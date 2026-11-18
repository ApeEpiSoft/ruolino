// =============================================================================
// store.js — Persistenza locale (IndexedDB) e stato condiviso dell'app.
//
// L'app lavora SEMPRE sulla copia locale: il documento viene caricato da
// IndexedDB all'avvio e risalvato (con un breve ritardo) dopo ogni modifica.
// La sincronizzazione con Dropbox (js/sync/) si appoggia a questo modulo.
//
// Contenuto del database 'ruolino', archivio 'kv' (chiave → valore):
//   'doc'           il documento dati completo
//   'deviceId'      identificativo di questo dispositivo (non sincronizzato)
//   'snapshots'     date di fine previste salvate giorno per giorno, per
//                   mostrare lo slittamento rispetto a ieri (solo locale)
//   'syncBase'      documento all'ultima sincronizzazione riuscita (base
//                   dell'unione a tre vie)
//   'syncMeta'      { rev, dirty, lastSync, lastBackup } della sincronizzazione
//   'dropboxToken'  token OAuth di Dropbox; 'dropboxPkce' login in corso
//   'appKey'        App key Dropbox inserita a mano (se non c'è in config.js)
//   'profili'       { elenco: [{id, nome}], attivo } — profili di questo dispositivo
//
// PROFILI: ogni profilo ha dati e collegamento Dropbox propri. Il profilo
// 'principale' usa le chiavi qui sopra così come sono (i dati esistenti non
// vanno spostati); gli altri le usano con il prefisso 'p-<id>/'.
// Sono comuni a tutti i profili solo 'deviceId', 'appKey' e 'profili'.
// Cambiare profilo ricarica la pagina (vedi attivaProfilo).
// =============================================================================

import { createEmptyDoc, normalizeDoc, setDevice } from './core/model.js';
import { newId, observe } from './core/ids.js';

const NOME_DB = 'ruolino';
const ARCHIVIO = 'kv';

let dbPromise = null;

function apriDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NOME_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(ARCHIVIO);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function leggi(chiave) {
  const db = await apriDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(ARCHIVIO).objectStore(ARCHIVIO).get(chiave);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function scrivi(chiave, valore) {
  const db = await apriDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ARCHIVIO, 'readwrite');
    tx.objectStore(ARCHIVIO).put(valore, chiave);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function cancella(chiave) {
  const db = await apriDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ARCHIVIO, 'readwrite');
    tx.objectStore(ARCHIVIO).delete(chiave);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// -----------------------------------------------------------------------------
// Profili
// -----------------------------------------------------------------------------

export const PRINCIPALE = 'principale';
const CHIAVI_COMUNI = new Set(['deviceId', 'appKey', 'profili']);
/** Chiavi di un profilo (cancellate quando si elimina il profilo). */
const CHIAVI_PROFILO = ['doc', 'snapshots', 'syncBase', 'syncMeta', 'dropboxToken', 'dropboxPkce'];

/** Profili di questo dispositivo (caricati da init). */
export const profili = { elenco: [{ id: PRINCIPALE, nome: 'Principale' }], attivo: PRINCIPALE };

/** Chiave effettiva nel database per il profilo `id` (default: quello attivo). */
function chiave(k, id = profili.attivo) {
  return CHIAVI_COMUNI.has(k) || id === PRINCIPALE ? k : `p-${id}/${k}`;
}

async function salvaProfili() {
  await scrivi('profili', { elenco: profili.elenco, attivo: profili.attivo });
  notifica(); // ridisegna (nomi dei profili nella testata e in Impostazioni)
}

/** Profilo attivo ({id, nome}). */
export function profiloAttivo() {
  return profili.elenco.find((p) => p.id === profili.attivo) || profili.elenco[0];
}

/** Crea un profilo vuoto (non lo attiva). */
export async function creaProfilo(nome) {
  const p = { id: newId().slice(0, 8), nome: (nome || '').trim() || 'Nuovo profilo' };
  profili.elenco.push(p);
  await salvaProfili();
  return p;
}

export async function rinominaProfilo(id, nome) {
  const p = profili.elenco.find((x) => x.id === id);
  if (!p || !(nome || '').trim()) return;
  p.nome = nome.trim();
  await salvaProfili();
}

/**
 * Elimina un profilo da questo dispositivo, con i suoi dati locali.
 * I dati su Dropbox restano. Non si può eliminare il profilo attivo né il principale.
 */
export async function eliminaProfilo(id) {
  if (id === profili.attivo || id === PRINCIPALE) return;
  for (const k of CHIAVI_PROFILO) await cancella(chiave(k, id));
  profili.elenco = profili.elenco.filter((p) => p.id !== id);
  await salvaProfili();
}

/**
 * Account Dropbox collegati agli ALTRI profili di questo dispositivo:
 * [{ profilo, account, email }]. Serve a impedire che due profili usino lo
 * stesso account (i loro dati finirebbero nello stesso file e si mescolerebbero).
 */
export async function accountAltriProfili() {
  const out = [];
  for (const p of profili.elenco) {
    if (p.id === profili.attivo) continue;
    const t = await leggi(chiave('dropboxToken', p.id));
    if (t && t.refresh) out.push({ profilo: p.nome, account: t.account, email: t.email });
  }
  return out;
}

/** Passa a un altro profilo: salva, registra la scelta e ricarica la pagina. */
export async function attivaProfilo(id) {
  if (!profili.elenco.some((p) => p.id === id)) return;
  await salvaOra();
  profili.attivo = id;
  await salvaProfili();
  location.reload();
}

// -----------------------------------------------------------------------------
// Stato in memoria
// -----------------------------------------------------------------------------

/** Stato condiviso: il documento corrente e un contatore di versione. */
export const state = {
  doc: null,
  version: 0,
  snapshots: {},
  errore: null,
};

const ascoltatori = new Set();
export function subscribe(fn) {
  ascoltatori.add(fn);
  return () => ascoltatori.delete(fn);
}

// Chi vuole sapere delle modifiche fatte dall'UTENTE (non quelle che arrivano
// dalla sincronizzazione): usato dal motore di sincronizzazione.
const ascoltatoriModifiche = new Set();
export function onMutate(fn) {
  ascoltatoriModifiche.add(fn);
  return () => ascoltatoriModifiche.delete(fn);
}

/** Archivio chiave-valore persistente, usato anche dalla sincronizzazione. */
export const archivio = {
  leggi: (k) => leggi(chiave(k)),
  scrivi: (k, v) => scrivi(chiave(k), v),
};
function notifica() {
  state.version++;
  for (const fn of ascoltatori) fn(state.version);
}

/** Carica dati e id dispositivo da IndexedDB (o crea un documento nuovo). */
export async function init() {
  let dev = await leggi('deviceId');
  if (!dev) {
    dev = 'dev-' + newId().slice(0, 8);
    await scrivi('deviceId', dev);
  }
  setDevice(dev);
  const p = await leggi('profili');
  if (p && Array.isArray(p.elenco) && p.elenco.length) {
    profili.elenco = p.elenco;
    profili.attivo = p.elenco.some((x) => x.id === p.attivo) ? p.attivo : p.elenco[0].id;
  }
  const salvato = await leggi(chiave('doc'));
  state.doc = salvato ? normalizeDoc(salvato) : createEmptyDoc();
  osservaTimestamp(state.doc);
  state.snapshots = (await leggi(chiave('snapshots'))) || {};
  if (!salvato) await scrivi(chiave('doc'), state.doc);
  notifica();
}

/** Fa avanzare l'orologio monotono oltre tutti i timestamp presenti. */
function osservaTimestamp(doc) {
  for (const k of ['tasks', 'logs', 'exceptions', 'days']) {
    for (const r of Object.values(doc[k])) observe(r.updatedAt);
  }
  observe(doc.settings.updatedAt);
  for (const r of Object.values(doc.conflicts || {})) observe(r.updatedAt);
}

let timerSalvataggio = null;

/**
 * Applica una modifica al documento: `fn(doc)` lo modifica sul posto.
 * Dopo la modifica l'interfaccia si aggiorna e il salvataggio parte dopo 300 ms.
 */
export function mutate(fn) {
  const risultato = fn(state.doc);
  notifica();
  clearTimeout(timerSalvataggio);
  timerSalvataggio = setTimeout(salvaOra, 300);
  for (const f of ascoltatoriModifiche) f();
  return risultato;
}

/** Salva subito il documento (usato anche quando la pagina va in background). */
export async function salvaOra() {
  clearTimeout(timerSalvataggio);
  timerSalvataggio = null;
  try {
    await scrivi(chiave('doc'), state.doc);
    state.errore = null;
  } catch (e) {
    state.errore = 'Salvataggio locale non riuscito: ' + e.message;
    notifica();
  }
}

/**
 * Sostituisce l'intero documento.
 * - dalla sincronizzazione (daSync = true): risultato dell'unione con Dropbox;
 * - dall'utente (import, ripristino backup): conta come modifica da caricare.
 */
export function applicaDoc(nuovo, { daSync = false } = {}) {
  state.doc = normalizeDoc(nuovo);
  osservaTimestamp(state.doc);
  notifica();
  if (!daSync) for (const f of ascoltatoriModifiche) f();
  return salvaOra();
}

/**
 * Salva le date di fine previste di oggi (chiamato a ogni ricalcolo).
 * Conserva solo gli ultimi 14 giorni.
 */
let timerSnap = null;
export function salvaSnapshot(data, fini) {
  const prec = state.snapshots[data];
  if (prec && JSON.stringify(prec) === JSON.stringify(fini)) return;
  state.snapshots[data] = fini;
  const date = Object.keys(state.snapshots).sort();
  while (date.length > 14) delete state.snapshots[date.shift()];
  clearTimeout(timerSnap);
  timerSnap = setTimeout(() => scrivi(chiave('snapshots'), state.snapshots).catch(() => {}), 1000);
}

/** Ultimo snapshot di un giorno precedente a `data` (o null). */
export function snapshotPrecedente(data) {
  const date = Object.keys(state.snapshots).filter((d) => d < data).sort();
  return date.length ? state.snapshots[date[date.length - 1]] : null;
}

// Salva quando l'app va in background (es. si cambia app sul telefono).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timerSalvataggio) salvaOra();
  });
}
