// =============================================================================
// scheduler.js — Simulazione della coda di lavoro.
//
// NON è un Gantt a giorni di calendario: è una coda con capacità giornaliera.
// Partendo da oggi, per ogni giorno:
//   1. si calcola la capacità del giorno (eccezione o orario settimanale);
//      per oggi si tolgono le ore già registrate oggi;
//   2. si scorre la coda in ordine di priorità e si assegnano ore a ogni
//      macro-attività "disponibile" (non in pausa, predecessori completati),
//      fino a  min(ore rimanenti, capacità residua, limite ore/giorno);
//   3. ciò che avanza passa all'attività successiva (così un'attività con
//      limite giornaliero avanza in parallelo a quelle sotto di lei);
//   4. si ripete il giro finché nel giorno si riesce ad assegnare qualcosa:
//      un predecessore finito a metà giornata libera subito le attività che
//      lo aspettano (possono iniziare lo stesso giorno).
//
// Dentro una macro le sottoattività avanzano in sequenza, nel loro ordine;
// le ore "proprie" della macro (non assegnate a sottoattività) vengono per
// ultime. Il limite ore/giorno vale per la macro intera.
//
// Vincoli di data (solo sulle macro):
//  - DATE FISSE (fixedStart … fixedEnd): l'attività si fa solo in quei giorni,
//    PRIMA di tutto il resto, con le ore rimanenti divise in parti uguali sui
//    giorni lavorativi dell'intervallo. Ignora coda, predecessori e limite
//    giornaliero; se supera la capacità il giorno è "sovraccarico".
//    Se l'intervallo è passato e restano ore: stato 'expired'.
//  - NON PRIMA DEL (notBefore): l'attività resta in coda ma non riceve ore
//    prima di quella data.
//
// Tutti i calcoli interni sono in QUARTI D'ORA interi, per evitare errori di
// arrotondamento con i numeri decimali.
//
// Modulo puro: riceve il documento e la data di oggi, restituisce il piano.
// =============================================================================

import { addDays, weekday } from './dates.js';
import { macros, children, workedMap, loggedOn, capacityOn } from './model.js';

const QUARTI = 4;
const aQuarti = (h) => Math.round(Number(h || 0) * QUARTI);
const aOre = (qq) => qq / QUARTI;

/**
 * Esegue la simulazione.
 * @param {object} doc      documento dati
 * @param {string} today    data di partenza 'AAAA-MM-GG'
 * @param {object} opzioni  { horizonDays = 730, factor = 1 }
 *                          factor: moltiplicatore delle ore rimanenti
 *                          (fattore di correzione personale delle stime).
 *                          Può essere un numero oppure una funzione
 *                          macro → numero (fattore per categoria, vedi stats.js).
 * @returns {{ today, horizonEnd, tasks: Object<string, RisultatoAttività>, days: Object<string, Array> }}
 *
 * RisultatoAttività = { start, end, plannedHours, days: {data: ore},
 *                       state: 'planned'|'done'|'paused'|'blocked'|'unscheduled',
 *                       reason, late, exhausted }
 */
