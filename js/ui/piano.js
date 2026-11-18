// =============================================================================
// piano.js — Vista "Piano": diagramma di Gantt RISULTATO della simulazione.
//
// Non si modifica nulla trascinando le barre: il Gantt mostra dove lo
// scheduler colloca le ore di ogni attività. Per ogni giorno l'altezza del
// blocco è proporzionale alle ore pianificate rispetto alla capacità del
// giorno, così si vede subito se un'attività avanza a tempo pieno o a pezzi
// (limite ore/giorno, attività che si dividono la giornata).
// Per cambiare il piano si riordina la coda o si correggono le stime.
// =============================================================================

import { html, useState, fmtOre } from './util.js';
import { macros, children, summary, capacityOn } from '../core/model.js';
import { addDays, weekday, formatBreve, fromISO } from '../core/dates.js';
import { finePrevista } from './coda.js';

const SCALE = {
  giorni: { larghezza: 28, nome: 'Giorni' },
  settimane: { larghezza: 10, nome: 'Settimane' },
};
const MAX_GIORNI = 400;
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const INIZIALI = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];

export function VistaPiano({ ctx }) {
  const { doc, plan, today, wm, apriEditor, opzioni } = ctx;
  const [scala, setScala] = useState('giorni');
  const [mostraSotto, setMostraSotto] = useState(false);
  const W = SCALE[scala].larghezza;

  // Righe: macro non completate nell'ordine della coda, con le eventuali sottoattività.
  const righe = [];
  for (const m of macros(doc)) {
    if (m.status === 'done') continue;
    righe.push({ t: m, macro: m, livello: 0 });
    if (mostraSotto) {
      for (const c of children(doc, m.id)) if (c.status !== 'done') righe.push({ t: c, macro: m, livello: 1 });
    }
  }

  if (!righe.length) {
    return html`<section class="vista"><div class="vuoto-grande"><p>Niente da pianificare: la coda è vuota.</p></div></section>`;
  }

  // Intervallo mostrato: da oggi fino all'ultima fine prevista o scadenza.
  let fine = addDays(today, 13);
  for (const { t } of righe) {
    const r = plan.tasks[t.id];
    if (r && r.end && r.end > fine) fine = r.end;
    if (t.deadline && t.deadline > fine) fine = t.deadline;
  }
  const date = [];
  for (let g = today; g <= fine && date.length < MAX_GIORNI; g = addDays(g, 1)) date.push(g);
  for (let i = 0; i < 2; i++) date.push(addDays(date[date.length - 1], 1)); // un po' di margine
  const indice = Object.fromEntries(date.map((g, i) => [g, i]));
  const cap = Object.fromEntries(date.map((g) => [g, capacityOn(doc, g, weekday)]));
  const larghezzaTela = date.length * W;
  const troncato = fine > date[date.length - 1];

  // Intestazione: mesi e giorni.
  const mesi = [];
  date.forEach((g, i) => {
    if (i === 0 || g.endsWith('-01')) mesi.push({ i, testo: MESI[fromISO(g).getMonth()] + ' ' + g.slice(0, 4) });
  });

  const ultima = righe.reduce((u, { t }) => {
    const r = plan.tasks[t.id];
    return !t.parentId && r && r.end && (!u || r.end > u) ? r.end : u;
  }, null);

  return html`
    <section class="vista piano">
      <div class="barra-strumenti piano-strumenti">
        <div class="segmenti">
          ${Object.entries(SCALE).map(([k, s]) => html`
            <button class=${scala === k ? 'attivo' : ''} onClick=${() => setScala(k)}>${s.nome}</button>`)}
        </div>
        <label class="check"><input type="checkbox" checked=${mostraSotto}
          onChange=${(e) => setMostraSotto(e.target.checked)} /> Sottoattività</label>
      </div>
      <div class="riepilogo">
        ${ultima ? html`<span>coda finita il <b>${formatBreve(ultima)}</b></span>` : null}
        ${opzioni.factor ? html`<span>con le stime corrette dalle statistiche</span>` : null}
        <span class="legenda"><i class="l-ore"></i> ore pianificate · <i class="l-scad"></i> scadenza · <i class="l-libero"></i> giorno non lavorativo</span>
      </div>

      <div class="gantt" style="--w:${W}px">
        <div class="g-nomi">
          <div class="g-testa"></div>
          ${righe.map(({ t, livello }) => {
            const r = plan.tasks[t.id];
            const s = summary(doc, t.id, wm);
            const f = finePrevista(r, s);
            return html`<div class="g-nome livello-${livello}" key=${t.id} onClick=${() => apriEditor(t.parentId || t.id)}
              title="${t.title} · restano ${fmtOre(s.remaining)}">
              <span class="g-titolo">${t.title}</span>
              <span class="g-fine ${f.classe}">${f.testo}</span>
            </div>`;
          })}
        </div>

        <div class="g-scorri">
          <div class="g-tela" style="width:${larghezzaTela}px">
            ${date.map((g, i) => cap[g] <= 0 ? html`<div class="g-libero" style="left:${i * W}px"></div>` : null)}
            <div class="g-oggi" style="left:0"></div>

            <div class="g-testa">
              <div class="g-mesi">
                ${mesi.map((m) => html`<span style="left:${m.i * W}px">${m.testo}</span>`)}
              </div>
              <div class="g-giorni">
                ${date.map((g, i) => {
                  const wd = weekday(g);
                  if (scala === 'settimane' && wd !== 1) return null;
                  return html`<span style="left:${i * W}px;${scala === 'giorni' ? 'width:' + W + 'px' : ''}"
                    class=${cap[g] <= 0 ? 'festivo' : ''}>${scala === 'giorni' ? html`${INIZIALI[wd]}<br />` : null}${Number(g.slice(8))}</span>`;
                })}
              </div>
            </div>

            ${righe.map(({ t, macro, livello }) => {
              const r = plan.tasks[t.id];
              const pianificata = r && r.state === 'planned' && r.start;
              const tardi = (r && r.late) || (livello === 1 && plan.tasks[macro.id]?.late);
              const fineIdx = pianificata ? (indice[r.end] ?? date.length - 1) : 0;
              return html`<div class="g-riga livello-${livello}" key=${t.id} onClick=${() => apriEditor(macro.id)}>
                ${pianificata ? html`
                  <div class="g-banda ${tardi ? 'tardi' : ''}" style="left:${indice[r.start] * W}px;width:${(fineIdx - indice[r.start] + 1) * W}px"></div>
                  ${Object.entries(r.days).map(([g, h]) => indice[g] === undefined ? null : html`
                    <div class="g-blocco ${tardi ? 'tardi' : ''}" title="${formatBreve(g)}: ${fmtOre(h)}"
                      style="left:${indice[g] * W + 1}px;height:${Math.round(4 + 18 * Math.min(1, h / (cap[g] || h)))}px"></div>`)}`
                : html`<span class="g-motivo">${finePrevista(r).testo}${r && r.reason && r.state !== 'paused' ? ': ' + r.reason : ''}</span>`}
                ${t.deadline && indice[t.deadline] !== undefined ? html`
                  <div class="g-scad" style="left:${indice[t.deadline] * W + W - 2}px" title="Scadenza ${formatBreve(t.deadline)}"></div>` : null}
              </div>`;
            })}
          </div>
        </div>
      </div>
      ${troncato ? html`<p class="muto">Mostrati i primi ${MAX_GIORNI} giorni.</p>` : null}
      <p class="muto piccolo">Il piano è il risultato della simulazione: per cambiarlo riordina la coda, correggi le stime
        o le ore disponibili. Tocca una riga per aprire l'attività.</p>
    </section>`;
}
