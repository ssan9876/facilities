// Facilities service worker: the app opens and recently viewed lists and tickets stay readable without a
// connection. Everything is network-first, so an online device always gets the current version; the
// cache is only the fallback. Changes made offline are queued by the page (ui.js), not here.
const SHELL = 'facilities-shell-v1';
const DATA = 'facilities-data-v1';
const pages = [/^\/$/, /^\/tickets\/[^/]+$/, /^\/assets\/[^/]+$/, /^\/report$/];
// Read-only API answers worth keeping for offline reading. Never the stream, sign-in or exports.
const readable =
  /^\/api\/(me|data|notifications|orders(\/[^/]+(\/comments)?)?|assets\/[^/]+\/history|checklist-templates|replies|views)$/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(['/', '/styles.css', '/app.js', '/manifest.webmanifest'])));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => ![SHELL, DATA].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
// Sign-out (or a different person signing in) clears the data cache on this device.
self.addEventListener('message', event => {
  if (event.data === 'clear-data') event.waitUntil(caches.delete(DATA));
});

async function networkFirst(request, cacheName, cacheKey = request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(cacheName).then(c => c.put(cacheKey, copy));
    }
    return response;
  } catch (err) {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (request.mode === 'navigate' && pages.some(p => p.test(url.pathname))) {
    // Every page is the same app shell.
    event.respondWith(networkFirst(request, SHELL, '/'));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (readable.test(url.pathname)) event.respondWith(networkFirst(request, DATA));
    return;
  }
  if (url.pathname.startsWith('/auth') || ['/health', '/metrics', '/labels'].includes(url.pathname)) return;
  event.respondWith(networkFirst(request, SHELL));
});
