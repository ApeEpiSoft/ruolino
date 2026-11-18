# Ruolino

Web app personale per pianificare le attività di lavoro e **prevedere quando ciascuna sarà finita**.
Non è un Gantt da disegnare: è una coda di lavoro con una capacità giornaliera (ore al giorno).
Il simulatore riempie i giorni futuri seguendo le priorità e calcola inizio e fine previsti di ogni attività.

- Funziona offline (PWA installabile su Android e PC).
- I dati sono un unico file JSON sul **tuo** Dropbox, sincronizzato tra i dispositivi senza perdere modifiche.
- Nessun server da mantenere: è pubblicata gratis su GitHub Pages.

---

## Indice

1. [Uso in breve](#uso-in-breve)
2. [Avvio in locale (sul PC, senza pubblicare)](#avvio-in-locale)
3. [Pubblicazione su GitHub Pages](#pubblicazione-su-github-pages)
4. [Registrare l'app su Dropbox](#registrare-lapp-su-dropbox)
5. [Collegare i dispositivi e installare l'app](#collegare-i-dispositivi)
6. [Come funziona la sincronizzazione](#come-funziona-la-sincronizzazione)
7. [Backup e ripristino](#backup-e-ripristino)
8. [Pubblicare una nuova versione](#pubblicare-una-nuova-versione)
9. [Test automatici](#test-automatici)
10. [Struttura del progetto](#struttura-del-progetto)

---

## Uso in breve

| Vista | A cosa serve |
|---|---|
| **Oggi** | Cosa fare oggi secondo il piano; ✓ per registrare subito le ore; avvisi (ritardi, blocchi, stime esaurite); prossimi giorni |
| **Coda** | Le attività in ordine di priorità. Si riordinano trascinando la maniglia ⠿ (anche col dito). Accanto a ogni voce c'è la fine prevista, in rosso se supera la scadenza. **⚡ Urgenza** inserisce in cima e, mentre scrivi le ore, mostra quando finirebbe e quali attività slitterebbero (e se superano la scadenza). L'etichetta **+1g / −1g** è lo slittamento rispetto al piano di ieri |
| **Piano** | Diagramma di Gantt calcolato dalla simulazione: per ogni giorno, un blocco alto quanto le ore pianificate rispetto alla capacità. Linea rossa = scadenza, colonne grigie = giorni non lavorativi. Scala a giorni o a settimane, sottoattività facoltative. Non si modifica trascinando: si cambia la coda |
| **Registro** | A fine giornata: ore lavorate su una o più attività (`2,5` o `1:30`, oppure +½ +1 +2), correzione delle ore residue, spunta "finita" |
| **Archivio** | Attività completate con ricerca (titoli, note, sottoattività, note delle ore), filtri per categoria e anno, scarto tra ore effettive e stimate. In testa la **precisione delle stime** con il fattore di correzione (vedi sotto) |
| **Impostazioni** | Sincronizzazione Dropbox e backup, conflitti da controllare, ore per giorno della settimana, eccezioni per data o periodo (ferie, trasferte), export/import JSON, **CSV per Excel** (attività e ore registrate) |

**Date fisse e "non prima del"** (scheda dell'attività, sezione *Date*):
- **Da fare il / Fino al**: l'attività si fa solo in quei giorni (uno o più, es. una trasferta), prima di tutte le altre.
  Le ore rimanenti sono divise in parti uguali sui giorni lavorativi dell'intervallo; le altre attività usano le ore che avanzano.
  Il pulsante *Usa … come ore rimanenti* occupa tutte le ore disponibili di quei giorni.
  Se le ore superano la capacità del giorno compare *⚠ giornata piena*. Se i giorni passano e restano ore: *Date passate*, da spostare o completare.
  Posizione nella coda, predecessori, limite ore/giorno e correzione delle stime non valgono per queste attività.
- **Non prima del**: l'attività resta nella coda ma non riceve ore prima di quella data (es. materiale in arrivo).

**Correzione delle stime.** L'archivio confronta le ore effettive di ogni attività completata con la sua stima *originale*
(quella data all'inizio, che non cambia quando correggi il residuo). Il fattore è il rapporto tra ore effettive e stimate,
per categoria e in generale, sulle ultime 20 attività di ciascun gruppo. Spuntando *Applica la correzione alle date previste*
le ore rimanenti di ogni attività vengono moltiplicate per il fattore della sua categoria. Una categoria con meno di 3 attività
completate usa il fattore generale; con meno di 3 in tutto non si corregge nulla. Il fattore è limitato tra ×0,5 e ×3.
Le stime mostrate restano quelle scritte da te: cambiano solo le date.

Clic su un'attività: si apre la scheda di dettaglio. Lì ci sono stato, categoria, scadenza, limite ore/giorno,
stime, sottoattività (riordinabili), predecessori, note e ore registrate. Le modifiche si salvano da sole.

In alto c'è l'indicatore di sincronizzazione:

| Indicatore | Significato |
|---|---|
| ✓ | Sincronizzato |
| ● | Modifiche da caricare |
| ↻ | Sincronizzazione in corso |
| ⚡ | Offline: modifiche salvate sul dispositivo |
| ⚠ | Errore |
| ○ | Non collegato |

---

## Avvio in locale

Per provare l'app sul PC senza pubblicarla: doppio clic su **`avvia.cmd`**.
Avvia un piccolo server con Python e apre il browser su <http://localhost:8000>; per fermarlo chiudi la finestra nera.
In alternativa da terminale: `python -m http.server 8000` nella cartella del progetto.

> I dati del browser sono legati all'indirizzo: `localhost:8000` e l'indirizzo pubblicato su GitHub sono **archivi diversi**.
> Per portare i dati da uno all'altro basta collegare entrambi a Dropbox: si uniscono da soli.
> In alternativa: *Esporta JSON* da una parte e *Unisci da file* dall'altra.

---

## Pubblicazione su GitHub Pages

**L'app è già pubblicata** su **<https://apeepisoft.github.io/ruolino/>**
(repository <https://github.com/ApeEpiSoft/ruolino>). Ogni `git push` su `main` la aggiorna in 1-2 minuti.
I passi qui sotto servono solo per ripubblicarla da zero, per esempio con un altro account.

Serve un account gratuito su <https://github.com>.
Il repository deve essere **pubblico**: con il piano gratuito GitHub Pages funziona solo così.
Diventa pubblico solo il codice. I tuoi dati restano su Dropbox e non finiscono mai su GitHub.

1. **Crea il repository.** Su GitHub clicca **+ → New repository**:
   - nome `ruolino`;
   - visibilità **Public**;
   - *non* aggiungere README, .gitignore o licenza.

   Poi **Create repository**.
2. **Carica il codice.** Da un terminale nella cartella del progetto (sostituisci `TUO-UTENTE`):

   ```
   git remote add origin https://github.com/TUO-UTENTE/ruolino.git
   git push -u origin main
   ```

   La prima volta Git apre il browser per il login a GitHub.
   Con GitHub CLI basta invece: `gh repo create ruolino --public --source . --push`.
3. **Attiva Pages.** Nel repository vai in **Settings → Pages**. In *Build and deployment* scegli:
   - Source: **Deploy from a branch**;
   - Branch: **main** e cartella **/ (root)**.

   Poi **Save**.
4. Dopo 1-2 minuti l'app è online su **`https://TUO-UTENTE.github.io/ruolino/`** (in minuscolo).
   L'avanzamento si vede nella scheda **Actions**, dove girano anche i test automatici a ogni push.

---

## Registrare l'app su Dropbox

L'app accede a Dropbox con le API ufficiali e il login OAuth (PKCE). Non c'è nessuna password o segreto nel codice.
Vede **solo la propria cartella** (`Dropbox/Applicazioni/<nome app>/`) e nient'altro del tuo Dropbox.

1. Vai su <https://www.dropbox.com/developers/apps> (accedi con il tuo account Dropbox) e clicca **Create app**.
2. Compila:
   - *Choose an API*: **Scoped access**;
   - *Choose the type of access*: **App folder**;
   - *Name your app*: un nome univoco, per esempio `Ruolino-TuoCognome`. Sarà anche il nome della cartella.

   Poi **Create app**.
3. Scheda **Permissions**: spunta **files.metadata.read**, **files.content.read** e **files.content.write**, poi clicca **Submit**.
   *Se cambi i permessi dopo esserti collegato, scollega e ricollega i dispositivi.*
4. Scheda **Settings**, sezione **OAuth 2**:
   - **Redirect URIs**: aggiungi (uno alla volta, con **Add**) gli indirizzi da cui userai l'app, **con la barra finale**:
     - `https://apeepisoft.github.io/ruolino/`
     - `http://localhost:8000/` (solo se vuoi sincronizzare anche la versione locale)

     Devono coincidere carattere per carattere (minuscole, `https`, barra finale), altrimenti Dropbox risponde "Invalid redirect_uri".
     L'indirizzo esatto di ogni pagina è mostrato anche in **Impostazioni → Sincronizzazione Dropbox**.
   - **Allow public clients (Implicit Grant & PKCE)**: deve essere **Allow**.
5. Sempre in **Settings** copia la **App key**. È un identificativo pubblico, non un segreto: **non** serve l'*App secret*.
6. Inserisci la App key nell'app in uno di questi due modi:
   - **consigliato:** scrivila in `js/config.js` (`export const DROPBOX_APP_KEY = 'la-tua-app-key';`), poi fai commit e push. Vale per tutti i dispositivi;
   - oppure in **Impostazioni → Sincronizzazione Dropbox** su ogni dispositivo.

Lo stato *Development* dell'app Dropbox va benissimo per l'uso personale: non serve chiedere la "production approval".

---

## Collegare i dispositivi

Su ogni dispositivo (PC e telefono):

1. Apri <https://apeepisoft.github.io/ruolino/>.
2. Vai in **Impostazioni → Collega a Dropbox**, accedi a Dropbox e clicca **Consenti**: torni all'app collegato.
3. La prima sincronizzazione unisce i dati del dispositivo con quelli su Dropbox. Il primo dispositivo crea il file.
   Fallo per primo dal dispositivo che ha già i dati.

**Installare l'app**

- **Android (Chrome):** apri l'indirizzo, menu **⋮ → Installa app** (oppure *Aggiungi a schermata Home*).
  Si apre a schermo intero come un'app e funziona anche offline.
- **PC (Edge o Chrome):** icona **Installa** nella barra degli indirizzi. È facoltativo: funziona anche come normale pagina web.
  Non richiede installazioni di sistema né permessi di amministratore.

---

## Come funziona la sincronizzazione

- L'app lavora **sempre sulla copia locale**: resta usabile offline.
- Sincronizza in questi momenti:
  - all'apertura;
  - 3 secondi dopo ogni modifica;
  - al ritorno della connessione;
  - quando torna in primo piano;
  - ogni 5 minuti.
- Il file su Dropbox è `ruolino.json`.
- Ogni voce (attività, sottoattività, registrazione ore, eccezione, impostazioni) ha un id e un orario di modifica.
  Le cancellazioni vengono marcate, non eseguite subito.
- Se il file su Dropbox è cambiato dall'ultima volta (lo si capisce dalla sua *revisione*), l'app lo scarica e **unisce voce per voce**:
  - si prendono le voci nuove di entrambi i dispositivi;
  - le ore registrate si sommano;
  - se **la stessa voce** è stata modificata su due dispositivi prima di sincronizzarsi, vince la modifica più recente.
    La versione scartata compare in **Impostazioni → Conflitti da controllare**, dove puoi ripristinarla. Niente si perde in silenzio.
- Il caricamento avviene solo se il file è ancora alla revisione letta.
  Se nel frattempo un altro dispositivo ha scritto, Dropbox rifiuta e l'app riparte da capo: nessun dispositivo può cancellare le modifiche di un altro.
- Se il file su Dropbox fosse illeggibile, l'app **non lo sovrascrive** e segnala l'errore: in quel caso ripristina un backup.

---

## Backup e ripristino

**Backup automatici:** una volta al giorno, alla prima sincronizzazione, l'app copia `ruolino.json` in `backup/ruolino-AAAA-MM-GG.json`
nella cartella dell'app su Dropbox. Conserva gli ultimi **30** e cancella i più vecchi.
Ogni backup è lo stato del file **all'inizio** di quel giorno.

**Ripristinare un backup dall'app:**
1. **Impostazioni → Sincronizzazione Dropbox → Backup…**
2. Scegli la data e clicca **Ripristina**, poi conferma.

Tutti i dati tornano a quello stato **su tutti i dispositivi** alla loro prossima sincronizzazione.
Le modifiche successive al backup vengono annullate, ma i backup restano tutti disponibili.

**Ripristinare da un file sul computer** (un export o un backup scaricato da dropbox.com):
**Impostazioni → Dati → Ripristina da file…**. Per aggiungere i dati di un file senza annullare nulla usa invece **Unisci da file…**.

**Se l'app non si apre più su nessun dispositivo:**
1. su dropbox.com apri `Applicazioni/<nome app>/backup/` e scarica l'ultimo backup buono;
2. apri l'app (anche in locale con `avvia.cmd`);
3. usa **Ripristina da file…**.

I file sono JSON leggibili, apribili anche con un editor di testo.

**Esportare:** **Impostazioni → Esporta JSON** scarica una copia completa dei dati.

---

## Pubblicare una nuova versione

1. Modifica il codice e verifica i test (vedi sotto).
2. Aumenta la versione **in due punti**:
   - `VERSIONE` in `sw.js`;
   - `VERSIONE_APP` in `js/versione.js`.

   Devono coincidere: lo verifica il test automatico. Senza questo passaggio i dispositivi continuerebbero a usare la versione in cache.
3. `git commit` e `git push`. Dopo un minuto, su ogni dispositivo compare **"È disponibile una nuova versione → Aggiorna"**.

Se aggiungi un nuovo file JavaScript, aggiungilo anche all'elenco `FILE` in `sw.js`. Il test lo segnala se te ne dimentichi.

---

## Test automatici

- **Nel browser:** con l'app avviata in locale apri <http://localhost:8000/tests/>.
  Deve comparire `RISULTATO: N passati, 0 falliti`.
- **Su GitHub:** a ogni push la scheda **Actions** esegue `node tests/run-node.mjs`.
  Fa gli stessi test più i controlli del service worker.

I test coprono:
- lo scheduler: interruzioni, predecessori, limiti giornalieri, giorni non lavorativi, eccezioni;
- l'unione dei dati e la sincronizzazione tra due dispositivi simulati: modifiche concorrenti, corse tra upload, backup, file corrotto, ripristino.

---

## Struttura del progetto

```
index.html, manifest.webmanifest, sw.js   pagina, manifest PWA, service worker (offline)
avvia.cmd                                  avvio locale con doppio clic
css/app.css                                stile (tema chiaro/scuro automatico, responsive)
icons/                                     icone (PNG generate da tools/genera-icone.py)
js/app.js                                  avvio, navigazione, calcolo del piano
js/config.js                               App key Dropbox e percorsi
js/store.js                                copia locale (IndexedDB) e stato
js/core/                                   logica pura, coperta dai test
  model.js, scheduler.js, merge.js         modello dati, simulazione coda, unione a tre vie
  order.js, dates.js, ids.js               ordinamento frazionario, date, id e orologio
  stats.js, impatto.js, csv.js             statistiche stime, anteprima urgenze, export CSV
js/sync/                                   sincronizzazione
  motore.js                                algoritmo (indipendente dal browser, testato)
  dropbox.js                               API Dropbox e login OAuth PKCE
  sincronizzazione.js                      quando sincronizzare, stato visibile
js/ui/                                     viste (Preact + htm)
js/vendor/                                 Preact+htm 3.1.1, SortableJS 1.15.6 (MIT, inclusi)
tests/                                     test (browser e Node)
.github/workflows/test.yml                 test automatici su GitHub
```
