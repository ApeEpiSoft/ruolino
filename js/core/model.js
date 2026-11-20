// =============================================================================
// model.js — Modello dati di Ruolino e operazioni che lo modificano.
//
// Tutto lo stato dell'app è un unico oggetto "documento" (doc), serializzabile
// in JSON. È organizzato in COLLEZIONI di record indicizzati per id:
//
//   doc.tasks       attività (macro: parentId = null) e sottoattività
//   doc.logs        registrazioni di ore lavorate
//   doc.exceptions  eccezioni di capacità per singola data (id = 'exc-AAAA-MM-GG')
//   doc.days        conferme "giorno senza lavoro" (id = 'day-AAAA-MM-GG')
//   doc.settings    impostazioni (record unico, id = 'settings')
//   doc.conflicts   versioni scartate durante l'unione (vedi merge.js)
//
// Regole fondamentali, necessarie per la sincronizzazione tra dispositivi:
//  - ogni record ha `id`, `updatedAt` (ms, orologio monotono) e `dev` (dispositivo);
//  - nessun record viene eliminato: la cancellazione imposta `deletedAt` (tombstone);
//  - le ore lavorate NON sono un contatore: sono la somma delle registrazioni.
//    Così registrare ore sul telefono e correggere la stima sul PC tocca
//    record diversi e non crea conflitti.
//  - la stima corrente (`estimate`) è separata da quella originale
//    (`estimateOriginal`), che serve per le statistiche di precisione.
//
// Le funzioni che modificano il doc lo fanno "sul posto" e aggiornano
// updatedAt/dev del record toccato tramite touch().
// =============================================================================

import { newId, now } from './ids.js';
import { keyBetween, compareOrder } from './order.js';
import { todayISO, addDays } from './dates.js';

export const SCHEMA = 1;

/** Stati possibili di un'attività, con etichette italiane. */
export const STATI = {
  todo: 'Da fare',
  doing: 'In corso',
  paused: 'In pausa',
  done: 'Completata',
};

// Dispositivo corrente: impostato all'avvio dall'app (vedi store.js).
let deviceId = 'sconosciuto';
export function setDevice(id) { deviceId = id; }
export function getDevice() { return deviceId; }

/** Arrotonda le ore al quarto d'ora (granularità dell'app). */
export function q(h) {
  const n = Number(h);
  if (!isFinite(n)) return 0;
  return Math.round(n * 4) / 4;
}

/** Marca un record come modificato ora da questo dispositivo. */
export function touch(rec) {
  rec.updatedAt = now();
  rec.dev = deviceId;
  return rec;
}

/** Crea un documento vuoto con le impostazioni predefinite. */
export function createEmptyDoc() {
  const t = now();
  return {
    schema: SCHEMA,
    tasks: {},
    logs: {},
    exceptions: {},
    days: {},
    settings: {
      id: 'settings',
      // Ore per giorno della settimana, indice 0 = domenica … 6 = sabato.
      weekly: [0, 8, 8, 8, 8, 8, 0],
      // Fattore di correzione delle stime (fase 3): 1 = nessuna correzione.
      applyCorrection: false,
      createdAt: t,
      // updatedAt = 0: impostazioni "mai toccate". Così, alla prima
      // sincronizzazione di un dispositivo nuovo, vincono quelle già su Dropbox.
      updatedAt: 0,
      dev: deviceId,
    },
    // Versioni scartate durante l'unione (id → record conflitto), vedi merge.js.
    conflicts: {},
  };
}

/** Completa un documento caricato da file/backup con le parti mancanti. */
export function normalizeDoc(doc) {
  const base = createEmptyDoc();
  const d = Object.assign({}, base, doc || {});
  for (const k of ['tasks', 'logs', 'exceptions', 'days']) {
    if (!d[k] || typeof d[k] !== 'object') d[k] = {};
  }
  d.settings = Object.assign({}, base.settings, d.settings || {});
  if (!Array.isArray(d.settings.weekly) || d.settings.weekly.length !== 7) {
    d.settings.weekly = base.settings.weekly;
  }
  // Nella prima versione i conflitti erano un array: ora sono una mappa per id.
  if (Array.isArray(d.conflicts)) {
    const m = {};
    for (const c of d.conflicts) if (c && c.id) m[c.id] = c;
    d.conflicts = m;
  } else if (!d.conflicts || typeof d.conflicts !== 'object') {
    d.conflicts = {};
  }
  return d;
}

