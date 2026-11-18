// =============================================================================
// registro.js — Vista "Registro ore": inserimento rapido a fine giornata delle
// ore lavorate su una o più attività, con correzione del residuo.
// =============================================================================

import { html, useState, useEffect, fmtOre, fmtNum, parseOre } from './util.js';
import {
  macros, children, summary, addLog, updateLog, deleteLog, setRemaining, updateTask,
  live, loggedOn, capacityOn,
} from '../core/model.js';
import { mutate } from '../store.js';
import { addDays, weekday, formatLungo } from '../core/dates.js';
import { Ore } from './editor.js';

/** Elenco delle voci su cui si possono registrare ore, nell'ordine della coda. */
function vociRegistrabili(doc) {
  const voci = [];
  for (const m of macros(doc)) {
    if (m.status === 'done') continue;
    const figli = children(doc, m.id).filter((c) => c.status !== 'done');
    if (children(doc, m.id).length === 0) {
      voci.push({ id: m.id, macro: m, titolo: m.title, sotto: null, pausa: m.status === 'paused' });
      continue;
    }
    for (const c of figli) {
      voci.push({ id: c.id, macro: m, titolo: c.title, sotto: c, pausa: m.status === 'paused' || c.status === 'paused' });
    }
    // Ore "generali" sulla macro, solo se la macro ha ore proprie stimate.
    if (Number(m.estimate) > 0) {
      voci.push({ id: m.id, macro: m, titolo: '(generale)', sotto: { id: m.id }, pausa: m.status === 'paused' });
    }
  }
  return voci;
}

