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

  // Cross-origin requests: let the browser handle them normally.
  if (url.origin !== self.location.origin) {
    return;
  }

  // socket.io long-polling: every poll has a unique cache-busting query
  // string, so caching these would never hit and only grow the cache forever.
  if (url.pathname.startsWith('/socket.io/')) {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (isAllowlistedApiGet(url)) {
      event.respondWith(networkFirstApi(request));
    }
    // Non-allowlisted /api/ GETs: do nothing, let the browser fetch normally.
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(cacheFirstStatic(request));
});

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
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
