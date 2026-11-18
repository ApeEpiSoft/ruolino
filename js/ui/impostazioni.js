// =============================================================================
// impostazioni.js — Capacità settimanale, eccezioni per data, export/import.
// =============================================================================

import { html, useState, fmtOre, parseOre } from './util.js';
import { setWeekly, setException, deleteException, live, getDevice, SCHEMA } from '../core/model.js';
import { mutate, sostituisciDoc, salvaOra } from '../store.js';
import { addDays, formatBreve, NOMI_GIORNI } from '../core/dates.js';
import { Ore } from './editor.js';

const ORDINE_GIORNI = [1, 2, 3, 4, 5, 6, 0]; // lunedì … domenica

/** Scarica un testo come file. */
function scarica(nome, testo, tipo = 'application/json') {
  const blob = new Blob([testo], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function Eccezioni({ doc, today }) {
  const [dal, setDal] = useState('');
  const [al, setAl] = useState('');
  const [ore, setOre] = useState('0');
  const [nota, setNota] = useState('');
  const [mostraPassate, setMostraPassate] = useState(false);

  const tutte = live(doc.exceptions).sort((a, b) => a.date.localeCompare(b.date));
  const future = tutte.filter((e) => e.date >= today);
  const passate = tutte.filter((e) => e.date < today).reverse();

  const aggiungi = (e) => {
    e.preventDefault();
    const h = parseOre(ore);
    if (!dal || h === null) return;
    const fine = al && al > dal ? al : dal;
    mutate((d) => {
      for (let g = dal, i = 0; g <= fine && i < 366; g = addDays(g, 1), i++) setException(d, g, h, nota);
    });
    setDal(''); setAl(''); setNota('');
  };

  const riga = (e) => html`<li key=${e.id}>
    <span class="data">${formatBreve(e.date)}</span>
    <span>${fmtOre(e.hours)}</span>
    <span class="titolo">${e.note}</span>
    <button class="icona elimina" title="Rimuovi eccezione" onClick=${() => mutate((d) => deleteException(d, e.date))}>✕</button>
  </li>`;

  return html`
    <form class="eccezione-nuova" onSubmit=${aggiungi}>
      <label>Dal<input type="date" value=${dal} onInput=${(e) => setDal(e.target.value)} required /></label>
      <label>Al (facoltativo)<input type="date" value=${al} min=${dal} onInput=${(e) => setAl(e.target.value)} /></label>
      <label>Ore disponibili<input inputmode="decimal" value=${ore} onInput=${(e) => setOre(e.target.value)} /></label>
      <label class="largo">Motivo<input placeholder="Ferie, trasferta, festivo, riunioni…" value=${nota}
        onInput=${(e) => setNota(e.target.value)} /></label>
      <button class="pri">Aggiungi</button>
    </form>
    ${future.length ? html`<ul class="eccezioni">${future.map(riga)}</ul>` : html`<p class="muto">Nessuna eccezione futura.</p>`}
    ${passate.length ? html`
      <button class="link" onClick=${() => setMostraPassate(!mostraPassate)}>${mostraPassate ? '▾' : '▸'} Passate (${passate.length})</button>
      ${mostraPassate ? html`<ul class="eccezioni muto">${passate.map(riga)}</ul>` : null}` : null}`;
}

export function VistaImpostazioni({ ctx }) {
  const { doc, today } = ctx;
  const [esito, setEsito] = useState('');
  const settimana = ORDINE_GIORNI.reduce((s, g) => s + Number(doc.settings.weekly[g] || 0), 0);

  const esporta = async () => {
    await salvaOra();
    scarica(`ruolino-${today}.json`, JSON.stringify(doc, null, 2));
  };

  const importa = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dati = JSON.parse(await file.text());
      if (!dati || typeof dati.tasks !== 'object') throw new Error('il file non sembra un export di Ruolino');
      if (dati.schema > SCHEMA) throw new Error('il file è stato creato da una versione più recente dell\'app');
      const n = Object.values(dati.tasks).filter((t) => !t.deletedAt).length;
      if (!confirm(`Il file contiene ${n} attività. Sostituire TUTTI i dati attuali con quelli del file?\n\nSuggerimento: prima esporta i dati attuali come copia di sicurezza.`)) return;
      await sostituisciDoc(dati);
      setEsito(`Importate ${n} attività da ${file.name}.`);
    } catch (err) {
      setEsito('Import non riuscito: ' + err.message);
    }
  };

  const nAtt = live(doc.tasks).length;
  const nLog = live(doc.logs).length;

  return html`
    <section class="vista impostazioni">
      <h2>Capacità settimanale</h2>
      <p class="muto">Ore che puoi dedicare alle attività della coda in ciascun giorno. Totale: <b>${fmtOre(settimana)}</b> a settimana.</p>
      <div class="settimana">
        ${ORDINE_GIORNI.map((g) => html`
          <label key=${g}>${NOMI_GIORNI[g]}
            <${Ore} valore=${doc.settings.weekly[g]} onSalva=${(v) => mutate((d) => setWeekly(d, g, v))} />
          </label>`)}
      </div>

      <h2>Eccezioni per data</h2>
      <p class="muto">Ferie, trasferte, festivi o giorni parzialmente occupati: sostituiscono la capacità settimanale di quella data.</p>
      <${Eccezioni} doc=${doc} today=${today} />

      <h2>Dati</h2>
      <p class="muto">I dati sono salvati in questo browser (${nAtt} attività, ${nLog} registrazioni ore).
        Finché non è attiva la sincronizzazione con Dropbox (fase 2), esporta spesso una copia.</p>
      <div class="azioni sinistra">
        <button class="pri" onClick=${esporta}>Esporta JSON</button>
        <label class="bottone sec">Importa JSON<input type="file" accept=".json,application/json" hidden onChange=${importa} /></label>
      </div>
      ${esito ? html`<p class="messaggio">${esito}</p>` : null}

      <h2>Informazioni</h2>
      <p class="muto">Ruolino · fase 1 (solo locale) · dispositivo <code>${getDevice()}</code></p>
    </section>`;
}
