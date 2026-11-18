// =============================================================================
// merge.js — Unione record per record di due versioni del documento
// (come fa KeePass): la copia locale e quella su Dropbox.
//
// Si usa un'unione "a tre vie": oltre alle due versioni da unire (L = locale,
// R = remota) si conosce la BASE (B), cioè la versione dell'ultima
// sincronizzazione riuscita. Per ogni record (stesso id):
//
//   - L e R identici                → nessun problema;
//   - L uguale alla base            → è cambiato solo il remoto: si prende R;
//   - R uguale alla base            → è cambiato solo il locale: si prende L;
//   - entrambi cambiati (concorrenti) → vince la modifica più recente
//     (updatedAt; a parità decide l'id del dispositivo) e la versione
//     perdente viene salvata in doc.conflicts, visibile e ripristinabile:
//     NESSUNA modifica viene persa in silenzio.
//
// "Uguale" si valuta sulla coppia (updatedAt, dev), che cambia a ogni modifica.
// Un record assente da una parte ma presente nella base è stato eliminato
// definitivamente (pulizia dei tombstone) da quella parte.
//
// Senza base (prima sincronizzazione o import) ogni differenza è trattata
// come concorrente: vince il più recente.
//
// Modulo puro: non modifica gli argomenti, restituisce un nuovo documento.
// =============================================================================

import { normalizeDoc, getDevice, touch } from './model.js';
import { now } from './ids.js';

/** Collezioni di record unite con le regole sopra. */
export const COLLEZIONI = ['tasks', 'logs', 'exceptions', 'days'];

/** Tombstone e conflitti archiviati più vecchi di così vengono eliminati. */
export const GIORNI_PULIZIA = 180;
const MAX_CONFLITTI = 200;

const versione = (r) => (r ? `${r.updatedAt}|${r.dev}` : null);
const copia = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** true se `a` è più recente di `b`. */
function piùRecente(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return String(a.dev) > String(b.dev);
}

/** Confronto del contenuto di due record ignorando i metadati di modifica. */
export function stessoContenuto(a, b) {
  const pulisci = (r) => {
    const o = Object.assign({}, r);
    delete o.updatedAt;
    delete o.dev;
    return JSON.stringify(o, Object.keys(o).sort());
  };
  return pulisci(a) === pulisci(b);
}

/** Titolo leggibile di un record, per l'elenco dei conflitti. */
function descrivi(col, r, doc) {
  if (!r) return '';
  switch (col) {
    case 'tasks': return r.title || '(attività)';
    case 'logs': {
      const t = doc.tasks[r.taskId];
      return `Ore del ${r.date}${t ? ' su ' + t.title : ''}`;
    }
    case 'exceptions': return 'Capacità del ' + r.date;
    case 'days': return 'Giorno ' + r.date;
    case 'settings': return 'Impostazioni';
    default: return r.id;
  }
}

/**
 * Unisce una collezione (mappa id → record).
 * Restituisce { risultato, perdenti: [{ vincitore, perdente }] }.
 */
function unisciCollezione(L = {}, R = {}, B = null, registra = true) {
  const risultato = {};
  const perdenti = [];
  const ids = new Set([...Object.keys(L), ...Object.keys(R)]);
  for (const id of ids) {
    const l = L[id];
    const r = R[id];
    const b = B ? B[id] : undefined;
    const vl = versione(l), vr = versione(r), vb = versione(b);
    let scelto;
    if (vl === vr) scelto = l;
    // Cambiato solo il remoto. Se il record manca dal remoto si accetta la
    // scomparsa solo per un tombstone (pulizia): un record vivo non sparisce
    // mai (es. file su Dropbox riportato a una versione vecchia).
    else if (B && vl === vb) scelto = r !== undefined ? r : (l && !l.deletedAt ? l : undefined);
    // Cambiato solo il locale (stessa regola, a parti invertite).
    else if (B && vr === vb) scelto = l !== undefined ? l : (r && !r.deletedAt ? r : undefined);
    else if (!l) scelto = r;
    else if (!r) scelto = l;
    else {
      // Modifiche concorrenti: vince la più recente.
      const [vince, perde] = piùRecente(l, r) ? [l, r] : [r, l];
      scelto = vince;
      // Si registra il conflitto solo se il contenuto differiva davvero e la
      // versione perdente non era "mai toccata" (updatedAt = 0).
      if (registra && perde.updatedAt > 0 && !stessoContenuto(l, r)) {
        perdenti.push({ vincitore: vince, perdente: perde });
      }
    }
    if (scelto) risultato[id] = copia(scelto);
  }
  return { risultato, perdenti };
}

/**
 * Unisce documento locale e remoto rispetto alla base.
 * @param {object} locale
 * @param {object} remoto
 * @param {object|null} base   versione dell'ultima sincronizzazione (o null)
 * @param {object} opzioni     { registraConflitti = true, adesso = Date.now() }
 * @returns {{ doc: object, conflitti: Array }}
 */
