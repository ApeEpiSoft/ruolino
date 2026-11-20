// =============================================================================
// model.test.js — Test di modello dati e chiavi di ordinamento.
// =============================================================================

import { test, assert } from './runner.js';
import { keyBetween, compareOrder } from '../js/core/order.js';
import {
  createEmptyDoc, addTask, updateTask, deleteTask, moveTask, macros, children,
  summary, addLog, setRemaining, live, setException, capacityOn, normalizeDoc, statoEffettivo,
  gruppiEccezioni,
} from '../js/core/model.js';

test('eccezioni: date consecutive con stesse ore e motivo diventano un periodo', () => {
  const d = createEmptyDoc();
  // Ferie lun 21 dic – ven 1 gen 2027, weekend 26-27 dic inseriti, 2-3 gen no (sab-dom), poi lun 4.
  for (let g = '2026-12-21'; g <= '2027-01-01'; g = addDays(g, 1)) setException(d, g, 0, 'Ferie');
  setException(d, '2027-01-04', 0, 'Ferie');
  setException(d, '2026-12-08', 0, 'Festa');
  setException(d, '2026-11-20', 4.5, '');
  setException(d, '2026-11-23', 4.5, ''); // lunedì dopo un weekend libero: stesso periodo
  setException(d, '2026-12-09', 0, 'ferie'); // motivo diverso (maiuscola): periodo diverso
  const elenco = live(d.exceptions).sort((a, b) => a.date.localeCompare(b.date));
  const gr = gruppiEccezioni(d, elenco, weekday);
  assert.deepEqual(gr.map((g) => [g.dal, g.al, g.voci.length, g.note]), [
    ['2026-11-20', '2026-11-23', 2, ''],
    ['2026-12-08', '2026-12-08', 1, 'Festa'],
    ['2026-12-09', '2026-12-09', 1, 'ferie'],
    ['2026-12-21', '2027-01-04', 13, 'Ferie'],
  ]);
});

test('eccezioni: un giorno lavorativo senza eccezione interrompe il periodo', () => {
  const d = createEmptyDoc();
  setException(d, '2026-11-16', 0, 'Ferie');
  setException(d, '2026-11-18', 0, 'Ferie'); // martedì 17 è lavorativo
  const elenco = live(d.exceptions).sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(gruppiEccezioni(d, elenco, weekday).length, 2);
});
import { addDays, weekday, diffDays } from '../js/core/dates.js';