export function VistaRegistro({ ctx, dataIniziale }) {
  const { doc, plan, wm, today } = ctx;
  const [data, setData] = useState(dataIniziale || today);
  const [form, setForm] = useState({}); // id → { ore, residuo, fatto }
  const [filtro, setFiltro] = useState('');
  const [messaggio, setMessaggio] = useState('');

  useEffect(() => { if (dataIniziale) setData(dataIniziale); }, [dataIniziale]);

  const capacità = capacityOn(doc, data, weekday);
  const registrate = loggedOn(doc, data);
  const delGiorno = live(doc.logs).filter((l) => l.date === data).sort((a, b) => a.createdAt - b.createdAt);
  const piano = {};
  for (const p of (data === today ? plan.days[today] : null) || []) piano[p.taskId] = (piano[p.taskId] || 0) + p.hours;

  // Voci previste dal piano per prime, poi le altre nell'ordine della coda.
  let voci = vociRegistrabili(doc);
  voci = [...voci.filter((v) => piano[v.id]), ...voci.filter((v) => !piano[v.id])];
  const f = filtro.trim().toLowerCase();
  if (f) voci = voci.filter((v) => (v.macro.title + ' ' + v.titolo).toLowerCase().includes(f));

  const VUOTO = { ore: '', residuo: '', fatto: false };
  const campo = (id) => form[id] || VUOTO;
  // Aggiornamenti "funzionali": partono sempre dallo stato più recente,
  // così inserimenti rapidi su più righe non si sovrascrivono.
  const imposta = (id, patch) => setForm((f) => ({ ...f, [id]: { ...(f[id] || VUOTO), ...patch } }));
  const aggiungi = (id, h) => setForm((f) => {
    const x = f[id] || VUOTO;
    return { ...f, [id]: { ...x, ore: fmtNum((parseOre(x.ore) || 0) + h) } };
  });

  const totaleForm = Object.values(form).reduce((s, x) => s + (parseOre(x.ore) || 0), 0);
  const daSalvare = Object.entries(form).filter(([, x]) => (parseOre(x.ore) || 0) > 0 || parseOre(x.residuo) !== null || x.fatto);

  const registra = () => {
    if (!daSalvare.length) return;
    mutate((d) => {
      for (const [id, x] of daSalvare) {
        const h = parseOre(x.ore) || 0;
        if (h > 0) addLog(d, { taskId: id, date: data, hours: h });
        const res = parseOre(x.residuo);
        if (res !== null) setRemaining(d, id, res);
        if (x.fatto) updateTask(d, id, { status: 'done' });
      }
    });
    setMessaggio(`Registrate ${fmtOre(totaleForm)} per ${formatLungo(data)}.`);
    setForm({});
    setTimeout(() => setMessaggio(''), 4000);
  };

  return html`
    <section class="vista registro">
      <div class="navigatore-data">
        <button class="icona" onClick=${() => setData(addDays(data, -1))} aria-label="Giorno precedente">◀</button>
        <input type="date" value=${data} onChange=${(e) => e.target.value && setData(e.target.value)} />
        <button class="icona" onClick=${() => setData(addDays(data, 1))} aria-label="Giorno successivo">▶</button>
        ${data !== today ? html`<button class="link" onClick=${() => setData(today)}>Oggi</button>` : null}
      </div>
      <div class="riepilogo">
        <span>${formatLungo(data)}</span>
        <span>capacità <b>${fmtOre(capacità)}</b></span>
        <span>registrate <b>${fmtOre(registrate)}</b></span>
      </div>

      ${delGiorno.length ? html`
        <ul class="registrazioni">
          ${delGiorno.map((l) => {
            const t = doc.tasks[l.taskId];
            const m = t && t.parentId ? doc.tasks[t.parentId] : null;
            return html`<li key=${l.id}>
              <span class="titolo">${m ? m.title + ' › ' : ''}${t ? t.title : '(attività eliminata)'}</span>
              <${Ore} class="ore-corto" valore=${l.hours}
                onSalva=${(v) => mutate((d) => (v > 0 ? updateLog(d, l.id, { hours: v }) : deleteLog(d, l.id)))} />
              <button class="icona elimina" title="Elimina registrazione"
                onClick=${() => mutate((d) => deleteLog(d, l.id))}>✕</button>
            </li>`;
          })}
        </ul>` : null}

      <h3>Aggiungi ore</h3>
      ${voci.length > 8 || f ? html`<input class="filtro" placeholder="Cerca attività…" value=${filtro}
        onInput=${(e) => setFiltro(e.target.value)} />` : null}
      <ul class="voci-registro">
        ${voci.map((v) => {
          const x = campo(v.id);
          // Per le ore "generali" di una macro conta solo la parte propria.
          const generale = v.sotto && v.sotto.id === v.id;
          const rimanente = generale
            ? Math.max(0, Number(v.macro.estimate || 0) - (wm[v.id] || 0))
            : summary(doc, v.id, wm).remaining;
          const ore = parseOre(x.ore) || 0;
          const residuoAuto = Math.max(0, rimanente - ore);
          return html`<li key=${v.id + (v.sotto ? '' : '-m')} class="${ore > 0 ? 'attiva' : ''} ${v.pausa ? 'muto' : ''}">
            <div class="voce-titolo">
              ${v.sotto ? html`<small>${v.macro.title} ›</small> ` : null}${v.titolo}
              ${piano[v.id] ? html`<span class="chip piano">piano ${fmtOre(piano[v.id])}</span>` : null}
              ${v.pausa ? html`<span class="chip">in pausa</span>` : null}
            </div>
            <div class="voce-campi">
              <label class="mini">ore
                <input inputmode="decimal" placeholder="0" value=${x.ore}
                  onInput=${(e) => imposta(v.id, { ore: e.target.value })} />
              </label>
              <span class="rapidi">
                <button type="button" onClick=${() => aggiungi(v.id, 0.5)}>+½</button>
                <button type="button" onClick=${() => aggiungi(v.id, 1)}>+1</button>
                <button type="button" onClick=${() => aggiungi(v.id, 2)}>+2</button>
              </span>
              <label class="mini" title="Ore che restano DOPO questa registrazione. Lascia vuoto per il calcolo automatico.">restano
                <input inputmode="decimal" placeholder=${fmtNum(residuoAuto)} value=${x.residuo}
                  onInput=${(e) => imposta(v.id, { residuo: e.target.value })} />
              </label>
              ${generale ? null : html`
                <label class="check mini-check"><input type="checkbox" checked=${x.fatto}
                  onChange=${(e) => imposta(v.id, { fatto: e.target.checked })} /> finita</label>`}
            </div>
          </li>`;
        })}
      </ul>
      ${voci.length === 0 ? html`<p class="muto">Nessuna attività aperta su cui registrare ore.</p>` : null}

      <div class="piede-fisso">
        ${messaggio ? html`<span class="messaggio">${messaggio}</span>` : html`<span>Totale: <b>${fmtOre(totaleForm)}</b></span>`}
        <button class="pri" disabled=${!daSalvare.length} onClick=${registra}>Registra</button>
      </div>
    </section>`;
}