/** Record non cancellati di una collezione. */
export function live(col) {
  return Object.values(col).filter((r) => !r.deletedAt);
}

// -----------------------------------------------------------------------------
// Letture
// -----------------------------------------------------------------------------

/** Macro-attività vive, nell'ordine della coda (incluse le completate). */
export function macros(doc) {
  return live(doc.tasks).filter((t) => !t.parentId).sort(compareOrder);
}

/** Sottoattività vive di una macro, nel loro ordine. */
export function children(doc, macroId) {
  return live(doc.tasks).filter((t) => t.parentId === macroId).sort(compareOrder);
}

/** Mappa taskId → ore registrate direttamente su quel record. */
export function workedMap(doc) {
  const m = {};
  for (const l of live(doc.logs)) m[l.taskId] = (m[l.taskId] || 0) + Number(l.hours || 0);
  return m;
}

/** Ore registrate in una certa data, su tutte le attività. */
export function loggedOn(doc, date) {
  let s = 0;
  for (const l of live(doc.logs)) if (l.date === date) s += Number(l.hours || 0);
  return q(s);
}

/**
 * Riepilogo ore di un record (macro o sottoattività).
 * Per una macro con sottoattività: le ore "proprie" della macro (lavoro non
 * assegnato a nessuna sottoattività) si sommano a quelle delle sottoattività.
 */
export function summary(doc, id, wm = workedMap(doc)) {
  const t = doc.tasks[id];
  const own = (r) => {
    const est = Number(r.estimate || 0);
    const orig = Number(r.estimateOriginal ?? r.estimate ?? 0);
    const worked = wm[r.id] || 0;
    const rem = r.status === 'done' ? 0 : Math.max(0, est - worked);
    return { estimate: est, estimateOriginal: orig, worked, remaining: rem };
  };
  const s = own(t);
  if (!t.parentId) {
    for (const c of children(doc, id)) {
      const cs = own(c);
      s.estimate += cs.estimate;
      s.estimateOriginal += cs.estimateOriginal;
      s.worked += cs.worked;
      s.remaining += t.status === 'done' ? 0 : cs.remaining;
    }
  }
  for (const k of Object.keys(s)) s[k] = q(s[k]);
  s.progress = s.estimate > 0 ? Math.min(1, s.worked / s.estimate) : (t.status === 'done' ? 1 : 0);
  return s;
}

// -----------------------------------------------------------------------------
// Modifiche alle attività
// -----------------------------------------------------------------------------

/** Chiave di ordinamento per inserire in cima o in fondo a una lista ordinata. */
function chiaveEstremo(lista, posizione) {
  if (lista.length === 0) return keyBetween(null, null);
  return posizione === 'top'
    ? keyBetween(null, lista[0].order)
    : keyBetween(lista[lista.length - 1].order, null);
}

/**
 * Crea un'attività. `fields` può contenere: title, notes, category, estimate,
 * deadline, maxPerDay, predecessors, parentId, status.
 * `posizione`: 'top' (urgenza, in cima) o 'bottom' (default).
 */
export function addTask(doc, fields, posizione = 'bottom') {
  const parentId = fields.parentId || null;
  const fratelli = parentId ? children(doc, parentId) : macros(doc);
  const est = q(fields.estimate || 0);
  const t = touch({
    id: newId(),
    parentId,
    title: (fields.title || '').trim() || 'Senza titolo',
    notes: fields.notes || '',
    category: fields.category || '',
    status: fields.status || 'todo',
    estimate: est,
    estimateOriginal: est,
    order: chiaveEstremo(fratelli, posizione),
    deadline: fields.deadline || null,
    fixedStart: fields.fixedStart || null, // date fisse: dal …
    fixedEnd: fields.fixedEnd || null, //            … al (null = un giorno solo)
    notBefore: fields.notBefore || null, // non prima del
    predecessors: fields.predecessors || [],
    maxPerDay: fields.maxPerDay ? q(fields.maxPerDay) : null,
    createdAt: Date.now(),
    completedAt: null,
    deletedAt: null,
  });
  doc.tasks[t.id] = t;
  return t;
}

