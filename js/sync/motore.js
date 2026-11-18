// =============================================================================
// motore.js — Algoritmo di sincronizzazione con il file su Dropbox.
//
// Indipendente dal browser: riceve dall'esterno
//   api       operazioni sui file (Dropbox vero, o un finto Dropbox nei test):
//               scarica(percorso)            → { rev, testo } | null
//               carica(percorso, testo, rev) → { rev }   (rev null = file nuovo)
//                                              lancia ConflittoRevisione se il
//                                              file non è più alla revisione rev
//               copia(da, a)                 → (se `a` esiste già: nessun errore)
//               elenca(cartella)             → [{ nome, percorso }]
//               elimina(percorso)
//   archivio  memoria locale persistente: leggi(chiave) / scrivi(chiave, valore)
//   leggiDoc / applicaDoc   accesso al documento corrente dell'app
//
// Ciclo di sincronizzazione:
//   1. scarica il file e la sua revisione (rev);
//   2. una volta al giorno, prima di qualsiasi modifica, copia il file nella
//      cartella dei backup (tenendo gli ultimi N);
//   3. se la revisione è quella dell'ultima sincronizzazione e non ci sono
//      modifiche locali: niente da fare;
//   4. se la revisione è diversa: unione a tre vie (merge.js) tra locale,
//      remoto e base, e il risultato diventa il documento dell'app;
//   5. se il risultato contiene qualcosa che il remoto non ha, lo carica
//      indicando la revisione attesa: se nel frattempo un altro dispositivo
//      ha scritto, Dropbox rifiuta (ConflittoRevisione) e si ricomincia dal
//      punto 1. Nessuna scrittura può cancellare quella di un altro.
//
// Se il file remoto è illeggibile il ciclo si ferma con ErroreDati SENZA
// sovrascriverlo.
// =============================================================================

import { merge, stesseVersioni } from '../core/merge.js';
import { SCHEMA, normalizeDoc } from '../core/model.js';
import { ConflittoRevisione, ErroreDati } from './errori.js';

const TENTATIVI = 5;
const copia = (x) => JSON.parse(JSON.stringify(x));

export class Motore {
  constructor({ api, archivio, leggiDoc, applicaDoc, oggi, percorso = '/ruolino.json', cartellaBackup = '/backup', maxBackup = 30 }) {
    Object.assign(this, { api, archivio, leggiDoc, applicaDoc, oggi, percorso, cartellaBackup, maxBackup });
    this.contatore = 0; // modifiche locali (in memoria) per capire se ne arrivano durante un ciclo
    this.meta = null;
    this.inCorso = null;
  }

  /** Carica i metadati di sincronizzazione salvati. */
  async init() {
    // dirty = true di default: un dispositivo con dati ma mai sincronizzato
    // deve comunque unire/caricare i suoi dati.
    this.meta = Object.assign({ rev: null, dirty: true, lastSync: null, lastBackup: null }, (await this.archivio.leggi('syncMeta')) || {});
  }

  async salvaMeta() {
    await this.archivio.scrivi('syncMeta', this.meta);
  }

  /** Da chiamare a ogni modifica fatta dall'utente. */
  segnaModifica() {
    this.contatore++;
    if (this.meta && !this.meta.dirty) {
      this.meta.dirty = true;
      this.salvaMeta().catch(() => {});
    }
  }

  /** Ci sono modifiche locali non ancora caricate? */
  get modificheLocali() {
    return !!(this.meta && this.meta.dirty);
  }

  /**
   * Esegue una sincronizzazione completa (una sola alla volta: chiamate
   * concorrenti attendono quella in corso e poi ne eseguono un'altra).
   * Restituisce { esito, conflitti }.
   */
  async sincronizza() {
    if (this.inCorso) {
      // Accoda una sola ripetizione dopo quella in corso.
      if (!this.ripeti) this.ripeti = this.inCorso.catch(() => {}).then(() => { this.ripeti = null; return this.sincronizza(); });
      return this.ripeti;
    }
    this.inCorso = this._conRitentativi().finally(() => { this.inCorso = null; });
    return this.inCorso;
  }

  async _conRitentativi() {
    if (!this.meta) await this.init();
    const conflitti = [];
    for (let i = 0; i < TENTATIVI; i++) {
      try {
        const r = await this._ciclo();
        conflitti.push(...(r.conflitti || []));
        return { esito: r.esito, conflitti };
      } catch (e) {
        if (!(e instanceof ConflittoRevisione)) throw e;
        // Un altro dispositivo ha scritto nel frattempo: si riparte.
      }
    }
    throw new ConflittoRevisione('Il file su Dropbox cambia continuamente: riprova tra poco');
  }

