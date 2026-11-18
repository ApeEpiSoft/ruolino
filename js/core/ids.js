// =============================================================================
// ids.js — Identificativi univoci e orologio monotono.
//
// Ogni record ha un id univoco (generato sul dispositivo, senza server) e un
// timestamp di modifica `updatedAt`. Per l'unione in sincronizzazione serve che
// i timestamp generati da questo dispositivo siano strettamente crescenti,
// anche se l'orologio di sistema torna indietro: per questo usiamo un orologio
// monotono, che la sincronizzazione può anche "far avanzare" quando vede
// timestamp remoti più recenti (vedi observe()).
// =============================================================================

/** Genera un id univoco (UUID v4 se disponibile, altrimenti casuale). */
export function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

let ultimo = 0;

/** Timestamp in millisecondi, sempre maggiore del precedente restituito. */
export function now() {
  const t = Date.now();
  ultimo = t > ultimo ? t : ultimo + 1;
  return ultimo;
}

/** Registra un timestamp visto altrove, così i prossimi saranno più recenti. */
export function observe(ts) {
  if (typeof ts === 'number' && ts > ultimo) ultimo = ts;
}
