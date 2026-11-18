// =============================================================================
// profili.js (ui) — Selettore del profilo nella testata e gestione dei
// profili in Impostazioni. La logica (chiavi separate in IndexedDB) è in store.js.
// =============================================================================

import { html, useState } from './util.js';
import {
  profili, profiloAttivo, creaProfilo, rinominaProfilo, eliminaProfilo, attivaProfilo, PRINCIPALE,
} from '../store.js';
import { Testo } from './editor.js';

/** Selettore nella testata: compare solo se ci sono almeno due profili. */
export function SelettoreProfilo({ onGestisci }) {
  if (profili.elenco.length < 2) return null;
  const scegli = (e) => {
    const v = e.target.value;
    if (v === '__gestisci') { e.target.value = profili.attivo; onGestisci(); return; }
    if (v !== profili.attivo) attivaProfilo(v);
  };
  return html`<select class="selettore-profilo" value=${profili.attivo} onChange=${scegli} aria-label="Profilo"
    title="Profilo in uso: ogni profilo ha dati e Dropbox propri">
    ${profili.elenco.map((p) => html`<option value=${p.id}>${p.nome}</option>`)}
    <option value="__gestisci">Gestisci profili…</option>
  </select>`;
}

/** Sezione "Profili" delle impostazioni. */
export function SezioneProfili() {
  const [nome, setNome] = useState('');
  const [occupato, setOccupato] = useState(false);
  const attivo = profiloAttivo();

  const crea = async (e) => {
    e.preventDefault();
    if (!nome.trim()) return;
    setOccupato(true);
    const p = await creaProfilo(nome);
    setNome('');
    setOccupato(false);
    if (confirm(`Profilo "${p.nome}" creato. Aprirlo adesso?\n\nPoi collegalo al suo account Dropbox da Impostazioni.`)) attivaProfilo(p.id);
  };

  const elimina = async (p) => {
    if (!confirm(`Eliminare il profilo "${p.nome}" da questo dispositivo?\n\nI suoi dati su questo dispositivo vengono cancellati. `
      + 'Quelli su Dropbox restano: li ritrovi creando un nuovo profilo e collegando lo stesso account.')) return;
    await eliminaProfilo(p.id);
  };

  return html`
    <p class="muto">Ogni profilo ha attività, impostazioni e collegamento Dropbox propri. Per esempio un profilo per il
      lavoro e uno personale, ognuno con il suo account Dropbox. Il profilo in uso è <b>${attivo.nome}</b>.</p>
    <ul class="profili">
      ${profili.elenco.map((p) => html`<li key=${p.id} class=${p.id === profili.attivo ? 'attivo' : ''}>
        <${Testo} valore=${p.nome} aria-label="Nome del profilo" onSalva=${(v) => rinominaProfilo(p.id, v)} />
        ${p.id === profili.attivo
          ? html`<span class="chip">in uso</span>`
          : html`
            <button class="sec" onClick=${() => attivaProfilo(p.id)}>Apri</button>
            ${p.id !== PRINCIPALE ? html`<button class="icona elimina" title="Elimina profilo" onClick=${() => elimina(p)}>✕</button>` : null}`}
      </li>`)}
    </ul>
    <form class="riga-campi" onSubmit=${crea}>
      <input placeholder="Nome del nuovo profilo (es. Personale)" value=${nome} onInput=${(e) => setNome(e.target.value)} />
      <button class="pri" disabled=${!nome.trim() || occupato}>Crea profilo</button>
    </form>
    ${profili.elenco.length > 1 ? html`<p class="muto piccolo">Per cambiare profilo usa anche il menu in alto.
      Collegando Dropbox in un profilo, Dropbox chiede di accedere: usa l'account di quel profilo.
      Lo stesso account non può essere collegato a due profili.</p>` : null}`;
}
