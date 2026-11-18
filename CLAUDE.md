# CLAUDE.md — Guida per le sessioni di sviluppo su Ruolino

Ruolino è una PWA personale (tutta in italiano) per pianificare le attività di lavoro dell'utente.
L'utente sviluppa software per robot di verniciatura e fa schemi elettrici.
Ha 20-30 macro-attività e un lavoro frammentato, con interruzioni frequenti.
Usa l'app da un portatile aziendale, spesso offline e senza permesso di installare nulla, e da un telefono Android.

## Regole di lavoro concordate

- Si procede **una fase alla volta**. L'utente prova la fase prima di passare alla successiva.
  - Fase 1 (fatta): MVP locale.
  - Fase 2: sincronizzazione Dropbox, PWA offline, GitHub Pages con guida passo passo, CI.
  - Fase 3: Gantt, anteprima dell'impatto di un'urgenza, statistiche stime e fattore di correzione, archivio con ricerca, export CSV.
- Interfaccia, commenti nel codice e documentazione **in italiano**.
- **Niente build e niente npm.** Solo moduli ES nativi; le librerie stanno in `js/vendor/`.
  Sul PC c'è Python (serve `python -m http.server`), non c'è Node.
- Solo software gratuito e open source. Nessun server da mantenere.

## Modello (NON è un Gantt a giorni di calendario)

Il modello è una coda di lavoro con capacità giornaliera:

- **Attività** (`doc.tasks`): una macro ha `parentId = null`, una sottoattività ha `parentId = id della macro`.
  - Campi: `title, notes, category, status (todo|doing|paused|done), estimate, estimateOriginal, order, deadline, predecessors[], maxPerDay, completedAt`.
  - `estimate` è lo sforzo in ore, non la durata.
  - Ore lavorate = somma delle registrazioni in `doc.logs`: **non c'è un contatore**.
  - Rimanenti = `max(0, estimate − lavorate)`; vale 0 se `done`.
  - Correggere il residuo significa `estimate = lavorate + nuovoResiduo` (`setRemaining`).
  - `estimateOriginal` non cambia: serve alle statistiche della fase 3.
  - Una macro con sottoattività aggrega le loro ore. Il suo `estimate` diventa "ore proprie": lavoro generale non assegnato a una sottoattività.
  - Predecessori e `maxPerDay` esistono solo a livello di macro. Il limite vale per la somma della macro.
- **Capacità**: `doc.settings.weekly[0..6]` (0 = domenica, default 8 h lun-ven).
  Le eccezioni per data stanno in `doc.exceptions` con id deterministico `exc-AAAA-MM-GG`.
- **Scheduler** (`js/core/scheduler.js`, funzione pura `schedule(doc, today, {horizonDays, factor})`):
  - Simula i giorni da oggi in poi, lavorando in quarti d'ora interi.
  - Per oggi la capacità è quella del giorno meno le ore già registrate oggi.
  - Per ogni giorno scorre le macro in ordine di coda e assegna `min(rimanenti, capacità residua, maxPerDay − già assegnato oggi)`. Ripete il giro finché assegna qualcosa: un predecessore finito a metà giornata sblocca subito chi lo aspetta.
  - Dentro una macro le sottoattività avanzano in sequenza (saltando quelle in pausa o completate). Le ore proprie della macro vengono per ultime.
  - Le macro in pausa, quelle in cicli di predecessori e quelle che ne dipendono restano escluse, con un motivo.
  - Restituisce `{ tasks: {id: {start, end, days, plannedHours, state, reason, late, exhausted}}, days: {data: [{taskId, macroId, hours}]} }`.
  - Ricalcolo completo a ogni modifica: costa meno di 1 ms.
- **Ordine della coda**: chiavi frazionarie in `order` (`js/core/order.js`). Spostare un elemento modifica un solo record.
  Se due chiavi sono uguali, decide l'id. Se le chiavi dei vicini non sono valide, `moveTask` rinumera la lista.
- **Slittamento**: ogni giorno si salva localmente (in IndexedDB, chiave `snapshots`, non sincronizzata) la mappa macro → fine prevista.
  L'etichetta ±Ng confronta il piano di oggi con l'ultimo piano di un giorno precedente, in giorni lavorativi.
- **Promemoria ore**: se l'ultimo giorno lavorativo prima di oggi non ha registrazioni e non è confermato in `doc.days` (`day-AAAA-MM-GG`, `noWork`), compare un banner.

## Regole sui dati (indispensabili per la sincronizzazione della fase 2)

- Ogni record ha `id`, `updatedAt` (ms, generato da `now()` in `ids.js`, orologio monotono) e `dev` (id del dispositivo).
  Ogni modifica passa da `touch(rec)`.
- **Mai eliminare record**: si imposta `deletedAt` (tombstone). Le letture usano `live()`.
- Il documento è un unico JSON: `{schema, tasks, logs, exceptions, days, settings, conflicts}`.
- Fase 2, unione dei dati prevista: record per record, vince l'`updatedAt` più recente (a parità decide `dev`).
  La versione perdente va salvata in `doc.conflicts`, visibile e ripristinabile.
  Si usa la revisione del file Dropbox per accorgersi delle modifiche concorrenti.
  Backup giornaliero datato, tenendo gli ultimi 30.
  OAuth PKCE, cartella dell'app, nessun segreto nel codice.

## Architettura

```
store.js (IndexedDB, stato, mutate) → app.js (schedule + slittamenti) → viste in js/ui/
```

- Tutte le modifiche passano da `mutate(doc => ...)` in `store.js`: aggiorna la versione, ridisegna e salva con 300 ms di ritardo.
- Interfaccia scritta con **Preact + htm** (template `html\`...\``, senza JSX).
  Nei campi dell'editor la modifica viene applicata all'evento `change`, cioè all'uscita dal campo.
- Drag & drop con **SortableJS** (`useSortable` in `ui/util.js`). A fine trascinamento il DOM viene riportato com'era, poi cambiano i dati e Preact ridisegna.
- Negli `setState` basati sullo stato precedente usare **aggiornamenti funzionali**: inserimenti rapidi altrimenti si sovrascrivono.
- I numeri inseriti dall'utente passano da `parseOre` (accetta `2,5`, `2.5`, `1:30`). Tutte le ore sono arrotondate al quarto d'ora (`q()`).

## Test

- `tests/*.test.js` usano il mini runner `tests/runner.js`.
  Si eseguono nel browser (`/tests/`) o con Node (`node tests/run-node.mjs`).
  I nuovi file di test vanno aggiunti sia in `tests/index.html` sia in `tests/run-node.mjs`.
- Verifica senza Node da questa macchina:
  1. avviare `python -m http.server`;
  2. eseguire Edge headless con `--dump-dom --virtual-time-budget` su `/tests/index.html`.
  Attenzione: con `--virtual-time-budget` IndexedDB non completa. Per provare l'app vera serve tempo reale, con CDP oppure una pagina che invia i log via POST.
- I test della logica sono obbligatori per scheduler e unione dei dati.
  Casi da coprire: interruzioni, predecessori, limiti giornalieri, giorni non lavorativi, modifiche concorrenti da due dispositivi.
