// =============================================================================
// coda.js — Vista "Coda": l'elenco ordinabile delle macro-attività con la
// data di fine prevista accanto a ciascuna.
// =============================================================================

import { html, useState, useRef, useMemo, fmtOre, fmtIntervallo, parseOre, useSortable, Barra, Slittamento } from './util.js';
import { macros, children, summary, addTask, moveTask, updateTask, statoEffettivo, STATI } from '../core/model.js';
import { mutate } from '../store.js';
import { formatBreve } from '../core/dates.js';
import { anteprimaUrgenza } from '../core/impatto.js';

/**
 * Testo e classe per la colonna "fine prevista" di un risultato dello scheduler.
 * `s` (riepilogo ore, facoltativo) distingue "senza stima" da "stima esaurita".
 */
export function finePrevista(r, s = null) {
  if (!r) return { testo: '—', classe: '' };
  if (s && s.estimate === 0 && s.worked === 0 && r.state === 'planned' && !r.end) {
    return { testo: 'Senza stima', classe: 'avviso', titolo: 'Inserisci le ore stimate per pianificarla' };
  }
  switch (r.state) {
    case 'done': return { testo: 'Completata', classe: 'ok' };
    case 'paused': return { testo: 'In pausa', classe: 'muto' };
    case 'expired': return { testo: 'Date passate', classe: 'tardi', titolo: 'Le date fissate sono passate e restano ore: sposta le date o completala' };
    case 'blocked':
    case 'unscheduled': return { testo: 'Non pianificabile', classe: 'avviso', titolo: r.reason };
    default:
      if (r.end) return { testo: formatBreve(r.end), classe: r.late ? 'tardi' : '' };
      return r.exhausted
        ? { testo: 'Stima esaurita', classe: 'avviso', titolo: 'Ore finite ma attività non completata: aggiorna il residuo o completala' }
        : { testo: 'Pronta da chiudere', classe: 'ok', titolo: 'Non restano ore da pianificare' };
  }
}

/**
 * Anteprima dell'urgenza: quando finirebbe e cosa sposterebbe nella coda.
 * Ricalcolata a ogni tasto (la simulazione costa pochi millisecondi).
 */
function AnteprimaUrgenza({ ctx, titolo, ore, scad }) {
  const { doc, today, plan, opzioni } = ctx;
  const h = parseOre(ore);
  const a = useMemo(
    () => (h > 0 ? anteprimaUrgenza(doc, today, { title: titolo, estimate: h, deadline: scad || null }, opzioni, plan) : null),
    [h, scad, plan, titolo],
  );
  if (!a) return html`<div class="anteprima muto">Scrivi le ore stimate per vedere l'effetto sulla coda.</div>`;
  const n = a.nuova;
  const MAX = 6;
  return html`
    <div class="anteprima">
      <div>
        ${n.end
          ? html`Finirebbe <b class=${n.late ? 'tardi' : ''}>${formatBreve(n.end)}</b>${n.late ? html` <span class="tardi">· oltre la scadenza</span>` : null}`
          : html`<span class="avviso">Oltre l'orizzonte di pianificazione</span>`}
      </div>
      ${a.spostate.length === 0 ? html`<div class="ok">Nessun'altra attività cambia data.</div>` : html`
        <div>
          ${a.spostate.length === 1 ? 'Slitta 1 attività' : `Slittano ${a.spostate.length} attività`}${a.nuoveInRitardo
            ? html`, <b class="tardi">${a.nuoveInRitardo} ${a.nuoveInRitardo === 1 ? 'supera' : 'superano'} la scadenza</b>` : null}:
        </div>
        <ul class="spostate">
          ${a.spostate.slice(0, MAX).map((s) => html`<li key=${s.id} class=${s.nuovoRitardo ? 'tardi' : ''}>
            <span class="titolo">${s.titolo}</span>
            <span class="date">${s.prima ? formatBreve(s.prima) : '—'} → <b>${s.dopo ? formatBreve(s.dopo) : 'oltre l\'orizzonte'}</b>
              ${s.giorni ? html` <span class="slitta peggio">+${s.giorni}g</span>` : null}${s.nuovoRitardo ? ' ⚠' : ''}</span>
          </li>`)}
          ${a.spostate.length > MAX ? html`<li class="muto">… e altre ${a.spostate.length - MAX}</li>` : null}
        </ul>`}
    </div>`;
}

/** Modulo di inserimento rapido: titolo + ore + scadenza. */
function InserimentoRapido({ posizione, onChiudi, ctx }) {
  const [titolo, setTitolo] = useState('');
  const [ore, setOre] = useState('');
  const [scad, setScad] = useState('');
  const refTitolo = useRef(null);
  const urgenza = posizione === 'top';

  /** Aggiunge l'attività; con `apri` chiude il modulo e apre subito la scheda di dettaglio. */
  const invia = (e, apri = false) => {
    e.preventDefault();
    if (!titolo.trim()) { refTitolo.current && refTitolo.current.focus(); return; }
    const t = mutate((doc) => addTask(doc, {
      title: titolo,
      estimate: parseOre(ore) || 0,
      deadline: scad || null,
    }, posizione));
    setTitolo(''); setOre(''); setScad('');
    if (apri) { onChiudi(); ctx.apriEditor(t.id); }
    else if (urgenza) onChiudi();
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
      ${urgenza ? html`<${AnteprimaUrgenza} ctx=${ctx} titolo=${titolo} ore=${ore} scad=${scad} />` : null}
      <div class="azioni">
        <button type="button" class="sec" onClick=${onChiudi}>Chiudi</button>
        <button type="button" class="sec" onClick=${(e) => invia(e, true)}
          title="Aggiunge l'attività e apre la scheda per categoria, sottoattività, note…">Aggiungi e apri ›</button>
        <button type="submit" class="pri">Aggiungi</button>
      </div>
    </form>`;
}