export function schedule(doc, today, opzioni = {}) {
  const horizonDays = opzioni.horizonDays ?? 730;
  const fattoreDi = (m) => {
    const f = typeof opzioni.factor === 'function' ? opzioni.factor(m) : opzioni.factor;
    return f > 0 && isFinite(f) ? f : 1;
  };
  const wm = workedMap(doc);
  const risultati = {};
  const giorni = {};

  const nuovoRisultato = () => ({
    start: null, end: null, plannedHours: 0, days: {},
    state: 'planned', reason: '', late: false, exhausted: false,
  });

  // Quarti rimanenti di un singolo record (con eventuale fattore di correzione).
  const rimanenti = (t, factor) => {
    const r = Math.max(0, Number(t.estimate || 0) - (wm[t.id] || 0));
    return Math.ceil(r * factor * QUARTI - 1e-9);
  };

  // ---------------------------------------------------------------------------
  // 1. Prepara le macro e le loro "unità" di lavoro sequenziali.
  // ---------------------------------------------------------------------------
  const tutte = macros(doc);
  const perId = {};
  for (const m of tutte) {
    const r = (risultati[m.id] = nuovoRisultato());
    const figli = children(doc, m.id);
    for (const c of figli) {
      const rc = (risultati[c.id] = nuovoRisultato());
      if (c.status === 'done' || m.status === 'done') rc.state = 'done';
      else if (c.status === 'paused') { rc.state = 'paused'; rc.reason = 'In pausa'; }
    }
    if (m.status === 'done') { r.state = 'done'; continue; }

    // Date fisse: l'attività si fa SOLO in quei giorni (vedi giorniFissi).
    const fisso = m.fixedStart ? giorniFissi(doc, m) : null;
    // Unità: sottoattività attive in ordine, poi le ore proprie della macro.
    // Il fattore di correzione non si applica alle date fisse: le ore di una
    // trasferta o di un appuntamento non "si allungano".
    const f = fisso ? 1 : fattoreDi(m);
    const unità = [];
    for (const c of figli) {
      if (c.status === 'done' || c.status === 'paused') continue;
      const qq = rimanenti(c, f);
      if (qq > 0) unità.push({ id: c.id, rem: qq });
      else risultati[c.id].exhausted = true; // stima esaurita ma non completata
    }
    const propri = rimanenti(m, f);
    if (propri > 0) unità.push({ id: m.id, rem: propri });
    else if (figli.length === 0) r.exhausted = true;

    perId[m.id] = {
      m,
      unità,
      i: 0, // indice dell'unità corrente
      // Le date fisse vincono sui predecessori: vengono ignorati.
      preds: fisso ? [] : (m.predecessors || []).filter((p) => doc.tasks[p] && !doc.tasks[p].deletedAt && p !== m.id),
      finita: unità.length === 0, // niente da fare: considerata già finita
      oggiQ: 0, // quarti assegnati nel giorno corrente
      fisso, // null oppure { dal, al, giorni: [date in cui distribuire le ore] }
      nonPrima: !fisso && m.notBefore ? m.notBefore : null,
    };
    if (m.status === 'paused') { r.state = 'paused'; r.reason = 'In pausa'; }
  }

  // ---------------------------------------------------------------------------
  // 2. Individua le macro che non potranno mai partire: in pausa, in un ciclo
  //    di predecessori, o che dipendono (anche indirettamente) da queste.
  // ---------------------------------------------------------------------------
  const esclusa = {}; // id → motivo
  const visita = {}; // 0 = mai, 1 = in corso (sullo stack), 2 = finita
  const verifica = (id) => {
    const s = perId[id];
    if (!s) return null; // completata: nessun impedimento
    if (visita[id] === 2) return esclusa[id] || null;
    if (visita[id] === 1) return 'Dipendenze circolari';
    visita[id] = 1;
    let motivo = s.m.status === 'paused' ? 'In pausa' : null;
    for (const p of s.preds) {
      const mp = verifica(p);
      if (mp === 'Dipendenze circolari') { motivo = motivo || mp; }
      else if (mp && !motivo) motivo = 'In attesa di: ' + doc.tasks[p].title;
    }
    visita[id] = 2;
    if (motivo) esclusa[id] = motivo;
    return motivo;
  };
  for (const id of Object.keys(perId)) verifica(id);
  // Un ciclo marca solo chi lo scopre: ripassa per propagare a tutti i membri.
  let cambiato = true;
  while (cambiato) {
    cambiato = false;
    for (const id of Object.keys(perId)) {
      if (esclusa[id]) continue;
      const s = perId[id];
      const p = s.preds.find((x) => esclusa[x]);
      if (p) {
        esclusa[id] = esclusa[p] === 'Dipendenze circolari' ? esclusa[p] : 'In attesa di: ' + doc.tasks[p].title;
        cambiato = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Simulazione giorno per giorno.
  // ---------------------------------------------------------------------------
  const attive = tutte.filter((m) => perId[m.id] && !esclusa[m.id]).map((m) => perId[m.id]);
  const predFinito = (p) => !perId[p] || perId[p].finita;
  const assegna = (s, unitàId, data, qq) => {
    const h = aOre(qq);
    for (const id of new Set([unitàId, s.m.id])) {
      const r = risultati[id];
      if (!r.start) r.start = data;
      r.days[data] = (r.days[data] || 0) + h;
      r.plannedHours += h;
    }
    (giorni[data] = giorni[data] || []).push({ taskId: unitàId, macroId: s.m.id, hours: h });
  };

  const fisse = attive.filter((s) => s.fisso);
  const sovraccarichi = {}; // data → ore oltre la capacità (per le date fisse)

  const oreOggi = aQuarti(loggedOn(doc, today));
  let giorno = today;
  for (let n = 0; n < horizonDays; n++, giorno = addDays(giorno, 1)) {
    if (attive.every((s) => s.finita)) break;
    let cap = aQuarti(capacityOn(doc, giorno, weekday));
    if (n === 0) cap = Math.max(0, cap - oreOggi);

    // 3a. Prima di tutto le attività a date fisse: le ore che restano sono
    //     distribuite in parti uguali sui giorni fissati che mancano (oggi
    //     compreso). Se superano la capacità il giorno risulta sovraccarico.
    for (const s of fisse) {
      if (s.finita) continue;
      const k = s.fisso.giorni.indexOf(giorno);
      if (k < 0) continue;
      const giorniRimasti = s.fisso.giorni.length - k;
      let qq = Math.ceil(s.unità.slice(s.i).reduce((t, u) => t + u.rem, 0) / giorniRimasti);
      while (qq > 0 && s.i < s.unità.length) {
        const u = s.unità[s.i];
        const x = Math.min(u.rem, qq);
        assegna(s, u.id, giorno, x);
        u.rem -= x; qq -= x; cap -= x;
        if (u.rem === 0) {
          if (u.id !== s.m.id) risultati[u.id].end = giorno;
          s.i++;
        }
      }
      if (s.i >= s.unità.length) { s.finita = true; risultati[s.m.id].end = giorno; }
    }
    if (cap < 0) {
      sovraccarichi[giorno] = aOre(-cap);
      cap = 0;
    }

    if (cap <= 0) continue;
    for (const s of attive) s.oggiQ = 0;

    let progresso = true;
    while (cap > 0 && progresso) {
      progresso = false;
      for (const s of attive) {
        if (cap <= 0) break;
        if (s.finita || s.fisso || !s.preds.every(predFinito)) continue;
        if (s.nonPrima && giorno < s.nonPrima) continue;
        const limite = s.m.maxPerDay > 0 ? aQuarti(s.m.maxPerDay) : Infinity;
        while (cap > 0 && s.oggiQ < limite && s.i < s.unità.length) {
          const u = s.unità[s.i];
          const qq = Math.min(u.rem, cap, limite - s.oggiQ);
          assegna(s, u.id, giorno, qq);
          u.rem -= qq;
          cap -= qq;
          s.oggiQ += qq;
          progresso = true;
          if (u.rem === 0) {
            if (u.id !== s.m.id) risultati[u.id].end = giorno;
            s.i++;
          }
        }
        if (s.i >= s.unità.length && !s.finita) {
          s.finita = true;
          risultati[s.m.id].end = giorno;
        }
      }
    }
  }
  const horizonEnd = addDays(today, horizonDays - 1);

  // ---------------------------------------------------------------------------
  // 4. Stati finali, motivi di blocco e ritardi rispetto alle scadenze.
  // ---------------------------------------------------------------------------
  for (const m of tutte) {
    const r = risultati[m.id];
    const s = perId[m.id];
    if (r.state === 'done') continue;
    if (esclusa[m.id]) {
      if (r.state !== 'paused') { r.state = 'blocked'; r.reason = esclusa[m.id]; }
    } else if (!s.finita && s.fisso && s.fisso.al < today) {
      // Date fisse passate con ore ancora da fare: decide l'utente (sposta o completa).
      r.state = 'expired';
      r.reason = 'Date fissate passate';
      r.late = true;
    } else if (!s.finita) {
      r.state = 'unscheduled';
      const p = s.preds.find((x) => !predFinito(x));
      r.reason = p ? 'In attesa di: ' + doc.tasks[p].title : 'Oltre l\'orizzonte di pianificazione';
    } else if (!r.end) {
      // Nessuna ora da pianificare (stima esaurita): finita "oggi" sulla carta.
      r.end = null;
    }
    // Sottoattività non ancora completate ma senza piano: ereditano lo stato.
    for (const c of children(doc, m.id)) {
      const rc = risultati[c.id];
      if (rc.state === 'planned' && !rc.end && r.state !== 'planned') {
        rc.state = r.state;
        rc.reason = r.reason;
      }
    }
    // Giorni sovraccarichi in cui lavora questa attività a date fisse.
    if (s && s.fisso) r.overload = Object.keys(r.days).filter((g) => sovraccarichi[g]);
    // In ritardo: fine prevista oltre la scadenza, oppure scadenza senza fine prevista.
    if (m.deadline && r.state !== 'expired') {
      r.late = r.end ? r.end > m.deadline : (r.state !== 'planned' || (!r.exhausted && s.unità.length > 0));
    }
  }

  return { today, horizonEnd, tasks: risultati, days: giorni, overload: sovraccarichi };
}

/**
 * Giorni di un'attività a date fisse: dal `fixedStart` al `fixedEnd` (o solo
 * `fixedStart`), solo quelli con capacità > 0. Se nessuno ne ha (es. un
 * sabato), tutti i giorni dell'intervallo. Limite di sicurezza: 366 giorni.
 */
export function giorniFissi(doc, m) {
  const dal = m.fixedStart;
  const al = m.fixedEnd && m.fixedEnd > dal ? m.fixedEnd : dal;
  const tutti = [];
  for (let g = dal; g <= al && tutti.length < 366; g = addDays(g, 1)) tutti.push(g);
  const lavorativi = tutti.filter((g) => capacityOn(doc, g, weekday) > 0);
  return { dal, al, giorni: lavorativi.length ? lavorativi : tutti };
}

/**
 * Confronta due piani: per ogni macro restituisce lo spostamento della fine
 * prevista in giorni LAVORATIVI (giorni con capacità > 0) tra `prima` e `dopo`.
 * Usato per "slittamento rispetto a ieri" e per l'anteprima delle urgenze.
 * `prima` e `dopo` sono mappe id → data di fine (o null).
 */
export function slittamenti(doc, prima, dopo) {
  const out = {};
  for (const id of Object.keys(dopo)) {
    const a = prima[id];
    const b = dopo[id];
    if (!a || !b || a === b) continue;
    out[id] = giorniLavorativiTra(doc, a, b);
  }
  return out;
}

/** Numero (con segno) di giorni lavorativi in (a, b] se b > a, negativo se b < a. */
export function giorniLavorativiTra(doc, a, b) {
  const segno = b > a ? 1 : -1;
  let [da, a2] = segno > 0 ? [a, b] : [b, a];
  let n = 0;
  let g = addDays(da, 1);
  for (let i = 0; i < 3660 && g <= a2; i++, g = addDays(g, 1)) {
    if (capacityOn(doc, g, weekday) > 0) n++;
  }
  // Se tra le due date non ci sono giorni lavorativi conta almeno 1 giorno.
  return segno * Math.max(n, 1);
}
