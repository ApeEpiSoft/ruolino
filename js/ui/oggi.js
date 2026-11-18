// =============================================================================
// oggi.js — Vista "Oggi": cosa dovrei fare oggi secondo il piano, i prossimi
// giorni e gli avvisi (ritardi, blocchi, stime esaurite).
// =============================================================================

import { html, useState, fmtOre, fmtNum, parseOre } from './util.js';
import { macros, addLog, loggedOn, capacityOn } from '../core/model.js';
import { mutate } from '../store.js';
import { addDays, weekday, formatBreve, formatLungo } from '../core/dates.js';

/** Raggruppa le voci di un giorno del piano per macro-attività. */
function perMacro(doc, voci) {
  const gruppi = new Map();
  for (const v of voci || []) {
    if (!gruppi.has(v.macroId)) gruppi.set(v.macroId, { macro: doc.tasks[v.macroId], voci: [], ore: 0 });
    const g = gruppi.get(v.macroId);
    g.voci.push(v);
    g.ore += v.hours;
  }
  return [...gruppi.values()];
}

/** Voce del piano di oggi con registrazione rapida. */
function VoceOggi({ v, doc }) {
  const [ore, setOre] = useState(fmtNum(v.hours));
  const t = doc.tasks[v.taskId];
  const registra = () => {
    const h = parseOre(ore);
    if (h > 0) mutate((d) => addLog(d, { taskId: v.taskId, date: v.data, hours: h }));
  };
  return html`
    <li class="voce-oggi">
      <span class="titolo">${t.id === v.macroId ? 'Lavoro sull\'attività' : t.title}</span>
      <span class="ore">${fmtOre(v.hours)}</span>
      <span class="registra-rapido">
        <input inputmode="decimal" value=${ore} onInput=${(e) => setOre(e.target.value)} aria-label="Ore lavorate" />
        <button class="ok" title="Registra queste ore per oggi" onClick=${registra}>✓</button>
      </span>
    </li>`;
}

export function VistaOggi({ ctx }) {
  const { doc, plan, today, apriEditor } = ctx;
  const capacità = capacityOn(doc, today, weekday);
  const registrate = loggedOn(doc, today);
  const gruppiOggi = perMacro(doc, plan.days[today]);
  const pianificate = gruppiOggi.reduce((s, g) => s + g.ore, 0);

  // Prossimi 5 giorni con lavoro pianificato.
  const prossimi = [];
  let g = addDays(today, 1);
  for (let i = 0; i < 60 && prossimi.length < 5; i++, g = addDays(g, 1)) {
    if (plan.days[g]) prossimi.push({ data: g, gruppi: perMacro(doc, plan.days[g]) });
  }

  // Avvisi.
  const attive = macros(doc).filter((m) => m.status !== 'done');
  const ritardi = attive.filter((m) => plan.tasks[m.id].late);
  const bloccate = attive.filter((m) => ['blocked', 'unscheduled'].includes(plan.tasks[m.id].state) && m.status !== 'paused');
  const esaurite = attive.filter((m) => plan.tasks[m.id].exhausted && m.status !== 'paused');

  return html`
    <section class="vista oggi">
      <h2>Oggi, ${formatLungo(today)}</h2>
      <div class="riepilogo">
        <span>capacità <b>${fmtOre(capacità)}</b></span>
        <span>registrate <b>${fmtOre(registrate)}</b></span>
        <span>ancora da fare <b>${fmtOre(pianificate)}</b></span>
      </div>

      ${gruppiOggi.length ? html`
        <ul class="piano-oggi">
          ${gruppiOggi.map((gr) => html`
            <li key=${gr.macro.id} class="gruppo">
              <div class="gruppo-testa" onClick=${() => apriEditor(gr.macro.id)}>
                <b>${gr.macro.title}</b><span>${fmtOre(gr.ore)}</span>
              </div>
              <ul>${gr.voci.map((v) => html`<${VoceOggi} key=${v.taskId} v=${{ ...v, data: today }} doc=${doc} />`)}</ul>
            </li>`)}
        </ul>
        <p class="muto suggerimento">Con ✓ registri subito le ore per oggi; per più voci insieme usa <b>Registro</b>.</p>`
      : html`<div class="vuoto-grande">
          ${capacità === 0 ? html`<p>Oggi non è previsto lavoro.</p>`
            : registrate >= capacità && registrate > 0 ? html`<p>Giornata piena: hai registrato ${fmtOre(registrate)}. 👍</p>`
            : attive.length === 0 ? html`<p>Nessuna attività in coda.</p>`
            : html`<p>Niente di pianificabile oggi (attività in pausa o bloccate).</p>`}
        </div>`}

      ${ritardi.length || bloccate.length || esaurite.length ? html`
        <h3>Avvisi</h3>
        <ul class="avvisi">
          ${ritardi.map((m) => html`<li class="tardi" onClick=${() => apriEditor(m.id)}>
            <b>${m.title}</b>: fine prevista ${plan.tasks[m.id].end ? formatBreve(plan.tasks[m.id].end) : 'non calcolabile'}, scadenza ${formatBreve(m.deadline)}</li>`)}
          ${bloccate.map((m) => html`<li class="avviso" onClick=${() => apriEditor(m.id)}>
            <b>${m.title}</b>: ${plan.tasks[m.id].reason}</li>`)}
          ${esaurite.map((m) => html`<li class="avviso" onClick=${() => apriEditor(m.id)}>
            <b>${m.title}</b>: ore stimate finite ma non completata — aggiorna il residuo</li>`)}
        </ul>` : null}

      ${prossimi.length ? html`
        <h3>Prossimi giorni</h3>
        <ul class="prossimi">
          ${prossimi.map((p) => html`
            <li key=${p.data}>
              <span class="data">${formatBreve(p.data)}</span>
              <span>${p.gruppi.map((gr) => html`<span class="chip" onClick=${() => apriEditor(gr.macro.id)}>${gr.macro.title} · ${fmtOre(gr.ore)}</span>`)}</span>
            </li>`)}
        </ul>` : null}
    </section>`;
}