/** Etichette dei vincoli di data: 📌 date fisse, "dal …" (non prima del), sovraccarico. */
export function ChipDate({ m, r, today }) {
  return html`
    ${m.fixedStart ? html`<span class="chip fisso" title="Date fisse: si fa solo in questi giorni">📌 ${fmtIntervallo(m.fixedStart, m.fixedEnd)}</span>` : null}
    ${!m.fixedStart && m.notBefore && m.notBefore > today
      ? html`<span class="chip" title="Non prima del ${formatBreve(m.notBefore)}">dal ${fmtIntervallo(m.notBefore)}</span>` : null}
    ${r && r.overload && r.overload.length
      ? html`<span class="chip sovraccarico" title="Ore oltre la capacità: ${r.overload.map(formatBreve).join(', ')}">⚠ giornata piena</span>` : null}`;
}

/** Una riga della coda. */
function RigaMacro({ m, ctx, indice }) {
  const { doc, plan, wm, slitta, apriEditor } = ctx;
  const [aperta, setAperta] = useState(false);
  const s = summary(doc, m.id, wm);
  const r = plan.tasks[m.id];
  const f = finePrevista(r, s);
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
            ${m.maxPerDay && !m.fixedStart ? html`<span class="chip" title="Limite ore al giorno">max ${fmtOre(m.maxPerDay)}/g</span>` : null}
            <${ChipDate} m=${m} r=${r} today=${ctx.today} />
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
        <button class="icona pausa" title=${m.status === 'paused' ? 'Riprendi' : 'Metti in pausa'}
          aria-label=${m.status === 'paused' ? 'Riprendi' : 'Metti in pausa'}
          onClick=${() => mutate((d) => updateTask(d, m.id, { status: m.status === 'paused' ? 'todo' : 'paused' }))}
          >${m.status === 'paused' ? '▶' : '❚❚'}</button>
        ${figli.length ? html`
          <button class="espandi" onClick=${() => setAperta(!aperta)} aria-label="Sottoattività"
            title="${figli.length} sottoattività">${aperta ? '▾' : '▸'} ${figli.length}</button>` : html`<span class="espandi vuoto"></span>`}
      </div>
      ${aperta ? html`
        <ul class="sotto">
          ${figli.map((c) => {
            const sc = summary(doc, c.id, wm);
            const fc = finePrevista(plan.tasks[c.id], sc);
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

  const tutte = macros(doc);
  const attive = tutte.filter((m) => m.status !== 'done');
  const nFatte = tutte.length - attive.length;

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
      ${modulo ? html`<${InserimentoRapido} key=${modulo} posizione=${modulo} ctx=${ctx} onChiudi=${() => setModulo(null)} />` : null}

      ${attive.length ? html`
        <div class="riepilogo">
          <span><b>${attive.length}</b> attività</span>
          <span><b>${fmtOre(restanti)}</b> di lavoro rimanente</span>
          ${ultima ? html`<span>coda finita il <b>${formatBreve(ultima)}</b></span>` : null}
          ${inRitardo ? html`<span class="tardi"><b>${inRitardo}</b> oltre la scadenza</span>` : null}
          ${ctx.opzioni.factor ? html`<button class="link piccolo" onClick=${() => ctx.vai('archivio')}
            title="Le date tengono conto di quanto, in passato, le attività hanno richiesto più o meno ore del previsto">date corrette con le statistiche</button>` : null}
        </div>` : html`
        <div class="vuoto-grande">
          <p>La coda è vuota.</p>
          <p>Aggiungi la prima attività con <b>+ Attività</b>: titolo e ore stimate bastano.</p>
        </div>`}

      <ul class="coda" ref=${refLista}>
        ${attive.map((m, i) => html`<${RigaMacro} key=${m.id} m=${m} ctx=${ctx} indice=${i} />`)}
      </ul>

      ${nFatte ? html`
        <div class="sezione-fatte">
          <button class="link" onClick=${() => ctx.vai('archivio')}>✓ ${nFatte} ${nFatte === 1 ? 'attività completata' : 'attività completate'} → Archivio</button>
        </div>` : null}
    </section>`;
}

export { STATI };
