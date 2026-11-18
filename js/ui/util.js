// =============================================================================
// util.js — Funzioni di supporto comuni all'interfaccia.
// =============================================================================

import { html, useEffect, useRef } from '../vendor/preact-htm.js';
import Sortable from '../vendor/sortable.esm.js';

export { html, render, useState, useEffect, useMemo, useRef, useCallback } from '../vendor/preact-htm.js';

const nf = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });

/** Formatta ore: 2.5 → "2,5 h". */
export function fmtOre(h) {
  return nf.format(Number(h || 0)) + ' h';
}

/** Formatta un numero con la virgola italiana, senza unità. */
export function fmtNum(h) {
  return nf.format(Number(h || 0));
}

/**
 * Interpreta un numero di ore scritto dall'utente ("2,5", "2.5", "1:30").
 * Restituisce null se il testo è vuoto o non valido.
 */
export function parseOre(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(',', '.');
  if (t === '') return null;
  const hm = t.match(/^(\d+):(\d{1,2})$/);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = Number(t);
  return isFinite(n) && n >= 0 ? n : null;
}

/**
 * Rende ordinabile con drag & drop (anche al tocco) un elemento lista.
 * Gli elementi figli devono avere l'attributo data-id.
 * onMove(id, primaId, dopoId) viene chiamato a spostamento completato.
 *
 * Nota tecnica: SortableJS sposta direttamente i nodi del DOM, mentre Preact
 * vuole esserne l'unico proprietario. Per questo, a fine trascinamento,
 * rimettiamo il nodo dov'era e lasciamo che sia Preact a ridisegnare la lista
 * nel nuovo ordine dopo aver aggiornato i dati.
 */
export function useSortable(onMove, opzioni = {}) {
  const ref = useRef(null);
  const cb = useRef(onMove);
  cb.current = onMove;
  useEffect(() => {
    if (!ref.current) return;
    const s = Sortable.create(ref.current, {
      handle: opzioni.handle || '.maniglia',
      animation: 150,
      ghostClass: 'trascina-fantasma',
      chosenClass: 'trascina-scelto',
      forceFallback: true, // stesso comportamento su mouse e touch
      fallbackTolerance: 3,
      onEnd(ev) {
        const { item, from, oldIndex, newIndex } = ev;
        if (oldIndex === newIndex) return;
        // Ripristina il DOM come lo conosce Preact.
        from.removeChild(item);
        from.insertBefore(item, from.children[oldIndex] || null);
        // Calcola il nuovo ordine degli id e i vicini dell'elemento spostato.
        const ids = Array.from(from.children).map((el) => el.dataset.id);
        const [id] = ids.splice(oldIndex, 1);
        ids.splice(newIndex, 0, id);
        const i = ids.indexOf(id);
        cb.current(id, ids[i - 1] || null, ids[i + 1] || null);
      },
    });
    return () => s.destroy();
  }, []);
  return ref;
}

const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
/** Intervallo di date compatto: "18 nov", "19–23 nov", "30 nov – 2 dic". */
export function fmtIntervallo(dal, al) {
  const g = (s) => Number(s.slice(8));
  const m = (s) => MESI_BREVI[Number(s.slice(5, 7)) - 1];
  if (!al || al === dal) return `${g(dal)} ${m(dal)}`;
  if (dal.slice(0, 7) === al.slice(0, 7)) return `${g(dal)}–${g(al)} ${m(al)}`;
  return `${g(dal)} ${m(dal)} – ${g(al)} ${m(al)}`;
}

/** Piccolo componente: barra di avanzamento 0..1. */
export function Barra({ valore, classe = '' }) {
  const p = Math.round(Math.max(0, Math.min(1, valore || 0)) * 100);
  return html`<div class="barra ${classe}" title="${p}%"><div style="width:${p}%"></div></div>`;
}

/** Etichetta di slittamento: +2g (peggiorata) / −1g (migliorata). */
export function Slittamento({ giorni }) {
  if (!giorni) return null;
  const peggio = giorni > 0;
  return html`<span class="slitta ${peggio ? 'peggio' : 'meglio'}"
    title="Fine prevista ${peggio ? 'spostata in avanti' : 'anticipata'} di ${Math.abs(giorni)} giorni lavorativi rispetto a ieri"
    >${peggio ? '+' : '−'}${Math.abs(giorni)}g</span>`;
}
