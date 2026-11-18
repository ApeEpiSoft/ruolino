// =============================================================================
// vincoli.test.js — Date fisse (uno o più giorni) e "non prima del".
// Data di riferimento: lunedì 16 novembre 2026 (8 h lun–ven).
// =============================================================================

import { test, assert } from './runner.js';
import { schedule } from '../js/core/scheduler.js';
import { createEmptyDoc, addTask, updateTask, addLog } from '../js/core/model.js';

const LUN = '2026-11-16';
const MAR = '2026-11-17';
const MER = '2026-11-18';
const GIO = '2026-11-19';
const VEN = '2026-11-20';
const SAB = '2026-11-21';
const LUN2 = '2026-11-23';

const att = (d, title, estimate, extra = {}) => addTask(d, Object.assign({ title, estimate }, extra));

test('date fisse: un giorno solo, prima della coda', () => {
  const d = createEmptyDoc();
  const a = att(d, 'Coda', 40);
  const f = att(d, 'Riunione cliente', 4, { fixedStart: MER });
  const p = schedule(d, LUN);
  assert.deepEqual(p.tasks[f.id].days, { [MER]: 4 });
  assert.equal(p.tasks[f.id].start, MER);
  assert.equal(p.tasks[f.id].end, MER);
  assert.equal(p.tasks[a.id].days[MER], 4, 'la coda usa le ore che avanzano');
  assert.equal(p.tasks[a.id].end, LUN2);
});

test('date fisse: più giorni, le ore divise sui giorni lavorativi (salta il weekend)', () => {
  const d = createEmptyDoc();
  const a = att(d, 'Coda', 80);
  const f = att(d, 'Trasferta', 24, { fixedStart: GIO, fixedEnd: LUN2 });
  const p = schedule(d, LUN);
  assert.deepEqual(p.tasks[f.id].days, { [GIO]: 8, [VEN]: 8, [LUN2]: 8 });
  assert.equal(p.tasks[a.id].days[GIO], undefined, 'in trasferta la coda non avanza');
  assert.equal(p.tasks[a.id].days[VEN], undefined);
});

test('date fisse: ore oltre la capacità → giorno sovraccarico', () => {
  const d = createEmptyDoc();
  const a = att(d, 'Coda', 16);
  const f = att(d, 'Collaudo', 12, { fixedStart: MAR });
  const p = schedule(d, LUN);
  assert.equal(p.tasks[f.id].days[MAR], 12);
  assert.equal(p.overload[MAR], 4);
  assert.deepEqual(p.tasks[f.id].overload, [MAR]);
  assert.equal(p.tasks[a.id].days[MAR], undefined);
  assert.equal(p.tasks[a.id].end, MER);
});

test('date fisse: in un giorno non lavorativo le ore si fanno lo stesso (sovraccarico)', () => {
  const d = createEmptyDoc();
  const f = att(d, 'Fiera', 6, { fixedStart: SAB });
  const p = schedule(d, LUN);
  assert.deepEqual(p.tasks[f.id].days, { [SAB]: 6 });
  assert.equal(p.overload[SAB], 6);
});

test('date fisse: date passate con ore da fare → scaduta, la coda non ne risente', () => {
  const d = createEmptyDoc();
  const f = att(d, 'Riunione', 4, { fixedStart: LUN });
  const a = att(d, 'Coda', 8);
  const p = schedule(d, MER);
  assert.equal(p.tasks[f.id].state, 'expired');
  assert.ok(p.tasks[f.id].late);
  assert.equal(p.tasks[a.id].end, MER);
});

test('date fisse: intervallo già iniziato, il residuo va sui giorni che mancano', () => {
  const d = createEmptyDoc();
  const f = att(d, 'Trasferta', 40, { fixedStart: LUN, fixedEnd: VEN });
  addLog(d, { taskId: f.id, date: LUN, hours: 8 });
  addLog(d, { taskId: f.id, date: MAR, hours: 8 });
  const p = schedule(d, MER);
  assert.deepEqual(p.tasks[f.id].days, { [MER]: 8, [GIO]: 8, [VEN]: 8 });
});

test('date fisse: ignorano posizione, predecessori, limite giornaliero e fattore di correzione', () => {
  const d = createEmptyDoc();
  const a = att(d, 'Lunga', 80);
  const f = att(d, 'Fissa', 6, { fixedStart: MER, predecessors: [a.id], maxPerDay: 2 });
  const p = schedule(d, LUN, { factor: 2 });
  assert.deepEqual(p.tasks[f.id].days, { [MER]: 6 });
  assert.equal(p.tasks[f.id].state, 'planned');
});

test('date fisse: chi dipende da un\'attività fissa parte lo stesso giorno, dopo', () => {
  const d = createEmptyDoc();
  const f = att(d, 'Sopralluogo', 2, { fixedStart: MER });
  const b = att(d, 'Progetto', 10, { predecessors: [f.id] });
  const p = schedule(d, LUN);
  assert.equal(p.tasks[b.id].start, MER);
  assert.equal(p.tasks[b.id].days[MER], 6);
  assert.equal(p.tasks[b.id].end, GIO);
});

test('date fisse: le sottoattività avanzano in sequenza nei giorni fissati', () => {
  const d = createEmptyDoc();
  const m = att(d, 'Avviamento', 0, { fixedStart: MAR, fixedEnd: MER });
  const c1 = att(d, 'Prove a vuoto', 4, { parentId: m.id });
  const c2 = att(d, 'Prove con pezzo', 4, { parentId: m.id });
  const p = schedule(d, LUN);
  assert.equal(p.tasks[c1.id].end, MAR);
  assert.equal(p.tasks[c2.id].start, MER);
  assert.equal(p.tasks[m.id].end, MER);
});

test('non prima del: l\'attività aspetta la data e intanto passano le altre', () => {
  const d = createEmptyDoc();
  const a = att(d, 'Materiale in arrivo', 16, { notBefore: MER });
  const b = att(d, 'Altro', 16);
  const p = schedule(d, LUN);
  assert.equal(p.tasks[b.id].start, LUN);
  assert.equal(p.tasks[b.id].end, MAR);
  assert.equal(p.tasks[a.id].start, MER);
  assert.equal(p.tasks[a.id].end, GIO);
});

test('non prima del: data già passata non ha effetto', () => {
  const d = createEmptyDoc();
  const a = att(d, 'A', 8, { notBefore: '2026-11-01' });
  assert.equal(schedule(d, LUN).tasks[a.id].start, LUN);
});

test('date fisse: "al" non valido viene azzerato', () => {
  const d = createEmptyDoc();
  const f = att(d, 'F', 4);
  updateTask(d, f.id, { fixedStart: MER, fixedEnd: LUN });
  assert.equal(d.tasks[f.id].fixedEnd, null);
  updateTask(d, f.id, { fixedEnd: VEN });
  assert.equal(d.tasks[f.id].fixedEnd, VEN);
  updateTask(d, f.id, { fixedStart: null });
  assert.equal(d.tasks[f.id].fixedEnd, null, 'senza "dal" non c\'è "al"');
});
