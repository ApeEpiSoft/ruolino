// =============================================================================
// impatto.js — Anteprima dell'impatto di un'urgenza sulla coda.
//
// Simula la coda con un'attività ipotetica in cima (senza toccare i dati) e
// la confronta con il piano attuale: per ogni macro che cambia data dice di
// quanti giorni lavorativi slitta e se finisce oltre la scadenza.
// =============================================================================

import { macros, q } from './model.js';
import { keyBetween } from './order.js';
import { schedule, giorniLavorativiTra } from './scheduler.js';

export const ID_ANTEPRIMA = '__anteprima__';

/**
 * @param {object} doc
 * @param {string} today
 * @param {{title, estimate, deadline}} campi  dati dell'urgenza
 * @param {object} opzioni   opzioni dello scheduler (fattore di correzione)
 * @param {object} [pianoAttuale]  piano già calcolato senza l'urgenza
 * @returns {{ nuova, spostate: Array, nuoveInRitardo: number }}
 *   nuova    = risultato dello scheduler per l'urgenza (start, end, late…)
 *   spostate = [{id, titolo, prima, dopo, giorni, inRitardo, nuovoRitardo}]
 */
export function anteprimaUrgenza(doc, today, campi, opzioni = {}, pianoAttuale = null) {
  const elenco = macros(doc);
  let order;
  try { order = keyBetween(null, elenco.length ? elenco[0].order : null); } catch { order = '0'; }
  const est = q(campi.estimate || 0);
  const ipotetica = {
    id: ID_ANTEPRIMA, parentId: null, title: campi.title || 'Urgenza', notes: '', category: campi.category || '',
    status: 'todo', estimate: est, estimateOriginal: est, order,
    deadline: campi.deadline || null, predecessors: [], maxPerDay: null, deletedAt: null,
  };
  const prova = Object.assign({}, doc, { tasks: Object.assign({}, doc.tasks, { [ID_ANTEPRIMA]: ipotetica }) });
  const prima = pianoAttuale || schedule(doc, today, opzioni);
  const dopo = schedule(prova, today, opzioni);

  const spostate = [];
  for (const m of elenco) {
    if (m.status === 'done') continue;
    const a = prima.tasks[m.id];
    const b = dopo.tasks[m.id];
    if (!a || !b || a.end === b.end) continue;
    spostate.push({
      id: m.id,
      titolo: m.title,
      prima: a.end,
      dopo: b.end,
      giorni: a.end && b.end ? giorniLavorativiTra(doc, a.end, b.end) : null,
      inRitardo: b.late,
      nuovoRitardo: b.late && !a.late,
    });
  }
  return {
    nuova: dopo.tasks[ID_ANTEPRIMA],
    spostate,
    nuoveInRitardo: spostate.filter((s) => s.nuovoRitardo).length,
  };
}
