/* eslint-disable no-console */
'use strict';

/**
 * The GATED entry point for Phase-1 snapshot extraction.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT UNDER scripts/backtest/
 *
 * Nothing in `scripts/backtest/` may require `server/modules/pool` or any
 * `server/services/*`, directly or transitively, and nothing there may read
 * `process.env`. That is asserted by test over the whole tree
 * (`server/test/backtestSourceFetch.test.js`, "the Phase-0 fetch tree never
 * reaches a database") and it is what lets the analysis code be reviewed and
 * unit-tested with no database anywhere near it.
 *
 * But the extraction genuinely needs four pieces of production: the real
 * `generateProjections` (an oracle produced by a copy of the engine would prove
 * nothing), the real `normalizeTeamKey` (the JS twin of
 * `fn_normalize_nfl_team`, so the orientation overlay joins the way production
 * joins), the real global pool (so it can be LOCKED OUT), and a credential.
 * Rather than weaken the isolation test to let the analysis tree import them,
 * the wiring lives here, outside that tree, in a file that does nothing else.
 * Everything worth reviewing about the extraction - the identity assertions,
 * the transaction, the lockout, the overlay arithmetic, the integrity checks,
 * the receipt gate, the manifest - is in
 * `scripts/backtest/extract-snapshot.js` and is covered by pure tests. This
 * file is the plug.
 *
 * WHAT THIS PROCESS LOADS THAT IT DOES NOT USE
 *
 * Requiring `projection.service` transitively loads `scoring.service`, which at
 * module load constructs an axios instance and `modules/tank01Client` (the
 * metered RapidAPI client). **Nothing on the extraction path calls either** -
 * the oracle runs with `weatherService: false`, and no code reached from
 * `generateProjections` touches Tank01. But it is honest to say plainly that
 * the Gate-2 process holds a live HTTP client and a metered API client in
 * memory for the duration of the run. Two consequences worth knowing: this
 * process is NOT the credential-cleared, `--network none` environment the
 * authoritative sweep runs in (that is Phase 5, and it is a different
 * mechanism); and if a future edit added a Tank01 call to any code the
 * extraction reaches, it would spend real quota. Neither is a defect today;
 * both are why the sweep, not the extraction, is the thing that runs offline.
 *
 * CREDENTIALS ARE ENVIRONMENT-ONLY
 *
 * The connection string is read from exactly one variable,
 * `BACKTEST_RO_DATABASE_URL`, and there is NO fallback to `DATABASE_URL` or the
 * `PG*` variables. Two separate reasons:
 *
 *   - a credential on the command line is world-readable (`ps`,
 *     /proc/<pid>/cmdline), lands in shell history, and can be echoed back by
 *     an error message. The plan requires env-only for exactly this;
 *   - falling back to `DATABASE_URL` would let a shell that already holds the
 *     APPLICATION's credentials run this against production as the app role,
 *     which can write. The whole authorization sequence rests on the extraction
 *     running as the temporary read-only role from Gate 1, so the absence of a
 *     fallback is a safety property, not an inconvenience.
 *
 * `--database` and `--role` stay on argv because they are not secrets: they are
 * the accident guard, and the extraction refuses to read a row unless the
 * server reports exactly those two values.
 *
 * AUTHORIZATION. Running this against production is **Gate 2** of three
 * separate approvals and must not happen before Gate 1 (creating the temporary
 * read-only role) has been granted and executed. It never writes to the
 * database: the only statements it issues are two `set_config` calls,
 * `BEGIN ... READ ONLY`, SELECTs, and `ROLLBACK`.
 *
 * Usage (Gate 2, once, by a human):
 *   export BACKTEST_RO_DATABASE_URL='postgres://backtest_ro:...@host/db'
 *   export DB_SSL_CA_PATH=/path/to/supabase-ca.crt
 *   node server/scripts/run-backtest-extraction.js --database endzone_empire --role backtest_ro
 *   # that is the DRY RUN: it reads everything, checks everything, writes
 *   # nothing, and leaves a receipt. Then, and only then:
 *   node server/scripts/run-backtest-extraction.js --database endzone_empire --role backtest_ro --apply
 */

const pg = require('pg');

const extract = require('../../scripts/backtest/extract-snapshot');
const { sslForConnection } = require('../modules/dbSsl');
const globalPool = require('../modules/pool');
const { normalizeTeamKey } = require('../services/projectionFeatures');
const { generateProjections } = require('../services/projection.service');
const model = require('../services/projectionModel');
const { SCORING_RULES } = require('../services/scoring.service');

/** The ONE variable a credential may arrive in. No fallback, by design. */
const CREDENTIAL_ENV_VAR = 'BACKTEST_RO_DATABASE_URL';

/**
 * Read the read-only connection string, or fail with an error that names the
 * variable and says explicitly that the app's own `DATABASE_URL` is not a
 * substitute - because the obvious next thing a blocked operator tries is to
 * point this at whatever credential the shell already has.
 */
