// =============================================================================
// dropbox.js — Accesso a Dropbox tramite le API HTTP ufficiali (v2), senza SDK.
//
// Autenticazione: OAuth 2 "Authorization Code" con PKCE, adatto alle app che
// girano nel browser: NON serve alcun segreto nel codice, solo la "App key"
// (pubblica). Si chiede un refresh token di lunga durata
// (token_access_type=offline) con cui ottenere nuovi access token (validi
// circa 4 ore) senza rifare il login.
//
// L'app Dropbox è di tipo "App folder": vede solo la cartella
// Dropbox/Applicazioni/<nome app>/; i percorsi qui sotto sono relativi ad essa.
// =============================================================================

import { ErroreRete, ErroreAutorizzazione, ConflittoRevisione, ErroreServer } from './errori.js';

const URL_AUTORIZZA = 'https://www.dropbox.com/oauth2/authorize';
const URL_TOKEN = 'https://api.dropboxapi.com/oauth2/token';
const API = 'https://api.dropboxapi.com/2/';
const CONTENUTI = 'https://content.dropboxapi.com/2/';

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

function base64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function casuale(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return base64url(a);
}

async function sfida(verificatore) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificatore));
  return base64url(h);
}

/**
 * L'intestazione Dropbox-API-Arg accetta solo ASCII: i caratteri non ASCII
 * vanno scritti come \uXXXX.
 */