export function merge(locale, remoto, base, opzioni = {}) {
  const registra = opzioni.registraConflitti !== false;
  const adesso = opzioni.adesso ?? Date.now();
  const L = normalizeDoc(copia(locale));
  const R = normalizeDoc(copia(remoto));
  const B = base ? normalizeDoc(copia(base)) : null;

  const doc = { schema: Math.max(L.schema || 1, R.schema || 1) };
  const nuoviConflitti = [];

  for (const col of COLLEZIONI) {
    const { risultato, perdenti } = unisciCollezione(L[col], R[col], B && B[col], registra);
    doc[col] = risultato;
    for (const p of perdenti) nuoviConflitti.push({ col, ...p });
  }

  // Impostazioni: un unico record, stesse regole.
  const s = unisciCollezione({ s: L.settings }, { s: R.settings }, B && { s: B.settings }, registra);
  doc.settings = s.risultato.s || L.settings;
  for (const p of s.perdenti) nuoviConflitti.push({ col: 'settings', ...p });

  // Ore registrate su un'attività eliminata nel frattempo su un altro
  // dispositivo (registrazione più recente dell'eliminazione): l'attività
  // viene ripristinata, così le ore non finiscono "nel vuoto", e il caso
  // compare tra i conflitti.
  const resuscita = (t) => {
    const vecchio = copia(t);
    t.deletedAt = null;
    t.updatedAt = now();
    t.dev = getDevice();
    nuoviConflitti.push({ col: 'tasks', vincitore: t, perdente: vecchio });
  };
  for (const l of Object.values(doc.logs)) {
    const t = doc.tasks[l.taskId];
    if (l.deletedAt || !t || !t.deletedAt || l.updatedAt <= t.updatedAt) continue;
    resuscita(t);
    const m = t.parentId ? doc.tasks[t.parentId] : null;
    if (m && m.deletedAt) resuscita(m);
  }

  // Conflitti già registrati: unione semplice (vince il più recente, niente meta-conflitti).
  doc.conflicts = unisciCollezione(L.conflicts, R.conflicts, B && B.conflicts, false).risultato;

  // Nuovi conflitti. L'id è deterministico (record + versione perdente), così
  // se entrambi i dispositivi rilevano lo stesso conflitto non si duplica.
  const conflitti = [];
  for (const { col, vincitore, perdente } of nuoviConflitti) {
    const id = `cf-${col}-${perdente.id}-${perdente.updatedAt}`;
    if (doc.conflicts[id]) continue;
    const c = {
      id,
      col,
      recId: perdente.id,
      titolo: descrivi(col, vincitore, doc),
      tenuta: copia(vincitore),
      scartata: copia(perdente),
      at: adesso,
      updatedAt: now(),
      dev: getDevice(),
      deletedAt: null,
    };
    doc.conflicts[id] = c;
    conflitti.push(c);
  }

  pulisci(doc, adesso);
  return { doc, conflitti };
}

/**
 * Elimina definitivamente i tombstone più vecchi di GIORNI_PULIZIA e limita
 * il numero di conflitti conservati.
 */
export function pulisci(doc, adesso = Date.now()) {
  const limite = adesso - GIORNI_PULIZIA * 86400000;
  for (const col of [...COLLEZIONI, 'conflicts']) {
    for (const [id, r] of Object.entries(doc[col])) {
      if (r.deletedAt && r.deletedAt < limite) delete doc[col][id];
    }
  }
  const attivi = Object.values(doc.conflicts).filter((c) => !c.deletedAt).sort((a, b) => b.at - a.at);
  for (const c of attivi.slice(MAX_CONFLITTI)) delete doc.conflicts[c.id];
  return doc;
}

/**
 * true se due documenti hanno esattamente le stesse versioni di tutti i
 * record (cioè l'unione non ha portato nulla di nuovo).
 */
export function stesseVersioni(a, b) {
  const firma = (d) => {
    const parti = [];
    for (const col of [...COLLEZIONI, 'conflicts']) {
      for (const id of Object.keys(d[col] || {}).sort()) parti.push(col + ':' + id + ':' + versione(d[col][id]));
    }
    parti.push('settings:' + versione(d.settings));
    return parti.join('\n');
  };
  return firma(a) === firma(b);
}

/**
 * Ripristino da backup: produce un documento che, una volta sincronizzato,
 * riporta TUTTI i dispositivi allo stato del backup. Ogni record del backup
 * viene "ritoccato" (diventa la modifica più recente) e i record attuali
 * assenti dal backup vengono marcati come eliminati.
 * I conflitti registrati restano.
 */
export function restoreFrom(attuale, backup) {
  const A = normalizeDoc(copia(attuale));
  const K = normalizeDoc(copia(backup));
  const out = { schema: A.schema, conflicts: A.conflicts };
  const ts = Date.now();
  for (const col of COLLEZIONI) {
    out[col] = {};
    for (const [id, r] of Object.entries(K[col])) out[col][id] = touch(copia(r));
    for (const [id, r] of Object.entries(A[col])) {
      if (out[col][id] || r.deletedAt) {
        if (!out[col][id]) out[col][id] = r;
        continue;
      }
      out[col][id] = touch(Object.assign(copia(r), { deletedAt: ts }));
    }
  }
  out.settings = touch(copia(K.settings));
  return out;
}

/**
 * Ripristina la versione scartata di un conflitto: diventa la modifica più
 * recente del record. Il conflitto viene archiviato.
 */
export function ripristinaConflitto(doc, idConflitto) {
  const c = doc.conflicts[idConflitto];
  if (!c) return;
  const rec = copia(c.scartata);
  touch(rec);
  if (c.col === 'settings') doc.settings = rec;
  else doc[c.col][c.recId] = rec;
  archiviaConflitto(doc, idConflitto);
}

/** Archivia (nasconde) un conflitto: "ho visto, va bene così". */
export function archiviaConflitto(doc, idConflitto) {
  const c = doc.conflicts[idConflitto];
  if (!c) return;
  c.deletedAt = Date.now();
  touch(c);
}
