/**
 * Pin that the production API origin is allowed by connect-src, so a CSP
 * tightening cannot silently turn every API read into a hard network error.
 */
const fs = require('fs');
const path = require('path');

const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');

test("netlify.toml's CSP connect-src allows the production API origin the page fetches from", () => {
  const apiOrigin = /REACT_APP_API_ORIGIN\s*=\s*"([^"]+)"/.exec(toml)[1];
  const csp = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml)[1];
  const connectSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src '));
  expect(connectSrc).toBeDefined();
  expect(connectSrc.split(/\s+/)).toContain(apiOrigin);
});

test('netlify.toml keeps /service-worker.js uncached (Cache-Control: no-cache) so a new worker is picked up', () => {
  expect(toml).toMatch(/for = "\/service-worker\.js"[\s\S]*?Cache-Control = "no-cache"/);
});

// #stale-asset: a missing hashed asset must 404, not fall through to the SPA
// rewrite that answers index.html with 200 under the year-long immutable cache
// /static/* carries. Netlify applies redirect rules in order and, unforced,
// only when no file exists, so the /static/* 404 must come before /*.
test('netlify.toml answers a missing /static/* asset 404 before the SPA fallback can serve index.html', () => {
  const rules = toml.split('[[redirects]]').slice(1).map((block) => ({
    from: (/from\s*=\s*"([^"]+)"/.exec(block) || [])[1],
    status: Number((/status\s*=\s*(\d+)/.exec(block) || [])[1]),
    force: /force\s*=\s*true/.test(block),
  }));
  const staticRule = rules.findIndex((r) => r.from === '/static/*');
  const spaRule = rules.findIndex((r) => r.from === '/*');
  expect(staticRule).toBeGreaterThanOrEqual(0);
  expect(rules[staticRule].status).toBe(404);
  expect(rules[staticRule].force).toBe(false);
  expect(staticRule).toBeLessThan(spaRule);
});
