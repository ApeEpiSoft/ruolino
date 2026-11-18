// =============================================================================
// sync.js (ui) — Interfaccia della sincronizzazione: indicatore nella
// testata, sezione in Impostazioni (collegamento, backup), elenco conflitti.
// =============================================================================

import { html, useState, useEffect, fmtOre } from './util.js';
import {
  statoSync, subscribeSync, sincronizzaOra, collega, scollega, impostaAppKey,
  elencaBackup, ripristinaBackup,
} from '../sync/sincronizzazione.js';
import { indirizzoRitorno } from '../sync/dropbox.js';
import { ripristinaConflitto, archiviaConflitto } from '../core/merge.js';
import { STATI, live, getDevice } from '../core/model.js';
import { mutate } from '../store.js';
import { formatBreve, toISO, NOMI_GIORNI } from '../core/dates.js';

/** Stato della sincronizzazione come hook Preact. */
export function useStatoSync() {
  const [s, setS] = useState({ ...statoSync });
  useEffect(() => {
    const via = subscribeSync(setS);
    setS({ ...statoSync }); // recupera eventuali aggiornamenti arrivati prima dell'iscrizione
    return via;
  }, []);
  return s;
}

const FASI = {
  nonConfigurato: { icona: '○', testo: 'Dropbox non configurato', classe: 'muto' },
  scollegato: { icona: '○', testo: 'Non collegato a Dropbox', classe: 'muto' },
  offline: { icona: '⚡', testo: 'Offline: modifiche salvate sul dispositivo', classe: 'avviso' },
  inCorso: { icona: '↻', testo: 'Sincronizzazione in corso…', classe: 'gira' },
  ok: { icona: '✓', testo: 'Sincronizzato', classe: 'ok' },
  modifiche: { icona: '●', testo: 'Modifiche da sincronizzare', classe: 'avviso' },
  errore: { icona: '⚠', testo: 'Errore di sincronizzazione', classe: 'tardi' },
};

/** "alle 14:32" oppure "il 17 nov alle 14:32". */
function quando(ms) {
  if (!ms) return 'mai';
  const d = new Date(ms);
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const g = toISO(d);
  return g === toISO(new Date()) ? 'alle ' + ora : `il ${formatBreve(g)} alle ${ora}`;
}

/** Indicatore compatto nella testata. */
export function IndicatoreSync({ onClick }) {
  const s = useStatoSync();
  const f = FASI[s.fase] || FASI.scollegato;
  return html`<button class="indicatore-sync ${f.classe}" onClick=${onClick}
    title="${f.testo}${s.ultima ? ' · ultima sincronizzazione ' + quando(s.ultima) : ''}${s.messaggio ? ' · ' + s.messaggio : ''}">
    <span class="icona-sync">${f.icona}</span><span class="testo-sync">${f.testo}</span>
  </button>`;
}

/** Sezione "Sincronizzazione Dropbox" delle impostazioni. */
export function SezioneSync() {
  const s = useStatoSync();
  const f = FASI[s.fase] || FASI.scollegato;
  const [chiave, setChiave] = useState('');
  const [backup, setBackup] = useState(null);
  const [errore, setErrore] = useState('');
  const [occupato, setOccupato] = useState(false);

  const esegui = async (fn) => {
    setErrore(''); setOccupato(true);
    try { await fn(); } catch (e) { setErrore(e.message || String(e)); }
    setOccupato(false);
  };

  if (s.fase === 'nonConfigurato') {
    return html`
      <p class="muto">Per sincronizzare PC e telefono serve la <b>App key</b> dell'app registrata sulla
        console sviluppatori di Dropbox (istruzioni nel README). Indirizzo di ritorno da registrare per questa
        pagina: <code>${indirizzoRitorno()}</code></p>
      <form class="riga-campi" onSubmit=${(e) => { e.preventDefault(); esegui(() => impostaAppKey(chiave)); }}>
        <input placeholder="App key di Dropbox" value=${chiave} onInput=${(e) => setChiave(e.target.value)} />
        <button class="pri" disabled=${!chiave.trim() || occupato}>Salva</button>
      </form>
      ${errore ? html`<p class="tardi">${errore}</p>` : null}`;
  }

  const collegato = s.fase !== 'scollegato';
  return html`
    <div class="stato-sync ${f.classe}">
      <span class="icona-sync">${f.icona}</span>
      <div>
        <b>${f.testo}</b>
        ${s.account ? html`<div class="muto">Account: ${s.account} · ultima sincronizzazione ${quando(s.ultima)}</div>` : null}
        ${s.messaggio ? html`<div class=${s.fase === 'errore' ? 'tardi' : 'avviso'}>${s.messaggio}</div>` : null}
      </div>
    </div>
    <div class="azioni sinistra">
      ${!collegato
        ? html`<button class="pri" disabled=${occupato} onClick=${() => esegui(collega)}>Collega a Dropbox</button>`
        : html`
          <button class="pri" disabled=${occupato || s.fase === 'inCorso'} onClick=${() => esegui(sincronizzaOra)}>Sincronizza ora</button>
          <button class="sec" disabled=${occupato} onClick=${() => esegui(async () => setBackup(await elencaBackup()))}>Backup…</button>
          <button class="pericolo" disabled=${occupato} onClick=${() => confirm('Scollegare Dropbox da questo dispositivo? I dati restano sia qui sia su Dropbox.') && esegui(scollega)}>Scollega</button>`}
    </div>
    ${errore ? html`<p class="tardi">${errore}</p>` : null}
    ${backup ? html`
      <h3>Backup giornalieri su Dropbox</h3>
      ${backup.length === 0 ? html`<p class="muto">Nessun backup ancora: il primo viene creato alla prima sincronizzazione di domani.</p>` : html`
        <p class="muto">Ogni backup è il file così com'era all'inizio di quel giorno. Ripristinarlo riporta
          <b>tutti i dispositivi</b> a quello stato (le modifiche successive vengono annullate; i backup restano).</p>
        <ul class="eccezioni">
          ${backup.map((b) => {
            const data = b.nome.slice(8, 18);
            return html`<li key=${b.percorso}>
              <span class="data">${formatBreve(data)}</span>
              <span class="titolo">${b.nome}</span>
              <button class="link" disabled=${occupato} onClick=${() =>
                confirm(`Ripristinare il backup del ${formatBreve(data)}?\n\nTutti i dati torneranno a quello stato su tutti i dispositivi.`)
                && esegui(async () => { await ripristinaBackup(b.percorso); setBackup(null); })}>Ripristina</button>
            </li>`;
          })}
        </ul>`}` : null}`;
}

