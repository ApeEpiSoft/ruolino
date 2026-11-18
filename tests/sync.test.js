// =============================================================================
// sync.test.js — Test del motore di sincronizzazione con un "Dropbox finto"
// in memoria e due dispositivi simulati (PC e telefono).
// =============================================================================

import { test, assert } from './runner.js';
import { Motore } from '../js/sync/motore.js';
import { ConflittoRevisione, ErroreDati } from '../js/sync/errori.js';
import { restoreFrom } from '../js/core/merge.js';
import {
  createEmptyDoc, addTask, updateTask, deleteTask, addLog, moveTask, setWeekly, setDevice, macros, live,
} from '../js/core/model.js';

/** Dropbox finto: file con revisione, come quello vero. */
class FintoDropbox {
  constructor() { this.file = {}; this.n = 0; this.primaDiCaricare = null; }
  async scarica(p) {
    const f = this.file[p];
    return f ? { rev: f.rev, testo: f.testo } : null;
  }
  async carica(p, testo, rev) {
    if (this.primaDiCaricare) { const f = this.primaDiCaricare; this.primaDiCaricare = null; await f(); }
    const f = this.file[p];
    if (rev === null ? !!f : (!f || f.rev !== rev)) throw new ConflittoRevisione();
    this.file[p] = { rev: 'rev' + ++this.n, testo };
    return { rev: this.file[p].rev };
  }
  async copia(da, a) { if (!this.file[a]) this.file[a] = { ...this.file[da], rev: 'rev' + ++this.n }; }
  async elenca(cartella) {
    return Object.keys(this.file).filter((p) => p.startsWith(cartella + '/'))
      .map((p) => ({ nome: p.slice(cartella.length + 1), percorso: p }));
  }
  async elimina(p) { delete this.file[p]; }
  /** Riscrive il file direttamente (es. ripristino manuale dal sito Dropbox). */
  forza(p, testo) { this.file[p] = { rev: 'rev' + ++this.n, testo }; }
}

let giorno = '2026-11-18';

/** Un dispositivo: documento, memoria locale e motore. */
function dispositivo(nome, dbx) {
  const mem = new Map();
  const d = {
    nome,
    doc: (setDevice(nome), createEmptyDoc()),
    mem,
  };
  d.motore = new Motore({
    api: dbx,
    archivio: { leggi: async (k) => (mem.has(k) ? JSON.parse(mem.get(k)) : undefined), scrivi: async (k, v) => mem.set(k, JSON.stringify(v)) },
    leggiDoc: () => d.doc,
    applicaDoc: (x) => { d.doc = x; },
    oggi: () => giorno,
  });
  /** Esegue una modifica "dell'utente" su questo dispositivo. */
  d.modifica = (fn) => { setDevice(nome); const r = fn(d.doc); d.motore.segnaModifica(); return r; };
  d.sync = () => { setDevice(nome); return d.motore.sincronizza(); };
  return d;
}

const titoli = (doc) => macros(doc).map((t) => t.title);

test('sync: il primo dispositivo crea il file, il secondo (vuoto) riceve tutto', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  pc.modifica((d) => { addTask(d, { title: 'A' }); setWeekly(d, 5, 4); });
  assert.equal((await pc.sync()).esito, 'creato');
  const tel = dispositivo('tel', dbx);
  await tel.sync();
  assert.deepEqual(titoli(tel.doc), ['A']);
  assert.equal(tel.doc.settings.weekly[5], 4, 'le impostazioni del PC non vengono sovrascritte dal telefono nuovo');
  assert.equal(tel.motore.modificheLocali, false);
});

test('sync: modifiche offline su record diversi convergono senza conflitti', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  const tel = dispositivo('tel', dbx);
  const t = pc.modifica((d) => addTask(d, { title: 'Comune', estimate: 8 }));
  await pc.sync(); await tel.sync();
  // Offline: ognuno lavora per conto suo.
  pc.modifica((d) => addTask(d, { title: 'Solo PC' }));
  pc.modifica((d) => updateTask(d, t.id, { deadline: '2026-12-01' }));
  tel.modifica((d) => addTask(d, { title: 'Solo telefono' }));
  tel.modifica((d) => addLog(d, { taskId: t.id, date: giorno, hours: 2 }));
  const r1 = await tel.sync();
  const r2 = await pc.sync();
  await tel.sync();
  assert.deepEqual(titoli(pc.doc).sort(), ['Comune', 'Solo PC', 'Solo telefono']);
  assert.deepEqual(titoli(tel.doc).sort(), titoli(pc.doc).sort());
  assert.equal(pc.doc.tasks[t.id].deadline, '2026-12-01');
  assert.equal(live(pc.doc.logs).length, 1);
  assert.equal(r1.conflitti.length + r2.conflitti.length, 0);
});

