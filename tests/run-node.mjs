// =============================================================================
// run-node.mjs — Esegue i test con Node (usato da GitHub Actions nella fase 2).
// Uso:  node tests/run-node.mjs
// =============================================================================

import './model.test.js';
import './scheduler.test.js';
import { run } from './runner.js';

const r = await run();
for (const t of r.risultati) {
  console.log((t.ok ? '  ✔ ' : '  ✘ ') + t.nome + (t.ok ? '' : '\n      ' + t.errore));
}
console.log(`\nRISULTATO: ${r.passati} passati, ${r.falliti} falliti`);
process.exit(r.falliti ? 1 : 0);
