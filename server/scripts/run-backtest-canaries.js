/* eslint-disable no-console */
'use strict';

/**
 * The real-probe wiring for the pre-sweep canaries.
 *
 * Same split as `run-backtest-extraction.js`, for the same reason: the DECISION
 * logic - what counts as blocked, what aborts the sweep - lives in
 * `scripts/backtest/lib/guards.js`, where it is pure and unit-tested with fakes
 * and no socket. This file holds the four things that can actually reach out,
 * which is why it lives outside the guarded tree: `scripts/backtest/**` may not
 * require `pg`, `server/modules/pool`, or any `server/services/*`, and may not
 * read `process.env`.
 *
 * The four probes, each of which MUST fail:
 *
 *   - `tcp`: a raw socket to a public address. Catches an environment with
 *     network access that simply has not been asked for one yet.
 *   - `https`: an HTTPS request through the standard library. Catches a proxy
 *     that would answer even when raw TCP appears blocked.
 *   - `globalPool`: a query through `server/modules/pool`, the pool every
 *     service defaults to when no client is passed. This is the realistic leak:
 *     one helper that forgot its `client` argument.
 *   - `freshPgClient`: a brand-new `pg.Client` built and connected here. The
 *     pool can be disarmed in-process; a freshly constructed client cannot be,
 *     so this is the probe that tests the CONTAINER rather than the guards.
 *
 * The authoritative isolation is `docker run --network none`, credential
 * cleared. These probes do not create that isolation - they PROVE it, before
 * the sweep runs, and abort if any route is open.
 *
 * Usage (inside the offline container, before the sweep):
 *   node server/scripts/run-backtest-canaries.js
 * Exit 0 means every route is shut and the sweep may start.
 */

const net = require('net');
const https = require('https');

const { assertOffline, CANARY_NAMES } = require('../../scripts/backtest/lib/guards');

/** How long a probe may hang before it is treated as REACHING something. */
const PROBE_TIMEOUT_MS = 5000;

/**
 * A probe that neither resolves nor rejects is the dangerous case: a hung
 * connection attempt is not proof of blocking, and treating a timeout as
 * "blocked" would let a slow-but-open route pass. So a timeout REJECTS with a
 * distinctive reason and the operator sees which probe could not decide.
 *
 * A blocked route in a `--network none` container fails immediately with
 * EPERM/ENETUNREACH, so a timeout genuinely is anomalous rather than routine.
 */
function withTimeout(promise, { name, timeoutMs = PROBE_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${name} probe did not settle within ${timeoutMs}ms - treating as undecided`));
    }, timeoutMs);
    timer.unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** Raw TCP. Resolving means something accepted the connection. */
function tcpProbe({ host = '1.1.1.1', port = 443 } = {}) {
  return withTimeout(new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.once('connect', () => { socket.destroy(); resolve(`connected to ${host}:${port}`); });
    socket.once('error', (err) => { socket.destroy(); reject(err); });
  }), { name: 'tcp' });
}

/** HTTPS through the standard library. Any response at all is a reach. */
function httpsProbe({ url = 'https://example.com/' } = {}) {
  return withTimeout(new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      res.resume();
      resolve(`HTTP ${res.statusCode}`);
    });
    req.once('error', reject);
  }), { name: 'https' });
}

/**
 * The global pool. Required lazily and inside the probe so that merely LOADING
 * this file does not construct a pg.Pool from the environment - the require
 * itself is part of what is being tested.
 */
function globalPoolProbe() {
  return withTimeout((async () => {
    // eslint-disable-next-line global-require
    const pool = require('../modules/pool');
    const result = await pool.query('SELECT 1 AS "canary"');
    return `pool answered with ${result.rowCount} row(s)`;
  })(), { name: 'globalPool' });
}

/** A freshly constructed client: the probe the in-process guards cannot fake. */
function freshPgClientProbe({ env = process.env } = {}) {
  return withTimeout((async () => {
    // eslint-disable-next-line global-require
    const pg = require('pg');
    const client = new pg.Client({
      connectionString: env.DATABASE_URL || env.BACKTEST_RO_DATABASE_URL,
      host: env.PGHOST,
      port: env.PGPORT ? Number(env.PGPORT) : undefined,
      database: env.PGDATABASE,
      user: env.PGUSER,
      password: env.PGPASSWORD,
      connectionTimeoutMillis: PROBE_TIMEOUT_MS,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return 'a freshly constructed client connected';
    } finally {
      await client.end().catch(() => {});
    }
  })(), { name: 'freshPgClient' });
}

const PROBES = Object.freeze({
  tcp: tcpProbe,
  https: httpsProbe,
  globalPool: globalPoolProbe,
  freshPgClient: freshPgClientProbe,
});

async function main() {
  const report = await assertOffline({ probes: PROBES, names: CANARY_NAMES, label: 'sweep' });
  console.log('canaries: every route is shut');
  for (const result of report.results) console.log(`  ${result.name}: blocked (${result.detail})`);
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error('CANARY FAILURE:', err.message);
      process.exit(1);
    });
}

module.exports = {
  PROBE_TIMEOUT_MS, PROBES, withTimeout, tcpProbe, httpsProbe, globalPoolProbe, freshPgClientProbe, main,
};
