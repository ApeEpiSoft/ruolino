// =============================================================================
// sw.js — Service worker: rende Ruolino utilizzabile offline e installabile.
//
// Strategia "cache first": all'installazione scarica tutti i file dell'app in
// una cache con il nome della versione; poi li serve dalla cache, anche senza
// rete. Le chiamate a Dropbox (altri domini) non passano di qui.
//
// Per pubblicare una nuova versione: cambiare VERSIONE qui E in js/versione.js
// (il test Node verifica che coincidano e che FILE elenchi tutti i file).
// Il nuovo service worker si installa in background e resta "in attesa":
// l'app mostra "Nuova versione disponibile" e, alla conferma, si ricarica.
// =============================================================================

const VERSIONE = '2.0.2';
const CACHE = 'ruolino-' + VERSIONE;

const FILE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icona.svg',
  'icons/icona-192.png',
  'icons/icona-512.png',
  'icons/icona-maskable-512.png',
  'js/app.js',
  'js/config.js',
  'js/store.js',
  'js/versione.js',
  'js/core/dates.js',
  'js/core/ids.js',
  'js/core/merge.js',
  'js/core/model.js',
  'js/core/order.js',
  'js/core/scheduler.js',
  'js/sync/dropbox.js',
  'js/sync/errori.js',
  'js/sync/motore.js',
  'js/sync/sincronizzazione.js',
  'js/ui/coda.js',
  'js/ui/editor.js',
  'js/ui/impostazioni.js',
  'js/ui/oggi.js',
  'js/ui/registro.js',
  'js/ui/sync.js',
  'js/ui/util.js',
  'js/vendor/preact-htm.js',
  'js/vendor/sortable.esm.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomi) => Promise.all(nomi.filter((n) => n.startsWith('ruolino-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'aggiorna') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Le pagine (anche con ?code=… al ritorno da Dropbox) sono sempre index.html.
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
