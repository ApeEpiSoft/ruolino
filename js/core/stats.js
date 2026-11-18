// =============================================================================
// stats.js — Statistiche sulla precisione delle stime e fattore di correzione.
//
// Campione = macro-attività completata con ore stimate e ore registrate.
//   stimate   = stima ORIGINALE (estimateOriginal, macro + sottoattività)
//   effettive = ore registrate in totale
//   rapporto  = effettive / stimate   (1,25 = ci è voluto il 25% in più)
//
// Il fattore di un gruppo (tutte le attività, o una categoria) è il rapporto
// pesato: somma delle effettive / somma delle stimate, sugli ULTIMI
// MAX_CAMPIONI completamenti, così segue l'evoluzione delle abitudini.
// Serve un minimo di MIN_CAMPIONI attività, altrimenti:
//   - una categoria con pochi dati usa il fattore generale;
//   - con pochi dati in generale il fattore è 1 (nessuna correzione).
//
// Con la correzione attiva (settings.applyCorrection) lo scheduler moltiplica
// le ore rimanenti di ogni macro per il fattore della sua categoria.
// =============================================================================

import { macros, summary, workedMap } from './model.js';

export const MIN_CAMPIONI = 3;
export const MAX_CAMPIONI = 20;
export const FATTORE_MIN = 0.5;
export const FATTORE_MAX = 3;
/** Scarto entro cui una stima è considerata "buona" (±20%). */
export const TOLLERANZA = 0.2;

const limita = (f) => Math.min(FATTORE_MAX, Math.max(FATTORE_MIN, f));

/** Attività completate utilizzabili come campione, più recenti prima. */
export function campioni(doc, wm = workedMap(doc)) {
  const out = [];
  for (const m of macros(doc)) {
    if (m.status !== 'done') continue;
    const s = summary(doc, m.id, wm);
    if (!(s.estimateOriginal > 0) || !(s.worked > 0)) continue;
    out.push({
      id: m.id,
      titolo: m.title,
      categoria: m.category || '',
      completata: m.completedAt || '',
      stimate: s.estimateOriginal,
      effettive: s.worked,
      rapporto: s.worked / s.estimateOriginal,
    });
  }
  return out.sort((a, b) => b.completata.localeCompare(a.completata));
}

/** Riassunto di un gruppo di campioni (già ordinati dal più recente). */
function gruppo(elenco) {
  const usati = elenco.slice(0, MAX_CAMPIONI);
  const stimate = usati.reduce((s, c) => s + c.stimate, 0);
  const effettive = usati.reduce((s, c) => s + c.effettive, 0);
  const buone = usati.filter((c) => Math.abs(c.rapporto - 1) <= TOLLERANZA).length;
  return {
    n: usati.length,
    totale: elenco.length,
    stimate,
    effettive,
    fattore: stimate > 0 ? limita(effettive / stimate) : 1,
    buone,
    affidabile: usati.length >= MIN_CAMPIONI,
  };
}

/**
 * Statistiche complete: { campioni, globale, categorie: [{nome, ...gruppo}] }.
 * `nome` vuoto = attività senza categoria.
 */
export function statisticheStime(doc, wm = workedMap(doc)) {
  const tutti = campioni(doc, wm);
  const perCat = new Map();
  for (const c of tutti) {
    if (!perCat.has(c.categoria)) perCat.set(c.categoria, []);
    perCat.get(c.categoria).push(c);
  }
  const categorie = [...perCat.entries()]
    .map(([nome, el]) => Object.assign({ nome }, gruppo(el)))
    .sort((a, b) => (a.nome === '') - (b.nome === '') || a.nome.localeCompare(b.nome));
  return { campioni: tutti, globale: gruppo(tutti), categorie };
}

/**
 * Fattori effettivamente usati per la correzione:
 * { globale, perCategoria: {nome: fattore} } (solo categorie con dati sufficienti).
 */
export function fattoriCorrezione(stat) {
  const globale = stat.globale.affidabile ? stat.globale.fattore : 1;
  const perCategoria = {};
  for (const c of stat.categorie) if (c.nome && c.affidabile) perCategoria[c.nome] = c.fattore;
  return { globale, perCategoria };
}

/** Fattore da applicare a una macro. */
export function fattoreDi(fattori, m) {
  return fattori.perCategoria[m.category || ''] ?? fattori.globale;
}

/**
 * Opzioni per lo scheduler secondo le impostazioni: con la correzione attiva
 * contiene `factor` (funzione macro → fattore), altrimenti è vuoto.
 */
export function opzioniPiano(doc, wm = workedMap(doc)) {
  if (!doc.settings.applyCorrection) return {};
  const fattori = fattoriCorrezione(statisticheStime(doc, wm));
  return { factor: (m) => fattoreDi(fattori, m), fattori };
}
