// =============================================================================
// runner.js — Mini framework di test, senza dipendenze.
// Funziona sia nel browser (tests/index.html) sia in Node (tests/run-node.mjs),
// così i test girano sul PC senza installare nulla e in GitHub Actions.
// =============================================================================

const elenco = [];

/** Registra un test. */
export function test(nome, fn) {
  elenco.push({ nome, fn });
}

function formatta(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

export const assert = {
  ok(v, msg = 'atteso vero') {
    if (!v) throw new Error(msg);
  },
  equal(a, b, msg = '') {
    if (a !== b) throw new Error(`${msg} — atteso ${formatta(b)}, ottenuto ${formatta(a)}`);
  },
  deepEqual(a, b, msg = '') {
    if (formatta(a) !== formatta(b)) throw new Error(`${msg} — atteso ${formatta(b)}, ottenuto ${formatta(a)}`);
  },
  throws(fn, msg = 'attesa un\'eccezione') {
    try { fn(); } catch { return; }
    throw new Error(msg);
  },
};

/** Esegue tutti i test registrati. Restituisce { passati, falliti, risultati }. */
export async function run() {
  const risultati = [];
  for (const t of elenco) {
    try {
      await t.fn();
      risultati.push({ nome: t.nome, ok: true });
    } catch (e) {
      risultati.push({ nome: t.nome, ok: false, errore: e && e.message ? e.message : String(e) });
    }
  }
  const falliti = risultati.filter((r) => !r.ok).length;
  return { passati: risultati.length - falliti, falliti, risultati };
}
