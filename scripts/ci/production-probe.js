#!/usr/bin/env node
/**
 * Outside-in probe of production (#3001), run daily by production-probe.yml.
 *
 * One check per argument: `web` (the site serves its bundle), `api` (the API
 * reports ready with a release), `rate-limit` (the general /api limiter counts
 * per caller, so RateLimit-Remaining falls one step per GET), `sync-freshness`
 * (every sync that should run all year has an ok run inside its limit) and
 * `login` (a real account logs in and reaches its data). Each prints one line
 * per assertion and exits 0 on pass, 1 on fail. The hourly holdout-uptime
 * workflow covers the holdout, worker and stats routes; this does not repeat them.
 *
 * Every check takes an injected fetch and log, so the tests drive it with a
 * stub. main is the only reader of argv and env. Only login sends a POST, and
 * it runs only with the SMOKE_* secrets set.
 */

const SITE = 'https://endzoneempire.gg';
const API = 'https://api.endzoneempire.gg';
const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_MAX = '300';

function request(fetch, url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
}

// One assertion per line, so the job log shows which one failed.
function step(log, pass, text) {
  log(`${pass ? 'ok  ' : 'FAIL'} ${text}`);
  return pass;
}

async function checkWeb({ fetch, log }) {
  const page = await request(fetch, `${SITE}/`);
  const html = await page.text();
  const bundle = html.match(/src="(\/static\/js\/main\.[0-9a-f]+\.js)"/)?.[1];
  const results = [
    step(log, page.status === 200, `GET / answered ${page.status}, want 200`),
    step(log, html.includes('id="react-root"'), 'HTML has id="react-root"'),
    step(log, Boolean(bundle), 'HTML references /static/js/main.<hash>.js'),
  ];
  if (bundle) {
    const script = await request(fetch, `${SITE}${bundle}`);
    results.push(
      step(log, script.status === 200, `GET ${bundle} answered ${script.status}, want 200`),
      step(log, /javascript/.test(script.headers.get('content-type') || ''), `${bundle} is served as JavaScript`),
    );
  }
  return results.every(Boolean);
}

async function checkApi({ fetch, log }) {
  const res = await request(fetch, `${API}/api/health/readyz`);
  const body = await res.json().catch(() => ({}));
  return [
    step(log, res.status === 200, `GET /api/health/readyz answered ${res.status}, want 200`),
    step(log, body.ok === true, 'readyz ok is true'),
    step(log, typeof body.release === 'string' && body.release.length > 0, `readyz release is ${body.release}`),
  ].every(Boolean);
}

// Each caller's count falls by one per GET. The 60 second window may roll over
// once (Remaining jumps back up); a second jump, a repeat or a drop by two fails.
// A shared key (the 2026-11-09 proxy-address bug, #2736) shows as a count that
// does not fall in step.
async function checkRateLimit({ fetch, log }) {
  let previous = null;
  let rollovers = 0;
  for (let i = 1; i <= RATE_LIMIT_REQUESTS; i += 1) {
    const res = await request(fetch, `${API}/api/health/livez`);
    const limit = res.headers.get('RateLimit-Limit');
    const raw = res.headers.get('RateLimit-Remaining');
    const remaining = raw === null ? NaN : Number(raw);
    const rolled = previous !== null && remaining > previous;
    if (rolled) rollovers += 1;
    const falls = previous === null || remaining === previous - 1;
    const pass =
      res.status === 200 && limit === RATE_LIMIT_MAX && Number.isInteger(remaining) && (falls || (rolled && rollovers <= 1));
    const seen = previous === null ? `${remaining}` : `${previous} -> ${remaining}`;
    const text = `request ${i} of ${RATE_LIMIT_REQUESTS}: HTTP ${res.status}, RateLimit-Limit ${limit}, RateLimit-Remaining ${seen}`;
    if (!step(log, pass, rolled ? `${text} (window rollover)` : text)) return false;
    previous = remaining;
  }
  return true;
}

// A 503 names each overdue sync with its last ok run. A 404 means this API has
// not shipped the route yet.
async function checkSyncFreshness({ fetch, log }) {
  const res = await request(fetch, `${API}/api/health/sync-freshness`);
  if (res.status === 404) {
    return step(log, false, 'GET /api/health/sync-freshness answered 404: the route is not deployed');
  }
  const body = await res.json().catch(() => ({}));
  const fresh = step(
    log,
    res.status === 200 && body.ok === true,
    `GET /api/health/sync-freshness answered ${res.status}, want 200 with ok true`,
  );
  if (res.status === 503) {
    for (const job of body.overdue || []) {
      log(`FAIL ${job.job}: last ok ${job.lastOkAt ?? 'never'}, limit ${job.maxAgeMinutes} minutes`);
    }
  }
  return fresh;
}

async function checkLogin({ fetch, log, env }) {
  const missing = ['SMOKE_USERNAME', 'SMOKE_PASSWORD'].filter((name) => !env[name]);
  if (missing.length) {
    log(`::warning::${missing.join(' and ')} not set, so the login check is skipped`);
    return true;
  }
  const login = await request(fetch, `${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.SMOKE_USERNAME, password: env.SMOKE_PASSWORD }),
  });
  const session = await login.json().catch(() => ({}));
  const loggedIn = step(
    log,
    login.status === 200 && typeof session.token === 'string',
    `POST /api/auth/login answered ${login.status}, want 200 with a token`,
  );
  if (!loggedIn) return false;

  const auth = { headers: { Authorization: `Bearer ${session.token}` } };
  const me = await request(fetch, `${API}/api/user`, auth);
  const meBody = await me.json().catch(() => ({}));
  const league = await request(fetch, `${API}/api/league`, auth);
  const leagueBody = await league.json().catch(() => null);
  return [
    step(log, me.status === 200 && meBody.username === env.SMOKE_USERNAME, `GET /api/user answered ${me.status} as the smoke account`),
    step(log, league.status === 200 && Array.isArray(leagueBody), `GET /api/league answered ${league.status} with a list`),
  ].every(Boolean);
}

const CHECKS = {
  web: checkWeb,
  api: checkApi,
  'rate-limit': checkRateLimit,
  'sync-freshness': checkSyncFreshness,
  login: checkLogin,
};

async function main(argv = process.argv.slice(2), io = {}) {
  const ctx = { fetch: io.fetch ?? fetch, log: io.log ?? console.log, env: io.env ?? process.env };
  const name = argv[0];
  if (!Object.hasOwn(CHECKS, name)) {
    ctx.log(`usage: production-probe.js <${Object.keys(CHECKS).join('|')}>`);
    return 1;
  }
  try {
    return (await CHECKS[name](ctx)) ? 0 : 1;
  } catch (err) {
    ctx.log(`FAIL ${name}: ${err.message}`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { checkWeb, checkApi, checkRateLimit, checkSyncFreshness, checkLogin, main };
