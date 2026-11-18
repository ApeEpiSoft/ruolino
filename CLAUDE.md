# CLAUDE.md — Guida per le sessioni di sviluppo su Ruolino

Ruolino è una PWA personale (tutta in italiano) per pianificare le attività di lavoro dell'utente.
L'utente sviluppa software per robot di verniciatura e fa schemi elettrici.
Ha 20-30 macro-attività e un lavoro frammentato, con interruzioni frequenti.
Usa l'app da un portatile aziendale, spesso offline e senza permesso di installare nulla, e da un telefono Android.

## Regole di lavoro concordate

- Si procede **una fase alla volta**. L'utente prova la fase prima di passare alla successiva.
  - Fase 1 (fatta): MVP locale.
  - Fase 2 (fatta): sincronizzazione Dropbox, PWA offline, guida per GitHub Pages, CI.
  - Fase 3 (fatta): Gantt (vista Piano), anteprima dell'impatto di un'urgenza, statistiche stime e fattore di correzione, archivio con ricerca, export CSV.
- App pubblicata su https://apeepisoft.github.io/ruolino/ (repo `ApeEpiSoft/ruolino`, Pages dal branch `main`).
  La App key Dropbox è in `js/config.js`. Ogni push su `main` ripubblica.
- Interfaccia, commenti nel codice e documentazione **in italiano**.
- **Niente build e niente npm.** Solo moduli ES nativi; le librerie stanno in `js/vendor/`.
  Sul PC c'è Python (serve `python -m http.server`), non c'è Node.
- Solo software gratuito e open source. Nessun server da mantenere.
- **A ogni rilascio** aumentare `VERSIONE` in `sw.js` **e** `VERSIONE_APP` in `js/versione.js`, che devono coincidere.
  Ogni nuovo file va aggiunto a `FILE` in `sw.js`. Il test Node verifica entrambe le cose.

## Modello (NON è un Gantt a giorni di calendario)

Il modello è una coda di lavoro con capacità giornaliera:

- **Attività** (`doc.tasks`): una macro ha `parentId = null`, una sottoattività ha `parentId = id della macro`.
  - Campi: `title, notes, category, status (todo|doing|paused|done), estimate, estimateOriginal, order, deadline, predecessors[], maxPerDay, completedAt`.
  - `estimate` è lo sforzo in ore, non la durata.
  - Ore lavorate = somma delle registrazioni in `doc.logs`: **non c'è un contatore**.
  - Rimanenti = `max(0, estimate − lavorate)`; vale 0 se `done`.
  - Correggere il residuo significa `estimate = lavorate + nuovoResiduo` (`setRemaining`).
  - `estimateOriginal` non cambia: serve alle statistiche delle stime.
  - Una macro con sottoattività aggrega le loro ore. Il suo `estimate` diventa "ore proprie": lavoro generale non assegnato a una sottoattività.
  - Predecessori e `maxPerDay` esistono solo a livello di macro. Il limite vale per la somma della macro.
  - **"In corso" è calcolato** (`statoEffettivo`: `todo` con ore registrate).
    `addLog` NON tocca l'attività, apposta: registrare ore su un dispositivo non deve entrare in conflitto con le modifiche all'attività fatte su un altro.
    In generale: evitare effetti collaterali che modificano record diversi da quello su cui l'utente agisce.
- **Capacità**: `doc.settings.weekly[0..6]` (0 = domenica, default 8 h lun-ven).
  Le eccezioni per data stanno in `doc.exceptions` con id deterministico `exc-AAAA-MM-GG`.
- **Scheduler** (`js/core/scheduler.js`, funzione pura `schedule(doc, today, {horizonDays, factor})`):
  - Simula i giorni da oggi in poi, lavorando in quarti d'ora interi.
  - Per oggi la capacità è quella del giorno meno le ore già registrate oggi.
  - Per ogni giorno scorre le macro in ordine di coda e assegna `min(rimanenti, capacità residua, maxPerDay − già assegnato oggi)`. Ripete il giro finché assegna qualcosa: un predecessore finito a metà giornata sblocca subito chi lo aspetta.
  - Dentro una macro le sottoattività avanzano in sequenza (saltando quelle in pausa o completate). Le ore proprie della macro vengono per ultime.
  - Le macro in pausa, quelle in cicli di predecessori e quelle che ne dipendono restano escluse, con un motivo.
  - **Date fisse** (`fixedStart`, `fixedEnd` facoltativo, solo macro): ogni giorno vengono assegnate per prime, residuo diviso in parti uguali sui giorni lavorativi dell'intervallo (`giorniFissi`; se nessuno ha capacità, tutti).
    Ignorano ordine, predecessori, `maxPerDay` e fattore di correzione. Le ore oltre la capacità finiscono in `plan.overload[data]` e `tasks[id].overload`.
    Intervallo passato con ore residue → `state: 'expired'`, `late: true`.
  - **Non prima del** (`notBefore`, ignorato se ci sono date fisse): la macro resta in coda ma non riceve ore prima della data.
  - Restituisce `{ tasks: {id: {start, end, days, plannedHours, state, reason, late, exhausted}}, days: {data: [{taskId, macroId, hours}]} }`.
  - Ricalcolo completo a ogni modifica: costa meno di 1 ms.
