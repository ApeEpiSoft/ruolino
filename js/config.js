// =============================================================================
// config.js — Configurazione dell'app.
//
// DROPBOX_APP_KEY: la "App key" dell'app registrata sulla console sviluppatori
// di Dropbox (vedi README, "Registrare l'app su Dropbox"). Non è un segreto:
// con OAuth PKCE identifica solo l'app, l'accesso lo concede l'utente con il
// proprio login. Se resta vuota, la chiave si può inserire da Impostazioni
// (viene salvata solo su quel dispositivo).
// =============================================================================

export const DROPBOX_APP_KEY = '';

/** Percorso del file dati, relativo alla cartella dell'app su Dropbox. */
export const PERCORSO_DATI = '/ruolino.json';

/** Cartella dei backup giornalieri e quanti conservarne. */
export const CARTELLA_BACKUP = '/backup';
export const MAX_BACKUP = 30;
