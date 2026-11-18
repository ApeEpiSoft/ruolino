// =============================================================================
// csv.js — Esportazione CSV di attività e ore registrate.
//
// Formato pensato per Excel in italiano: separatore ";", virgola decimale,
// codifica UTF-8 con BOM (così le lettere accentate si leggono bene), righe
// terminate da CRLF. Le date restano AAAA-MM-GG, che Excel riconosce.
// =============================================================================

import { macros, children, summary, workedMap, live, statoEffettivo, STATI } from './model.js';

const SEP = ';';

/** Numero con la virgola decimale. */
function num(n) {
  return String(Math.round(Number(n || 0) * 100) / 100).replace('.', ',');
}

/** Un campo CSV, tra virgolette se serve. */
function campo(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Un testo che inizia con = + - @ verrebbe interpretato da Excel come formula.
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = "'" + s;
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Tabella (array di righe) → testo CSV. */
export function aCsv(righe) {
  return '﻿' + righe.map((r) => r.map(campo).join(SEP)).join('\r\n') + '\r\n';
}

/**
 * Tutte le attività (macro e sottoattività), nell'ordine della coda.
 * `plan` (facoltativo) aggiunge inizio e fine previsti.
 */
export function csvAttivita(doc, plan = null, wm = workedMap(doc)) {
  const righe = [[
    'Macro-attività', 'Sottoattività', 'Categoria', 'Stato', 'Stima originale (h)', 'Stima attuale (h)',
    'Ore lavorate', 'Ore rimanenti', 'Scadenza', 'Inizio previsto', 'Fine prevista', 'Completata il', 'Note',
  ]];
  const riga = (m, t) => {
    const s = summary(doc, t.id, wm);
    const p = plan && plan.tasks[t.id];
    const previsto = p && p.state === 'planned';
    righe.push([
      m.title, t === m ? '' : t.title, m.category || '', STATI[statoEffettivo(doc, t, wm)],
      num(s.estimateOriginal), num(s.estimate), num(s.worked), num(s.remaining),
      t.deadline || '', previsto ? p.start || '' : '', previsto ? p.end || '' : '', t.completedAt || '', t.notes || '',
    ]);
  };
  for (const m of macros(doc)) {
    riga(m, m);
    for (const c of children(doc, m.id)) riga(m, c);
  }
  return aCsv(righe);
}

/** Tutte le ore registrate, in ordine di data. */
export function csvOre(doc) {
  const righe = [['Data', 'Macro-attività', 'Sottoattività', 'Categoria', 'Ore', 'Nota']];
  const logs = live(doc.logs).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  for (const l of logs) {
    const t = doc.tasks[l.taskId];
    if (!t) continue;
    const m = t.parentId ? doc.tasks[t.parentId] || t : t;
    righe.push([l.date, m.title, t === m ? '' : t.title, m.category || '', num(l.hours), l.note || '']);
  }
  return aCsv(righe);
}
