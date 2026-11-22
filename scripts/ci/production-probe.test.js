const test = require('node:test');
const assert = require('node:assert/strict');
const { checkWeb, checkApi, checkRateLimit, checkLogin, main } = require('./production-probe');

// Stubs answer each request through `respond(url, init)` and record it, so no
// test touches the network. Response is the global one (Node 18+).
function stub(respond) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { fetch, calls };
}

function collect() {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)) };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SITE_HTML = '<!doctype html><div id="react-root"></div><script defer src="/static/js/main.ec039032.js"></script>';

function respondSite(url) {
  if (url === 'https://endzoneempire.gg/') return new Response(SITE_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response('', { status: 200, headers: { 'content-type': 'application/javascript; charset=UTF-8' } });
}

// One livez response per entry, each carrying the next RateLimit-Remaining.
function limiterStub(remainings, { status = 200, limit = '300' } = {}) {
  let n = 0;
  return stub(() => {
    const remaining = remainings[n];
    n += 1;
    return new Response('{"ok":true}', {
      status,
      headers: { 'content-type': 'application/json', 'RateLimit-Limit': limit, 'RateLimit-Remaining': String(remaining) },
    });
  });
}

// `count` consecutive Remaining values from `from` down, as one window would count.
const falling = (from, count) => Array.from({ length: count }, (_, k) => from - k);

test('web: passes when / names the bundle and the bundle is served as JavaScript', async () => {
  const { fetch, calls } = stub(respondSite);
  const { log } = collect();
  assert.equal(await checkWeb({ fetch, log }), true);
  assert.equal(calls.length, 2);
});

test('web: fails when the HTML references no bundle', async () => {
  const { fetch, calls } = stub(() => new Response('<div id="react-root"></div>', { status: 200, headers: { 'content-type': 'text/html' } }));
  const { log, lines } = collect();
  assert.equal(await checkWeb({ fetch, log }), false);
  assert.equal(calls.length, 1, 'no bundle request without a reference');
  assert.match(lines.join('\n'), /FAIL HTML references/);
});

test('api: passes when readyz is ok and names a release', async () => {
  const { fetch } = stub(() => json({ ok: true, db: { ok: true }, redis: { ok: true }, release: 'c1adcf90' }));
  const { log } = collect();
  assert.equal(await checkApi({ fetch, log }), true);
});

test('api: fails when readyz reports ok false', async () => {
  const { fetch } = stub(() => json({ ok: false, release: 'c1adcf90' }, 503));
  const { log, lines } = collect();
  assert.equal(await checkApi({ fetch, log }), false);
  assert.match(lines.join('\n'), /FAIL readyz ok is true/);
});

test('rate-limit: passes when Remaining falls by one on every request', async () => {
  const { fetch, calls } = limiterStub(falling(299, 30));
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), true);
  assert.equal(calls.length, 30);
  assert.equal(lines.length, 30);
});

test('rate-limit: fails and names the request when Remaining repeats', async () => {
  const { fetch, calls } = limiterStub([299, 298, 298, ...falling(297, 27)]);
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), false);
  assert.equal(calls.length, 3, 'stops at the first bad response');
  assert.match(lines.at(-1), /FAIL request 3 of 30: .*RateLimit-Remaining 298 -> 298/);
});

test('rate-limit: fails and names the request when Remaining falls by two', async () => {
  const { fetch } = limiterStub([299, 298, 296, ...falling(295, 27)]);
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), false);
  assert.match(lines.at(-1), /FAIL request 3 of 30: .*RateLimit-Remaining 298 -> 296/);
});

test('rate-limit: passes with one window rollover', async () => {
  const { fetch } = limiterStub([...falling(299, 10), ...falling(299, 20)]);
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), true);
  assert.match(lines[10], /window rollover/);
});

test('rate-limit: fails on a second window rollover and names the request', async () => {
  const { fetch } = limiterStub([...falling(299, 10), ...falling(299, 10), ...falling(299, 10)]);
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), false);
  assert.match(lines.at(-1), /FAIL request 21 of 30: .*RateLimit-Remaining 290 -> 299/);
});

test('rate-limit: fails on a 429 response', async () => {
  const { fetch } = limiterStub([0], { status: 429 });
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), false);
  assert.match(lines.at(-1), /FAIL request 1 of 30: HTTP 429/);
});

test('login: with a SMOKE_* variable missing, warns once, sends nothing and exits 0', async () => {
  const { fetch, calls } = stub(() => {
    throw new Error('no request expected');
  });
  const { log, lines } = collect();
  const code = await main(['login'], { fetch, log, env: { SMOKE_USERNAME: 'smoke' } });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^::warning::SMOKE_PASSWORD not set/);
});

test('login: logs in, reads the user and the league, and never prints the token or password', async () => {
  const respond = (url) => {
    if (url.endsWith('/api/auth/login')) return json({ token: 'tok-secret', user: { username: 'smoke' } });
    if (url.endsWith('/api/user')) return json({ username: 'smoke' });
    return json([]);
  };
  const { fetch, calls } = stub(respond);
  const { log, lines } = collect();
  const env = { SMOKE_USERNAME: 'smoke', SMOKE_PASSWORD: 'pw-secret' };
  assert.equal(await checkLogin({ fetch, log, env }), true);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { username: 'smoke', password: 'pw-secret' });
  assert.equal(calls[1].init.headers.Authorization, 'Bearer tok-secret');
  assert.equal(calls[2].init.headers.Authorization, 'Bearer tok-secret');
  const printed = lines.join('\n');
  assert.ok(!printed.includes('tok-secret') && !printed.includes('pw-secret'));
});

test('login: fails with exit 1 on a 401 from the login POST', async () => {
  const { fetch, calls } = stub(() => json({ error: 'invalid' }, 401));
  const { log, lines } = collect();
  const code = await main(['login'], { fetch, log, env: { SMOKE_USERNAME: 'smoke', SMOKE_PASSWORD: 'wrong' } });
  assert.equal(code, 1);
  assert.equal(calls.length, 1);
  assert.match(lines.join('\n'), /FAIL POST \/api\/auth\/login answered 401/);
});

test('main: a network error fails the named check with exit 1 instead of crashing', async () => {
  const { fetch } = stub(() => {
    throw new Error('socket hang up');
  });
  const { log, lines } = collect();
  assert.equal(await main(['api'], { fetch, log }), 1);
  assert.equal(lines.at(-1), 'FAIL api: socket hang up');
});