test('sync: stessa attività modificata su due dispositivi → vince la più recente, conflitto visibile ovunque', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  const tel = dispositivo('tel', dbx);
  const t = pc.modifica((d) => addTask(d, { title: 'Schema', estimate: 8 }));
  await pc.sync(); await tel.sync();
  pc.modifica((d) => updateTask(d, t.id, { estimate: 12 }));
  tel.modifica((d) => updateTask(d, t.id, { estimate: 16 })); // più recente
  await pc.sync();
  const r = await tel.sync();
  await pc.sync();
  assert.equal(pc.doc.tasks[t.id].estimate, 16);
  assert.equal(tel.doc.tasks[t.id].estimate, 16);
  assert.equal(r.conflitti.length, 1);
  const cPc = Object.values(pc.doc.conflicts);
  assert.equal(cPc.length, 1, 'il conflitto arriva anche sul PC');
  assert.equal(cPc[0].scartata.estimate, 12);
});

test('sync: corsa tra dispositivi (file cambiato tra download e upload) → si ritenta, nulla perso', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  const tel = dispositivo('tel', dbx);
  pc.modifica((d) => addTask(d, { title: 'Iniziale' }));
  await pc.sync(); await tel.sync();
  tel.modifica((d) => addTask(d, { title: 'Dal telefono' }));
  pc.modifica((d) => addTask(d, { title: 'Dal PC' }));
  // Mentre il PC sta per caricare, il telefono scrive.
  dbx.primaDiCaricare = () => tel.sync();
  await pc.sync();
  await tel.sync();
  assert.deepEqual(titoli(pc.doc).sort(), ['Dal PC', 'Dal telefono', 'Iniziale']);
  assert.deepEqual(titoli(tel.doc).sort(), titoli(pc.doc).sort());
});

test('sync: una modifica fatta durante la sincronizzazione resta da caricare e non si perde', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  const tel = dispositivo('tel', dbx);
  pc.modifica((d) => addTask(d, { title: 'Uno' }));
  await pc.sync();
  pc.modifica((d) => addTask(d, { title: 'Due' }));
  dbx.primaDiCaricare = async () => { pc.modifica((d) => addTask(d, { title: 'Tre (durante)' })); };
  await pc.sync();
  assert.equal(pc.motore.modificheLocali, true, 'la modifica arrivata durante l\'upload è ancora da caricare');
  await pc.sync();
  assert.equal(pc.motore.modificheLocali, false);
  await tel.sync();
  assert.deepEqual(titoli(tel.doc).sort(), ['Due', 'Tre (durante)', 'Uno']);
});

test('sync: riordino concorrente della coda su due dispositivi', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  const tel = dispositivo('tel', dbx);
  const [a, b, c, e] = ['A', 'B', 'C', 'D'].map((x) => pc.modifica((d) => addTask(d, { title: x })));
  await pc.sync(); await tel.sync();
  pc.modifica((d) => moveTask(d, e.id, null, a.id)); // D in cima
  tel.modifica((d) => moveTask(d, a.id, c.id, e.id)); // A tra C e D
  await pc.sync(); await tel.sync(); await pc.sync();
  assert.deepEqual(titoli(pc.doc), ['D', 'B', 'C', 'A']);
  assert.deepEqual(titoli(tel.doc), titoli(pc.doc));
  void b;
});

test('sync: eliminazione su un dispositivo, ore registrate sull\'altro', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  const tel = dispositivo('tel', dbx);
  const t = pc.modifica((d) => addTask(d, { title: 'T', estimate: 5 }));
  await pc.sync(); await tel.sync();
  pc.modifica((d) => deleteTask(d, t.id));
  tel.modifica((d) => addLog(d, { taskId: t.id, date: giorno, hours: 1 }));
  await pc.sync(); await tel.sync(); await pc.sync();
  // Le ore registrate dopo l'eliminazione fanno ripristinare l'attività,
  // e il caso è visibile tra i conflitti su entrambi i dispositivi.
  assert.equal(live(pc.doc.logs).length, 1);
  assert.ok(!pc.doc.tasks[t.id].deletedAt, 'attività ripristinata');
  assert.ok(!tel.doc.tasks[t.id].deletedAt);
  assert.equal(Object.values(pc.doc.conflicts).length, 1, 'il conflitto è visibile');
  assert.equal(Object.values(tel.doc.conflicts).length, 1);
});