- **Ordine della coda**: chiavi frazionarie in `order` (`js/core/order.js`). Spostare un elemento modifica un solo record.
  Se due chiavi sono uguali, decide l'id. Se le chiavi dei vicini non sono valide, `moveTask` rinumera la lista.
- **Slittamento**: ogni giorno si salva localmente (in IndexedDB, chiave `snapshots`, non sincronizzata) la mappa macro → fine prevista.
  L'etichetta ±Ng confronta il piano di oggi con l'ultimo piano di un giorno precedente, in giorni lavorativi.
- **Correzione delle stime** (`js/core/stats.js`): campione = macro completata con stima originale e ore registrate.
  - Il fattore è effettive/stimate pesato, sulle ultime 20 di ogni gruppo (categoria o tutte), limitato a [0,5; 3]; servono almeno 3 campioni.
  - Con `settings.applyCorrection` attivo, `opzioniPiano(doc)` passa allo scheduler `factor` come funzione macro → fattore della categoria.
  - `app.js` mette le opzioni in `ctx.opzioni`: chi ricalcola un piano (es. anteprima urgenza) deve usarle.
- **Anteprima urgenza** (`js/core/impatto.js`): `anteprimaUrgenza` simula con un'attività fittizia in cima su una copia superficiale del doc, senza modificarlo.
- **Gantt** (`ui/piano.js`): solo visualizzazione di `plan.tasks[id].days`; nessuna modifica dal diagramma.
- **CSV** (`js/core/csv.js`): separatore `;`, virgola decimale, BOM UTF-8, CRLF; i testi che iniziano con `= + - @` sono neutralizzati.
- **Promemoria ore**: se l'ultimo giorno lavorativo prima di oggi non ha registrazioni e non è confermato in `doc.days` (`day-AAAA-MM-GG`, `noWork`), compare un banner.

## Regole sui dati (indispensabili per la sincronizzazione)

- Ogni record ha `id`, `updatedAt` (ms, generato da `now()` in `ids.js`, orologio monotono) e `dev` (id del dispositivo).
  Ogni modifica passa da `touch(rec)`.
- **Mai eliminare record**: si imposta `deletedAt` (tombstone). Le letture usano `live()`.
  I tombstone più vecchi di 180 giorni vengono ripuliti da `merge.pulisci`.
- Il documento è un unico JSON: `{schema, tasks, logs, exceptions, days, settings, conflicts}`.
  `conflicts` è una mappa per id; nella fase 1 era un array, e `normalizeDoc` lo converte.
- `createEmptyDoc` crea le impostazioni con `updatedAt = 0` ("mai toccate"): un dispositivo nuovo non sovrascrive le impostazioni presenti su Dropbox.
- Se cambia la struttura dei dati, aumentare `SCHEMA` in `model.js` e gestire la migrazione in `normalizeDoc`.
  Un dispositivo con versione vecchia rifiuta file con schema più alto (`ErroreDati`) e non li sovrascrive.

## Sincronizzazione (js/core/merge.js, js/sync/)

- **Unione a tre vie** `merge(locale, remoto, base)`, record per record. La base è il documento all'ultima sincronizzazione riuscita (IndexedDB `syncBase`).
  - Cambiato da una parte sola → si prende quella.
  - Cambiato da entrambe → vince l'`updatedAt` più recente (a parità decide `dev`) e la versione perdente va in `doc.conflicts`.
    L'id del conflitto è deterministico, così non si duplica tra dispositivi.
  - Un record **vivo** non sparisce mai perché manca da una parte: solo i tombstone possono essere ripuliti.
  - Ore registrate dopo l'eliminazione concorrente di un'attività la fanno ripristinare, e il caso finisce tra i conflitti.