  /** Interpreta il testo del file remoto, con controlli di validità. */
  _analizza(testo) {
    let d;
    try { d = JSON.parse(testo); } catch {
      throw new ErroreDati('Il file su Dropbox non è un JSON valido: non verrà sovrascritto. Ripristina un backup.');
    }
    if (!d || typeof d !== 'object' || typeof d.tasks !== 'object') {
      throw new ErroreDati('Il file su Dropbox non sembra un archivio di Ruolino: non verrà sovrascritto.');
    }
    if ((d.schema || 1) > SCHEMA) {
      throw new ErroreDati('Il file su Dropbox è stato scritto da una versione più recente di Ruolino: aggiorna l\'app.');
    }
    return normalizeDoc(d);
  }

  /** Registra come "base" il documento appena allineato con Dropbox. */
  async _fissa(doc, rev, contatoreIniziale) {
    await this.archivio.scrivi('syncBase', doc);
    this.meta.rev = rev;
    this.meta.dirty = this.contatore !== contatoreIniziale;
    this.meta.lastSync = Date.now();
    await this.salvaMeta();
  }

  async _ciclo() {
    const remoto = await this.api.scarica(this.percorso);

    // Primo dispositivo: il file non esiste ancora.
    if (!remoto) {
      const c0 = this.contatore;
      const snap = copia(this.leggiDoc());
      const r = await this.api.carica(this.percorso, serializza(snap), null);
      await this._fissa(snap, r.rev, c0);
      return { esito: 'creato' };
    }

    const docRemoto = this._analizza(remoto.testo);
    await this._backupGiornaliero();

    if (remoto.rev === this.meta.rev && !this.meta.dirty) {
      this.meta.lastSync = Date.now();
      await this.salvaMeta();
      return { esito: 'invariato' };
    }

    let conflitti = [];
    if (remoto.rev !== this.meta.rev) {
      const base = await this.archivio.leggi('syncBase');
      // Da qui fino ad applicaDoc nessuna attesa: le modifiche dell'utente
      // non possono inserirsi tra lettura, unione e applicazione.
      const c0 = this.contatore;
      const esito = merge(this.leggiDoc(), docRemoto, base || null);
      conflitti = esito.conflitti;
      this.applicaDoc(esito.doc);
      if (stesseVersioni(esito.doc, docRemoto)) {
        // Il locale non aggiunge nulla: basta adottare il remoto.
        await this._fissa(docRemoto, remoto.rev, c0);
        return { esito: 'scaricato', conflitti };
      }
    }

    const c1 = this.contatore;
    const snap = copia(this.leggiDoc());
    const r = await this.api.carica(this.percorso, serializza(snap), remoto.rev);
    await this._fissa(snap, r.rev, c1);
    return { esito: 'caricato', conflitti };
  }

  /**
   * Una volta al giorno copia il file su Dropbox nella cartella dei backup
   * (nome datato) ed elimina i più vecchi oltre maxBackup. Un errore nel
   * backup non blocca la sincronizzazione.
   */
  async _backupGiornaliero() {
    const oggi = this.oggi();
    if (this.meta.lastBackup === oggi) return;
    try {
      await this.api.copia(this.percorso, `${this.cartellaBackup}/ruolino-${oggi}.json`);
      const nomi = (await this.api.elenca(this.cartellaBackup))
        .filter((f) => /^ruolino-\d{4}-\d{2}-\d{2}\.json$/.test(f.nome))
        .sort((a, b) => b.nome.localeCompare(a.nome));
      for (const f of nomi.slice(this.maxBackup)) await this.api.elimina(f.percorso);
      this.meta.lastBackup = oggi;
      this.meta.erroreBackup = null;
    } catch (e) {
      if (e instanceof ConflittoRevisione) throw e;
      this.meta.erroreBackup = e.message;
    }
  }

  /** Elenco dei backup disponibili (più recenti prima). */
  async elencaBackup() {
    return (await this.api.elenca(this.cartellaBackup))
      .filter((f) => /^ruolino-\d{4}-\d{2}-\d{2}\.json$/.test(f.nome))
      .sort((a, b) => b.nome.localeCompare(a.nome));
  }

  /** Legge e valida un backup. */
  async leggiBackup(percorso) {
    const f = await this.api.scarica(percorso);
    if (!f) throw new ErroreDati('Backup non trovato');
    return this._analizza(f.testo);
  }
}

/** Testo del file su Dropbox. */
export function serializza(doc) {
  return JSON.stringify(doc, null, 1);
}
