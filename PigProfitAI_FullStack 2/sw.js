// PigProfit AI service worker. Only static app assets are cached. API responses
// contain private workspace data and MUST always bypass CacheStorage.
const CACHE = 'pigprofit-ai-static-v9';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icon.svg', './icon-192.png', './icon-512.png'
];
const ASSET_URLS = new Set(ASSETS.map(path => new URL(path, self.registration.scope).pathname));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('pigprofit-ai-static-') && key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authentication, snapshots, QR API, or any other API responses.
  // This prevents stale data and cross-account/workspace exposure on shared devices.
  if (url.pathname.startsWith(new URL('./api/', self.registration.scope).pathname)) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell only. Unlisted files remain normal network requests and are not cached.
  if (!ASSET_URLS.has(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response && response.ok) caches.open(CACHE).then(cache => cache.put('./index.html', response.clone()));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached => {
    const network = fetch(request).then(response => {
      if (response && response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    });
    return cached || network;
  }));
});
