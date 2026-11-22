#!/usr/bin/env node
/**
 * Outside-in probe of production (#3001), run daily by production-probe.yml.
 *
 * One check per argument: `web` (the site serves its bundle), `api` (the API
 * reports ready with a release), `rate-limit` (the general /api limiter counts
 * per caller, so RateLimit-Remaining falls one step per GET) and `login` (a
 * real account logs in and reaches its data). Each prints one line per
 * assertion and exits 0 on pass, 1 on fail. The hourly holdout-uptime workflow
 * covers the holdout, worker and stats routes; this does not repeat them.
 *
 * Every check takes an injected fetch and log, so the tests drive it with a
 * stub. main is the only reader of argv and env. Only login sends a POST, and
 * it runs only with the SMOKE_* secrets set.
 */

const SITE = 'https://endzoneempire.gg';
const API = 'https://api.endzoneempire.gg';
const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_MAX = '300';
// The first request of a fresh window reads the full count back.
const RATE_LIMIT_FIRST = 299;
const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

function request(fetch, url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
}

// Render adds x-render-origin-server to responses that come from the instance (nothing in
// this repo sets it), so its absence means the instance did not answer: Render's edge or Cloudflare did.
const appAnswered = (res) => res.headers.get('x-render-origin-server') !== null;

// Names who answered a non-200, so a proxy 502 is not read as an app verdict.
function answerNote(res) {
  if (res.status === 200) return '';
  return `, cf-ray ${res.headers.get('cf-ray') ?? 'none'}, ${appAnswered(res) ? 'the app answered' : "Render's edge answered, not the app"}`;
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
  // Netlify serves the site, so Render's header does not apply here.
  const pageNote = page.status === 200 ? '' : `, server ${page.headers.get('server') ?? 'none'}`;
  const results = [
    step(log, page.status === 200, `GET / answered ${page.status}, want 200${pageNote}`),
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
    step(log, res.status === 200, `GET /api/health/readyz answered ${res.status}, want 200${answerNote(res)}`),
    step(log, body.ok === true, 'readyz ok is true'),
    step(log, typeof body.release === 'string' && body.release.length > 0, `readyz release is ${body.release}`),
  ].every(Boolean);
}

// Each caller's count falls by one per GET. The 60 second window may roll over
// once: its first request reads 299 again, and any other upward move fails. A
// repeat or a drop by two fails too. A shared key (the 2026-11-09 proxy-address
// bug, #2736) shows as a count that does not fall in step.
async function checkRateLimit({ fetch, log }) {
  let previous = null;
  let rollovers = 0;
  for (let i = 1; i <= RATE_LIMIT_REQUESTS; i += 1) {
    // With the proxy hop count right, the forged entry is ignored and the count still falls by one. If the app ever trusts a client-supplied address, every request gets a fresh counter, every response reads 299, and the check fails at request 3 (the first repeat is the one allowed rollover).
    const res = await request(fetch, `${API}/api/health/livez`, { headers: { 'X-Forwarded-For': `203.0.113.${i}` } });
    const limit = res.headers.get('RateLimit-Limit');
    const raw = res.headers.get('RateLimit-Remaining');
    const remaining = raw === null ? NaN : Number(raw);
    const falls = previous === null || remaining === previous - 1;
    const rolled = !falls && remaining === RATE_LIMIT_FIRST;
    if (rolled) rollovers += 1;
    const pass =
      res.status === 200 && limit === RATE_LIMIT_MAX && Number.isInteger(remaining) && (falls || (rolled && rollovers <= 1));
    const shown = raw ?? 'absent';
    const seen = previous === null ? shown : `${previous} -> ${shown}`;
    const unjudged = res.status !== 200 && !appAnswered(res) ? ', the API did not answer, so the limiter was not judged' : '';
    const text = `request ${i} of ${RATE_LIMIT_REQUESTS}: HTTP ${res.status}, RateLimit-Limit ${limit ?? 'absent'}, RateLimit-Remaining ${seen}`;
    const rollover = rolled ? ` (window rollover ${rollovers})` : '';
    if (!step(log, pass, `${text}${rollover}${answerNote(res)}${unjudged}`)) return false;
    previous = remaining;
  }
  return true;
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
  if (!step(log, login.status === 200, `POST /api/auth/login answered ${login.status}, want 200${answerNote(login)}`)) return false;
  // Checked before any header uses it, and never printed, so a malformed token cannot reach a log line.
  if (!step(log, typeof session.token === 'string' && JWT.test(session.token), 'login response carries a JWT-shaped token')) {
    return false;
  }

  const auth = { headers: { Authorization: `Bearer ${session.token}` } };
  const me = await request(fetch, `${API}/api/user`, auth);
  const meBody = await me.json().catch(() => ({}));
  const league = await request(fetch, `${API}/api/league`, auth);
  const leagueBody = await league.json().catch(() => null);
  // The server matches usernames case-insensitively and trimmed, so compare with the name login returned, not the secret.
  const account = session.user?.username;
  return [
    step(
      log,
      typeof account === 'string' && me.status === 200 && meBody.username === account,
      `GET /api/user answered ${me.status} as the account the login returned${answerNote(me)}`,
    ),
    step(log, league.status === 200 && Array.isArray(leagueBody), `GET /api/league answered ${league.status} with a list${answerNote(league)}`),
  ].every(Boolean);
}

const CHECKS = { web: checkWeb, api: checkApi, 'rate-limit': checkRateLimit, login: checkLogin };

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
    // Node's fetch hides the reason (ECONNRESET, ENOTFOUND) on err.cause.
    const cause = err.cause?.code ?? err.cause?.message;
    ctx.log(`FAIL ${name}: ${err.message}${cause ? ` (${cause})` : ''}`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { checkWeb, checkApi, checkRateLimit, checkLogin, main };
