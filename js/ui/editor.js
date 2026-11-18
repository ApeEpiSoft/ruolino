// =============================================================================
// editor.js — Scheda di dettaglio/modifica di una macro-attività.
//
// Le modifiche vengono applicate subito, campo per campo, quando si esce dal
// campo (evento "change"): non c'è un pulsante "Salva". Così ogni modifica
// tocca solo il record interessato, il che semplifica la sincronizzazione.
// =============================================================================

import { html, useState, useEffect, fmtOre, fmtNum, parseOre, useSortable } from './util.js';
import {
  macros, children, summary, addTask, updateTask, deleteTask, moveTask,
  setRemaining, live, deleteLog, statoEffettivo, STATI,
} from '../core/model.js';
import { mutate } from '../store.js';
import { formatBreve, formatCorto } from '../core/dates.js';
import { finePrevista } from './coda.js';

/**
 * Stato locale di un campo, riallineato quando il valore nei dati cambia
 * (es. modificato da un'altra parte dell'app).
 */
function useCampo(esterno) {
  const [v, setV] = useState(esterno);
  useEffect(() => setV(esterno), [esterno]);
  return [v, setV];
}

/** Campo di testo che salva all'uscita. */
export function Testo({ valore, onSalva, ...altri }) {
  const [v, setV] = useCampo(valore ?? '');
  return html`<input value=${v} onInput=${(e) => setV(e.target.value)}
    onChange=${(e) => e.target.value !== (valore ?? '') && onSalva(e.target.value)} ...${altri} />`;
}

/** Campo ore che salva all'uscita (accetta "2,5" o "1:30"). */
export function Ore({ valore, onSalva, vuotoNull = false, ...altri }) {
  const testo = valore === null || valore === undefined ? '' : fmtNum(valore);
  const [v, setV] = useCampo(testo);
  const salva = (t) => {
    const n = parseOre(t);
    if (n === null && !vuotoNull) { setV(testo); return; }
    if (n !== valore) onSalva(n);
  };
  return html`<input inputmode="decimal" value=${v} onInput=${(e) => setV(e.target.value)}
    onChange=${(e) => salva(e.target.value)} ...${altri} />`;
}

/** Riga di una sottoattività dentro l'editor. */
function RigaSotto({ c, ctx }) {
  const { doc, wm, plan } = ctx;
  const s = summary(doc, c.id, wm);
  const f = finePrevista(plan.tasks[c.id], s);
  const agg = (patch) => mutate((d) => updateTask(d, c.id, patch));
  return html`
    <li data-id=${c.id} class="sotto-riga stato-${c.status}">
      <span class="maniglia">⠿</span>
      <input type="checkbox" title="Completata" checked=${c.status === 'done'}
        onChange=${(e) => agg({ status: e.target.checked ? 'done' : 'todo' })} />
      <${Testo} class="s-titolo" valore=${c.title} onSalva=${(v) => agg({ title: v })} />
      <label class="mini">stima<${Ore} valore=${c.estimate} onSalva=${(v) => agg({ estimate: v })} /></label>
      <label class="mini">restano<${Ore} valore=${s.remaining}
        onSalva=${(v) => mutate((d) => setRemaining(d, c.id, v))} disabled=${c.status === 'done'} /></label>
      <span class="s-info">${fmtOre(s.worked)} lav. · <span class=${f.classe}>${c.status === 'done' ? 'fatta' : f.testo}</span></span>
      <button class="icona" title=${c.status === 'paused' ? 'Riprendi' : 'Metti in pausa'}
        onClick=${() => agg({ status: c.status === 'paused' ? 'todo' : 'paused' })}
        disabled=${c.status === 'done'}>${c.status === 'paused' ? '▶' : '❚❚'}</button>
      <button class="icona elimina" title="Elimina sottoattività"
        onClick=${() => confirm(`Eliminare la sottoattività "${c.title}"?`) && mutate((d) => deleteTask(d, c.id))}>✕</button>
    </li>`;
}

