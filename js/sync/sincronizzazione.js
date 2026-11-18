// =============================================================================
// sincronizzazione.js — Collega il motore di sincronizzazione all'app:
// quando sincronizzare, stato visibile all'utente, login Dropbox, backup.
//
// Quando si sincronizza:
//   - all'apertura dell'app;
//   - 3 secondi dopo ogni modifica (le modifiche ravvicinate si accorpano);
//   - quando torna la connessione (evento "online");
//   - quando l'app torna in primo piano, e subito quando va in background se
//     ci sono modifiche non caricate;
//   - ogni 5 minuti mentre l'app è aperta e visibile.
// =============================================================================

import { state, archivio, applicaDoc, onMutate, profili, accountAltriProfili } from '../store.js';
import { Dropbox, indirizzoRitorno } from './dropbox.js';
import { Motore } from './motore.js';
import { ErroreRete, ErroreAutorizzazione, ErroreDati } from './errori.js';
import { restoreFrom } from '../core/merge.js';
import { todayISO } from '../core/dates.js';
import { DROPBOX_APP_KEY, PERCORSO_DATI, CARTELLA_BACKUP, MAX_BACKUP } from '../config.js';

/**
 * Stato mostrato nell'interfaccia.
 * fase: 'nonConfigurato' | 'scollegato' | 'offline' | 'inCorso' | 'ok' | 'modifiche' | 'errore'
 */
export const statoSync = {
  fase: 'scollegato',
  messaggio: '',
  ultima: null,
  account: null,
  appKey: '',
  appKeyDaConfig: !!DROPBOX_APP_KEY,
};

const ascoltatori = new Set();
export function subscribeSync(fn) {
  ascoltatori.add(fn);
  return () => ascoltatori.delete(fn);
}
function aggiorna(patch) {
  Object.assign(statoSync, patch);
  for (const f of ascoltatori) f({ ...statoSync });
}

let dbx = null;
let motore = null;
let timer = null;
let avviato = false;

function pianifica(ms) {
  clearTimeout(timer);
  timer = setTimeout(sincronizzaOra, ms);
}

/** Avvio: da chiamare dopo store.init(). */
export async function initSync() {
  const appKey = DROPBOX_APP_KEY || (await archivio.leggi('appKey')) || '';
  aggiorna({ appKey });
  if (!appKey) {
    aggiorna({ fase: 'nonConfigurato', messaggio: '' });
    return;
  }
  dbx = await new Dropbox(appKey, archivio).init();
  motore = new Motore({
    api: dbx,
    archivio,
    leggiDoc: () => state.doc,
    applicaDoc: (d) => applicaDoc(d, { daSync: true }),
    oggi: todayISO,
    percorso: PERCORSO_DATI,
    cartellaBackup: CARTELLA_BACKUP,
    maxBackup: MAX_BACKUP,
  });
  await motore.init();
  aggiorna({ ultima: motore.meta.lastSync });

  // Ritorno dalla pagina di login di Dropbox?
  const p = new URLSearchParams(location.search);
  if (p.has('code') || p.has('error')) {
    history.replaceState(null, '', indirizzoRitorno() + location.hash);
    if (p.has('error')) {
      aggiorna({ fase: 'scollegato', messaggio: 'Collegamento annullato' });
    } else {
      try {
        await dbx.completaLogin(p);
        // Lo stesso account su due profili mescolerebbe i loro dati: si annulla.
        const doppio = (await accountAltriProfili()).find((a) => a.account && a.account === dbx.token.account);
        if (doppio) {
          const email = dbx.token.email || 'questo account';
          await dbx.scollega();
          aggiorna({
            fase: 'scollegato', account: null,
            messaggio: `${email} è già collegato al profilo "${doppio.profilo}": per questo profilo usa un altro account Dropbox.`,
          });
          return;
        }
      } catch (e) {
        aggiorna({ fase: 'errore', messaggio: e.message });
      }
    }
  }
  aggiorna({ account: dbx.token ? (dbx.token.email || dbx.token.nome || 'account Dropbox') : null });

  if (!avviato) {
    avviato = true;
    onMutate(() => {
      if (!motore) return;
      motore.segnaModifica();
      if (statoSync.fase === 'ok') aggiorna({ fase: 'modifiche' });
      pianifica(3000);
    });
    window.addEventListener('online', () => pianifica(500));
    window.addEventListener('offline', () => aggiorna({ fase: 'offline', messaggio: '' }));
    document.addEventListener('visibilitychange', () => {
      if (!motore) return;
      if (document.visibilityState === 'hidden' && motore.modificheLocali) sincronizzaOra();
      if (document.visibilityState === 'visible' && Date.now() - (statoSync.ultima || 0) > 30000) pianifica(300);
    });
    setInterval(() => document.visibilityState === 'visible' && sincronizzaOra(), 5 * 60000);
  }
  await sincronizzaOra();
}