// -----------------------------------------------------------------------------
// Conflitti
// -----------------------------------------------------------------------------

const ETICHETTE = {
  title: 'Titolo', notes: 'Note', category: 'Categoria', status: 'Stato', estimate: 'Stima',
  estimateOriginal: 'Stima originale', deadline: 'Scadenza', predecessors: 'Predecessori',
  maxPerDay: 'Max ore/giorno', deletedAt: 'Eliminata', order: 'Posizione nella coda',
  completedAt: 'Completata il', hours: 'Ore', date: 'Data', note: 'Nota', taskId: 'Attività',
  weekly: 'Ore settimanali', applyCorrection: 'Correzione stime', parentId: 'Macro-attività',
  noWork: 'Giorno senza lavoro', fixedStart: 'Data fissa (dal)', fixedEnd: 'Data fissa (al)',
  notBefore: 'Non prima del',
};

function valore(campo, v, doc) {
  if (v === null || v === undefined || v === '') return '—';
  switch (campo) {
    case 'deletedAt': return v ? 'sì' : 'no';
    case 'status': return STATI[v] || v;
    case 'estimate': case 'estimateOriginal': case 'maxPerDay': case 'hours': return fmtOre(v);
    case 'deadline': case 'date': case 'completedAt': case 'fixedStart': case 'fixedEnd': case 'notBefore':
      return formatBreve(v);
    case 'predecessors': return v.map((id) => doc.tasks[id]?.title || '?').join(', ') || '—';
    case 'taskId': case 'parentId': return doc.tasks[v]?.title || '?';
    case 'weekly': return [1, 2, 3, 4, 5, 6, 0].map((g) => NOMI_GIORNI[g].slice(0, 3) + ' ' + v[g]).join(', ');
    case 'order': return '(spostata)';
    default: return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}

/** Differenze campo per campo tra versione tenuta e scartata. */
function differenze(c, doc) {
  const ignora = new Set(['updatedAt', 'dev', 'id', 'createdAt']);
  const campi = new Set([...Object.keys(c.tenuta || {}), ...Object.keys(c.scartata || {})]);
  const out = [];
  for (const k of campi) {
    if (ignora.has(k)) continue;
    const a = c.tenuta?.[k], b = c.scartata?.[k];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    out.push({ campo: ETICHETTE[k] || k, tenuto: valore(k, a, doc), scartato: valore(k, b, doc) });
  }
  return out;
}

/** "questo dispositivo" / "altro dispositivo" + ora della modifica. */
function dispositivo(r) {
  if (!r) return '?';
  const chi = r.dev === getDevice() ? 'questo dispositivo' : 'altro dispositivo';
  return r.updatedAt ? `${chi}, ${quando(r.updatedAt)}` : chi;
}

/** Conflitti non ancora archiviati, più recenti prima. */
export function conflittiAttivi(doc) {
  return live(doc.conflicts).sort((a, b) => b.at - a.at);
}

export function SezioneConflitti({ ctx }) {
  const { doc } = ctx;
  const elenco = conflittiAttivi(doc);
  if (!elenco.length) return html`<p class="muto">Nessun conflitto: tutte le modifiche fatte sui diversi dispositivi sono state unite.</p>`;
  return html`
    <p class="muto">La stessa voce è stata modificata su due dispositivi prima che si sincronizzassero:
      è stata tenuta la modifica più recente. Controlla la versione scartata e, se serve, ripristinala.</p>
    <ul class="conflitti">
      ${elenco.map((c) => html`
        <li key=${c.id}>
          <div class="conflitto-testa"><b>${c.titolo}</b> <span class="muto">· ${quando(c.at)}</span></div>
          <table class="diff">
            <tr><th></th><th>Tenuta (${dispositivo(c.tenuta)})</th><th>Scartata (${dispositivo(c.scartata)})</th></tr>
            ${differenze(c, doc).map((d) => html`<tr><td>${d.campo}</td><td>${d.tenuto}</td><td>${d.scartato}</td></tr>`)}
          </table>
          <div class="azioni sinistra">
            <button class="sec" onClick=${() => mutate((d) => ripristinaConflitto(d, c.id))}>Ripristina la scartata</button>
            <button class="pri" onClick=${() => mutate((d) => archiviaConflitto(d, c.id))}>Va bene così</button>
          </div>
        </li>`)}
    </ul>`;
}
