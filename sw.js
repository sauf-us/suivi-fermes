// Service worker : garde l'application sur le téléphone pour qu'elle s'ouvre sans réseau.
// Pour publier une nouvelle version : augmentez le numéro ci-dessous.
const VERSION = 'fermes-v1.0.0';
const FICHIERS = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/calc.js', 'js/xlsx.js', 'js/donnees-depart.js', 'js/backend-firebase.js', 'js/backend-demo.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];
const FIREBASE = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(cles => Promise.all(cles.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const local = url.origin === self.location.origin;
  if (!local && !req.url.startsWith(FIREBASE)) return; // la base de données Firebase gère elle-même le hors connexion

  if (local && req.mode === 'navigate') {
    // Page : réseau d'abord (mise à jour), sinon version gardée
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put('index.html', c)); return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  // Fichiers : version gardée tout de suite (rapide sans réseau), mise à jour en arrière-plan
  const reseau = fetch(req).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); }
    return r;
  });
  e.respondWith(caches.match(req, { ignoreSearch: local }).then(trouve => {
    if (trouve) { reseau.catch(() => {}); return trouve; }
    return reseau;
  }));
});