/** Esegue subito una sincronizzazione (se possibile). */
export async function sincronizzaOra() {
  clearTimeout(timer);
  if (!motore) return;
  if (!dbx.collegato) {
    aggiorna({ fase: 'scollegato' });
    return;
  }
  if (!navigator.onLine) {
    aggiorna({ fase: 'offline', messaggio: '' });
    return;
  }
  aggiorna({ fase: 'inCorso', messaggio: '' });
  try {
    await motore.sincronizza();
    aggiorna({
      fase: motore.modificheLocali ? 'modifiche' : 'ok',
      messaggio: motore.meta.erroreBackup ? 'Backup giornaliero non riuscito: ' + motore.meta.erroreBackup : '',
      ultima: motore.meta.lastSync,
    });
    if (motore.modificheLocali) pianifica(2000);
  } catch (e) {
    if (e instanceof ErroreRete) {
      aggiorna({ fase: 'offline', messaggio: '' });
      pianifica(60000);
    } else if (e instanceof ErroreAutorizzazione) {
      aggiorna({ fase: 'scollegato', messaggio: e.message, account: null });
    } else if (e instanceof ErroreDati) {
      aggiorna({ fase: 'errore', messaggio: e.message });
    } else {
      aggiorna({ fase: 'errore', messaggio: e.message || String(e) });
      pianifica(120000);
    }
  }
}

/** Avvia il collegamento a Dropbox (porta alla pagina di login). */
export async function collega() {
  if (!dbx) throw new Error('Inserisci prima la App key di Dropbox');
  // Con più profili Dropbox chiede di accedere: si sceglie l'account giusto.
  await dbx.avviaLogin({ scegliAccount: profili.elenco.length > 1 });
}

/**
 * Scollega Dropbox. Si dimentica anche la base dell'ultima sincronizzazione:
 * se ci si ricollega (magari a un altro account) l'unione sarà una semplice
 * somma dei dati, senza rischio di perdere record.
 */
export async function scollega() {
  if (!dbx) return;
  await dbx.scollega();
  await archivio.scrivi('syncBase', null);
  motore.meta = { rev: null, dirty: true, lastSync: null, lastBackup: null };
  await motore.salvaMeta();
  aggiorna({ fase: 'scollegato', account: null, messaggio: '', ultima: null });
}

/** Salva una App key inserita a mano e riavvia la sincronizzazione. */
export async function impostaAppKey(k) {
  await archivio.scrivi('appKey', (k || '').trim());
  await initSync();
}

export async function elencaBackup() {
  if (!motore || !dbx.collegato) return [];
  return motore.elencaBackup();
}

/**
 * Ripristina un backup di Dropbox: lo stato del backup diventa la modifica
 * più recente e si propaga a tutti i dispositivi alla sincronizzazione.
 */
export async function ripristinaBackup(percorso) {
  const doc = await motore.leggiBackup(percorso);
  await applicaDoc(restoreFrom(state.doc, doc));
  await sincronizzaOra();
}
