/*
 * Tilbudsradar service worker – cacher KUN statiske filer (scripts, styles,
 * skrifttyper, ikoner). API-svar, login og sider med data caches aldrig.
 * Navigationer går altid til netværket; kun uden forbindelse vises den
 * senest hentede app-skal.
 */
const VERSION = 'tr-static-v1';
const SHELL = '/offline-shell';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const isStatic = (url) =>
  url.origin === self.location.origin &&
  !url.pathname.startsWith('/api/') &&
  (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || /\.(?:js|css|woff2?|png|svg|webmanifest)$/.test(url.pathname));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return; // aldrig API eller auth

  if (request.mode === 'navigate') {
    // Netværk først. App-skallen (HTML uden data) gemmes kun som reserve til offline.
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok && url.pathname.startsWith('/app')) {
            const cache = await caches.open(VERSION);
            await cache.put(SHELL, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(SHELL);
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (!isStatic(url)) return;
  // Filer med hash i navnet ændrer sig aldrig: cache først.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(VERSION);
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