/** Scheda modale di modifica. */
export function Editor({ id, ctx, onChiudi }) {
  const { doc, wm, plan } = ctx;
  const m = doc.tasks[id];
  const [nuovaSotto, setNuovaSotto] = useState('');
  const [oreSotto, setOreSotto] = useState('');
  const refSotto = useSortable((cid, a, b) => mutate((d) => moveTask(d, cid, a, b)));

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onChiudi();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  if (!m || m.deletedAt) return null;
  const figli = children(doc, id);
  const s = summary(doc, id, wm);
  const r = plan.tasks[id];
  const f = finePrevista(r, s);
  const agg = (patch) => mutate((d) => updateTask(d, id, patch));
  const categorie = [...new Set(live(doc.tasks).map((t) => t.category).filter(Boolean))].sort();
  const candidatiPred = macros(doc).filter((x) => x.id !== id && (x.status !== 'done' || (m.predecessors || []).includes(x.id)));
  const registrazioni = live(doc.logs)
    .filter((l) => l.taskId === id || figli.some((c) => c.id === l.taskId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  const aggiungiSotto = (e) => {
    e.preventDefault();
    if (!nuovaSotto.trim()) return;
    mutate((d) => addTask(d, { title: nuovaSotto, estimate: parseOre(oreSotto) || 0, parentId: id }));
    setNuovaSotto(''); setOreSotto('');
  };

  const togglePred = (pid, on) => {
    const p = new Set(m.predecessors || []);
    on ? p.add(pid) : p.delete(pid);
    agg({ predecessors: [...p] });
  };

  return html`
    <div class="modale" onClick=${(e) => e.target === e.currentTarget && onChiudi()}>
      <div class="pannello" role="dialog" aria-label="Modifica attività">
        <header class="pannello-testa">
          <${Testo} class="campo-titolo grande" valore=${m.title} onSalva=${(v) => agg({ title: v })} />
          <button class="icona chiudi" onClick=${onChiudi} aria-label="Chiudi">✕</button>
        </header>

        <div class="esito ${f.classe}">
          ${r && r.state === 'planned' && r.end
            ? html`Fine prevista <b>${formatBreve(r.end)}</b>${r.start ? html` · inizio ${formatBreve(r.start)}` : ''}${r.late ? html` · <b>oltre la scadenza</b>` : ''}`
            : html`<b>${f.testo}</b>${r && r.reason && r.state !== 'paused' ? ' — ' + r.reason : ''}`}
        </div>

        <div class="griglia">
          <label>Stato
            <select value=${statoEffettivo(doc, m, wm)} onChange=${(e) => agg({ status: e.target.value })}>
              ${Object.entries(STATI).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
            </select>
          </label>
          <label>Categoria
            <${Testo} valore=${m.category} list="elenco-categorie" placeholder="es. Software robot"
              onSalva=${(v) => agg({ category: v.trim() })} />
            <datalist id="elenco-categorie">${categorie.map((c) => html`<option value=${c} />`)}</datalist>
          </label>
          <label>Scadenza
            <input type="date" value=${m.deadline || ''} onChange=${(e) => agg({ deadline: e.target.value || null })} />
          </label>
          <label title="Lascia vuoto per nessun limite">Max ore al giorno
            <${Ore} valore=${m.maxPerDay} vuotoNull placeholder="nessun limite"
              onSalva=${(v) => agg({ maxPerDay: v || null })} />
          </label>
        </div>

        <h3>Ore</h3>
        <div class="griglia">
          <label>${figli.length ? 'Ore proprie (oltre alle sottoattività)' : 'Stima corrente'}
            <${Ore} valore=${m.estimate} onSalva=${(v) => agg({ estimate: v })} />
          </label>
          ${figli.length ? null : html`
            <label>Ore rimanenti
              <${Ore} valore=${s.remaining} onSalva=${(v) => mutate((d) => setRemaining(d, id, v))}
                disabled=${m.status === 'done'} />
            </label>`}
          <label title="Stima iniziale: serve per le statistiche di precisione">Stima originale
            <${Ore} valore=${m.estimateOriginal} onSalva=${(v) => agg({ estimateOriginal: v })} />
          </label>
        </div>
        <div class="totali">
          Totale: <b>${fmtOre(s.worked)}</b> lavorate su <b>${fmtOre(s.estimate)}</b> stimate ·
          restano <b>${fmtOre(s.remaining)}</b>
          ${s.estimate !== s.estimateOriginal ? html` · stima originale ${fmtOre(s.estimateOriginal)}` : null}
        </div>

        <h3>Sottoattività</h3>
        <ul class="lista-sotto" ref=${refSotto}>
          ${figli.map((c) => html`<${RigaSotto} key=${c.id} c=${c} ctx=${ctx} />`)}
        </ul>
        <form class="aggiungi-sotto" onSubmit=${aggiungiSotto}>
          <input placeholder="Nuova sottoattività" value=${nuovaSotto} onInput=${(e) => setNuovaSotto(e.target.value)} />
          <input class="ore-corto" inputmode="decimal" placeholder="ore" value=${oreSotto} onInput=${(e) => setOreSotto(e.target.value)} />
          <button class="sec">Aggiungi</button>
        </form>

        <h3>Predecessori <small>(non può iniziare prima che queste siano completate)</small></h3>
        ${candidatiPred.length ? html`
          <div class="predecessori">
            ${candidatiPred.map((p) => html`
              <label class="check">
                <input type="checkbox" checked=${(m.predecessors || []).includes(p.id)}
                  onChange=${(e) => togglePred(p.id, e.target.checked)} />
                ${p.title}${p.status === 'done' ? ' ✓' : ''}
              </label>`)}
          </div>` : html`<p class="muto">Nessun'altra attività disponibile.</p>`}

        <h3>Note</h3>
        <${NoteCampo} valore=${m.notes} onSalva=${(v) => agg({ notes: v })} />

        ${registrazioni.length ? html`
          <h3>Ore registrate</h3>
          <ul class="registrazioni">
            ${registrazioni.slice(0, 30).map((l) => html`
              <li key=${l.id}>
                <span>${formatCorto(l.date)}</span>
                <span class="titolo">${l.taskId !== id ? doc.tasks[l.taskId]?.title : figli.length ? '(generale)' : ''}</span>
                <span>${fmtOre(l.hours)}</span>
                <button class="icona elimina" title="Elimina registrazione"
                  onClick=${() => confirm('Eliminare questa registrazione?') && mutate((d) => deleteLog(d, l.id))}>✕</button>
              </li>`)}
          </ul>` : null}

        <footer class="pannello-piede">
          <button class="pericolo" onClick=${() => {
            if (confirm(`Eliminare "${m.title}" e le sue sottoattività?`)) { mutate((d) => deleteTask(d, id)); onChiudi(); }
          }}>Elimina</button>
          <span class="spazio"></span>
          ${m.status === 'done' ? null : m.status === 'paused'
            ? html`<button class="sec" onClick=${() => agg({ status: 'todo' })}>▶ Riprendi</button>`
            : html`<button class="sec" onClick=${() => agg({ status: 'paused' })}
                title="Esclude l'attività dal piano finché non la riprendi">❚❚ Metti in pausa</button>`}
          ${m.status === 'done'
            ? html`<button class="sec" onClick=${() => agg({ status: 'todo' })}>Riapri</button>`
            : html`<button class="ok" onClick=${() => { agg({ status: 'done' }); onChiudi(); }}>✓ Segna completata</button>`}
          <button class="pri" onClick=${onChiudi}>Fatto</button>
        </footer>
      </div>
    </div>`;
}

function NoteCampo({ valore, onSalva }) {
  const [v, setV] = useCampo(valore || '');
  return html`<textarea rows="4" placeholder="Descrizione, appunti, riferimenti…" value=${v}
    onInput=${(e) => setV(e.target.value)} onChange=${(e) => onSalva(e.target.value)}></textarea>`;
}
