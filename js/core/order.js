// =============================================================================
// order.js — Chiavi di ordinamento frazionarie.
//
// La posizione nella coda non è un numero 1, 2, 3… (spostare un'attività
// costringerebbe a rinumerare tutte le altre, creando conflitti tra
// dispositivi). Ogni attività ha invece una stringa `order`: l'ordine della
// coda è l'ordine alfabetico di queste stringhe. Per inserire un elemento tra
// due vicini basta generare una stringa "a metà" fra le loro chiavi: si
// modifica un solo record.
//
// Le chiavi sono frazioni in base 62 (0,xxxx) scritte senza "0,", e non
// terminano mai con la cifra '0'. Algoritmo derivato dal "fractional indexing"
// di David Greenspan / rocicorp.
// =============================================================================

const CIFRE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = CIFRE.length;

function cifra(c) {
  const i = CIFRE.indexOf(c);
  if (i < 0) throw new Error('Chiave di ordinamento non valida: ' + c);
  return i;
}

/**
 * Restituisce una chiave strettamente compresa tra a e b.
 * a = '' significa "inizio", b = null significa "fine".
 */
function metà(a, b) {
  if (b !== null) {
    // Toglie il prefisso comune (a viene esteso con '0' se più corto).
    let n = 0;
    while ((a[n] || '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + metà(a.slice(n), b.slice(n));
  }
  const da = a ? cifra(a[0]) : 0;
  const db = b !== null ? cifra(b[0]) : BASE;
  if (db - da > 1) {
    // C'è spazio per una cifra intermedia.
    return CIFRE[Math.round((da + db) / 2)];
  }
  // Cifre consecutive: se b ha altre cifre, la sua prima cifra basta.
  if (b !== null && b.length > 1) return b[0];
  // Altrimenti si scende di una posizione a destra di a.
  return CIFRE[da] + metà(a.slice(1), null);
}

/**
 * Chiave tra `prima` e `dopo` (entrambe opzionali: null = estremo della lista).
 * Esempi: keyBetween(null, null) → prima chiave; keyBetween(k, null) → dopo k.
 */
export function keyBetween(prima, dopo) {
  const a = prima || '';
  const b = dopo || null;
  if (b !== null && a >= b) {
    throw new Error(`keyBetween: "${a}" non precede "${b}"`);
  }
  return metà(a, b);
}

/** Confronto tra record con chiave `order` (a parità di chiave decide l'id). */
export function compareOrder(x, y) {
  if (x.order < y.order) return -1;
  if (x.order > y.order) return 1;
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
}
