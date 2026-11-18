// =============================================================================
// scheduler.test.js — Test della simulazione della coda.
// Data di riferimento: lunedì 16 novembre 2026, capacità predefinita
// 8 h lun–ven, 0 h sabato e domenica.
// =============================================================================

import { test, assert } from './runner.js';
import { schedule, slittamenti } from '../js/core/scheduler.js';
import {
  createEmptyDoc, addTask, updateTask, addLog, setException, setWeekly,
} from '../js/core/model.js';
import { weekday } from '../js/core/dates.js';

const LUN = '2026-11-16';
const MAR = '2026-11-17';
const MER = '2026-11-18';
const GIO = '2026-11-19';
const VEN = '2026-11-20';
const LUN2 = '2026-11-23';

function nuovo() { return createEmptyDoc(); }
function att(doc, title, estimate, extra = {}, pos = 'bottom') {
  return addTask(doc, Object.assign({ title, estimate }, extra), pos);
}

test('scheduler: la data di riferimento è un lunedì', () => {
  assert.equal(weekday(LUN), 1);
});

test('scheduler: attività singola riempie la capacità giornaliera', () => {
  const d = nuovo();
  const a = att(d, 'A', 20);
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].start, LUN);
  assert.equal(p.tasks[a.id].end, MER);
  assert.deepEqual(p.tasks[a.id].days, { [LUN]: 8, [MAR]: 8, [MER]: 4 });
});

test('scheduler: le attività seguono l\'ordine della coda e si passano la capacità avanzata', () => {
  const d = nuovo();
  const a = att(d, 'A', 10);
  const b = att(d, 'B', 10);
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].end, MAR);
  assert.equal(p.tasks[b.id].start, MAR, 'B inizia con le ore avanzate da A');
  assert.equal(p.tasks[b.id].days[MAR], 6);
  assert.equal(p.tasks[b.id].end, MER);
});

test('scheduler: sabato e domenica non si lavora', () => {
  const d = nuovo();
  const a = att(d, 'A', 24);
  const p = schedule(d, GIO);
  assert.equal(p.tasks[a.id].end, LUN2);
  assert.equal(p.days['2026-11-21'], undefined);
  assert.equal(p.days['2026-11-22'], undefined);
});

test('scheduler: le eccezioni (ferie, giorni parziali) sostituiscono la capacità', () => {
  const d = nuovo();
  const a = att(d, 'A', 16);
  setException(d, MAR, 0, 'Ferie');
  let p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].end, MER);
  setException(d, MAR, 4, 'Riunioni');
  p = schedule(d, LUN);
  assert.deepEqual(p.tasks[a.id].days, { [LUN]: 8, [MAR]: 4, [MER]: 4 });
});

test('scheduler: un sabato con eccezione diventa lavorativo', () => {
  const d = nuovo();
  const a = att(d, 'A', 20);
  setException(d, '2026-11-21', 4, 'Collaudo');
  const p = schedule(d, GIO);
  assert.deepEqual(p.tasks[a.id].days, { [GIO]: 8, [VEN]: 8, '2026-11-21': 4 });
});

test('scheduler: la capacità settimanale è configurabile', () => {
  const d = nuovo();
  setWeekly(d, 5, 4); // venerdì 4 h
  const a = att(d, 'A', 12);
  const p = schedule(d, GIO);
  assert.deepEqual(p.tasks[a.id].days, { [GIO]: 8, [VEN]: 4 });
});

test('scheduler: limite ore/giorno fa avanzare attività in parallelo', () => {
  const d = nuovo();
  const a = att(d, 'A', 10, { maxPerDay: 2 });
  const b = att(d, 'B', 12);
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].days[LUN], 2);
  assert.equal(p.tasks[b.id].days[LUN], 6);
  assert.equal(p.tasks[b.id].end, MAR);
  assert.equal(p.tasks[a.id].end, VEN, 'A avanza di 2 h al giorno per 5 giorni');
  assert.equal(p.days[MER].reduce((s, x) => s + x.hours, 0), 2, 'mercoledì resta solo A (2 h)');
});

test('scheduler: predecessore finito a metà giornata libera subito chi lo aspetta', () => {
  const d = nuovo();
  const a = att(d, 'A', 10);
  const b = att(d, 'B', 4, { predecessors: [a.id] }, 'top'); // B è prima in coda ma deve aspettare A
  const p = schedule(d, LUN);
  assert.equal(p.tasks[b.id].days[LUN], undefined, 'lunedì B non può partire');
  assert.equal(p.tasks[a.id].end, MAR);
  assert.equal(p.tasks[b.id].start, MAR, 'B parte lo stesso giorno in cui A finisce');
  assert.equal(p.tasks[b.id].end, MAR);
});

