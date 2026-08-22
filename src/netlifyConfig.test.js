/**
 * The service worker fetches the API from its own global scope, which the
 * page's CSP governs too (the /* header rule applies to /service-worker.js).
 * Pin that the production API origin is allowed by connect-src, so a CSP
 * tightening cannot silently turn every offline-capable read into a hard
 * network error.
 */
const fs = require('fs');
const path = require('path');

const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');

test("netlify.toml's CSP connect-src allows the production API origin the worker fetches from", () => {
  const apiOrigin = /REACT_APP_API_ORIGIN\s*=\s*"([^"]+)"/.exec(toml)[1];
  const csp = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml)[1];
  const connectSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src '));
  expect(connectSrc).toBeDefined();
  expect(connectSrc.split(/\s+/)).toContain(apiOrigin);
});

test('netlify.toml keeps /service-worker.js uncached (Cache-Control: no-cache) so a new worker is picked up', () => {
  expect(toml).toMatch(/for = "\/service-worker\.js"[\s\S]*?Cache-Control = "no-cache"/);
});
