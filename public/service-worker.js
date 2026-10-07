/* eslint-disable no-restricted-globals */
// Plain hand-rolled service worker — no imports, no workbox. Bump CACHE_NAME
// whenever the precached app-shell assets change so old clients pick up the
// new shell instead of being stuck on a stale cached copy.
// v2: drops every v1 shell cache on activate, clearing any static URL that a
// pre-fix worker stored the SPA's index.html under (see cacheFirstStatic).
const CACHE_NAME = 'endzone-shell-v2';
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
  // The viewer's weekly lineup (shared cached read, ADR 0004): viewer-scoped
  // like the roster above. Matched on the pathname alone, so the
  // `?leagueId=&week=` query does not defeat it; the cache keys the full URL.
  /^\/api\/team\/lineup$/,
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
      .then(() =>
        // Older browsers have no navigationPreload; they activate without it,
        // and a rejected enable() never costs the clients.claim() below.
        // Preload is a property of the REGISTRATION, so a rollback of #2072
        // must call navigationPreload.disable() here, not just drop this line.
        self.registration.navigationPreload
          ? self.registration.navigationPreload.enable().catch(() => {})
          : undefined
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
    event.respondWith(networkFirstNavigation(request, event.preloadResponse));
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

// Navigation preload (#2072): the worker's cold start was measured at 1.1 to
// 1.6 s ahead of every page request, and a stalled start left the document
// pending. Preload takes it off the critical path: the browser sends the page
// request in parallel with starting the worker, and the worker answers from
// that response (undefined on older browsers, then it fetches as before).
async function networkFirstNavigation(request, preloadResponse) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = (await preloadResponse) || (await fetch(request));
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

// Never cache HTML for a non-navigation request. After a deploy an old tab can
// ask for a hashed asset that no longer exists, and an SPA host answers it 200
// with index.html; stored here, that page would be served as the script on
// every later load until the user cleared the cache.
function isHtml(response) {
  const type = response.headers && response.headers.get ? response.headers.get('content-type') : null;
  return /text\/html/i.test(type || '');
}

const usable = (response) => response && response.ok && !isHtml(response);

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  let response = await fetch(request);
  // The bad copy can also live in the browser's HTTP cache (the host answered
  // with /static/*'s immutable year-long header), out of this cache's reach.
  // One retry with cache: 'reload' skips and overwrites it.
  if (!usable(response)) {
    response = await fetch(request, { cache: 'reload' });
  }
  if (usable(response)) {
    cache.put(request, response.clone());
  }
  return response;
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
