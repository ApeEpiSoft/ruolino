// =============================================================================
// archivio.js — Vista "Archivio": attività completate con ricerca e
// statistiche sulla precisione delle stime (fattore di correzione).
// =============================================================================

import { html, useState, useMemo, fmtOre, fmtNum } from './util.js';
import { macros, children, summary, live, updateTask, setApplyCorrection } from '../core/model.js';
import { statisticheStime, MIN_CAMPIONI, MAX_CAMPIONI, TOLLERANZA } from '../core/stats.js';
import { mutate } from '../store.js';
import { formatBreve } from '../core/dates.js';

/** Testo in minuscolo e senza accenti, per la ricerca. */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const fmtFattore = (f) => '×' + fmtNum(Math.round(f * 100) / 100);

/** Scarto percentuale tra effettive e stimate: "+25%", con classe di colore. */
function Scarto({ stimate, effettive }) {
  if (!(stimate > 0)) return null;
  const p = Math.round((effettive / stimate - 1) * 100);
  const classe = Math.abs(p) <= TOLLERANZA * 100 ? 'ok' : p > 0 ? 'tardi' : 'avviso';
  const titolo = p === 0 ? 'Stima esatta' : p > 0 ? `Ci sono volute il ${p}% di ore in più del previsto` : `Ci sono volute il ${-p}% di ore in meno del previsto`;
  return html`<span class="scarto ${classe}" title=${titolo}>${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p)}%</span>`;
}

/** Fattore di un gruppo; se i dati sono pochi indica quello che si usa al suo posto. */
function Fattore({ f, affidabile, usato }) {
  if (affidabile) return html`<b>${fmtFattore(f)}</b>`;
  return html`<span class="muto" title="Meno di ${MIN_CAMPIONI} attività: per le previsioni si usa ${fmtFattore(usato)}">
    ${fmtFattore(f)} <span class="piccolo">→ si usa ${fmtFattore(usato)}</span></span>`;
}

/** Riquadro "Precisione delle stime". */
function Statistiche({ doc, wm }) {
  const stat = useMemo(() => statisticheStime(doc, wm), [doc, wm]);
  const g = stat.globale;
  const attiva = !!doc.settings.applyCorrection;

  if (g.n === 0) {
    return html`<p class="muto">Le statistiche compaiono quando completi attività con una stima e delle ore registrate.
      Confrontano le ore effettive con la <b>stima originale</b>, quella che avevi dato all'inizio.</p>`;
  }
  const p = Math.round((g.fattore - 1) * 100);
  return html`
    <p>
      ${g.n < g.totale ? html`Sulle ultime <b>${g.n}</b> attività completate ` : html`Sulle <b>${g.n}</b> attività completate `}hai
      lavorato <b>${fmtOre(g.effettive)}</b> contro <b>${fmtOre(g.stimate)}</b> stimate:
      ${Math.abs(p) < 3 ? html` le tue stime sono <b class="ok">precise</b>.`
        : html` in media le attività richiedono il <b class=${p > 0 ? 'tardi' : 'avviso'}>${Math.abs(p)}% di ore ${p > 0 ? 'in più' : 'in meno'}</b> del previsto.`}
      <span class="muto"> Stime entro ±${TOLLERANZA * 100}%: ${g.buone} su ${g.n}.</span>
    </p>
    <table class="tabella-stat">
      <thead><tr><th>Categoria</th><th>Attività</th><th>Stimate</th><th>Effettive</th><th>Fattore</th></tr></thead>
      <tbody>
        ${stat.categorie.map((c) => html`<tr key=${c.nome}>
          <td>${c.nome || html`<span class="muto">senza categoria</span>`}</td>
          <td>${c.n}</td>
          <td>${fmtOre(c.stimate)}</td>
          <td>${fmtOre(c.effettive)}</td>
          <td><${Fattore} f=${c.fattore} affidabile=${c.affidabile} usato=${g.affidabile ? g.fattore : 1} /></td>
        </tr>`)}
        <tr class="totale"><td>Tutte</td><td>${g.n}</td><td>${fmtOre(g.stimate)}</td><td>${fmtOre(g.effettive)}</td>
          <td><${Fattore} f=${g.fattore} affidabile=${g.affidabile} usato=${1} /></td></tr>
      </tbody>
    </table>
    <label class="check correzione">
      <input type="checkbox" checked=${attiva} onChange=${(e) => mutate((d) => setApplyCorrection(d, e.target.checked))} />
      <span>Applica la correzione alle date previste</span>
    </label>
    <p class="muto piccolo">Con la correzione attiva le ore rimanenti di ogni attività vengono moltiplicate per il fattore
      della sua categoria. Una categoria con meno di ${MIN_CAMPIONI} attività completate usa il fattore di tutte;
      con meno di ${MIN_CAMPIONI} attività in tutto non si corregge nulla. Contano le ultime ${MAX_CAMPIONI} attività
      di ogni gruppo. Le stime che vedi nella coda restano quelle che hai scritto.</p>`;
}

