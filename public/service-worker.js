/* eslint-disable no-restricted-globals */
// Plain hand-rolled service worker — no imports, no workbox. Bump CACHE_NAME
// whenever the precached app-shell assets change so old clients pick up the
// new shell instead of being stuck on a stale cached copy.
const CACHE_NAME = 'endzone-shell-v1';
const API_CACHE_NAME = 'api-cache-v1';
const APP_SHELL = ['/', '/index.html'];

// Only these read-only, non-personalized-mutation GET endpoints are safe to
// serve from cache when offline. Anything else under /api/ (auth, writes,
// per-request mutations) must always hit the network — caching those could
// leak stale/other-user data or silently "succeed" a mutation offline.
const API_ALLOWLIST = [
  /^\/api\/league$/,
  /^\/api\/league\/\d+$/,
  /^\/api\/league\/\d+\/matchups(\/\d+)?$/,
  /^\/api\/team\/roster$/,
  /^\/api\/scoring\/league\/\d+\/standings$/,
  /^\/api\/scoring\/league\/\d+\/power-rankings$/,
  /^\/api\/scoring\/league\/\d+\/recap$/,
  // Pick'em reads (a pick'em-only league's whole game). The settings and week
  // rows are viewer-scoped like /api/team/roster above; login and logout
  // already drop this cache. Writes (PUT settings, PUT week/:n/picks) are
  // not GETs and never reach this list.
  /^\/api\/pickem\/league\/\d+\/settings$/,
  /^\/api\/pickem\/league\/\d+\/standings$/,
  /^\/api\/pickem\/league\/\d+\/week\/\d+$/,
];

function isAllowlistedApiGet(url) {
  return API_ALLOWLIST.some((re) => re.test(url.pathname));
}

// The API may live on its own origin (production: api.endzoneempire.gg while
// this worker is served from endzoneempire.gg). A worker cannot read the
// build's REACT_APP_* values, so the page registers it with `?api=<origin>`
// (src/serviceWorkerRegistration.js) and the /api/ GETs on that origin are
// treated as ours: fetched as the page would (CORS mode, Authorization header
// intact) and cached the same way. A same-origin proxy (dev, deploy previews)
// needs nothing. A missing or malformed value means same-origin only.
const API_ORIGINS = new Set([self.location.origin]);
try {
  const configuredApiOrigin = new URL(self.location.href).searchParams.get('api');
  if (configuredApiOrigin) API_ORIGINS.add(new URL(configuredApiOrigin).origin);
} catch (err) {
  // same-origin only
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/') && API_ORIGINS.has(url.origin);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== API_CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never intercept non-GET requests (posts/puts/deletes must always hit
  // the real network — caching or short-circuiting them would be wrong).
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // API GETs, on this origin or the configured API origin: only the allowlist
  // is served network-first with a cache fallback; every other API GET is left
  // to the browser.
  if (isApiRequest(url)) {
    if (isAllowlistedApiGet(url)) {
      event.respondWith(networkFirstApi(request));
    }
    return;
  }

  // Any other cross-origin request: let the browser handle it normally.
  if (url.origin !== self.location.origin) {
    return;
  }

  // socket.io long-polling: every poll has a unique cache-busting query
  // string, so caching these would never hit and only grow the cache forever.
  if (url.pathname.startsWith('/socket.io/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(cacheFirstStatic(request));
});

// The API answers with `Cache-Control: private, no-store`; that governs the
// HTTP cache, not this Cache API store, which is exactly the point: these
// reads are kept for the offline fallback on this device only, and the app
// drops the store on every session change (login, logout, registration,
// expiry: src/sessionCaches.js). Matching ignores Vary so the CORS response's
// `Vary: Origin` never hides the entry from the same page.
async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    throw err;
  }
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match('/index.html');
    if (shell) return shell;
    throw err;
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = {};
  }
  const { title = 'Endzone Empire', body = '', url } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.openWindow(url));
});