test('sync: backup giornaliero una volta al giorno, conservati gli ultimi 30', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  pc.modifica((d) => addTask(d, { title: 'A' }));
  await pc.sync();
  for (let i = 0; i < 35; i++) {
    giorno = '2026-12-' + String(i + 1).padStart(2, '0');
    if (i >= 31) giorno = '2027-01-0' + (i - 30);
    pc.modifica((d) => addTask(d, { title: 'G' + i }));
    await pc.sync();
    await pc.sync(); // seconda sincronizzazione nello stesso giorno: nessun nuovo backup
  }
  const backup = await pc.motore.elencaBackup();
  assert.equal(backup.length, 30);
  assert.equal(backup[0].nome, 'ruolino-2027-01-04.json');
  assert.equal(backup[29].nome, 'ruolino-2026-12-06.json');
  // Il backup contiene lo stato PRIMA delle modifiche di quel giorno.
  const b = await pc.motore.leggiBackup(backup[0].percorso);
  assert.ok(!titoli(b).includes('G34'));
  assert.ok(titoli(b).includes('G33'));
  giorno = '2026-11-18';
});

test('sync: file su Dropbox illeggibile → errore, e il file NON viene sovrascritto', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  pc.modifica((d) => addTask(d, { title: 'A' }));
  await pc.sync();
  dbx.forza('/ruolino.json', '{ questo non è json');
  pc.modifica((d) => addTask(d, { title: 'B' }));
  let errore = null;
  try { await pc.sync(); } catch (e) { errore = e; }
  assert.ok(errore instanceof ErroreDati);
  assert.equal(dbx.file['/ruolino.json'].testo, '{ questo non è json');
  assert.equal(pc.motore.modificheLocali, true, 'le modifiche locali restano in attesa');
});

test('sync: file riportato a una versione vecchia dal sito Dropbox → nessun dato perso', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  pc.modifica((d) => addTask(d, { title: 'Vecchia' }));
  await pc.sync();
  const vecchio = dbx.file['/ruolino.json'].testo;
  pc.modifica((d) => addTask(d, { title: 'Nuova' }));
  await pc.sync();
  dbx.forza('/ruolino.json', vecchio);
  await pc.sync();
  assert.deepEqual(titoli(pc.doc).sort(), ['Nuova', 'Vecchia']);
  assert.ok(JSON.parse(dbx.file['/ruolino.json'].testo).tasks, 'il file viene ricaricato completo');
  assert.equal(titoli(JSON.parse(dbx.file['/ruolino.json'].testo)).length, 2);
});

test('sync: ripristino di un backup si propaga all\'altro dispositivo', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  const tel = dispositivo('tel', dbx);
  const t1 = pc.modifica((d) => addTask(d, { title: 'T1', estimate: 5 }));
  await pc.sync();
  giorno = '2026-11-19';
  await pc.sync(); // crea il backup del 19 con T1
  pc.modifica((d) => { updateTask(d, t1.id, { estimate: 50 }); addTask(d, { title: 'T2' }); });
  await pc.sync(); await tel.sync();
  const [b] = await pc.motore.elencaBackup();
  const contenuto = await pc.motore.leggiBackup(b.percorso);
  pc.modifica((d) => Object.assign(d, restoreFrom(d, contenuto)));
  await pc.sync(); await tel.sync();
  assert.deepEqual(titoli(tel.doc), ['T1']);
  assert.equal(tel.doc.tasks[t1.id].estimate, 5);
  giorno = '2026-11-18';
});

test('sync: due dispositivi che creano il file contemporaneamente', async () => {
  const dbx = new FintoDropbox();
  const pc = dispositivo('pc', dbx);
  const tel = dispositivo('tel', dbx);
  pc.modifica((d) => addTask(d, { title: 'PC' }));
  tel.modifica((d) => addTask(d, { title: 'Tel' }));
  dbx.primaDiCaricare = () => tel.sync(); // il telefono crea il file per primo
  await pc.sync();
  await tel.sync();
  assert.deepEqual(titoli(pc.doc).sort(), ['PC', 'Tel']);
  assert.deepEqual(titoli(tel.doc).sort(), ['PC', 'Tel']);
});
