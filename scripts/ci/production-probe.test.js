const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { checkWeb, checkApi, checkRateLimit, checkSyncFreshness, checkLogin, main } = require('./production-probe');

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

// Answers from the app carry x-render-origin-server, as they do through Render's proxy.
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-render-origin-server': 'Render' },
  });

const TOKEN = 'eyJhbGci.tok-secret.c2ln';

const SITE_HTML = '<!doctype html><div id="react-root"></div><script defer src="/static/js/main.ec039032.js"></script>';

function respondSite(bundleType = 'application/javascript; charset=UTF-8') {
  return (url) => {
    if (url === 'https://endzoneempire.gg/') return new Response(SITE_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response('', { status: 200, headers: { 'content-type': bundleType } });
  };
}

// One livez response per entry, each carrying the next RateLimit-Remaining.
function limiterStub(remainings, { status = 200, limit = '300' } = {}) {
  let n = 0;
  return stub(() => {
    const remaining = remainings[n];
    n += 1;
    return new Response('{"ok":true}', {
      status,
      headers: {
        'content-type': 'application/json',
        'x-render-origin-server': 'Render',
        'RateLimit-Limit': limit,
        'RateLimit-Remaining': String(remaining),
      },
    });
  });
}

// `count` consecutive Remaining values from `from` down, as one window would count.
const falling = (from, count) => Array.from({ length: count }, (_, k) => from - k);

test('web: passes when / names the bundle and the bundle is served as JavaScript', async () => {
  const { fetch, calls } = stub(respondSite());
  const { log } = collect();
  assert.equal(await checkWeb({ fetch, log }), true);
  assert.equal(calls.length, 2);
});

test('web: fetches the bundle from the site origin', async () => {
  const { fetch, calls } = stub(respondSite());
  await checkWeb({ fetch, log: collect().log });
  assert.equal(calls[1].url, 'https://endzoneempire.gg/static/js/main.ec039032.js');
});

test('web: fails when the bundle is answered as text/html', async () => {
  const { fetch } = stub(respondSite('text/html'));
  const { log, lines } = collect();
  assert.equal(await checkWeb({ fetch, log }), false);
  assert.match(lines.join('\n'), /FAIL \/static\/js\/main\.ec039032\.js is served as JavaScript/);
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

test('rate-limit: sends a distinct forged X-Forwarded-For on each of the 30 GETs', async () => {
  const { fetch, calls } = limiterStub(falling(299, 30));
  assert.equal(await checkRateLimit({ fetch, log: collect().log }), true);
  const forwarded = calls.map((call) => call.init.headers['X-Forwarded-For']);
  assert.equal(new Set(forwarded).size, 30);
  assert.equal(forwarded[0], '203.0.113.1');
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

test('rate-limit: fails and names the request when an upward jump lands on something other than 299', async () => {
  const { fetch } = limiterStub([287, 286, 285, 286, ...falling(285, 26)]);
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), false);
  assert.match(lines.at(-1), /FAIL request 4 of 30: .*RateLimit-Remaining 285 -> 286/);
});

test('rate-limit: passes with one window rollover', async () => {
  const { fetch } = limiterStub([...falling(299, 10), ...falling(299, 20)]);
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), true);
  assert.match(lines[10], /window rollover/);
});

test('rate-limit: passes when the rollover repeats 299 (299 -> 299) as the one rollover', async () => {
  const { fetch, calls } = limiterStub([299, 299, ...falling(298, 28)]);
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), true);
  assert.equal(calls.length, 30);
  assert.match(lines[1], /window rollover 1/);
});

test('rate-limit: fails on a second window rollover and names the request', async () => {
  const { fetch } = limiterStub([...falling(299, 10), ...falling(299, 10), ...falling(299, 10)]);
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), false);
  assert.match(lines.at(-1), /FAIL request 21 of 30: .*RateLimit-Remaining 290 -> 299/);
});

test('rate-limit: fails when RateLimit-Limit is not 300', async () => {
  const { fetch } = limiterStub(falling(299, 30), { limit: '299' });
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), false);
  assert.match(lines.at(-1), /FAIL request 1 of 30: .*RateLimit-Limit 299/);
});

test('rate-limit: a 429 from the app is a limiter verdict, not an unanswered request', async () => {
  const { fetch } = limiterStub([0], { status: 429 });
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), false);
  assert.match(lines.at(-1), /FAIL request 1 of 30: HTTP 429/);
  assert.doesNotMatch(lines.at(-1), /not judged/);
});

test('rate-limit: a 502 with no app header is reported as the API not answering, so the limiter was not judged', async () => {
  const { fetch } = stub(() => new Response('Bad Gateway', { status: 502, headers: { 'cf-ray': 'a5e3-ORD' } }));
  const { log, lines } = collect();
  assert.equal(await checkRateLimit({ fetch, log }), false);
  assert.match(
    lines.at(-1),
    /^FAIL request 1 of 30: HTTP 502, .*cf-ray a5e3-ORD, Render's edge answered, not the app, the API did not answer, so the limiter was not judged$/,
  );
});

test('sync-freshness: passes when the route answers 200 with ok true', async () => {
  const { fetch, calls } = stub(() => json({ ok: true, checked: 7, overdue: [] }));
  const { log } = collect();
  assert.equal(await checkSyncFreshness({ fetch, log }), true);
  assert.equal(calls[0].url, 'https://api.endzoneempire.gg/api/health/sync-freshness');
});