test('scheduler: predecessore già completato non blocca', () => {
  const d = nuovo();
  const a = att(d, 'A', 10);
  updateTask(d, a.id, { status: 'done' });
  const b = att(d, 'B', 4, { predecessors: [a.id] });
  const p = schedule(d, LUN);
  assert.equal(p.tasks[b.id].end, LUN);
  assert.equal(p.tasks[a.id].state, 'done');
});

test('scheduler: predecessore in pausa blocca (anche a catena)', () => {
  const d = nuovo();
  const a = att(d, 'Alfa', 8, { status: 'paused' });
  const b = att(d, 'Beta', 4, { predecessors: [a.id] });
  const c = att(d, 'Gamma', 4, { predecessors: [b.id] });
  const z = att(d, 'Zeta', 4);
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].state, 'paused');
  assert.equal(p.tasks[b.id].state, 'blocked');
  assert.ok(p.tasks[b.id].reason.includes('Alfa'), 'il motivo cita il predecessore');
  assert.equal(p.tasks[c.id].state, 'blocked');
  assert.equal(p.tasks[z.id].start, LUN, 'le attività indipendenti usano la capacità');
});

test('scheduler: dipendenze circolari segnalate senza bloccare il resto', () => {
  const d = nuovo();
  const a = att(d, 'A', 4);
  const b = att(d, 'B', 4, { predecessors: [a.id] });
  updateTask(d, a.id, { predecessors: [b.id] });
  const c = att(d, 'C', 4);
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].reason, 'Dipendenze circolari');
  assert.equal(p.tasks[b.id].reason, 'Dipendenze circolari');
  assert.equal(p.tasks[c.id].end, LUN);
});

test('scheduler: un\'urgenza in cima fa slittare le altre (interruzione)', () => {
  const d = nuovo();
  const a = att(d, 'A', 16);
  const b = att(d, 'B', 8);
  const prima = schedule(d, LUN);
  att(d, 'Urgenza', 8, {}, 'top');
  const dopo = schedule(d, LUN);
  assert.equal(prima.tasks[a.id].end, MAR);
  assert.equal(dopo.tasks[a.id].end, MER);
  assert.equal(dopo.tasks[b.id].end, GIO);
  const fine = (p) => ({ [a.id]: p.tasks[a.id].end, [b.id]: p.tasks[b.id].end });
  assert.deepEqual(slittamenti(d, fine(prima), fine(dopo)), { [a.id]: 1, [b.id]: 1 });
});

test('scheduler: slittamento in giorni lavorativi salta il weekend', () => {
  const d = nuovo();
  assert.deepEqual(slittamenti(d, { x: VEN }, { x: LUN2 }), { x: 1 });
  assert.deepEqual(slittamenti(d, { x: LUN2 }, { x: VEN }), { x: -1 });
});

test('scheduler: un\'attività interrotta riprende dopo l\'urgenza', () => {
  const d = nuovo();
  const a = att(d, 'Lunga', 30);
  addLog(d, { taskId: a.id, date: '2026-11-13', hours: 6 });
  const u = att(d, 'Urgenza', 12, {}, 'top');
  const p = schedule(d, LUN);
  assert.equal(p.tasks[u.id].end, MAR);
  assert.equal(p.tasks[a.id].start, MAR);
  assert.equal(p.tasks[a.id].plannedHours, 24, 'restano 30 − 6 = 24 h');
  assert.equal(p.tasks[a.id].end, VEN, 'mar 4 + mer 8 + gio 8 + ven 4');
});

test('scheduler: le ore registrate oggi riducono la capacità di oggi', () => {
  const d = nuovo();
  const a = att(d, 'A', 16);
  addLog(d, { taskId: a.id, date: LUN, hours: 6 });
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].days[LUN], 2);
  assert.equal(p.tasks[a.id].days[MAR], 8);
  assert.equal(p.tasks[a.id].end, MAR);
});

test('scheduler: ore registrate oggi su altro (oltre capacità) azzerano oggi', () => {
  const d = nuovo();
  const x = att(d, 'Fatta', 9);
  addLog(d, { taskId: x.id, date: LUN, hours: 9 });
  updateTask(d, x.id, { status: 'done' });
  const a = att(d, 'A', 4);
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].start, MAR);
});

test('scheduler: sottoattività in sequenza, poi le ore proprie della macro', () => {
  const d = nuovo();
  const m = att(d, 'Macro', 2);
  const s1 = att(d, 'S1', 4, { parentId: m.id });
  const s2 = att(d, 'S2', 6, { parentId: m.id });
  const p = schedule(d, LUN);
  assert.equal(p.tasks[s1.id].end, LUN);
  assert.deepEqual(p.tasks[s2.id].days, { [LUN]: 4, [MAR]: 2 });
  assert.equal(p.tasks[m.id].end, MAR);
  assert.equal(p.tasks[m.id].plannedHours, 12);
});