/** Applica modifiche a un'attività (gestisce le date di completamento). */
export function updateTask(doc, id, patch) {
  const t = doc.tasks[id];
  if (!t) return null;
  const p = Object.assign({}, patch);
  if ('estimate' in p) p.estimate = q(p.estimate);
  if ('estimateOriginal' in p) p.estimateOriginal = q(p.estimateOriginal);
  if ('maxPerDay' in p) p.maxPerDay = p.maxPerDay ? q(p.maxPerDay) : null;
  if ('title' in p) p.title = (p.title || '').trim() || 'Senza titolo';
  // Date fisse: "al" prima di "dal" (o senza "dal") non ha senso.
  if ('fixedStart' in p || 'fixedEnd' in p) {
    const dal = 'fixedStart' in p ? p.fixedStart : t.fixedStart;
    const al = 'fixedEnd' in p ? p.fixedEnd : t.fixedEnd;
    if (!dal || (al && al <= dal)) p.fixedEnd = null;
  }
  if ('status' in p && p.status !== t.status) {
    p.completedAt = p.status === 'done' ? todayISO() : null;
  }
  Object.assign(t, p);
  touch(t);
  return t;
}

/** Cancella (tombstone) un'attività e, se è una macro, le sue sottoattività. */
export function deleteTask(doc, id) {
  const t = doc.tasks[id];
  if (!t) return;
  const ts = Date.now();
  for (const c of children(doc, id)) {
    c.deletedAt = ts;
    touch(c);
  }
  t.deletedAt = ts;
  touch(t);
}

/**
 * Sposta un record nella sua lista (coda o sottoattività di una macro) in modo
 * che si trovi tra `primaId` e `dopoId` (uno dei due può essere null).
 * Normalmente modifica un solo record; se le chiavi dei vicini sono anomale
 * (es. identiche dopo un'unione) rinumera la lista intera.
 */
export function moveTask(doc, id, primaId, dopoId) {
  const t = doc.tasks[id];
  const a = primaId ? doc.tasks[primaId] : null;
  const b = dopoId ? doc.tasks[dopoId] : null;
  try {
    t.order = keyBetween(a ? a.order : null, b ? b.order : null);
    touch(t);
  } catch {
    const lista = (t.parentId ? children(doc, t.parentId) : macros(doc)).filter((x) => x.id !== id);
    const i = b ? lista.findIndex((x) => x.id === b.id) : lista.length;
    lista.splice(i < 0 ? lista.length : i, 0, t);
    let k = null;
    for (const x of lista) {
      k = keyBetween(k, null);
      x.order = k;
      touch(x);
    }
  }
}

/**
 * Imposta le ore rimanenti di un'attività: la stima corrente diventa
 * ore lavorate + ore rimanenti. La stima originale resta invariata.
 */
export function setRemaining(doc, id, remaining) {
  const worked = workedMap(doc)[id] || 0;
  updateTask(doc, id, { estimate: q(worked + Math.max(0, q(remaining))) });
}

// -----------------------------------------------------------------------------
// Registro ore
// -----------------------------------------------------------------------------

/** Registra ore lavorate su un'attività in una data. */
export function addLog(doc, { taskId, date, hours, note = '' }) {
  const h = q(hours);
  if (!(h > 0) || !doc.tasks[taskId]) return null;
  // Nota: registrare ore NON modifica l'attività (lo stato "in corso" è
  // calcolato, vedi statoEffettivo): così le registrazioni fatte su un
  // dispositivo non entrano in conflitto con le modifiche all'attività fatte
  // su un altro.
  const l = touch({ id: newId(), taskId, date, hours: h, note, createdAt: Date.now(), deletedAt: null });
  doc.logs[l.id] = l;
  return l;
}

