# Ruolino

Web app personale per pianificare le attività di lavoro e **prevedere quando ciascuna sarà finita**.
Non è un Gantt da disegnare: è una coda di lavoro con una capacità giornaliera (ore al giorno).
Il simulatore riempie i giorni futuri seguendo le priorità e calcola inizio e fine previsti di ogni attività.

**Stato:** fase 1 (MVP locale). I dati restano nel browser in cui usi l'app.
La sincronizzazione con Dropbox e la pubblicazione su GitHub Pages arrivano con la fase 2.

---

## Avvio in locale (fase 1)

L'app è fatta solo di file statici: non va compilata e non va installato nulla.
Il browser però non carica i moduli JavaScript aprendo `index.html` con un doppio clic (indirizzo `file://`).
Serve un piccolo server web locale, e Python, già presente sul PC, basta.

**Modo semplice:** doppio clic su `avvia.cmd`. Si apre il browser su <http://localhost:8000>.
Per fermare il server chiudi la finestra nera.

**Da terminale:**

```
cd percorso\di\RuolinoDiMarcia
python -m http.server 8000
```

poi apri <http://localhost:8000>.

> I dati vengono salvati nell'archivio del browser (IndexedDB), legati all'indirizzo.
> `localhost:8000` e `127.0.0.1:8000` sono due archivi diversi: usa sempre lo stesso indirizzo.
> Finché non c'è la sincronizzazione, fai spesso **Impostazioni → Esporta JSON**.

## Test automatici

Con il server avviato, apri <http://localhost:8000/tests/>.
La pagina esegue i test di scheduler e modello e mostra `RISULTATO: N passati, 0 falliti`.

Con Node.js (sarà usato da GitHub Actions nella fase 2): `node tests/run-node.mjs`.

## Uso in breve

| Vista | A cosa serve |
|---|---|
| **Oggi** | Cosa fare oggi secondo il piano; ✓ per registrare subito le ore; avvisi (ritardi, blocchi, stime esaurite); prossimi giorni |
| **Coda** | Elenco delle attività in ordine di priorità. Si riordina trascinando la maniglia ⠿. Accanto a ogni voce c'è la fine prevista, in rosso se supera la scadenza. **⚡ Urgenza** inserisce in cima alla coda. L'etichetta **+1g / −1g** è lo slittamento rispetto al piano di ieri |
| **Registro** | A fine giornata: ore lavorate su una o più attività (scrivi `2,5` o `1:30`, oppure usa +½ +1 +2), correzione delle ore residue, spunta "finita" |
| **Impostazioni** | Ore per giorno della settimana, eccezioni per data o periodo (ferie, trasferte, giorni parziali), export/import JSON |

Clic su un'attività: si apre la scheda di dettaglio. Lì ci sono stato, categoria, scadenza, limite ore/giorno,
stima corrente, stima originale e ore rimanenti, sottoattività (riordinabili), predecessori, note e ore registrate.
Le modifiche si salvano da sole quando esci dal campo.

**Promemoria:** se nell'ultimo giorno lavorativo non hai registrato ore, l'app te lo chiede.
Puoi rispondere "Inserisci ore" oppure "Non ho lavorato".

## Ripristino da file JSON

**Impostazioni → Importa JSON** e scegli un file esportato in precedenza.
I dati attuali vengono **sostituiti**, quindi prima esportali per sicurezza.
Nella fase 2 lo stesso procedimento varrà per i backup giornalieri salvati su Dropbox.

## Pubblicazione su GitHub Pages e Dropbox

*Istruzioni passo passo in arrivo con la fase 2.*

## Struttura del progetto

```
index.html            pagina dell'app
avvia.cmd             avvio locale con doppio clic
css/app.css           stile (tema chiaro/scuro automatico, responsive)
js/app.js             avvio, navigazione, calcolo del piano
js/store.js           salvataggio locale (IndexedDB) e stato
js/core/              logica pura, senza interfaccia, coperta dai test
  model.js            modello dati e operazioni
  scheduler.js        simulazione della coda
  order.js            chiavi di ordinamento frazionarie
  dates.js, ids.js    date ISO, id univoci, orologio monotono
js/ui/                viste (Preact + htm)
js/vendor/            librerie incluse nel progetto (Preact+htm, SortableJS)
tests/                test automatici (browser e Node)
```

Librerie usate, entrambe open source con licenza MIT e incluse nel progetto, senza CDN:
[Preact](https://preactjs.com) + [htm](https://github.com/developit/htm) (standalone 3.1.1) e
[SortableJS](https://sortablejs.github.io/Sortable/) 1.15.6.
