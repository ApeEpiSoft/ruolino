// =============================================================================
// coda.js — Vista "Coda": l'elenco ordinabile delle macro-attività con la
// data di fine prevista accanto a ciascuna.
// =============================================================================

import { html, useState, useRef, fmtOre, parseOre, useSortable, Barra, Slittamento } from './util.js';
import { macros, children, summary, addTask, moveTask, updateTask, statoEffettivo, STATI } from '../core/model.js';
import { mutate } from '../store.js';
import { formatBreve } from '../core/dates.js';

/** Testo e classe per la colonna "fine prevista" di un risultato dello scheduler. */
export function finePrevista(r) {
  if (!r) return { testo: '—', classe: '' };
  switch (r.state) {
    case 'done': return { testo: 'Completata', classe: 'ok' };
    case 'paused': return { testo: 'In pausa', classe: 'muto' };
    case 'blocked':
    case 'unscheduled': return { testo: 'Non pianificabile', classe: 'avviso', titolo: r.reason };
    default:
      if (r.end) return { testo: formatBreve(r.end), classe: r.late ? 'tardi' : '' };
      return r.exhausted
        ? { testo: 'Stima esaurita', classe: 'avviso', titolo: 'Ore finite ma attività non completata: aggiorna il residuo o completala' }
        : { testo: 'Pronta da chiudere', classe: 'ok', titolo: 'Non restano ore da pianificare' };
  }
}

/** Modulo di inserimento rapido: titolo + ore + scadenza. */
function InserimentoRapido({ posizione, onChiudi }) {
  const [titolo, setTitolo] = useState('');
  const [ore, setOre] = useState('');
  const [scad, setScad] = useState('');
  const refTitolo = useRef(null);
  const urgenza = posizione === 'top';

  const invia = (e) => {
    e.preventDefault();
    if (!titolo.trim()) return;
    mutate((doc) => addTask(doc, {
      title: titolo,
      estimate: parseOre(ore) || 0,
      deadline: scad || null,
    }, posizione));
    setTitolo(''); setOre(''); setScad('');
    if (urgenza) onChiudi();
    else refTitolo.current && refTitolo.current.focus();
  };

  return html`
    <form class="rapido ${urgenza ? 'urgenza' : ''}" onSubmit=${invia}>
      <div class="rapido-titolo">${urgenza ? '⚡ Urgenza: verrà messa in cima alla coda' : 'Nuova attività in fondo alla coda'}</div>
      <input ref=${refTitolo} class="campo-titolo" placeholder="Titolo" value=${titolo}
        onInput=${(e) => setTitolo(e.target.value)} autofocus />
      <div class="riga-campi">
        <label>Ore stimate<input inputmode="decimal" placeholder="es. 6" value=${ore}
          onInput=${(e) => setOre(e.target.value)} /></label>
        <label>Scadenza<input type="date" value=${scad} onInput=${(e) => setScad(e.target.value)} /></label>
      </div>
      <div class="azioni">
        <button type="button" class="sec" onClick=${onChiudi}>Chiudi</button>
        <button type="submit" class="pri">Aggiungi</button>
      </div>
    </form>`;
}

/** Una riga della coda. */
function RigaMacro({ m, ctx, indice }) {
  const { doc, plan, wm, slitta, apriEditor } = ctx;
  const [aperta, setAperta] = useState(false);
  const s = summary(doc, m.id, wm);
  const r = plan.tasks[m.id];
  const f = finePrevista(r);
  const figli = children(doc, m.id);
  const stato = statoEffettivo(doc, m, wm);

  return html`
    <li data-id=${m.id} class="riga ${r && r.late ? 'in-ritardo' : ''} stato-${stato}">
      <div class="riga-princ">
        <span class="maniglia" title="Trascina per riordinare" aria-label="Trascina">⠿</span>
        <span class="pos">${indice + 1}</span>
        <div class="riga-corpo" onClick=${() => apriEditor(m.id)}>
          <div class="titolo">
            ${m.title}
            ${m.category ? html`<span class="chip cat">${m.category}</span>` : null}
            ${stato === 'doing' ? html`<span class="chip stato-doing">In corso</span>` : null}
            ${m.maxPerDay ? html`<span class="chip" title="Limite ore al giorno">max ${fmtOre(m.maxPerDay)}/g</span>` : null}
          </div>
          <div class="dettagli">
            <span>${fmtOre(s.worked)} / ${fmtOre(s.estimate)}</span>
            <span class="sep">·</span>
            <span>restano <b>${fmtOre(s.remaining)}</b></span>
            ${r && r.reason && r.state !== 'paused' ? html`<span class="motivo">${r.reason}</span>` : null}
          </div>
          <${Barra} valore=${s.progress} />
        </div>
        <div class="fine" onClick=${() => apriEditor(m.id)}>
          <div class="data ${f.classe}" title=${f.titolo || ''}>${f.testo} <${Slittamento} giorni=${slitta[m.id]} /></div>
          ${m.deadline ? html`<div class="scad ${r && r.late ? 'tardi' : ''}">scad. ${formatBreve(m.deadline)}</div>` : null}
          ${r && r.start && r.state === 'planned' && r.start !== r.end ? html`<div class="inizio">da ${formatBreve(r.start)}</div>` : null}
        </div>
        ${figli.length ? html`
          <button class="espandi" onClick=${() => setAperta(!aperta)} aria-label="Sottoattività"
            title="${figli.length} sottoattività">${aperta ? '▾' : '▸'} ${figli.length}</button>` : html`<span class="espandi vuoto"></span>`}
      </div>
      ${aperta ? html`
        <ul class="sotto">
          ${figli.map((c) => {
            const sc = summary(doc, c.id, wm);
            const fc = finePrevista(plan.tasks[c.id]);
            return html`<li key=${c.id} class="stato-${c.status}" onClick=${() => apriEditor(m.id)}>
              <span class="spunta">${c.status === 'done' ? '✓' : c.status === 'paused' ? '❚❚' : '○'}</span>
              <span class="titolo">${c.title}</span>
              <span class="ore">${c.status === 'done' ? fmtOre(sc.worked) : 'restano ' + fmtOre(sc.remaining)}</span>
              <span class="data ${fc.classe}">${c.status === 'done' ? '' : fc.testo}</span>
            </li>`;
          })}
        </ul>` : null}
    </li>`;
}

