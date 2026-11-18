// =============================================================================
// errori.js — Tipi di errore della sincronizzazione, per reagire in modo
// diverso a ciascun caso (riprovare, chiedere un nuovo collegamento, ecc.).
// =============================================================================

/** Rete assente o server irraggiungibile: si riproverà più tardi. */
export class ErroreRete extends Error {
  constructor(msg = 'Rete non disponibile') { super(msg); this.name = 'ErroreRete'; }
}

/** Autorizzazione Dropbox scaduta o revocata: serve ricollegarsi. */
export class ErroreAutorizzazione extends Error {
  constructor(msg = 'Collegamento a Dropbox scaduto: ricollegati') { super(msg); this.name = 'ErroreAutorizzazione'; }
}

/** Il file su Dropbox è cambiato nel frattempo (revisione diversa). */
export class ConflittoRevisione extends Error {
  constructor(msg = 'Il file su Dropbox è cambiato nel frattempo') { super(msg); this.name = 'ConflittoRevisione'; }
}

/** Il file su Dropbox non è leggibile o è di una versione più recente dell'app. */
export class ErroreDati extends Error {
  constructor(msg) { super(msg); this.name = 'ErroreDati'; }
}

/** Errore del server Dropbox (5xx, limiti di frequenza, ecc.). */
export class ErroreServer extends Error {
  constructor(msg, stato) { super(msg); this.name = 'ErroreServer'; this.stato = stato; }
}