- `restoreFrom(attuale, backup)`: ritocca tutti i record del backup ed elimina quelli assenti, così il ripristino si propaga a tutti i dispositivi.
- **Motore** (`sync/motore.js`, indipendente dal browser, testato con un Dropbox finto):
  1. scarica il file e la sua revisione;
  2. una volta al giorno copia il file in `/backup/ruolino-AAAA-MM-GG.json`, tenendo gli ultimi 30;
  3. se la revisione è diversa, unisce e chiama `applicaDoc`;
  4. carica in modalità `update` con la revisione attesa. Se la revisione non coincide → `ConflittoRevisione` → si ritenta (al massimo 5 volte).
  - `meta.dirty` e il contatore delle modifiche evitano di perdere modifiche fatte durante un ciclo.
  - Tra la lettura del documento, l'unione e `applicaDoc` non ci devono essere `await`.
- **Dropbox** (`sync/dropbox.js`): API HTTP v2 senza SDK, OAuth PKCE con refresh token (`token_access_type=offline`), app di tipo "App folder".
  - App key in `js/config.js`, oppure inserita in Impostazioni (chiave IndexedDB `appKey`).
  - Indirizzo di ritorno = pagina dell'app senza `index.html`.
- **Quando si sincronizza** (`sync/sincronizzazione.js`): all'avvio, 3 s dopo ogni modifica, quando torna online o in primo piano, ogni 5 minuti, e subito quando la pagina va in background con modifiche pendenti.
- Le modifiche dell'utente passano da `mutate()` o `applicaDoc(doc)`, che avvisano `onMutate`. Quelle della sincronizzazione usano `applicaDoc(doc, {daSync: true})`.

## Architettura

```
store.js (IndexedDB, stato, mutate, onMutate) → app.js (schedule + slittamenti) → viste in js/ui/
                     ↕
sync/sincronizzazione.js → sync/motore.js (merge.js) → sync/dropbox.js
```

- Tutte le modifiche passano da `mutate(doc => ...)` in `store.js`: aggiorna la versione, ridisegna e salva con 300 ms di ritardo.
- Interfaccia scritta con **Preact + htm** (template `html\`...\``, senza JSX).
  Nei campi dell'editor la modifica viene applicata all'evento `change`, cioè all'uscita dal campo.
  Attenzione: htm elimina gli spazi a cavallo di un a capo tra testo e tag, quindi lo spazio va lasciato sulla stessa riga.
- Drag & drop con **SortableJS** (`useSortable` in `ui/util.js`). A fine trascinamento il DOM viene riportato com'era, poi cambiano i dati e Preact ridisegna.
- Negli `setState` basati sullo stato precedente usare **aggiornamenti funzionali**: inserimenti rapidi altrimenti si sovrascrivono.
- I numeri inseriti dall'utente passano da `parseOre` (accetta `2,5`, `2.5`, `1:30`). Tutte le ore sono arrotondate al quarto d'ora (`q()`).
- **Service worker** (`sw.js`): cache-first, con la cache intitolata alla versione.
  Su localhost non viene registrato, tranne con `?sw=1`. Gli aggiornamenti mostrano il banner "Nuova versione → Aggiorna".

## Test

- `tests/*.test.js` usano il mini runner `tests/runner.js`.
  Si eseguono nel browser (`/tests/`) o con Node (`node tests/run-node.mjs`, eseguito anche da GitHub Actions; aggiunge i controlli su `sw.js`).
  I nuovi file di test vanno aggiunti sia in `tests/index.html` sia in `tests/run-node.mjs`.
- Verifica senza Node da questa macchina:
  1. avviare `python -m http.server`;
  2. eseguire Edge headless con `--dump-dom --virtual-time-budget` su `/tests/index.html`.
  - Con `--virtual-time-budget` IndexedDB non completa. Per l'app vera serve tempo reale: CDP (`--remote-debugging-port`) o una pagina che invia i log via POST.
  - Gli eventi puntatore sintetici per SortableJS devono avere `cancelable: true`.
  - Chiudere i processi Edge headless, che restano vivi e tengono bloccato il profilo.
- I test della logica sono obbligatori per scheduler e unione dei dati.
  Casi da coprire: interruzioni, predecessori, limiti giornalieri, giorni non lavorativi, modifiche concorrenti da due dispositivi.
