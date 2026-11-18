// =============================================================================
// merge.test.js — Test dell'unione a tre vie dei documenti.
// =============================================================================

import { test, assert } from './runner.js';
import { merge, restoreFrom, ripristinaConflitto, archiviaConflitto, stesseVersioni, pulisci } from '../js/core/merge.js';
import { createEmptyDoc, addTask, updateTask, deleteTask, addLog, setWeekly, setDevice, macros, live } from '../js/core/model.js';

const copia = (x) => JSON.parse(JSON.stringify(x));

/** Base comune + due copie divergenti (dispositivi A e B). */
function treCopie(prepara) {
  setDevice('dev-A');
  const base = createEmptyDoc();
  if (prepara) prepara(base);
  return { base, A: copia(base), B: copia(base) };
}

test('unione: senza base è la somma dei dati', () => {
  setDevice('dev-A');
  const a = createEmptyDoc();
  addTask(a, { title: 'Da A' });
  setDevice('dev-B');
  const b = createEmptyDoc();
  addTask(b, { title: 'Da B' });
  const { doc, conflitti } = merge(a, b, null);
  assert.deepEqual(macros(doc).map((t) => t.title).sort(), ['Da A', 'Da B']);
  assert.equal(conflitti.length, 0);
});

test('unione: modifica solo da una parte vince anche se più vecchia', () => {
  let id;
  const { base, A, B } = treCopie((d) => { id = addTask(d, { title: 'T' }).id; });
  setDevice('dev-B');
  updateTask(B, id, { title: 'Modificata su B' });
  // A non tocca il record: deve prevalere B, nessun conflitto.
  const { doc, conflitti } = merge(A, B, base);
  assert.equal(doc.tasks[id].title, 'Modificata su B');
  assert.equal(conflitti.length, 0);
});

test('unione: modifiche concorrenti → vince la più recente, la perdente va nei conflitti', () => {
  let id;
  const { base, A, B } = treCopie((d) => { id = addTask(d, { title: 'T', estimate: 4 }).id; });
  setDevice('dev-A');
  updateTask(A, id, { estimate: 6 });
  setDevice('dev-B');
  updateTask(B, id, { estimate: 10 }); // più recente
  const { doc, conflitti } = merge(A, B, base);
  assert.equal(doc.tasks[id].estimate, 10);
  assert.equal(conflitti.length, 1);
  assert.equal(conflitti[0].scartata.estimate, 6);
  assert.equal(conflitti[0].tenuta.estimate, 10);
  assert.ok(doc.conflicts[conflitti[0].id], 'il conflitto è salvato nel documento');
  // Stesso risultato unendo nell'altro verso, e nessun conflitto duplicato.
  const inverso = merge(B, A, base);
  assert.equal(inverso.doc.tasks[id].estimate, 10);
  assert.equal(inverso.conflitti[0].id, conflitti[0].id);
  const di_nuovo = merge(doc, inverso.doc, base);
  assert.equal(Object.keys(di_nuovo.doc.conflicts).length, 1);
});

test('unione: modifiche concorrenti identiche non generano conflitti', () => {
  let id;
  const { base, A, B } = treCopie((d) => { id = addTask(d, { title: 'T' }).id; });
  setDevice('dev-A');
  updateTask(A, id, { status: 'done' });
  setDevice('dev-B');
  updateTask(B, id, { status: 'done' });
  B.tasks[id].completedAt = A.tasks[id].completedAt;
  assert.equal(merge(A, B, base).conflitti.length, 0);
});

test('unione: eliminazione contro modifica concorrente non perde nulla', () => {
  let id;
  const { base, A, B } = treCopie((d) => { id = addTask(d, { title: 'T' }).id; });
  setDevice('dev-A');
  deleteTask(A, id);
  setDevice('dev-B');
  updateTask(B, id, { notes: 'appunti importanti' }); // più recente
  const { doc, conflitti } = merge(A, B, base);
  assert.ok(!doc.tasks[id].deletedAt, 'la modifica più recente fa rivivere l\'attività');
  assert.equal(conflitti.length, 1);
  assert.ok(conflitti[0].scartata.deletedAt, 'l\'eliminazione è registrata come conflitto');
});

test('unione: le ore registrate da due dispositivi si sommano', () => {
  let id;
  const { base, A, B } = treCopie((d) => { id = addTask(d, { title: 'T', estimate: 10 }).id; });
  setDevice('dev-A');
  addLog(A, { taskId: id, date: '2026-11-16', hours: 2 });
  setDevice('dev-B');
  addLog(B, { taskId: id, date: '2026-11-16', hours: 3 });
  const { doc } = merge(A, B, base);
  const tot = live(doc.logs).reduce((s, l) => s + l.hours, 0);
  assert.equal(tot, 5);
});

test('unione: ore registrate su un\'attività eliminata altrove la ripristinano', () => {
  let id;
  const { base, A, B } = treCopie((d) => { id = addTask(d, { title: 'T' }).id; });
  setDevice('dev-A');
  deleteTask(A, id);
  setDevice('dev-B');
  addLog(B, { taskId: id, date: '2026-11-16', hours: 2 });
  const { doc, conflitti } = merge(A, B, base);
  assert.ok(!doc.tasks[id].deletedAt);
  assert.equal(conflitti.length, 1);
  assert.ok(conflitti[0].scartata.deletedAt);
});

