/**
 * The service worker is a plain script (no imports) that only registers in a
 * production build, so its offline API allowlist has no runtime coverage in
 * jsdom. This evaluates public/service-worker.js in a sandbox with a stub
 * `self` and pins the allowlist decision function directly.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadServiceWorker() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');
  const listeners = {};
  const self = {
    location: { origin: 'https://endzoneempire.gg' },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve() },
    registration: { showNotification: () => Promise.resolve() },
  };
  const context = vm.createContext({ self, caches: {}, fetch: () => Promise.reject(new Error('offline')), URL, console });
  vm.runInContext(source, context, { filename: 'service-worker.js' });
  // isAllowlistedApiGet is a top-level function declaration in the worker, which
  // is what makes it a property of the sandbox context; a const arrow would not be.
  return { isAllowlistedApiGet: context.isAllowlistedApiGet, listeners };
}

const url = (pathAndQuery) => new URL(pathAndQuery, 'https://endzoneempire.gg');

test("the pick'em read endpoints are served network-first with an offline fallback, like the fantasy ones", () => {
  const { isAllowlistedApiGet } = loadServiceWorker();
  for (const p of [
    '/api/pickem/league/7/settings',
    '/api/pickem/league/7/standings',
    '/api/pickem/league/7/standings?season=2026', // the query must not defeat the pathname test
    '/api/pickem/league/7/week/3',
  ]) {
    expect({ p, allowed: isAllowlistedApiGet(url(p)) }).toEqual({ p, allowed: true });
  }
});

test('the fantasy read endpoints stay allowlisted and everything else stays network-only', () => {
  const { isAllowlistedApiGet } = loadServiceWorker();
  for (const p of [
    '/api/league',
    '/api/league/7',
    '/api/league/7/matchups',
    '/api/league/7/matchups/12',
    '/api/team/roster',
    '/api/scoring/league/7/standings',
    '/api/scoring/league/7/power-rankings',
    '/api/scoring/league/7/recap',
  ]) {
    expect({ p, allowed: isAllowlistedApiGet(url(p)) }).toEqual({ p, allowed: true });
  }
  for (const p of [
    '/api/user',
    '/api/auth/refresh',
    '/api/pickem/league/7/week/3/picks', // the picks write target (PUT) must never be cached
    '/api/pickem/league/7/week', // no week number
    '/api/pickem/league/7/standings/extra',
    '/api/pickem/league/x/settings',
    '/api/league/7/transactions',
    '/api/notifications',
  ]) {
    expect({ p, allowed: isAllowlistedApiGet(url(p)) }).toEqual({ p, allowed: false });
  }
});