export function VistaArchivio({ ctx }) {
  const { doc, wm, apriEditor } = ctx;
  const [cerca, setCerca] = useState('');
  const [categoria, setCategoria] = useState('*');
  const [anno, setAnno] = useState('*');
  const [quante, setQuante] = useState(50);

  const fatte = macros(doc).filter((m) => m.status === 'done')
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  const categorie = [...new Set(fatte.map((m) => m.category || ''))].sort();
  const anni = [...new Set(fatte.map((m) => (m.completedAt || '').slice(0, 4)).filter(Boolean))].sort().reverse();

  // Testo in cui cercare: titolo, note, categoria, sottoattività, note delle ore.
  const indice = useMemo(() => {
    const noteLog = {};
    for (const l of live(doc.logs)) if (l.note) noteLog[l.taskId] = (noteLog[l.taskId] || '') + ' ' + l.note;
    const out = {};
    for (const m of fatte) {
      const parti = [m.title, m.notes, m.category, noteLog[m.id]];
      for (const c of children(doc, m.id)) parti.push(c.title, c.notes, noteLog[c.id]);
      out[m.id] = norm(parti.join(' '));
    }
    return out;
  }, [doc, fatte.length, ctx.plan]);

  const parole = norm(cerca).split(/\s+/).filter(Boolean);
  const risultati = fatte.filter((m) =>
    (categoria === '*' || (m.category || '') === categoria)
    && (anno === '*' || (m.completedAt || '').startsWith(anno))
    && parole.every((p) => indice[m.id].includes(p)));

  // Sottoattività che corrispondono alla ricerca (mostrate sotto il titolo).
  const sottoTrovate = (m) => parole.length
    ? children(doc, m.id).filter((c) => parole.some((p) => norm(c.title + ' ' + c.notes).includes(p)))
    : [];

  return html`
    <section class="vista archivio">
      <h2>Precisione delle stime</h2>
      <${Statistiche} doc=${doc} wm=${wm} />

      <h2>Attività completate</h2>
      ${fatte.length === 0 ? html`<p class="muto">Nessuna attività completata finora.</p>` : html`
        <div class="filtri">
          <input type="search" class="cerca" placeholder="Cerca in titoli, note, sottoattività…" value=${cerca}
            onInput=${(e) => { setCerca(e.target.value); setQuante(50); }} />
          ${categorie.length > 1 ? html`
            <select value=${categoria} onChange=${(e) => setCategoria(e.target.value)}>
              <option value="*">Tutte le categorie</option>
              ${categorie.map((c) => html`<option value=${c}>${c || 'Senza categoria'}</option>`)}
            </select>` : null}
          ${anni.length > 1 ? html`
            <select value=${anno} onChange=${(e) => setAnno(e.target.value)}>
              <option value="*">Tutti gli anni</option>
              ${anni.map((a) => html`<option value=${a}>${a}</option>`)}
            </select>` : null}
        </div>
        <p class="muto piccolo">${risultati.length === fatte.length ? `${fatte.length} attività` : `${risultati.length} su ${fatte.length} attività`}</p>
        <ul class="fatte">
          ${risultati.slice(0, quante).map((m) => {
            const s = summary(doc, m.id, wm);
            const sotto = sottoTrovate(m);
            return html`<li key=${m.id}>
              <span class="titolo" onClick=${() => apriEditor(m.id)}>
                ✓ ${m.title} ${m.category ? html`<span class="chip cat">${m.category}</span>` : null}
                ${sotto.length ? html`<span class="sotto-trovate">↳ ${sotto.map((c) => c.title).join(', ')}</span>` : null}
              </span>
              <span class="ore">${fmtOre(s.worked)} su ${fmtOre(s.estimateOriginal)} stimate</span>
              <${Scarto} stimate=${s.estimateOriginal} effettive=${s.worked} />
              <span class="data">${m.completedAt ? formatBreve(m.completedAt) + ' ' + m.completedAt.slice(0, 4) : ''}</span>
              <button class="link" onClick=${() => mutate((d) => updateTask(d, m.id, { status: 'todo' }))}>Riapri</button>
            </li>`;
          })}
        </ul>
        ${risultati.length > quante ? html`<button class="link" onClick=${() => setQuante(quante + 100)}>Mostra altre ${risultati.length - quante}</button>` : null}
        ${risultati.length === 0 ? html`<p class="muto">Nessuna attività corrisponde alla ricerca.</p>` : null}`}
    </section>`;
}