function readCredential(env) {
  const value = env[CREDENTIAL_ENV_VAR];
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  const hasAppUrl = !!(env.DATABASE_URL || env.DATABASE_URL_RUNTIME || env.PGUSER || env.PGHOST);
  throw new Error(
    `${CREDENTIAL_ENV_VAR} is not set. The extraction connects only as the temporary read-only `
    + 'role created under Gate 1, and its credential is read from that one environment variable - '
    + 'never from the command line, where `ps` and shell history can read it.'
    + (hasAppUrl
      ? ' DATABASE_URL (or PG*) IS set in this environment and is deliberately NOT used as a '
        + 'fallback: that is the application role, which can write, and running the extraction as '
        + 'it would defeat the entire authorization sequence.'
      : '')
  );
}

/**
 * Refuse a gated run unless the connection this process will ACTUALLY open
 * verifies the server's certificate.
 *
 * The check is on the RESOLVED ssl config, not on whether a CA happens to be
 * configured, because a configured CA is not sufficient:
 * `dbSsl.sslForConnection` returns `false` - TLS off entirely - for a
 * `localhost`/`127.0.0.1` host or when `PGSSLMODE=disable`, and returns
 * `{ rejectUnauthorized: false }` when no CA is set and `NODE_ENV` is not
 * `production`. The realistic way to hit the first case is an operator reaching
 * the production database through an SSH tunnel on localhost: the CA would be
 * present, a CA-presence check would pass, and the connection would carry the
 * whole players and stats history with no verification at all.
 *
 * So the gate demands the one thing that actually means "verified": an ssl
 * object whose `rejectUnauthorized` is exactly `true`.
 *
 * `resolveSsl` is injected so a test can exercise every branch without mutating
 * the real environment; `env` is used ONLY to make the error message say what
 * `NODE_ENV` was, since that is what selects the insecure fallback.
 */
function assertVerifiedTls(connectionString, { resolveSsl = sslForConnection, env = process.env } = {}) {
  let ssl;
  try {
    ssl = resolveSsl(connectionString);
  } catch (err) {
    throw new Error(`refusing to run the extraction: the TLS configuration is invalid (${err.message})`);
  }
  if (ssl && ssl.rejectUnauthorized === true) return true;
  const how = ssl === false || ssl == null
    ? 'TLS is disabled entirely for this connection (a localhost/127.0.0.1 host, or PGSSLMODE=disable)'
    : `TLS is on but unverified (rejectUnauthorized=${JSON.stringify(ssl.rejectUnauthorized)})`;
  throw new Error(
    `refusing to run the extraction: ${how}. This run reads the entire players and stats history, `
    + 'so the connection must verify the server certificate. Set DB_SSL_CA or DB_SSL_CA_PATH to the '
    + 'database CA, connect to the real database host rather than a localhost tunnel, and do not '
    + `set PGSSLMODE=disable. (NODE_ENV is ${JSON.stringify(env.NODE_ENV || null)}; dbSsl falls back `
    + 'to rejectUnauthorized:false whenever it is not "production" and no CA is configured.)'
  );
}

async function main(argv, { env = process.env } = {}) {
  const args = extract.parseArgs(argv);
  if (args.plan) {
    extract.printPlan(extract.extractionPlan());
    return 0;
  }
  for (const [flag, value] of [['--database', args.database], ['--role', args.role]]) {
    if (!value) {
      throw new Error(
        `${flag} is required. It is not a secret - it is the accident guard: the extraction `
        + 'refuses to read a single row unless the server reports exactly the database and role '
        + 'named here.'
      );
    }
  }
  // Both gates fire before a pool is constructed, so a misconfigured run opens
  // no socket at all. The credential comes first because the TLS gate now
  // inspects the ssl config resolved FOR THAT CONNECTION STRING - the host is
  // part of what decides whether the connection would be verified.
  const connectionString = readCredential(env);
  assertVerifiedTls(connectionString, { env });

  // A pool of its OWN, as the Gate-1 temporary read-only role - not the
  // application pool, which authenticates as the app role and can write.
  const extractionPool = new pg.Pool({
    connectionString,
    ssl: sslForConnection(connectionString),
    max: 1,
    application_name: 'endzone-empire-backtest-extraction',
  });

  // half-PPR is the formal primary scoring profile (preregistration 4.3), and
  // `SCORING_RULES` IS the app default half-PPR rule set.
  const rules = SCORING_RULES;

  try {
    return await extract.main(argv, {
      connect: () => extractionPool.connect(),
      // BOTH pools are locked once the transaction client exists: the global
      // one because every service defaults to it, and the extraction one
      // because a second connection would be a second snapshot.
      pool: [extractionPool, globalPool],
      normalizeTeamKey,
      generateProjections,
      rules,
      hashValue: model.scoringHash(rules),
      modelConstants: model.MODEL_CONSTANTS,
      modelVersion: model.MODEL_VERSION,
    });
  } finally {
    await extractionPool.end().catch(() => {});
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = { main, readCredential, assertVerifiedTls, CREDENTIAL_ENV_VAR };
