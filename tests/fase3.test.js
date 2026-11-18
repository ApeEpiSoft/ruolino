// =============================================================================
// fase3.test.js — Statistiche delle stime, fattore di correzione,
// anteprima delle urgenze, esportazione CSV.
// Data di riferimento: lunedì 16 novembre 2026 (8 h lun–ven).
// =============================================================================

import { test, assert } from './runner.js';
import { schedule } from '../js/core/scheduler.js';
import { createEmptyDoc, addTask, updateTask, addLog, setApplyCorrection } from '../js/core/model.js';
import {
  statisticheStime, fattoriCorrezione, opzioniPiano, MIN_CAMPIONI, MAX_CAMPIONI, FATTORE_MAX,
} from '../js/core/stats.js';
import { anteprimaUrgenza, ID_ANTEPRIMA } from '../js/core/impatto.js';
import { csvAttivita, csvOre } from '../js/core/csv.js';

const LUN = '2026-11-16';
const MAR = '2026-11-17';
const MER = '2026-11-18';
const VEN = '2026-11-20';

/** Crea un'attività completata: stimate `stima`, lavorate `ore`, completata il `quando`. */
function completata(d, titolo, stima, ore, categoria = '', quando = '2026-10-01') {
  const t = addTask(d, { title: titolo, estimate: stima });
  updateTask(d, t.id, { category: categoria });
  if (ore > 0) addLog(d, { taskId: t.id, date: '2026-09-01', hours: ore });
  updateTask(d, t.id, { status: 'done' });
  updateTask(d, t.id, { completedAt: quando });
  return t;
}

// -----------------------------------------------------------------------------
// Statistiche e fattore di correzione
// -----------------------------------------------------------------------------

test('stime: nessun dato → fattore 1 e nessuna correzione', () => {
  const d = createEmptyDoc();
  addTask(d, { title: 'In coda', estimate: 10 });
  const s = statisticheStime(d);
  assert.equal(s.globale.n, 0);
  assert.equal(fattoriCorrezione(s).globale, 1);
});

test('stime: il fattore è il rapporto pesato tra ore effettive e stimate', () => {
  const d = createEmptyDoc();
  completata(d, 'A', 10, 12);
  completata(d, 'B', 10, 15);
  completata(d, 'C', 20, 23);
  const s = statisticheStime(d);
  assert.equal(s.globale.n, 3);
  assert.equal(s.globale.stimate, 40);
  assert.equal(s.globale.effettive, 50);
  assert.equal(s.globale.fattore, 1.25);
  assert.equal(s.globale.buone, 2, 'A (+20%) e C (+15%) sono entro la tolleranza');
  assert.equal(fattoriCorrezione(s).globale, 1.25);
});

test('stime: si usa la stima ORIGINALE, non quella corretta strada facendo', () => {
  const d = createEmptyDoc();
  for (const n of ['A', 'B', 'C']) {
    const t = addTask(d, { title: n, estimate: 10 });
    updateTask(d, t.id, { estimate: 20 }); // residuo corretto durante il lavoro
    addLog(d, { taskId: t.id, date: '2026-09-01', hours: 20 });
    updateTask(d, t.id, { status: 'done' });
  }
  assert.equal(statisticheStime(d).globale.fattore, 2);
});

test('stime: macro con sottoattività sommano stime originali e ore', () => {
  const d = createEmptyDoc();
  const m = addTask(d, { title: 'Impianto', estimate: 2 });
  const c1 = addTask(d, { title: 'Schema', estimate: 4, parentId: m.id });
  const c2 = addTask(d, { title: 'Software', estimate: 4, parentId: m.id });
  addLog(d, { taskId: c1.id, date: '2026-09-01', hours: 6 });
  addLog(d, { taskId: c2.id, date: '2026-09-02', hours: 5 });
  addLog(d, { taskId: m.id, date: '2026-09-03', hours: 1 });
  updateTask(d, m.id, { status: 'done' });
  const [c] = statisticheStime(d).campioni;
  assert.equal(c.stimate, 10);
  assert.equal(c.effettive, 12);
});

test('stime: attività senza stima o senza ore registrate non fanno statistica', () => {
  const d = createEmptyDoc();
  completata(d, 'Senza stima', 0, 5);
  completata(d, 'Senza ore', 5, 0);
  assert.equal(statisticheStime(d).globale.n, 0);
});

test('stime: fattore per categoria solo con dati sufficienti, altrimenti quello generale', () => {
  const d = createEmptyDoc();
  for (let i = 0; i < MIN_CAMPIONI; i++) completata(d, 'Robot ' + i, 10, 20, 'Robot');
  completata(d, 'Schema 1', 10, 10, 'Schemi');
  const f = fattoriCorrezione(statisticheStime(d));
  assert.equal(f.perCategoria.Robot, 2);
  assert.equal(f.perCategoria.Schemi, undefined, 'una sola attività: non basta');
  assert.equal(f.globale, 70 / 40);
});

test('stime: contano solo gli ultimi completamenti', () => {
  const d = createEmptyDoc();
  // Le più vecchie erano sottostimate del doppio; le ultime 20 sono precise.
  for (let i = 0; i < 5; i++) completata(d, 'Vecchia ' + i, 10, 20, '', '2025-01-0' + (i + 1));
  for (let i = 0; i < MAX_CAMPIONI; i++) completata(d, 'Nuova ' + i, 10, 10, '', '2026-0' + (1 + (i % 9)) + '-1' + (i % 10));
  const s = statisticheStime(d);
  assert.equal(s.globale.n, MAX_CAMPIONI);
  assert.equal(s.globale.totale, MAX_CAMPIONI + 5);
  assert.equal(s.globale.fattore, 1);
});

