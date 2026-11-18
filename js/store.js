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
  leggi: (k) => leggi(k),
  scrivi: (k, v) => scrivi(k, v),
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
  const salvato = await leggi('doc');
  state.doc = salvato ? normalizeDoc(salvato) : createEmptyDoc();
  osservaTimestamp(state.doc);
  state.snapshots = (await leggi('snapshots')) || {};
  if (!salvato) await scrivi('doc', state.doc);
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
    await scrivi('doc', state.doc);
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
  timerSnap = setTimeout(() => scrivi('snapshots', state.snapshots).catch(() => {}), 1000);
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