/**
 * Stato mostrato: un'attività "da fare" con ore registrate (anche sulle
 * sottoattività) risulta "in corso".
 */
export function statoEffettivo(doc, t, wm = workedMap(doc)) {
  if (t.status !== 'todo') return t.status;
  if (wm[t.id]) return 'doing';
  if (!t.parentId && children(doc, t.id).some((c) => wm[c.id])) return 'doing';
  return 'todo';
}

/** Modifica le ore di una registrazione esistente. */
export function updateLog(doc, id, patch) {
  const l = doc.logs[id];
  if (!l) return;
  if ('hours' in patch) patch = Object.assign({}, patch, { hours: q(patch.hours) });
  Object.assign(l, patch);
  touch(l);
}

/** Cancella (tombstone) una registrazione. */
export function deleteLog(doc, id) {
  const l = doc.logs[id];
  if (!l) return;
  l.deletedAt = Date.now();
  touch(l);
}

// -----------------------------------------------------------------------------
// Capacità
// -----------------------------------------------------------------------------

/** Imposta le ore di un giorno della settimana (0 = domenica). */
export function setWeekly(doc, giorno, ore) {
  const w = doc.settings.weekly.slice();
  w[giorno] = Math.max(0, Math.min(24, q(ore)));
  doc.settings.weekly = w;
  touch(doc.settings);
}

/**
 * Imposta un'eccezione di capacità per una data. L'id è derivato dalla data,
 * così due dispositivi che modificano la stessa data toccano lo stesso record.
 */
export function setException(doc, date, hours, note = '') {
  const id = 'exc-' + date;
  const r = doc.exceptions[id] || { id, date, createdAt: Date.now() };
  r.hours = Math.max(0, Math.min(24, q(hours)));
  r.note = note;
  r.deletedAt = null;
  doc.exceptions[id] = touch(r);
  return r;
}

export function deleteException(doc, date) {
  const r = doc.exceptions['exc-' + date];
  if (!r) return;
  r.deletedAt = Date.now();
  touch(r);
}

/**
 * Raggruppa le eccezioni (vive, ordinate per data) in periodi: date
 * consecutive con le stesse ore e lo stesso motivo. Tra due date del periodo
 * possono esserci solo giorni senza eccezione e senza ore settimanali (es. un
 * weekend non inserito). Restituisce [{ dal, al, hours, note, voci: [eccezioni] }].
 */
export function gruppiEccezioni(doc, elenco, weekdayFn) {
  const liberiTra = (a, b) => {
    for (let g = addDays(a, 1), i = 0; g < b; g = addDays(g, 1), i++) {
      if (i > 7 || capacityOn(doc, g, weekdayFn) > 0) return false;
    }
    return true;
  };
  const gruppi = [];
  for (const e of elenco) {
    const g = gruppi[gruppi.length - 1];
    if (g && g.hours === Number(e.hours || 0) && g.note === (e.note || '').trim() && liberiTra(g.al, e.date)) {
      g.al = e.date;
      g.voci.push(e);
    } else {
      gruppi.push({ dal: e.date, al: e.date, hours: Number(e.hours || 0), note: (e.note || '').trim(), voci: [e] });
    }
  }
  return gruppi;
}

/** Capacità (ore) di una data: eccezione se presente, altrimenti settimanale. */
export function capacityOn(doc, date, weekdayFn) {
  const e = doc.exceptions['exc-' + date];
  if (e && !e.deletedAt) return Number(e.hours || 0);
  return Number(doc.settings.weekly[weekdayFn(date)] || 0);
}

/** Attiva o disattiva la correzione delle stime nelle previsioni (vedi stats.js). */
export function setApplyCorrection(doc, attiva) {
  doc.settings.applyCorrection = !!attiva;
  touch(doc.settings);
}

/** Conferma che in una data non si è lavorato (per il promemoria ore mancanti). */
export function confirmNoWork(doc, date) {
  const id = 'day-' + date;
  doc.days[id] = touch({ id, date, noWork: true, deletedAt: null });
}