test('stime: il fattore è limitato a valori ragionevoli', () => {
  const d = createEmptyDoc();
  for (let i = 0; i < 3; i++) completata(d, 'X' + i, 1, 50);
  assert.equal(statisticheStime(d).globale.fattore, FATTORE_MAX);
});

test('correzione: spenta non cambia il piano, accesa allunga le previsioni', () => {
  const d = createEmptyDoc();
  for (let i = 0; i < 3; i++) completata(d, 'Fatta ' + i, 10, 15);
  const a = addTask(d, { title: 'Nuova', estimate: 16 });
  assert.deepEqual(opzioniPiano(d), {});
  assert.equal(schedule(d, LUN, opzioniPiano(d)).tasks[a.id].end, MAR);
  setApplyCorrection(d, true);
  const p = schedule(d, LUN, opzioniPiano(d));
  assert.equal(p.tasks[a.id].end, MER, '16 h × 1,5 = 24 h → tre giorni');
  assert.equal(p.tasks[a.id].plannedHours, 24);
});

test('correzione: ogni macro usa il fattore della sua categoria', () => {
  const d = createEmptyDoc();
  for (let i = 0; i < 3; i++) completata(d, 'R' + i, 10, 20, 'Robot');
  for (let i = 0; i < 3; i++) completata(d, 'S' + i, 10, 10, 'Schemi');
  setApplyCorrection(d, true);
  const r = addTask(d, { title: 'Robot nuovo', estimate: 8 });
  updateTask(d, r.id, { category: 'Robot' });
  const s = addTask(d, { title: 'Schema nuovo', estimate: 8 });
  updateTask(d, s.id, { category: 'Schemi' });
  const p = schedule(d, LUN, opzioniPiano(d));
  assert.equal(p.tasks[r.id].plannedHours, 16);
  assert.equal(p.tasks[s.id].plannedHours, 8);
});

test('scheduler: il fattore numerico continua a funzionare', () => {
  const d = createEmptyDoc();
  const a = addTask(d, { title: 'A', estimate: 8 });
  assert.equal(schedule(d, LUN, { factor: 2 }).tasks[a.id].end, MAR);
});

// -----------------------------------------------------------------------------
// Anteprima urgenza
// -----------------------------------------------------------------------------

test('urgenza: anteprima di fine e slittamenti, senza toccare i dati', () => {
  const d = createEmptyDoc();
  const a = addTask(d, { title: 'A', estimate: 8 });
  const b = addTask(d, { title: 'B', estimate: 8, deadline: MAR });
  const prima = JSON.stringify(d);
  const r = anteprimaUrgenza(d, LUN, { title: 'Guasto', estimate: 8 });
  assert.equal(JSON.stringify(d), prima, 'il documento non cambia');
  assert.equal(d.tasks[ID_ANTEPRIMA], undefined);
  assert.equal(r.nuova.end, LUN);
  assert.equal(r.spostate.length, 2);
  const sa = r.spostate.find((s) => s.id === a.id);
  assert.equal(sa.prima, LUN);
  assert.equal(sa.dopo, MAR);
  assert.equal(sa.giorni, 1);
  const sb = r.spostate.find((s) => s.id === b.id);
  assert.ok(sb.nuovoRitardo, 'B supera la scadenza');
  assert.equal(r.nuoveInRitardo, 1);
});

test('urgenza: un\'urgenza piccola che non sposta nessuno', () => {
  const d = createEmptyDoc();
  addTask(d, { title: 'A', estimate: 4 });
  const r = anteprimaUrgenza(d, LUN, { title: 'Telefonata', estimate: 2 });
  assert.equal(r.spostate.length, 0);
  assert.equal(r.nuova.end, LUN);
});

test('urgenza: anteprima con scadenza dell\'urgenza e fattore di correzione', () => {
  const d = createEmptyDoc();
  addTask(d, { title: 'A', estimate: 40 });
  const r = anteprimaUrgenza(d, LUN, { title: 'U', estimate: 20, deadline: MAR }, { factor: 2 });
  assert.equal(r.nuova.end, VEN, '20 h × 2 = 40 h → una settimana');
  assert.ok(r.nuova.late);
});

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------

test('csv: attività con virgola decimale, separatore ; e campi tra virgolette', () => {
  const d = createEmptyDoc();
  const m = addTask(d, { title: 'Cella "A"; robot', estimate: 10 });
  addTask(d, { title: 'Sotto', estimate: 2.5, parentId: m.id });
  addLog(d, { taskId: m.id, date: LUN, hours: 1.25 });
  const testo = csvAttivita(d, schedule(d, LUN));
  assert.ok(testo.startsWith('﻿'), 'BOM per Excel');
  const righe = testo.slice(1).trim().split('\r\n');
  assert.equal(righe.length, 3);
  assert.ok(righe[1].startsWith('"Cella ""A""; robot";;'));
  assert.ok(righe[1].includes(';12,5;1,25;11,25;'), righe[1]);
  assert.ok(righe[2].includes(';Sotto;'));
});

test('csv: ore registrate in ordine di data, testo che sembra una formula neutralizzato', () => {
  const d = createEmptyDoc();
  const m = addTask(d, { title: '=SOMMA(A1)', estimate: 10 });
  addLog(d, { taskId: m.id, date: MAR, hours: 2 });
  addLog(d, { taskId: m.id, date: LUN, hours: 1.5, note: 'collaudo' });
  const righe = csvOre(d).slice(1).trim().split('\r\n');
  assert.equal(righe[0], 'Data;Macro-attività;Sottoattività;Categoria;Ore;Nota');
  assert.equal(righe[1], `${LUN};'=SOMMA(A1);;;1,5;collaudo`);
  assert.ok(righe[2].startsWith(MAR));
});
