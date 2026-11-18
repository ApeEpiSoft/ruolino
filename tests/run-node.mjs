// =============================================================================
// run-node.mjs — Esegue i test con Node (usato da GitHub Actions a ogni push).
// Uso:  node tests/run-node.mjs
//
// Oltre ai test della logica controlla che il service worker (sw.js) metta in
// cache TUTTI i file dell'app e che la sua versione coincida con js/versione.js:
// un file dimenticato renderebbe l'app inutilizzabile offline.
// =============================================================================

import './model.test.js';
import './scheduler.test.js';
import './merge.test.js';
import './sync.test.js';
import { test, assert, run } from './runner.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..');

function elencaFile(cartella) {
  const out = [];
  for (const nome of readdirSync(join(radice, cartella))) {
    const p = join(cartella, nome);
    if (statSync(join(radice, p)).isDirectory()) out.push(...elencaFile(p));
    else out.push(relative('.', p).replace(/\\/g, '/'));
  }
  return out;
}

test('service worker: tutti i file dell\'app sono in cache', () => {
  const sw = readFileSync(join(radice, 'sw.js'), 'utf8');
  const elenco = new Set([...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]));
  const attesi = ['index.html', 'manifest.webmanifest', ...elencaFile('js'), ...elencaFile('css'), ...elencaFile('icons')];
  const mancanti = attesi.filter((f) => !elenco.has(f));
  assert.deepEqual(mancanti, [], 'file mancanti in FILE di sw.js');
  const inesistenti = [...elenco].filter((f) => f !== './' && !attesi.includes(f));
  assert.deepEqual(inesistenti, [], 'file elencati in sw.js ma inesistenti');
});

test('service worker: versione uguale a js/versione.js', () => {
  const sw = readFileSync(join(radice, 'sw.js'), 'utf8').match(/const VERSIONE = '([^']+)'/)[1];
  const app = readFileSync(join(radice, 'js/versione.js'), 'utf8').match(/VERSIONE_APP = '([^']+)'/)[1];
  assert.equal(sw, app);
});

const r = await run();
for (const t of r.risultati) {
  console.log((t.ok ? '  ✔ ' : '  ✘ ') + t.nome + (t.ok ? '' : '\n      ' + t.errore));
}
console.log(`\nRISULTATO: ${r.passati} passati, ${r.falliti} falliti`);
process.exit(r.falliti ? 1 : 0);
