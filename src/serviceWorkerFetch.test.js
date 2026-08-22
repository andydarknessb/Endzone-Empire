/**
 * The service worker's fetch handler, exercised in a vm sandbox with the
 * production topology: the worker is served from the site origin while the
 * API lives on api.<site> (production sets REACT_APP_API_ORIGIN, and the page
 * registers the worker with `?api=<origin>` so the worker knows it). Same
 * loader idea as serviceWorkerAllowlist.test.js, plus Cache/fetch stubs so
 * the handler can run end to end.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = 'https://endzoneempire.gg';
const API = 'https://api.endzoneempire.gg';

function loadServiceWorker({ scriptUrl = `${SITE}/service-worker.js`, fetchImpl } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');
  const listeners = {};
  // One store per named cache, so the test can tell api-cache-v1 (dropped on
  // every session change) from the shell cache (not). Match options are
  // recorded: ignoreVary is load-bearing against the API's Vary: Origin.
  const stores = new Map();
  const matchOptions = [];
  const storeFor = (name) => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name); };
  const cacheFor = (name) => ({
    match: async (request, options) => { matchOptions.push(options); return storeFor(name).get(typeof request === 'string' ? request : request.url) || undefined; },
    put: async (request, response) => { storeFor(name).set(request.url, response); },
    addAll: async () => {},
    keys: async () => Array.from(storeFor(name).keys()),
  });
  const store = storeFor('api-cache-v1');
  const self = {
    location: { origin: SITE, href: scriptUrl },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve() },
    registration: { showNotification: () => Promise.resolve() },
  };
  const context = vm.createContext({
    self,
    caches: { open: async (name) => cacheFor(name), keys: async () => Array.from(stores.keys()), delete: async () => true },
    fetch: fetchImpl || (() => Promise.reject(new Error('offline'))),
    URL,
    console,
  });
  vm.runInContext(source, context, { filename: 'service-worker.js' });
  return { listeners, store, stores, matchOptions };
}

// A minimal FetchEvent: records whether the worker took the request over.
function fetchEvent(url, { method = 'GET', mode = 'cors' } = {}) {
  const event = { request: { url, method, mode, headers: new Map(), clone() { return this; } }, responded: null };
  event.respondWith = (promise) => {
    event.responded = Promise.resolve(promise);
    event.responded.catch(() => {}); // a rejected fallback is a legitimate outcome, not an unhandled rejection
  };
  return event;
}

const okResponse = (body) => ({ ok: true, status: 200, body, clone() { return this; } });

test('with the API origin configured, an allowlisted cross-origin API GET is served network-first and cached in api-cache-v1', async () => {
  const fetched = [];
  const { listeners, store, stores } = loadServiceWorker({
    scriptUrl: `${SITE}/service-worker.js?api=${encodeURIComponent(API)}`,
    fetchImpl: (request) => { fetched.push(request); return Promise.resolve(okResponse('settings')); },
  });
  const event = fetchEvent(`${API}/api/pickem/league/7/settings`);
  listeners.fetch(event);
  expect(event.responded).not.toBeNull();
  const response = await event.responded;
  expect(response.body).toBe('settings');
  // The page's own Request object goes to the network untouched (CORS mode,
  // Authorization header and credentials ride along).
  expect(fetched).toEqual([event.request]);
  expect(store.has(`${API}/api/pickem/league/7/settings`)).toBe(true);
  expect(stores.has('endzone-shell-v1') ? stores.get('endzone-shell-v1').size : 0).toBe(0);
});

test('with the API origin configured, the cached copy is served when the network is down', async () => {
  let online = true;
  const { listeners, matchOptions } = loadServiceWorker({
    scriptUrl: `${SITE}/service-worker.js?api=${encodeURIComponent(API)}`,
    fetchImpl: () => (online ? Promise.resolve(okResponse('fresh')) : Promise.reject(new Error('offline'))),
  });
  const warm = fetchEvent(`${API}/api/league/7`);
  listeners.fetch(warm);
  await warm.responded;

  online = false;
  const cold = fetchEvent(`${API}/api/league/7`);
  listeners.fetch(cold);
  expect((await cold.responded).body).toBe('fresh');
  // The API answers with Vary: Origin; the fallback match must ignore Vary.
  expect(matchOptions.filter(Boolean).length).toBeGreaterThan(0);
  expect(matchOptions.filter(Boolean).every((o) => o.ignoreVary === true)).toBe(true);
});

test('with the API origin configured, a non-allowlisted API GET on it is left to the browser', () => {
  const { listeners } = loadServiceWorker({ scriptUrl: `${SITE}/service-worker.js?api=${encodeURIComponent(API)}` });
  for (const p of ['/api/user', '/api/notifications', '/api/auth/refresh', '/api/pickem/league/7/week/3/picks']) {
    const event = fetchEvent(`${API}${p}`);
    listeners.fetch(event);
    expect({ p, intercepted: event.responded !== null }).toEqual({ p, intercepted: false });
  }
});

test('an unrelated cross-origin request is never intercepted, configured or not', () => {
  for (const scriptUrl of [`${SITE}/service-worker.js`, `${SITE}/service-worker.js?api=${encodeURIComponent(API)}`]) {
    const { listeners } = loadServiceWorker({ scriptUrl });
    const event = fetchEvent('https://cdn.example.com/api/league/7');
    listeners.fetch(event);
    expect(event.responded).toBeNull();
  }
});

test('without a configured API origin (same-origin proxy: dev, previews) only same-origin API GETs are intercepted, as before', () => {
  const { listeners } = loadServiceWorker({ scriptUrl: `${SITE}/service-worker.js` });
  const cross = fetchEvent(`${API}/api/league/7`);
  listeners.fetch(cross);
  expect(cross.responded).toBeNull();
  const same = fetchEvent(`${SITE}/api/league/7`);
  listeners.fetch(same);
  expect(same.responded).not.toBeNull();
});

test('a malformed api value falls back to same-origin only rather than breaking the worker', () => {
  const { listeners } = loadServiceWorker({ scriptUrl: `${SITE}/service-worker.js?api=not-a-url` });
  const cross = fetchEvent(`${API}/api/league/7`);
  listeners.fetch(cross);
  expect(cross.responded).toBeNull();
  const same = fetchEvent(`${SITE}/api/league/7`);
  listeners.fetch(same);
  expect(same.responded).not.toBeNull();
});

test('a non-/api/ path on the API origin (socket.io polling) is never intercepted', () => {
  const { listeners } = loadServiceWorker({ scriptUrl: `${SITE}/service-worker.js?api=${encodeURIComponent(API)}` });
  const poll = fetchEvent(`${API}/socket.io/?EIO=4&transport=polling&t=abc`);
  listeners.fetch(poll);
  expect(poll.responded).toBeNull();
});

test('non-GET requests to the API origin are never intercepted', () => {
  const { listeners } = loadServiceWorker({ scriptUrl: `${SITE}/service-worker.js?api=${encodeURIComponent(API)}` });
  const put = fetchEvent(`${API}/api/pickem/league/7/settings`, { method: 'PUT' });
  listeners.fetch(put);
  expect(put.responded).toBeNull();
});
