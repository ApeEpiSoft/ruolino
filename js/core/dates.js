// =============================================================================
// dates.js — Gestione delle date "di calendario" (senza ora).
//
// Tutte le date dell'app sono stringhe ISO 'AAAA-MM-GG' nel fuso locale.
// Le stringhe si confrontano direttamente (ordine lessicografico = ordine
// cronologico) e non hanno problemi di fuso orario o di ora legale.
// Modulo puro: nessuna dipendenza dal DOM, usato anche nei test.
// =============================================================================

/** Converte un oggetto Date in 'AAAA-MM-GG' usando il fuso locale. */
export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${g}`;
}

/** Converte 'AAAA-MM-GG' in Date a mezzogiorno locale (evita salti dell'ora legale). */
export function fromISO(s) {
  const [y, m, g] = s.split('-').map(Number);
  return new Date(y, m - 1, g, 12, 0, 0);
}

/** Data di oggi in formato ISO. */
export function todayISO() {
  return toISO(new Date());
}

/** Somma n giorni (anche negativi) a una data ISO. */
export function addDays(s, n) {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Giorno della settimana: 0 = domenica … 6 = sabato (come Date.getDay). */
export function weekday(s) {
  return fromISO(s).getDay();
}

/** Differenza in giorni di calendario (b - a). */
export function diffDays(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}

const fmtBreve = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtLungo = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtCorto = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' });

/** Esempio: "gio 26 nov". */
export function formatBreve(s) {
  return s ? fmtBreve.format(fromISO(s)) : '';
}

/** Esempio: "giovedì 26 novembre 2026". */
export function formatLungo(s) {
  return s ? fmtLungo.format(fromISO(s)) : '';
}

/** Esempio: "26/11/26". */
export function formatCorto(s) {
  return s ? fmtCorto.format(fromISO(s)) : '';
}

/** Nomi dei giorni, indice come Date.getDay (0 = domenica). */
export const NOMI_GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