test('sync-freshness: on 503 prints each overdue sync with its last ok time and fails', async () => {
  const { fetch } = stub(() => json({
    ok: false,
    checked: 7,
    overdue: [
      { job: 'injuries', lastOkAt: '2026-11-19T10:00:00.000Z', maxAgeMinutes: 120 },
      { job: 'players', lastOkAt: null, maxAgeMinutes: 2880 },
    ],
  }, 503));
  const { log, lines } = collect();
  assert.equal(await checkSyncFreshness({ fetch, log }), false);
  assert.match(lines.join('\n'), /FAIL injuries: last ok 2026-11-19T10:00:00.000Z, limit 120 minutes/);
  assert.match(lines.join('\n'), /FAIL players: last ok never, limit 2880 minutes/);
});

test('sync-freshness: on 404 fails and says the route is not deployed', async () => {
  const { fetch } = stub(() => new Response('Cannot GET /api/health/sync-freshness', { status: 404 }));
  const { log, lines } = collect();
  assert.equal(await checkSyncFreshness({ fetch, log }), false);
  assert.match(lines.join('\n'), /FAIL GET \/api\/health\/sync-freshness answered 404: the route is not deployed/);
});

test('sync-freshness: an unavailable body says the API could not read its sync runs, not that a sync is stale', async () => {
  const { fetch } = stub(() => json({ ok: false, checked: null, overdue: null, unavailable: true }, 503));
  const { log, lines } = collect();
  assert.equal(await checkSyncFreshness({ fetch, log }), false);
  assert.match(lines[0], /answered 503, want 200 with ok true, cf-ray none, the app answered$/);
  assert.match(lines[1], /^FAIL the API could not read its sync runs, so no sync is judged stale$/);
  assert.equal(lines.some((line) => /last ok/.test(line)), false, 'no overdue sync is named');
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

test('login: both variables set to the empty string (an unset GitHub secret) warns once and sends nothing', async () => {
  const { fetch, calls } = stub(() => {
    throw new Error('no request expected');
  });
  const { log, lines } = collect();
  const code = await main(['login'], { fetch, log, env: { SMOKE_USERNAME: '', SMOKE_PASSWORD: '' } });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^::warning::SMOKE_USERNAME and SMOKE_PASSWORD not set/);
});

test('login: logs in, reads the user and the league, and never prints the token or password', async () => {
  const respond = (url) => {
    if (url.endsWith('/api/auth/login')) return json({ token: TOKEN, user: { username: 'smoke' } });
    if (url.endsWith('/api/user')) return json({ username: 'smoke' });
    return json([]);
  };
  const { fetch, calls } = stub(respond);
  const { log, lines } = collect();
  const env = { SMOKE_USERNAME: 'smoke', SMOKE_PASSWORD: 'pw-secret' };
  assert.equal(await checkLogin({ fetch, log, env }), true);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { username: 'smoke', password: 'pw-secret' });
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[2].init.headers.Authorization, `Bearer ${TOKEN}`);
  const printed = lines.join('\n');
  assert.ok(!printed.includes('tok-secret') && !printed.includes('pw-secret'));
});

test("login: passes when the secret's case differs from the stored username", async () => {
  const respond = (url) => {
    if (url.endsWith('/api/auth/login')) return json({ token: TOKEN, user: { username: 'smoke' } });
    if (url.endsWith('/api/user')) return json({ username: 'smoke' });
    return json([]);
  };
  const { fetch } = stub(respond);
  const { log } = collect();
  assert.equal(await checkLogin({ fetch, log, env: { SMOKE_USERNAME: 'Smoke', SMOKE_PASSWORD: 'pw' } }), true);
});

test('login: fails on a token that is not JWT-shaped, and never prints it', async () => {
  const { fetch, calls } = stub(() => json({ token: 'tok-secret', user: { username: 'smoke' } }));
  const { log, lines } = collect();
  assert.equal(await checkLogin({ fetch, log, env: { SMOKE_USERNAME: 'smoke', SMOKE_PASSWORD: 'pw' } }), false);
  assert.equal(calls.length, 1, 'no request carries a malformed token');
  assert.match(lines.join('\n'), /FAIL login response carries a JWT-shaped token/);
  assert.ok(!lines.join('\n').includes('tok-secret'));
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

test('main: a failed fetch names the cause code beside the message', async () => {
  const err = new Error('fetch failed');
  err.cause = { code: 'ECONNRESET' };
  const { fetch } = stub(() => {
    throw err;
  });
  const { log, lines } = collect();
  assert.equal(await main(['api'], { fetch, log }), 1);
  assert.equal(lines.at(-1), 'FAIL api: fetch failed (ECONNRESET)');
});

test('the script exits 0 for login with the SMOKE_* variables removed, and 1 for an unknown check', () => {
  const env = { ...process.env };
  delete env.SMOKE_USERNAME;
  delete env.SMOKE_PASSWORD;
  const script = path.join(__dirname, 'production-probe.js');
  assert.equal(spawnSync(process.execPath, [script, 'login'], { env, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync(process.execPath, [script, 'bogus'], { env, encoding: 'utf8' }).status, 1);
});
