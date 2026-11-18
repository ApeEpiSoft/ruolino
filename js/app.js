// =============================================================================
// app.js — Punto di ingresso: carica i dati, calcola il piano e mostra le viste.
//
// Flusso: store (IndexedDB) → doc → scheduler → piano → viste.
// Ogni modifica passa da mutate() (store.js), che incrementa la versione:
// il piano viene ricalcolato da zero a ogni versione (costa pochi ms).
// =============================================================================

import { html, render, useState, useEffect, useMemo } from './ui/util.js';
import { state, init, subscribe, salvaSnapshot, snapshotPrecedente, mutate } from './store.js';
import { schedule, slittamenti } from './core/scheduler.js';
import { macros, workedMap, live, capacityOn, confirmNoWork } from './core/model.js';
import { todayISO, addDays, weekday, formatBreve, toISO } from './core/dates.js';
import { VistaCoda } from './ui/coda.js';
import { VistaOggi } from './ui/oggi.js';
import { VistaRegistro } from './ui/registro.js';
import { VistaImpostazioni } from './ui/impostazioni.js';
import { Editor } from './ui/editor.js';

const VISTE = [
  { id: 'oggi', nome: 'Oggi', icona: '☀' },
  { id: 'coda', nome: 'Coda', icona: '☰' },
  { id: 'registro', nome: 'Registro', icona: '⏱' },
  { id: 'impostazioni', nome: 'Impostazioni', icona: '⚙' },
];

/**
 * Promemoria ore mancanti: restituisce l'ultimo giorno lavorativo prima di
 * oggi in cui non sono state registrate ore (e non è stato confermato
 * "non ho lavorato"), oppure null.
 */
function giornoSenzaOre(doc, today) {
  if (live(doc.tasks).length === 0) return null;
  const inizio = toISO(new Date(doc.settings.createdAt || Date.now()));
  let g = addDays(today, -1);
  for (let i = 0; i < 14 && g >= inizio; i++, g = addDays(g, -1)) {
    if (capacityOn(doc, g, weekday) <= 0) continue; // giorno non lavorativo: si guarda prima
    const conf = doc.days['day-' + g];
    if (conf && !conf.deletedAt) return null;
    const registrato = live(doc.logs).some((l) => l.date === g);
    return registrato ? null : g;
  }
  return null;
}

function App() {
  const [versione, setVersione] = useState(state.version);
  const [today, setToday] = useState(todayISO());
  const [vista, setVista] = useState(() => {
    const h = location.hash.slice(1);
    return VISTE.some((v) => v.id === h) ? h : 'coda';
  });
  const [editorId, setEditorId] = useState(null);
  const [dataRegistro, setDataRegistro] = useState(null);

  useEffect(() => subscribe(setVersione), []);

  // Aggiorna "oggi" quando l'app torna in primo piano o allo scoccare della mezzanotte.
  useEffect(() => {
    const controlla = () => setToday(todayISO());
    document.addEventListener('visibilitychange', controlla);
    const t = setInterval(controlla, 60000);
    return () => { document.removeEventListener('visibilitychange', controlla); clearInterval(t); };
  }, []);

  useEffect(() => { history.replaceState(null, '', '#' + vista); }, [vista]);

  const doc = state.doc;
  const plan = useMemo(() => schedule(doc, today), [versione, today]);
  const wm = useMemo(() => workedMap(doc), [versione]);

  // Slittamento rispetto a ieri: confronta con l'ultimo piano di un giorno precedente.
  const slitta = useMemo(() => {
    const fini = {};
    for (const m of macros(doc)) if (m.status !== 'done') fini[m.id] = plan.tasks[m.id].end;
    salvaSnapshot(today, fini);
    const prima = snapshotPrecedente(today);
    return prima ? slittamenti(doc, prima, fini) : {};
  }, [plan]);

  const vai = (v, opzioni = {}) => {
    if (v === 'registro') setDataRegistro(opzioni.data || null);
    setVista(v);
    window.scrollTo(0, 0);
  };
  const ctx = { doc, plan, wm, today, slitta, vai, apriEditor: setEditorId };
  const mancante = giornoSenzaOre(doc, today);

  return html`
    <header class="testata">
      <h1>Ruolino</h1>
      <nav class="nav">
        ${VISTE.map((v) => html`
          <button class=${vista === v.id ? 'attivo' : ''} onClick=${() => vai(v.id)}>
            <span class="nav-icona">${v.icona}</span><span class="nav-nome">${v.nome}</span>
          </button>`)}
      </nav>
    </header>
    <main>
      ${state.errore ? html`<div class="banner errore">${state.errore}</div>` : null}
      ${mancante && vista !== 'registro' ? html`
        <div class="banner">
          <span>${mancante === addDays(today, -1) ? 'Ieri' : formatBreve(mancante)} non hai registrato ore.</span>
          <span class="azioni">
            <button class="pri" onClick=${() => vai('registro', { data: mancante })}>Inserisci ore</button>
            <button class="sec" onClick=${() => mutate((d) => confirmNoWork(d, mancante))}>Non ho lavorato</button>
          </span>
        </div>` : null}
      ${vista === 'oggi' ? html`<${VistaOggi} ctx=${ctx} />` : null}
      ${vista === 'coda' ? html`<${VistaCoda} ctx=${ctx} />` : null}
      ${vista === 'registro' ? html`<${VistaRegistro} ctx=${ctx} dataIniziale=${dataRegistro} />` : null}
      ${vista === 'impostazioni' ? html`<${VistaImpostazioni} ctx=${ctx} />` : null}
    </main>
    ${editorId ? html`<${Editor} id=${editorId} ctx=${ctx} onChiudi=${() => setEditorId(null)} />` : null}`;
}

// Avvio.
init()
  .then(() => {
    const radice = document.getElementById('app');
    radice.textContent = ''; // toglie "Caricamento…"
    render(html`<${App} />`, radice);
  })
  .catch((e) => {
    document.getElementById('app').innerHTML =
      '<div class="banner errore">Impossibile aprire l\'archivio locale del browser: ' + e.message + '</div>';
  });