test('scheduler: il limite giornaliero della macro vale per la somma delle sottoattività', () => {
  const d = nuovo();
  const m = att(d, 'Macro', 0, { maxPerDay: 3 });
  att(d, 'S1', 2, { parentId: m.id });
  att(d, 'S2', 2, { parentId: m.id });
  const b = att(d, 'B', 40);
  const p = schedule(d, LUN);
  assert.equal(p.tasks[m.id].days[LUN], 3);
  assert.equal(p.tasks[m.id].days[MAR], 1);
  assert.equal(p.tasks[b.id].days[LUN], 5);
});

test('scheduler: sottoattività in pausa o completate vengono saltate', () => {
  const d = nuovo();
  const m = att(d, 'Macro', 0);
  const s1 = att(d, 'S1', 4, { parentId: m.id, status: 'paused' });
  const s2 = att(d, 'S2', 4, { parentId: m.id });
  const s3 = att(d, 'S3', 4, { parentId: m.id });
  updateTask(d, s3.id, { status: 'done' });
  const p = schedule(d, LUN);
  assert.equal(p.tasks[s1.id].state, 'paused');
  assert.equal(p.tasks[s2.id].end, LUN);
  assert.equal(p.tasks[s3.id].state, 'done');
  assert.equal(p.tasks[m.id].plannedHours, 4);
});

test('scheduler: attività in pausa non consuma capacità', () => {
  const d = nuovo();
  const a = att(d, 'A', 8, { status: 'paused' });
  const b = att(d, 'B', 8);
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].state, 'paused');
  assert.equal(p.tasks[b.id].end, LUN);
});

test('scheduler: ritardo rispetto alla scadenza', () => {
  const d = nuovo();
  const a = att(d, 'A', 16, { deadline: LUN });
  const b = att(d, 'B', 8, { deadline: GIO });
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].late, true);
  assert.equal(p.tasks[b.id].late, false);
});

test('scheduler: attività con scadenza ma non pianificabile è in ritardo', () => {
  const d = nuovo();
  const a = att(d, 'A', 8, { status: 'paused', deadline: VEN });
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].late, true);
});

test('scheduler: senza capacità si arriva all\'orizzonte', () => {
  const d = nuovo();
  for (let g = 0; g < 7; g++) setWeekly(d, g, 0);
  const a = att(d, 'A', 8);
  const p = schedule(d, LUN, { horizonDays: 30 });
  assert.equal(p.tasks[a.id].state, 'unscheduled');
  assert.ok(p.tasks[a.id].reason.includes('orizzonte'));
});

test('scheduler: stima esaurita senza completamento', () => {
  const d = nuovo();
  const a = att(d, 'A', 4);
  addLog(d, { taskId: a.id, date: '2026-11-13', hours: 5 });
  const b = att(d, 'B', 4, { predecessors: [a.id] });
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].exhausted, true);
  assert.equal(p.tasks[a.id].end, null);
  assert.equal(p.tasks[b.id].end, LUN, 'chi dipende non resta bloccato');
});

test('scheduler: fattore di correzione delle stime', () => {
  const d = nuovo();
  const a = att(d, 'A', 8);
  const p = schedule(d, LUN, { factor: 1.25 });
  assert.equal(p.tasks[a.id].plannedHours, 10);
  assert.equal(p.tasks[a.id].end, MAR);
});

test('scheduler: precisione al quarto d\'ora senza errori di arrotondamento', () => {
  const d = nuovo();
  setWeekly(d, 1, 1);
  const a = att(d, 'A', 0.25);
  const b = att(d, 'B', 0.5);
  const c = att(d, 'C', 0.5);
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id].days[LUN], 0.25);
  assert.equal(p.tasks[b.id].days[LUN], 0.5);
  assert.equal(p.tasks[c.id].days[LUN], 0.25);
  assert.equal(p.tasks[c.id].days[MAR], 0.25);
});

test('scheduler: le attività eliminate non vengono pianificate', async () => {
  const { deleteTask } = await import('../js/core/model.js');
  const d = nuovo();
  const a = att(d, 'A', 8);
  const b = att(d, 'B', 8, { predecessors: [a.id] });
  deleteTask(d, a.id);
  const p = schedule(d, LUN);
  assert.equal(p.tasks[a.id], undefined);
  assert.equal(p.tasks[b.id].end, LUN, 'un predecessore eliminato viene ignorato');
});

test('scheduler: 30 attività con sottoattività in meno di 50 ms', () => {
  const d = nuovo();
  for (let i = 0; i < 30; i++) {
    const m = att(d, 'M' + i, 10, { maxPerDay: i % 3 === 0 ? 2 : null });
    for (let j = 0; j < 4; j++) att(d, 'S' + j, 5, { parentId: m.id });
  }
  const t0 = Date.now();
  schedule(d, LUN);
  assert.ok(Date.now() - t0 < 50, 'troppo lento');
});