test('ordine: chiavi sempre crescenti inserendo in fondo, in cima e in mezzo', () => {
  let chiavi = [keyBetween(null, null)];
  for (let i = 0; i < 300; i++) chiavi.push(keyBetween(chiavi[chiavi.length - 1], null));
  for (let i = 0; i < 300; i++) chiavi.unshift(keyBetween(null, chiavi[0]));
  // Inserimenti casuali in mezzo (generatore deterministico).
  let seme = 42;
  const caso = () => (seme = (seme * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i++) {
    const j = Math.floor(caso() * (chiavi.length - 1));
    chiavi.splice(j + 1, 0, keyBetween(chiavi[j], chiavi[j + 1]));
  }
  for (let i = 1; i < chiavi.length; i++) {
    assert.ok(chiavi[i - 1] < chiavi[i], `ordine violato: ${chiavi[i - 1]} / ${chiavi[i]}`);
  }
  assert.ok(chiavi.every((k) => !k.endsWith('0')), 'nessuna chiave termina con 0');
});

test('ordine: inserimenti ripetuti nello stesso punto restano validi', () => {
  let a = keyBetween(null, null);
  const b = keyBetween(a, null);
  for (let i = 0; i < 200; i++) {
    const m = keyBetween(a, b);
    assert.ok(a < m && m < b);
    a = m;
  }
});

test('ordine: errore se i vicini sono invertiti', () => {
  assert.throws(() => keyBetween('b', 'a'));
});

test('ordine: a parità di chiave decide l\'id', () => {
  assert.equal(compareOrder({ order: 'V', id: 'a' }, { order: 'V', id: 'b' }), -1);
});

test('modello: urgenza in cima e attività normale in fondo', () => {
  const d = createEmptyDoc();
  const a = addTask(d, { title: 'A' });
  const b = addTask(d, { title: 'B' });
  const u = addTask(d, { title: 'U' }, 'top');
  assert.deepEqual(macros(d).map((t) => t.title), ['U', 'A', 'B']);
  moveTask(d, u.id, b.id, null);
  assert.deepEqual(macros(d).map((t) => t.title), ['A', 'B', 'U']);
  moveTask(d, b.id, null, a.id);
  assert.deepEqual(macros(d).map((t) => t.title), ['B', 'A', 'U']);
});

test('modello: spostamento con chiavi duplicate (dopo un\'unione) rinumera', () => {
  const d = createEmptyDoc();
  const a = addTask(d, { title: 'A' });
  const b = addTask(d, { title: 'B' });
  const c = addTask(d, { title: 'C' });
  b.order = a.order; // situazione anomala
  const [primo, secondo] = macros(d);
  moveTask(d, c.id, primo.id, secondo.id);
  assert.deepEqual(macros(d).map((t) => t.title), [primo.title, 'C', secondo.title]);
});

test('modello: ore lavorate = somma delle registrazioni; aggregazione su macro', () => {
  const d = createEmptyDoc();
  const m = addTask(d, { title: 'M', estimate: 2 });
  const s1 = addTask(d, { title: 'S1', estimate: 5, parentId: m.id });
  const s2 = addTask(d, { title: 'S2', estimate: 3, parentId: m.id });
  addLog(d, { taskId: s1.id, date: '2026-11-16', hours: 2.5 });
  addLog(d, { taskId: s1.id, date: '2026-11-17', hours: 1 });
  addLog(d, { taskId: m.id, date: '2026-11-17', hours: 0.5 });
  const s = summary(d, m.id);
  assert.equal(s.estimate, 10);
  assert.equal(s.worked, 4);
  assert.equal(s.remaining, 6);
  assert.equal(summary(d, s1.id).remaining, 1.5);
  assert.equal(d.tasks[s1.id].status, 'todo', 'registrare ore non modifica il record dell\'attività');
  assert.equal(statoEffettivo(d, d.tasks[s1.id]), 'doing', 'ma l\'attività risulta in corso');
  assert.equal(statoEffettivo(d, d.tasks[m.id]), 'doing');
  assert.equal(statoEffettivo(d, d.tasks[s2.id]), 'todo');
});

test('modello: correggere il residuo cambia la stima corrente, non l\'originale', () => {
  const d = createEmptyDoc();
  const a = addTask(d, { title: 'A', estimate: 10 });
  addLog(d, { taskId: a.id, date: '2026-11-16', hours: 6 });
  setRemaining(d, a.id, 8);
  assert.equal(d.tasks[a.id].estimate, 14);
  assert.equal(d.tasks[a.id].estimateOriginal, 10);
  assert.equal(summary(d, a.id).remaining, 8);
});

test('modello: completata ha 0 ore rimanenti e data di completamento', () => {
  const d = createEmptyDoc();
  const a = addTask(d, { title: 'A', estimate: 10 });
  updateTask(d, a.id, { status: 'done' });
  assert.equal(summary(d, a.id).remaining, 0);
  assert.ok(d.tasks[a.id].completedAt);
  updateTask(d, a.id, { status: 'doing' });
  assert.equal(d.tasks[a.id].completedAt, null);
});

test('modello: la cancellazione è un tombstone, anche per le sottoattività', () => {
  const d = createEmptyDoc();
  const m = addTask(d, { title: 'M' });
  const s = addTask(d, { title: 'S', parentId: m.id });
  const t0 = d.tasks[s.id].updatedAt;
  deleteTask(d, m.id);
  assert.ok(d.tasks[m.id].deletedAt, 'record conservato con deletedAt');
  assert.ok(d.tasks[s.id].deletedAt);
  assert.ok(d.tasks[s.id].updatedAt > t0, 'timestamp aggiornato');
  assert.equal(macros(d).length, 0);
  assert.equal(children(d, m.id).length, 0);
});

test('modello: ogni modifica aggiorna updatedAt in modo strettamente crescente', () => {
  const d = createEmptyDoc();
  const a = addTask(d, { title: 'A' });
  let prec = a.updatedAt;
  for (let i = 0; i < 50; i++) {
    updateTask(d, a.id, { notes: 'n' + i });
    assert.ok(a.updatedAt > prec);
    prec = a.updatedAt;
  }
});

test('modello: eccezione con id derivato dalla data (stesso record da due dispositivi)', () => {
  const d = createEmptyDoc();
  setException(d, '2026-12-24', 4);
  setException(d, '2026-12-24', 0, 'Ferie');
  assert.equal(live(d.exceptions).length, 1);
  assert.equal(capacityOn(d, '2026-12-24', weekday), 0);
  assert.equal(capacityOn(d, '2026-12-23', weekday), 8);
});

test('modello: normalizeDoc completa un documento parziale', () => {
  const d = normalizeDoc({ tasks: {} });
  assert.ok(d.settings.weekly.length === 7);
  assert.ok(typeof d.logs === 'object');
});

test('date: somme e differenze attraverso il cambio dell\'ora legale', () => {
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(diffDays('2026-03-01', '2026-04-01'), 31);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