/** Vista principale della coda. */
export function VistaCoda({ ctx }) {
  const { doc, plan, wm } = ctx;
  const [modulo, setModulo] = useState(null); // null | 'top' | 'bottom'
  const [mostraFatte, setMostraFatte] = useState(false);

  const tutte = macros(doc);
  const attive = tutte.filter((m) => m.status !== 'done');
  const fatte = tutte.filter((m) => m.status === 'done')
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));

  const refLista = useSortable((id, primaId, dopoId) => mutate((d) => moveTask(d, id, primaId, dopoId)));

  // Riepilogo in testa alla coda.
  let restanti = 0, ultima = null, inRitardo = 0;
  for (const m of attive) {
    restanti += summary(doc, m.id, wm).remaining;
    const r = plan.tasks[m.id];
    if (r.end && (!ultima || r.end > ultima)) ultima = r.end;
    if (r.late) inRitardo++;
  }

  return html`
    <section class="vista">
      <div class="barra-strumenti">
        <button class="pri" onClick=${() => setModulo(modulo === 'bottom' ? null : 'bottom')}>+ Attività</button>
        <button class="urg" onClick=${() => setModulo(modulo === 'top' ? null : 'top')}>⚡ Urgenza</button>
      </div>
      ${modulo ? html`<${InserimentoRapido} key=${modulo} posizione=${modulo} onChiudi=${() => setModulo(null)} />` : null}

      ${attive.length ? html`
        <div class="riepilogo">
          <span><b>${attive.length}</b> attività</span>
          <span><b>${fmtOre(restanti)}</b> di lavoro rimanente</span>
          ${ultima ? html`<span>coda finita il <b>${formatBreve(ultima)}</b></span>` : null}
          ${inRitardo ? html`<span class="tardi"><b>${inRitardo}</b> oltre la scadenza</span>` : null}
        </div>` : html`
        <div class="vuoto-grande">
          <p>La coda è vuota.</p>
          <p>Aggiungi la prima attività con <b>+ Attività</b>: titolo e ore stimate bastano.</p>
        </div>`}

      <ul class="coda" ref=${refLista}>
        ${attive.map((m, i) => html`<${RigaMacro} key=${m.id} m=${m} ctx=${ctx} indice=${i} />`)}
      </ul>

      ${fatte.length ? html`
        <div class="sezione-fatte">
          <button class="link" onClick=${() => setMostraFatte(!mostraFatte)}>
            ${mostraFatte ? '▾' : '▸'} Completate (${fatte.length})
          </button>
          ${mostraFatte ? html`
            <ul class="fatte">
              ${fatte.slice(0, 50).map((m) => {
                const s = summary(doc, m.id, wm);
                return html`<li key=${m.id}>
                  <span class="titolo" onClick=${() => ctx.apriEditor(m.id)}>✓ ${m.title}</span>
                  <span class="ore">${fmtOre(s.worked)} su ${fmtOre(s.estimateOriginal)} stimate</span>
                  <span class="data">${m.completedAt ? formatBreve(m.completedAt) : ''}</span>
                  <button class="link" onClick=${() => mutate((d) => updateTask(d, m.id, { status: 'todo' }))}>Riapri</button>
                </li>`;
              })}
            </ul>` : null}
        </div>` : null}
    </section>`;
}

export { STATI };