test('unione: ore registrate PRIMA dell\'eliminazione non ripristinano l\'attività', () => {
  let id;
  const { base, A, B } = treCopie((d) => { id = addTask(d, { title: 'T' }).id; });
  setDevice('dev-B');
  addLog(B, { taskId: id, date: '2026-11-16', hours: 2 });
  setDevice('dev-A');
  deleteTask(A, id);
  const { doc } = merge(A, B, base);
  assert.ok(doc.tasks[id].deletedAt);
});

test('unione: un record vivo non sparisce se manca dal remoto (file riportato indietro)', () => {
  let id;
  const { base, A } = treCopie((d) => { id = addTask(d, { title: 'T' }).id; });
  const remotoVecchio = createEmptyDoc(); // non contiene T
  remotoVecchio.settings = copia(base.settings);
  const { doc } = merge(A, remotoVecchio, base);
  assert.ok(doc.tasks[id] && !doc.tasks[id].deletedAt);
});

test('unione: un tombstone ripulito da una parte resta ripulito', () => {
  let id;
  const { base, A, B } = treCopie((d) => { id = addTask(d, { title: 'T' }).id; deleteTask(d, id); });
  delete B.tasks[id]; // B ha fatto la pulizia
  const { doc } = merge(A, B, base);
  assert.equal(doc.tasks[id], undefined);
});

test('unione: pulizia dei tombstone vecchi, conservazione di quelli recenti', () => {
  setDevice('dev-A');
  const d = createEmptyDoc();
  const vecchio = addTask(d, { title: 'vecchio' });
  const recente = addTask(d, { title: 'recente' });
  vecchio.deletedAt = Date.now() - 200 * 86400000;
  recente.deletedAt = Date.now() - 10 * 86400000;
  pulisci(d);
  assert.equal(d.tasks[vecchio.id], undefined);
  assert.ok(d.tasks[recente.id]);
});

test('unione: impostazioni "mai toccate" di un dispositivo nuovo perdono senza conflitto', () => {
  setDevice('dev-A');
  const a = createEmptyDoc();
  setWeekly(a, 5, 4);
  setDevice('dev-B');
  const nuovo = createEmptyDoc(); // creato DOPO, ma mai modificato
  const { doc, conflitti } = merge(nuovo, a, null);
  assert.equal(doc.settings.weekly[5], 4);
  assert.equal(conflitti.length, 0);
});

test('unione: il risultato non dipende dall\'ordine (commutativa)', () => {
  let id;
  const { base, A, B } = treCopie((d) => { id = addTask(d, { title: 'T' }).id; });
  setDevice('dev-A');
  addTask(A, { title: 'A1' });
  updateTask(A, id, { title: 'TA' });
  setDevice('dev-B');
  addTask(B, { title: 'B1' });
  updateTask(B, id, { notes: 'nb' });
  const x = merge(A, B, base).doc;
  const y = merge(B, A, base).doc;
  // I record dei conflitti hanno un proprio timestamp di creazione: si confrontano i dati.
  x.conflicts = {}; y.conflicts = {};
  assert.ok(stesseVersioni(x, y));
});

test('unione: ripristino della versione scartata di un conflitto', () => {
  let id;
  const { base, A, B } = treCopie((d) => { id = addTask(d, { title: 'T', estimate: 4 }).id; });
  setDevice('dev-A'); updateTask(A, id, { estimate: 6 });
  setDevice('dev-B'); updateTask(B, id, { estimate: 10 });
  const { doc, conflitti } = merge(A, B, base);
  ripristinaConflitto(doc, conflitti[0].id);
  assert.equal(doc.tasks[id].estimate, 6);
  assert.ok(doc.conflicts[conflitti[0].id].deletedAt, 'conflitto archiviato');
  const altro = merge(A, B, base);
  archiviaConflitto(altro.doc, altro.conflitti[0].id);
  assert.equal(altro.doc.tasks[id].estimate, 10);
});

test('ripristino backup: i record del backup tornano, quelli nuovi vengono eliminati', () => {
  setDevice('dev-A');
  const d = createEmptyDoc();
  const t1 = addTask(d, { title: 'T1', estimate: 5 });
  const backup = copia(d);
  updateTask(d, t1.id, { estimate: 99 });
  const t2 = addTask(d, { title: 'T2' });
  const r = restoreFrom(d, backup);
  assert.equal(r.tasks[t1.id].estimate, 5);
  assert.ok(r.tasks[t2.id].deletedAt);
  assert.ok(r.tasks[t1.id].updatedAt > d.tasks[t1.id].updatedAt, 'il ripristino è la modifica più recente');
  // Unito con lo stato attuale di un altro dispositivo, il ripristino prevale.
  const { doc } = merge(d, r, d);
  assert.equal(doc.tasks[t1.id].estimate, 5);
  assert.ok(doc.tasks[t2.id].deletedAt);
});