function argomentoHeader(obj) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** Indirizzo di ritorno dopo il login: la pagina dell'app senza index.html. */
export function indirizzoRitorno() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class Dropbox {
  /**
   * @param {string} appKey    "App key" dell'app registrata su Dropbox
   * @param {object} archivio  leggi/scrivi chiave-valore persistente (token)
   */
  constructor(appKey, archivio) {
    this.appKey = appKey;
    this.archivio = archivio;
    this.token = null; // { refresh, access, scade, account }
  }

  async init() {
    this.token = (await this.archivio.leggi('dropboxToken')) || null;
    return this;
  }

  get collegato() {
    return !!(this.token && this.token.refresh);
  }

  /** Avvia il login: salva il verificatore PKCE e va alla pagina di Dropbox. */
  async avviaLogin() {
    const verificatore = casuale(48);
    const stato = casuale(16);
    const ritorno = indirizzoRitorno();
    await this.archivio.scrivi('dropboxPkce', { verificatore, stato, ritorno });
    const p = new URLSearchParams({
      client_id: this.appKey,
      response_type: 'code',
      code_challenge: await sfida(verificatore),
      code_challenge_method: 'S256',
      redirect_uri: ritorno,
      token_access_type: 'offline',
      state: stato,
    });
    location.assign(URL_AUTORIZZA + '?' + p.toString());
  }

  /**
   * Completa il login al ritorno da Dropbox (?code=…&state=…).
   * Restituisce true se il collegamento è riuscito.
   */
  async completaLogin(parametri) {
    const codice = parametri.get('code');
    const pkce = await this.archivio.leggi('dropboxPkce');
    if (!codice || !pkce || parametri.get('state') !== pkce.stato) {
      throw new ErroreAutorizzazione('Risposta di Dropbox non valida: riprova a collegarti');
    }
    const r = await this._post(URL_TOKEN, new URLSearchParams({
      code: codice,
      grant_type: 'authorization_code',
      code_verifier: pkce.verificatore,
      client_id: this.appKey,
      redirect_uri: pkce.ritorno,
    }));
    if (!r.ok) throw new ErroreAutorizzazione('Dropbox ha rifiutato il collegamento (' + (await r.text()) + ')');
    const j = await r.json();
    this.token = {
      refresh: j.refresh_token,
      access: j.access_token,
      scade: Date.now() + (j.expires_in || 14400) * 1000,
      account: j.account_id,
    };
    await this.archivio.scrivi('dropboxToken', this.token);
    await this.archivio.scrivi('dropboxPkce', null);
    try {
      const a = await this.rpc('users/get_current_account', null);
      this.token.nome = a.name && a.name.display_name;
      this.token.email = a.email;
      await this.archivio.scrivi('dropboxToken', this.token);
    } catch { /* informazioni facoltative */ }
    return true;
  }

  /** Scollega: revoca il token su Dropbox e lo dimentica. */
  async scollega() {
    try { if (this.token) await this.rpc('auth/token/revoke', null); } catch { /* già revocato o offline */ }
    this.token = null;
    await this.archivio.scrivi('dropboxToken', null);
  }

  /** fetch con traduzione degli errori di rete. */
  async _post(url, body, headers = {}) {
    try {
      return await fetch(url, { method: 'POST', body, headers, cache: 'no-store' });
    } catch {
      throw new ErroreRete();
    }
  }

  /** Access token valido (rinnovato con il refresh token se scaduto). */
  async accessToken(forza = false) {
    if (!this.collegato) throw new ErroreAutorizzazione('Non collegato a Dropbox');
    if (!forza && this.token.access && Date.now() < this.token.scade - 60000) return this.token.access;
    const r = await this._post(URL_TOKEN, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.token.refresh,
      client_id: this.appKey,
    }));
    if (r.status === 400 || r.status === 401) {
      this.token = null;
      await this.archivio.scrivi('dropboxToken', null);
      throw new ErroreAutorizzazione();
    }
    if (!r.ok) throw new ErroreServer('Rinnovo del token non riuscito', r.status);
    const j = await r.json();
    this.token.access = j.access_token;
    this.token.scade = Date.now() + (j.expires_in || 14400) * 1000;
    await this.archivio.scrivi('dropboxToken', this.token);
    return this.token.access;
  }

  /**
   * Esegue una richiesta autenticata; se l'access token è scaduto lo rinnova
   * e riprova una volta. Restituisce la Response se ok o 409 (errore
   * "applicativo" da interpretare), altrimenti lancia un errore.
   */
  async _richiesta(url, body, headers) {
    for (let tentativo = 0; tentativo < 2; tentativo++) {
      const t = await this.accessToken(tentativo > 0);
      const r = await this._post(url, body, Object.assign({ Authorization: 'Bearer ' + t }, headers));
      if (r.status === 401 && tentativo === 0) continue;
      if (r.status === 401) throw new ErroreAutorizzazione();
      if (r.ok || r.status === 409) return r;
      const testo = await r.text().catch(() => '');
      if (r.status === 429) throw new ErroreServer('Troppe richieste a Dropbox: riprovo più tardi', 429);
      throw new ErroreServer(`Errore Dropbox ${r.status}: ${testo.slice(0, 200)}`, r.status);
    }
  }

  /** Chiamata RPC (argomenti e risposta JSON). */
  async rpc(endpoint, args) {
    const r = await this._richiesta(API + endpoint, args === null ? 'null' : JSON.stringify(args), { 'Content-Type': 'application/json' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) {
      const e = new ErroreServer('Dropbox: ' + (j.error_summary || 'errore'), 409);
      e.riepilogo = j.error_summary || '';
      throw e;
    }
    return j;
  }

  // -------------------------------------------------------------------------
  // Operazioni sui file usate dal motore di sincronizzazione
  // -------------------------------------------------------------------------

  /** Scarica un file: { rev, testo }, oppure null se non esiste. */
  async scarica(percorso) {
    const r = await this._richiesta(CONTENUTI + 'files/download', undefined, {
      'Dropbox-API-Arg': argomentoHeader({ path: percorso }),
    });
    if (r.status === 409) {
      const j = await r.json().catch(() => ({}));
      if ((j.error_summary || '').startsWith('path/not_found')) return null;
      throw new ErroreServer('Download non riuscito: ' + (j.error_summary || ''), 409);
    }
    const testo = await r.text();
    let rev = null;
    try { rev = JSON.parse(r.headers.get('Dropbox-API-Result')).rev; } catch { /* intestazione non esposta */ }
    if (!rev) rev = (await this.rpc('files/get_metadata', { path: percorso })).rev;
    return { rev, testo };
  }

  /**
   * Carica un file. Con `rev` sovrascrive solo se il file è ancora a quella
   * revisione; con rev = null crea un file nuovo e fallisce se esiste già.
   * In entrambi i casi un rifiuto diventa ConflittoRevisione.
   */
  async carica(percorso, testo, rev) {
    const r = await this._richiesta(CONTENUTI + 'files/upload', new Blob([testo], { type: 'application/octet-stream' }), {
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': argomentoHeader({
        path: percorso,
        mode: rev ? { '.tag': 'update', update: rev } : { '.tag': 'add' },
        autorename: false,
        mute: true,
        strict_conflict: true,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) {
      if ((j.error_summary || '').includes('conflict')) throw new ConflittoRevisione();
      throw new ErroreServer('Caricamento non riuscito: ' + (j.error_summary || ''), 409);
    }
    return { rev: j.rev };
  }

  /** Copia un file; se la destinazione esiste già non fa nulla. */
  async copia(da, a) {
    try {
      await this.rpc('files/copy_v2', { from_path: da, to_path: a, autorename: false });
    } catch (e) {
      if (e.riepilogo && e.riepilogo.startsWith('to/conflict')) return;
      throw e;
    }
  }

  /** Elenca i file di una cartella (vuoto se la cartella non esiste). */
  async elenca(cartella) {
    let j;
    try {
      j = await this.rpc('files/list_folder', { path: cartella });
    } catch (e) {
      if (e.riepilogo && e.riepilogo.startsWith('path/not_found')) return [];
      throw e;
    }
    const voci = [...j.entries];
    while (j.has_more) {
      j = await this.rpc('files/list_folder/continue', { cursor: j.cursor });
      voci.push(...j.entries);
    }
    return voci.filter((v) => v['.tag'] === 'file').map((v) => ({ nome: v.name, percorso: v.path_lower, data: v.server_modified }));
  }

  async elimina(percorso) {
    await this.rpc('files/delete_v2', { path: percorso });
  }
}
