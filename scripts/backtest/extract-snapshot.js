/* eslint-disable no-console */
'use strict';

/**
 * Phase 1 of the reconstructed historical backtest: extract the frozen local
 * snapshot the whole sweep will replay against.
 *
 * WHAT THIS FILE DELIBERATELY CANNOT DO
 *
 * 1. **It cannot fetch.** It imports `lib/verifiedBytes` (fs + crypto) and
 *    never `lib/sourceFetch` (https). Every external byte it reads is an
 *    archived Phase-0 file, verified against the SHA-256 the preregistration
 *    sealed. The plan and preregistration section 17 both require Phase 1 to be
 *    "structurally incapable of refetching an external source"; a require graph
 *    with no transport in it is what makes that a property rather than a
 *    promise, and a test asserts the graph.
 *
 * 2. **It cannot reach a database on its own.** There is no `require` of
 *    `server/modules/pool`, of any `server/services/*`, and no read of
 *    `process.env` anywhere in `scripts/backtest`. The production wiring — the
 *    pool, the real `generateProjections`, the real `normalizeTeamKey` — is
 *    INJECTED by `server/scripts/run-backtest-extraction.js`, which is the one
 *    file allowed to hold both halves and exists only to be run once, under
 *    Gate 2, by a human. Everything a reviewer needs to check about the
 *    extraction (the identity assertions, the transaction, the lockout, the
 *    overlay arithmetic, the integrity checks) lives HERE and is tested with
 *    fakes, with no database anywhere near the test suite.
 *
 * 3. **It cannot write before it has planned.** A dry run performs every read,
 *    every integrity check and every oracle, writes no snapshot, and leaves a
 *    RECEIPT carrying the digest of the configuration it ran under. `--apply`
 *    refuses unless a receipt exists whose digest matches the current run, so
 *    "dry run first" is a precondition rather than a habit.
 *
 * 4. **It cannot see a credential.** There is no `--connection-string` and no
 *    `process.env` read anywhere under `scripts/backtest`. The gated runner
 *    outside this tree reads one dedicated variable and hands back a connected
 *    client.
 *
 * MANIFEST NOTES
 *
 * `extractedAt` (and `dryRunAt`) are wall-clock stamps and are therefore
 * EXCLUDED from any byte-reproducibility comparison. That is safe because the
 * extraction is a one-off gated capture against a live production database: the
 * reproduction CI described in the plan re-runs the SWEEP from the frozen
 * snapshot, and never re-runs this script. What must be reproducible is the
 * snapshot's content, which is pinned per dataset by SHA-256 in
 * `manifest.datasets`.
 *
 * Timestamp columns are stored as ISO 8601 strings; see `jsonSafe` for the
 * rehydration contract Phase 2 must honour.
 *
 * THE READ DISCIPLINE (plan rev 11, "Extraction hardening")
 *
 *   connect -> lock the global pool out -> set both timeouts -> assert database
 *   and role -> BEGIN REPEATABLE READ, READ ONLY -> assert transaction_read_only
 *   -> only now read data.
 *
 * The identity assertions come before any data read so that pointing this at
 * the wrong database, or running it as a role that can write, stops before a
 * single row is captured rather than after. The pool lockout goes in the moment
 * the transaction client exists, because from that instant a read through the
 * global pool would come from a DIFFERENT snapshot than the one being
 * certified — the failure mode is silent and the artifact would look fine.
 *
 * Usage:
 *   node scripts/backtest/extract-snapshot.js --plan
 *       Print the capture plan (SQL signatures, oracle weeks, datasets). No
 *       database, no writes. This is the only mode runnable from this file.
 *   node server/scripts/run-backtest-extraction.js [--apply] ...
 *       The gated run. See that file.
 */

const fs = require('fs');
const path = require('path');

const {
  sha256Hex,
  assertColumns,
  readVerified,
  readProvenanceRecords,
} = require('./lib/verifiedBytes');
const { parseCsvHeader, collectColumns } = require('./lib/csv');
const { SOURCES, BACKTEST_SEASONS, assertSafeSourceFile } = require('./lib/sources');
const { FANTASY_POSITIONS } = require('./lib/mappings');
const {
  SQL_SURFACE,
  SQL_BY_SIGNATURE,
  normalizeSql,
  sqlSignature,
  sqlSurfaceSignatures,
} = require('./lib/sqlSurface');
const store = require('./lib/snapshotStore');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, 'backtest-data');
const DEFAULT_SOURCES_DIR = path.join(DEFAULT_DATA_DIR, 'sources');
const DEFAULT_PROVENANCE_PATH = path.join(DEFAULT_SOURCES_DIR, 'provenance.json');
const DEFAULT_SNAPSHOT_DIR = path.join(DEFAULT_DATA_DIR, 'snapshot');

const STUDY_ID = 'pit-sweep-2024-2025';

/**
 * How many completed seasons back the production weekly-history window reaches.
 * Mirrors `projectionFeatures.HISTORY_SEASONS`; the capture has to span at
 * least as far back as the production query can look, or the snapshot cannot
 * answer it.
 */
const HISTORY_SEASONS = 2;

/** Fixed `now` for every oracle run, so a re-run cannot differ by clock. */
const ORACLE_NOW = new Date('2026-01-01T00:00:00.000Z');

/** Players per position in an oracle cohort. See `selectOracleCohort`. */
const ORACLE_PLAYERS_PER_POSITION = 5;

// ---------------------------------------------------------------------------
// The production read surface: the 8 SQL texts, captured and signed
// ---------------------------------------------------------------------------

/**
 * The surface itself lives in `lib/sqlSurface.js`, because the Phase-2 snapshot
 * client has to SERVE exactly the queries this extraction OBSERVES. Two copies
 * of that table could drift apart, and the failure would be silent: the
 * extraction would capture a query the client cannot answer. Re-exported here
 * unchanged so the extraction API is unchanged.
 */

// ---------------------------------------------------------------------------
// Preregistered oracle weeks (PREREGISTRATION.md section 15)
// ---------------------------------------------------------------------------

/**
 * The six oracle weeks, with the conditional SQL branch each one exists to
 * pin. Both `leagueScan` and `defenseGameCount` are conditional, and the
 * preregistration's table says exactly which weeks fire them; the extraction
 * asserts the branch it OBSERVED matches, so a snapshot cannot quietly be cut
 * with a branch unexercised.
 *
 * 2025 W1 and 2024 W1 are NOT evaluated weeks (the window is weeks 2-18). They
 * exist solely to pin the scan-off / defense-count-off branch that no evaluated
 * week reaches.
 */
const ORACLE_WEEKS = Object.freeze([
  Object.freeze({ season: 2025, week: 1, leagueScan: false, defenseGameCount: false, evaluated: false }),
  Object.freeze({ season: 2025, week: 2, leagueScan: true, defenseGameCount: true, evaluated: true }),
  Object.freeze({ season: 2025, week: 9, leagueScan: true, defenseGameCount: true, evaluated: true }),
  Object.freeze({ season: 2025, week: 18, leagueScan: true, defenseGameCount: true, evaluated: true }),
  Object.freeze({ season: 2024, week: 1, leagueScan: false, defenseGameCount: false, evaluated: false }),
  Object.freeze({ season: 2024, week: 10, leagueScan: true, defenseGameCount: true, evaluated: true }),
]);

/**
 * The closed set of week-position codes, in the preregistration's fixed order
 * (section 3.3). The ORDER BY that produces collation artifact 1 runs over
 * exactly this set, in PostgreSQL's collation, so the offline composition can
 * sort by reconstructed week position without ever consulting today's
 * `players.position`.
 */
const WEEK_POSITION_CODES = Object.freeze([...FANTASY_POSITIONS]);

// ---------------------------------------------------------------------------
// Extraction's own SQL (not the production surface)
// ---------------------------------------------------------------------------

const EXTRACTION_SQL = Object.freeze({
  identity: `SELECT current_database() AS "database", current_user AS "role"`,
  transactionMode: `SELECT current_setting('transaction_read_only') AS "transaction_read_only",
            current_setting('transaction_isolation') AS "transaction_isolation"`,
  // set_config takes the value as a BIND PARAMETER; `SET x = y` cannot, and
  // would mean building SQL by concatenation for no benefit.
  setConfig: `SELECT set_config($1, $2, false) AS "applied"`,
  begin: 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
  rollback: 'ROLLBACK',
  // `external_id` is captured even though the production READ SURFACE does not
  // select it, and it is the one column here that is not part of that surface.
  //
  // It is what links a database player to the pinned sources at all. The
  // crosswalk in `players.csv` maps `gsis_id -> espn_id`, and production joins
  // that to the players table through `external_id`:
  // `idByExternal.get(String(espnId))` (nflverseSync.service.js:224 and :177,
  // again at :629/:548). Without it the reconstruction has no way to say which
  // roster row belongs to which database player, and the whole cohort is
  // unbuildable. Capturing it costs one column and closes that gap; it is NOT
  // added to the 8-query surface, which stays exactly what production issues.
  players: `SELECT "id", "external_id", "name", "position", "nfl_team", "injury_status",
            "injury_detail", "adp",
            fn_normalize_nfl_team("nfl_team") AS "team_key"
     FROM "players" ORDER BY "id"`,
  playerStats: `SELECT "player_id", "season", "week", "stats"
     FROM "player_stats"
     WHERE "season" >= $1 AND "season" <= $2
     ORDER BY "player_id", "season", "week"`,
  playerSeasonStats: `SELECT "player_id", "season", "games_played", "stats", "fantasy_points"
     FROM "player_season_stats"
     WHERE "season" < $1
     ORDER BY "player_id", "season"`,
  nflGames: `SELECT "season", "week", "nfl_team", "opponent", "kickoff_at", "game_key",
            "home_away", "neutral_site", "venue", "roof", "surface",
            "latitude", "longitude", "rest_days",
            fn_normalize_nfl_team("nfl_team") AS "team_key",
            fn_normalize_nfl_team("opponent") AS "opponent_key"
     FROM "nfl_games" WHERE "season" = $1 ORDER BY "week", "nfl_team"`,
  // Collation artifact 1: PostgreSQL's own ordering of the closed week-position
  // code set. Never an Intl.Collator, never a JS comparator.
  positionRank: `SELECT "code", row_number() OVER (ORDER BY "code") AS "rank"
     FROM unnest($1::text[]) AS "t"("code") ORDER BY "code"`,
  // Collation artifact 2: PostgreSQL's own (name, id) ordering over all
  // players. `id` is the documented refinement for names that tie.
  playerNameRank: `SELECT "id", "name", row_number() OVER (ORDER BY "name", "id") AS "rank"
     FROM "players" ORDER BY "name", "id"`,
});

// ---------------------------------------------------------------------------
// Pool lockout
// ---------------------------------------------------------------------------

const LOCKED_OUT = Symbol.for('endzone-empire.backtest.poolLockout');

/**
 * Make the global pool unusable for the rest of the extraction.
 *
 * The whole point of a REPEATABLE READ transaction is that every row certified
 * by the manifest came from ONE database snapshot. A stray `pool.query` — from
 * a service that defaults its client, from a helper somebody forgot took one —
 * reads a DIFFERENT snapshot, and nothing about the resulting artifact would
 * look wrong. So the pool is made to throw, loudly, by name, the moment the
 * transaction client exists.
 *
 * `client.release()` is untouched on purpose: the lockout must not be able to
 * strand the connection it is protecting.
 */
function installPoolLockout(poolLike, { reason = 'the extraction transaction is open' } = {}) {
  // Several pools may need shutting at once (see openReadOnlyTransaction). A
  // list is locked left to right and restored right to left, so a failure
  // partway through still leaves nothing half-locked.
  if (Array.isArray(poolLike)) {
    const installed = [];
    try {
      for (const one of poolLike.filter(Boolean)) installed.push(installPoolLockout(one, { reason }));
    } catch (err) {
      for (const lock of installed.reverse()) lock.restore();
      throw err;
    }
    let restored = false;
    return {
      restore() {
        if (restored) return false;
        for (const lock of [...installed].reverse()) lock.restore();
        restored = true;
        return true;
      },
      get restored() { return restored; },
      get count() { return installed.length; },
    };
  }
  if (!poolLike || typeof poolLike.query !== 'function') {
    throw new Error('installPoolLockout requires a pool-like object with a query method');
  }
  if (poolLike[LOCKED_OUT]) {
    throw new Error('pool lockout is already installed - refusing to nest lockouts');
  }
  const original = { query: poolLike.query, connect: poolLike.connect };
  const deny = (method) => function lockedOut() {
    throw new Error(
      `global pool ${method}() is locked out: ${reason}. Every extraction and oracle read must ` +
      'go through the one REPEATABLE READ, READ ONLY transaction client, or the snapshot mixes ' +
      'two database snapshots and the manifest certifies neither.'
    );
  };
  poolLike.query = deny('query');
  if (typeof poolLike.connect === 'function') poolLike.connect = deny('connect');
  poolLike[LOCKED_OUT] = true;
  let restored = false;
  return {
    restore() {
      if (restored) return false;
      poolLike.query = original.query;
      if (original.connect) poolLike.connect = original.connect;
      delete poolLike[LOCKED_OUT];
      restored = true;
      return true;
    },
    get restored() { return restored; },
    get count() { return 1; },
  };
}

// ---------------------------------------------------------------------------
// The read-only transaction
// ---------------------------------------------------------------------------

function assertPositiveInteger(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 86400000) {
    throw new Error(`${label} must be a positive integer of milliseconds under 86400000 (got ${value})`);
  }
  return n;
}

/**
 * Acquire the ONE transaction client every later read goes through.
 *
 * Returns `{ client, lockout, identity, close }`. `close` rolls the
 * transaction back (it is READ ONLY; there is nothing to commit), releases the
 * client and restores the pool, and is safe to call twice.
 */
async function openReadOnlyTransaction({
  connect,
  pool,
  expectedDatabase,
  expectedRole,
  statementTimeoutMs,
  idleInTransactionSessionTimeoutMs,
}) {
  if (typeof connect !== 'function') throw new Error('openReadOnlyTransaction requires a connect() factory');
  if (!expectedDatabase) throw new Error('refusing to extract without an expected database name');
  if (!expectedRole) throw new Error('refusing to extract without an expected role name');
  // Checked BEFORE connecting, so a misconfigured run never opens a connection
  // it would have to read through an unlocked pool.
  const poolsToLock = (Array.isArray(pool) ? pool : [pool]).filter(Boolean);
  if (poolsToLock.length === 0) {
    throw new Error(
      'refusing to extract without a pool to lock out - the whole point of the one transaction ' +
      'client is that no other path to the database stays open while it is in use'
    );
  }
  const statementTimeout = assertPositiveInteger(statementTimeoutMs, 'statementTimeoutMs');
  const idleTimeout = assertPositiveInteger(
    idleInTransactionSessionTimeoutMs, 'idleInTransactionSessionTimeoutMs'
  );

  const client = await connect();
  if (!client || typeof client.query !== 'function') {
    throw new Error('connect() did not return a client with a query method');
  }
  let lockout = null;
  let begun = false;
  const close = async () => {
    try {
      if (begun) await client.query(EXTRACTION_SQL.rollback);
    } finally {
      if (lockout) lockout.restore();
      if (typeof client.release === 'function') client.release();
      begun = false;
    }
  };

  // Everything after the connect() above runs inside this try, so ANY failure -
  // including the lockout itself refusing because one is already installed -
  // goes through `close()` and hands the connection back. A throw between
  // "acquired a client" and "entered the try" would strand it in the pool.
  try {
    // `pool` may be one pool-like or several. The gated run has TWO that matter:
    // the extraction pool this client came from, and the GLOBAL production pool
    // that `projection.service` closed over at module load and that every
    // service defaults to. Both have to be shut, or the "one snapshot" claim
    // rests on every call site remembering to pass a client.
    lockout = installPoolLockout(poolsToLock);

    // The two set_config calls and the identity SELECT below run in autocommit,
    // before BEGIN, by design: `transaction_read_only` cannot be read until a
    // transaction exists, and the database/role identity must be proved before
    // one is opened. All three are constant SQL with bind parameters, they read
    // no application data, and they write nothing.
    await client.query(EXTRACTION_SQL.setConfig, ['statement_timeout', String(statementTimeout)]);
    await client.query(
      EXTRACTION_SQL.setConfig,
      ['idle_in_transaction_session_timeout', String(idleTimeout)]
    );

    // Identity BEFORE the transaction and before any data read: pointing this
    // at the wrong database, or running it as a role that is not the temporary
    // read role, must stop here rather than after a capture.
    const identityResult = await client.query(EXTRACTION_SQL.identity);
    const identity = (identityResult.rows || [])[0] || {};
    if (identity.database !== expectedDatabase) {
      throw new Error(
        `refusing to extract: connected to database ${JSON.stringify(identity.database)}, ` +
        `expected ${JSON.stringify(expectedDatabase)}`
      );
    }
    if (identity.role !== expectedRole) {
      throw new Error(
        `refusing to extract: connected as role ${JSON.stringify(identity.role)}, ` +
        `expected ${JSON.stringify(expectedRole)} (the temporary read-only role from Gate 1)`
      );
    }

    await client.query(EXTRACTION_SQL.begin);
    begun = true;

    const modeResult = await client.query(EXTRACTION_SQL.transactionMode);
    const mode = (modeResult.rows || [])[0] || {};
    if (mode.transaction_read_only !== 'on') {
      throw new Error(
        `refusing to extract: transaction_read_only is ${JSON.stringify(mode.transaction_read_only)}, ` +
        'expected "on" - a session that can write must not be the one that certifies a snapshot'
      );
    }
    if (String(mode.transaction_isolation || '').toLowerCase() !== 'repeatable read') {
      throw new Error(
        `refusing to extract: transaction_isolation is ${JSON.stringify(mode.transaction_isolation)}, ` +
        'expected "repeatable read" - every captured row must come from one database snapshot'
      );
    }

    return {
      client,
      lockout,
      close,
      identity: {
        database: identity.database,
        role: identity.role,
        transactionReadOnly: mode.transaction_read_only,
        transactionIsolation: mode.transaction_isolation,
        statementTimeoutMs: statementTimeout,
        idleInTransactionSessionTimeoutMs: idleTimeout,
      },
    };
  } catch (err) {
    await close();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The recording client
// ---------------------------------------------------------------------------

/**
 * Wrap the transaction client so every SQL it is asked for is recorded, and
 * (when `surfaceOnly`) refused unless its signature is one of the 8 the
 * production read surface is known to issue.
 *
 * Only ONE object is ever handed to production code, and it holds the
 * transaction client in a closure, so an oracle run physically has no other
 * client to reach for. A test counts the distinct clients used and asserts it
 * is one.
 */
function createRecordingClient(client, { surfaceOnly = false, label = 'query' } = {}) {
  const observed = [];
  const wrapper = {
    async query(text, params) {
      const sql = typeof text === 'string' ? text : (text && text.text);
      const signature = sqlSignature(sql);
      const entry = SQL_BY_SIGNATURE.get(signature);
      if (surfaceOnly && !entry) {
        throw new Error(
          `${label}: production issued SQL the pinned 8-query surface does not contain ` +
          `(signature ${signature}). The snapshot client could not answer it offline, so the ` +
          `snapshot would not reproduce production. First 120 characters: ` +
          `${normalizeSql(sql).slice(0, 120)}`
        );
      }
      observed.push({ signature, name: entry ? entry.name : null });
      return client.query(text, params);
    },
    get observed() { return observed; },
    observedNames() { return observed.map((o) => o.name); },
  };
  return wrapper;
}

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------

/**
 * Run one capture query and record its schema fingerprint.
 *
 * `result.fields` is required, not optional: the fingerprint is how a later
 * reproduction proves the snapshot was cut against the same column types, and
 * a driver that returned no field metadata would silently produce an empty
 * fingerprint that matches everything.
 */
async function capture(client, { name, sql, params = [] }) {
  const result = await client.query(sql, params);
  if (!result || !Array.isArray(result.rows)) {
    throw new Error(`capture ${name}: the client returned no rows array`);
  }
  if (!Array.isArray(result.fields)) {
    throw new Error(
      `capture ${name}: the client returned no field metadata, so no schema fingerprint can be ` +
      'recorded and the snapshot could not prove which columns it was cut from'
    );
  }
  const fields = result.fields.map((f) => ({
    name: String(f.name),
    dataTypeID: f.dataTypeID === undefined || f.dataTypeID === null ? null : Number(f.dataTypeID),
  }));
  return {
    name,
    rows: result.rows,
    rowCount: result.rows.length,
    fields,
    fingerprint: sha256Hex(Buffer.from(store.canonicalJson(fields), 'utf8')),
  };
}

/**
 * Pure: the storable form of a captured value, for canonical hashing and for
 * the NDJSON on disk.
 *
 * **It throws on `undefined` rather than dropping the key.** The obvious
 * implementation, `JSON.parse(JSON.stringify(value))`, silently deletes any key
 * whose value is `undefined` - which means two rows that differ only in whether
 * a key was absent or explicitly undefined would serialize identically and hash
 * identically. `snapshotStore.canonicalJson` already refuses `undefined` for
 * exactly that reason; converting here and refusing there would have meant the
 * conversion quietly repaired what the store was built to catch. An undefined
 * value in a captured row is an ambiguity nobody decided, and the extraction
 * stops on it and names the path to it.
 *
 * **Date columns are stored as ISO 8601 strings.** `kickoff_at` and friends
 * arrive from the driver as `Date` objects, and JSON has no date type, so the
 * storage contract is: every timestamp column is an ISO string in the snapshot.
 * **Phase 2 must rehydrate those columns before serving them**, using the
 * `dataTypeID`s recorded per column in the manifest's `schemaFingerprint`, so
 * that `off` mode hands the engine the same JS types the in-transaction oracle
 * saw. A snapshot client that served the raw string would give
 * `new Date(r.kickoff_at).getTime()` a different value than production's
 * `Date` did, and the "bit-identical to the oracle" claim would fail for a
 * reason that has nothing to do with the model.
 */
function jsonSafe(value, at = 'value') {
  if (value === undefined) {
    throw new Error(
      `${at} is undefined; a captured row may not carry an undefined value, because dropping the ` +
      'key would make two different rows hash identically'
    );
  }
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${at} is ${String(value)}, which JSON cannot represent`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, i) => jsonSafe(entry, `${at}[${i}]`));
  if (Buffer.isBuffer(value)) {
    throw new Error(`${at} is a Buffer; no captured column is expected to be binary`);
  }
  if (type === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = jsonSafe(value[key], `${at}.${key}`);
    return out;
  }
  throw new Error(`${at} is a ${type}, which cannot be stored in the snapshot`);
}

/**
 * Pure: the deterministic oracle cohort for one week.
 *
 * The preregistration fixes the oracle WEEKS; the player set is a Phase-1
 * mechanical choice and is therefore made reproducible from the snapshot
 * itself: for each of the six evaluated positions in the preregistration's
 * fixed order, take the first `perPosition` players in the captured
 * PostgreSQL `(name, id)` rank. No `Math.random`, no clock, no DB order —
 * anyone holding the snapshot can recompute the exact list.
 *
 * Covering all six positions is not decorative: `loadFeatureBundle` derives
 * `scanPositions` from the players it loaded, and a cohort missing a position
 * would leave that position's branch of the league scan unexercised.
 */
function selectOracleCohort({ players, nameRankById, perPosition = ORACLE_PLAYERS_PER_POSITION }) {
  const byPosition = new Map(WEEK_POSITION_CODES.map((code) => [code, []]));
  for (const player of players) {
    const bucket = byPosition.get(player.position);
    if (bucket) bucket.push(player);
  }
  const ids = [];
  const missing = [];
  for (const code of WEEK_POSITION_CODES) {
    const bucket = byPosition.get(code);
    bucket.sort((a, b) => {
      const ra = nameRankById.get(a.id);
      const rb = nameRankById.get(b.id);
      if (ra === undefined || rb === undefined) {
        throw new Error(
          `oracle cohort: player ${ra === undefined ? a.id : b.id} has no captured name rank - ` +
          'the collation artifact and the players capture disagree'
        );
      }
      return ra - rb;
    });
    if (bucket.length === 0) missing.push(code);
    for (const player of bucket.slice(0, perPosition)) ids.push(player.id);
  }
  if (missing.length > 0) {
    throw new Error(
      `oracle cohort: no players at position(s) ${missing.join(', ')} - the league scan branch for ` +
      'those positions would never be exercised by any oracle'
    );
  }
  return ids;
}

/**
 * Run the REAL `generateProjections` for every preregistered oracle week,
 * through the transaction client, with weather off and no cache.
 *
 * `generateProjections` is injected rather than required: see this file's
 * docblock. It is the production function, not a copy — the whole value of an
 * oracle is that it was produced by the code the snapshot must later
 * reproduce. `weatherService: false` is what makes the run offline-safe (the
 * default `null` would `require('./nwsWeather.service')` and reach the
 * network) and is also what makes the (f) subgroup derivation in the
 * preregistration exact.
 */
async function captureOracles({
  client,
  generateProjections,
  players,
  nameRankById,
  rules,
  hashValue,
  modelConstants,
  now = ORACLE_NOW,
  oracleWeeks = ORACLE_WEEKS,
  perPosition = ORACLE_PLAYERS_PER_POSITION,
}) {
  if (typeof generateProjections !== 'function') {
    throw new Error('captureOracles requires the real generateProjections to be injected');
  }
  // Hoisted: every input to the cohort is invariant across weeks, so computing
  // it once makes it obvious that all six oracles run against the SAME player
  // set - which is what makes their player and cohort hashes comparable.
  const playerIds = selectOracleCohort({ players, nameRankById, perPosition });

  const captured = [];
  for (const week of oracleWeeks) {
    const recording = createRecordingClient(client, {
      surfaceOnly: true,
      label: `oracle ${week.season} W${week.week}`,
    });
    const result = await generateProjections({
      season: week.season,
      week: week.week,
      rules,
      playerIds,
      hashValue,
      client: recording,
      now,
      weatherService: false,
      modelConstants,
    });

    const observedNames = new Set(recording.observedNames());
    for (const [name, expected] of [
      ['leagueScan', week.leagueScan],
      ['defenseGameCount', week.defenseGameCount],
    ]) {
      const fired = observedNames.has(name);
      if (fired !== expected) {
        throw new Error(
          `oracle ${week.season} W${week.week}: the ${name} branch ${fired ? 'fired' : 'did not fire'}, ` +
          `but the sealed preregistration (section 15) says it ${expected ? 'must' : 'must not'}. ` +
          'An oracle that does not exercise the branch it exists to pin proves nothing.'
        );
      }
    }
    for (const name of ['playersById', 'priorPlayerStats', 'priorPlayerSeasonStats',
      'targetWeekSchedule', 'historyWindowSchedule', 'byeWeeks']) {
      if (!observedNames.has(name)) {
        throw new Error(
          `oracle ${week.season} W${week.week}: the unconditional query ${name} was never issued - ` +
          'the production read surface is not what this extraction pinned'
        );
      }
    }

    const projections = [...(result.projections || new Map()).entries()]
      .map(([playerId, projection]) => ({
        season: week.season,
        week: week.week,
        player_id: Number(playerId),
        projection: jsonSafe(projection, `oracle ${week.season} W${week.week} player ${playerId}`),
      }))
      .sort((a, b) => a.player_id - b.player_id);

    captured.push({
      season: week.season,
      week: week.week,
      dataset: `oracle_${week.season}_w${week.week}`,
      rows: projections,
      playerIds,
      observedSql: [...observedNames].sort(),
      branches: { leagueScan: week.leagueScan, defenseGameCount: week.defenseGameCount },
      playerHash: sha256Hex(Buffer.from(store.canonicalJson(playerIds), 'utf8')),
      cohortHash: sha256Hex(Buffer.from(store.canonicalJson({
        positions: [...WEEK_POSITION_CODES],
        perPosition,
        playerIds,
      }), 'utf8')),
      outputHash: sha256Hex(Buffer.from(store.canonicalJson(projections), 'utf8')),
      inputCutoff: result.inputCutoff ? new Date(result.inputCutoff).toISOString() : null,
    });
  }
  return captured;
}

// ---------------------------------------------------------------------------
// The orientation overlay
// ---------------------------------------------------------------------------

const GAMES_OVERLAY_COLUMNS = Object.freeze([
  'game_id', 'season', 'game_type', 'week', 'away_team', 'home_team', 'location',
]);

/**
 * Pure: the orientation patch for one or more seasons, built from the pinned
 * games.csv.
 *
 * THIS IS NEVER WRITTEN TO THE DATABASE. Production's 2024/2025 `nfl_games`
 * rows carry `home_away = null`; repairing them in production is a separately
 * deferred authorization. The overlay lives only in the snapshot, and `off`
 * mode reproduces the original nulls because the raw rows are stored
 * separately from this.
 *
 * TEAM CODES. games.csv writes `LA` for the Rams and `WAS` for Washington;
 * `nfl_games` writes Tank01's `LAR` and `WSH`. Both sides are folded through
 * the SAME normalization production uses — `fn_normalize_nfl_team` in SQL, its
 * JS twin `normalizeTeamKey` here, injected rather than copied — which sends
 * `LA` and `LAR` both to `LAR`, and `WAS` and `WSH` both to `WAS`. Keying the
 * overlay on the normalized value is what makes the join exact; matching on the
 * raw spelling would silently miss two teams in every week.
 *
 * NEUTRAL SITES. Every schedule source still designates a nominal home team for
 * a London or Munich game, so both team rows are emitted with their
 * `home_away`, exactly as `nflverseSync.buildScheduleRows` writes them, AND
 * with `neutral_site: true`. Production's `scheduleOrientation` returns null
 * for a neutral row regardless of `home_away`, so the flag is what actually
 * removes the game from the home-field factor; dropping the orientation here
 * instead would make the overlay disagree with the shape production stores.
 * An absent `location` column value leaves the flag null (unknown), never
 * false.
 */
function buildOrientationOverlay({ gamesRows, seasons, normalizeTeamKey }) {
  if (typeof normalizeTeamKey !== 'function') {
    throw new Error('buildOrientationOverlay requires the production normalizeTeamKey to be injected');
  }
  const wanted = new Set(seasons.map(Number));
  const rows = [];
  const gamesBySeason = new Map(seasons.map((s) => [Number(s), 0]));
  const teamRowsBySeason = new Map(seasons.map((s) => [Number(s), 0]));
  let neutralGames = 0;
  const seen = new Set();

  for (const row of gamesRows) {
    const season = Number(row.season);
    if (!wanted.has(season)) continue;
    if (String(row.game_type).trim() !== 'REG') continue;
    const week = Number(row.week);
    if (!Number.isInteger(week) || week < 1 || week > 18) {
      throw new Error(`orientation overlay: game ${row.game_id} has week ${row.week}`);
    }
    const location = String(row.location == null ? '' : row.location).trim();
    const neutralSite = location === '' ? null : location.toLowerCase() === 'neutral';
    if (neutralSite === true) neutralGames++;
    const homeKey = normalizeTeamKey(row.home_team);
    const awayKey = normalizeTeamKey(row.away_team);
    if (!homeKey || !awayKey) {
      throw new Error(
        `orientation overlay: game ${row.game_id} has an unmappable team code ` +
        `(home ${JSON.stringify(row.home_team)}, away ${JSON.stringify(row.away_team)})`
      );
    }
    for (const [teamKey, opponentKey, sourceTeam, homeAway] of [
      [homeKey, awayKey, String(row.home_team), 'home'],
      [awayKey, homeKey, String(row.away_team), 'away'],
    ]) {
      const key = `${season}:${week}:${teamKey}`;
      if (seen.has(key)) {
        throw new Error(
          `orientation overlay: ${teamKey} appears twice in ${season} week ${week} ` +
          '(a team plays at most one regular-season game a week)'
        );
      }
      seen.add(key);
      rows.push({
        season,
        week,
        team_key: teamKey,
        opponent_key: opponentKey,
        source_team: sourceTeam,
        home_away: homeAway,
        neutral_site: neutralSite,
        game_id: String(row.game_id),
      });
      teamRowsBySeason.set(season, teamRowsBySeason.get(season) + 1);
    }
    gamesBySeason.set(season, gamesBySeason.get(season) + 1);
  }

  rows.sort((a, b) => a.season - b.season || a.week - b.week
    || (a.team_key < b.team_key ? -1 : a.team_key > b.team_key ? 1 : 0));

  return {
    rows,
    neutralGames,
    gamesBySeason: Object.fromEntries([...gamesBySeason].map(([k, v]) => [String(k), v])),
    teamRowsBySeason: Object.fromEntries([...teamRowsBySeason].map(([k, v]) => [String(k), v])),
  };
}

// ---------------------------------------------------------------------------
// Fail-closed integrity checks
// ---------------------------------------------------------------------------

/** A well-formed modern GSIS id. Legacy pre-GSIS shapes are excluded by shape. */
const GSIS_ID = /^00-\d{7}$/;
const ESPN_ID = /^\d+$/;

function ok(name, detail, counts = {}) {
  return { name, status: 'passed', detail, counts };
}

/**
 * The gsis -> espn crosswalk must be a partial bijection on well-formed ids.
 * A gsis id with two espn ids (or the reverse) means a cohort player could be
 * mapped two ways depending on iteration order, which is exactly the kind of
 * silent nondeterminism this harness exists to remove.
 */
function checkCrosswalkIntegrity(crosswalkRows) {
  const byGsis = new Map();
  const byEspn = new Map();
  const pairs = new Set();
  let legacyShape = 0;
  let mappable = 0;
  for (const row of crosswalkRows) {
    const gsis = String(row.gsis_id || '').trim();
    const espn = String(row.espn_id || '').trim();
    if (gsis === '') continue;
    if (!GSIS_ID.test(gsis)) { legacyShape++; continue; }
    if (espn === '') continue;
    if (!ESPN_ID.test(espn)) {
      throw new Error(`crosswalk integrity: gsis ${gsis} carries a malformed espn id ${JSON.stringify(espn)}`);
    }
    const pair = `${gsis}|${espn}`;
    if (pairs.has(pair)) {
      throw new Error(`crosswalk integrity: duplicate (gsis, espn) pair ${gsis} -> ${espn}`);
    }
    pairs.add(pair);
    if (byGsis.has(gsis) && byGsis.get(gsis) !== espn) {
      throw new Error(
        `crosswalk integrity: gsis ${gsis} maps to two espn ids (${byGsis.get(gsis)} and ${espn})`
      );
    }
    if (byEspn.has(espn) && byEspn.get(espn) !== gsis) {
      throw new Error(
        `crosswalk integrity: espn ${espn} maps to two gsis ids (${byEspn.get(espn)} and ${gsis})`
      );
    }
    byGsis.set(gsis, espn);
    byEspn.set(espn, gsis);
    mappable++;
  }
  return ok('crosswalk', 'gsis -> espn is one-to-one on well-formed ids', {
    rows: crosswalkRows.length, mappable, legacyShape,
  });
}

/** Database player ids must be unique positive integers. */
function checkPlayerIds(dbPlayers) {
  const seen = new Set();
  for (const player of dbPlayers) {
    const id = Number(player.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`malformed id: players row carries id ${JSON.stringify(player.id)}`);
    }
    if (seen.has(id)) throw new Error(`malformed id: duplicate players row for id ${id}`);
    seen.add(id);
  }
  return ok('playerIds', 'every captured players row has a unique positive integer id', {
    players: dbPlayers.length,
  });
}

/** No duplicate roster player-week once blank gsis ids are excluded. */
function checkRosterPlayerWeeks(rosterRows, { label }) {
  const seen = new Set();
  let blank = 0;
  for (const row of rosterRows) {
    const gsis = String(row.gsis_id || '').trim();
    if (gsis === '') { blank++; continue; }
    const key = `${row.season}|${row.week}|${String(row.game_type).trim()}|${gsis}`;
    if (seen.has(key)) {
      throw new Error(`${label}: duplicate roster player-week ${key}`);
    }
    seen.add(key);
  }
  return ok(`rosterPlayerWeeks:${label}`, 'no duplicate roster player-week', {
    rows: rosterRows.length, blankGsisId: blank,
  });
}

/**
 * Duplicate injury player-weeks are EXPECTED in 2024 (exactly two, both
 * successive revisions of the same report) and absent in 2025. What must never
 * happen is a duplicate nobody can resolve: preregistration section 3.4 fails
 * closed when `date_modified` is absent or when two rows tie on it exactly.
 */
function checkInjuryPlayerWeeks(injuryRows, { label, hasDateModified }) {
  const groups = new Map();
  for (const row of injuryRows) {
    const gsis = String(row.gsis_id || '').trim();
    if (gsis === '') continue;
    const key = `${row.season}|${row.week}|${String(row.game_type).trim()}|${gsis}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const duplicates = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  if (duplicates.length > 0 && !hasDateModified) {
    throw new Error(
      `${label}: ${duplicates.length} duplicate injury player-week(s) and no date_modified column - ` +
      'the preregistered resolution rule (section 3.4) cannot be applied, so the run fails closed'
    );
  }
  for (const [key, rows] of duplicates) {
    const stamps = rows.map((r) => String(r.date_modified || '').trim());
    if (stamps.some((s) => s === '')) {
      throw new Error(`${label}: duplicate injury player-week ${key} has a blank date_modified`);
    }
    if (new Set(stamps).size !== stamps.length) {
      throw new Error(
        `${label}: duplicate injury player-week ${key} ties exactly on date_modified - ` +
        'section 3.4 fails closed rather than picking one'
      );
    }
  }
  return ok(`injuryPlayerWeeks:${label}`, 'every duplicate injury player-week is resolvable', {
    rows: injuryRows.length, duplicateKeys: duplicates.length, hasDateModified: hasDateModified ? 1 : 0,
  });
}

/**
 * Every team that plays in a captured season must have exactly one DEF
 * pseudo-player in the database. A missing one means a whole team-week of DEF
 * outcomes cannot be attributed; a duplicate means it could be attributed two
 * ways.
 */
function checkDefenseMappings({ dbPlayers, teamKeys, normalizeTeamKey }) {
  if (typeof normalizeTeamKey !== 'function') {
    throw new Error('checkDefenseMappings requires the production normalizeTeamKey to be injected');
  }
  const byTeam = new Map();
  for (const player of dbPlayers) {
    if (player.position !== 'DEF') continue;
    const key = player.team_key || normalizeTeamKey(player.nfl_team);
    if (!key) {
      throw new Error(`DEF mapping: player ${player.id} (${player.name}) has no resolvable team`);
    }
    if (byTeam.has(key)) {
      throw new Error(
        `DEF mapping: two DEF players map to ${key} (${byTeam.get(key)} and ${player.id})`
      );
    }
    byTeam.set(key, player.id);
  }
  const missing = [...new Set(teamKeys)].filter((key) => !byTeam.has(key)).sort();
  if (missing.length > 0) {
    throw new Error(`DEF mapping: no DEF player for team(s) ${missing.join(', ')}`);
  }
  return ok('defenseMappings', 'every scheduled team has exactly one DEF player', {
    teams: new Set(teamKeys).size, defPlayers: byTeam.size,
  });
}

/**
 * A source that lost a column a preregistered rule depends on stops the run.
 * Same contract the fetcher applied on write, re-applied on read, because a
 * file can be replaced on disk after it was pinned.
 */
function checkSourceColumns(headersByName) {
  for (const source of SOURCES) {
    const header = headersByName.get(source.name);
    if (!header) throw new Error(`source columns: ${source.name} was never read`);
    assertColumns({ header, requiredColumns: source.requiredColumns, label: source.name });
  }
  return ok('sourceColumns', 'every pinned source still carries every required column', {
    sources: SOURCES.length,
  });
}

/**
 * Every schedule season the reconstruction could actually USE must have an
 * orientation overlay.
 *
 * The two windows are deliberately different sizes: `nfl_games` is captured
 * over the whole history window (2022-2025), because `historyWindowSchedule`
 * reads `season >= target - 2`, while the orientation overlay is built only for
 * the target seasons, because those are the seasons the study evaluates. That
 * gap is safe ONLY while the extra seasons carry no weekly stat rows: with no
 * stat rows, `buildPriorGames` never looks up a 2022 team-week, so the missing
 * patch is unobservable.
 *
 * The moment production holds both a 2022 schedule row and a 2022 stat row, the
 * gap stops being safe: reconstructed mode would serve that schedule row with
 * production's stored orientation, which is null, while patching its 2024 and
 * 2025 neighbours - a silent, one-sided divergence that would surface only in
 * the homeAway-on arms. So the condition is asserted rather than assumed, and
 * it fails closed with a named remedy.
 */
function checkOverlayWindowCoverage({ scheduleSeasons, overlaySeasons, weeklyRowsBySeason }) {
  const covered = new Set(overlaySeasons.map(Number));
  const uncovered = scheduleSeasons.map(Number).filter((s) => !covered.has(s));
  const offenders = uncovered.filter((s) => Number(weeklyRowsBySeason[String(s)] || 0) > 0);
  if (offenders.length > 0) {
    throw new Error(
      `season(s) ${offenders.join(', ')} have weekly stat rows AND schedule rows but no orientation ` +
      'overlay: the overlay is built for the target seasons only, which is safe only while the ' +
      'earlier history-window seasons are empty of stats. They are not. Widen the overlay to cover ' +
      'the whole schedule window, or the reconstructed mode would serve those weeks with ' +
      "production's null orientation while patching the target seasons."
    );
  }
  return ok('overlayWindowCoverage',
    'every schedule season without an overlay is empty of weekly stat rows', {
      scheduleSeasons: scheduleSeasons.length,
      overlaySeasons: overlaySeasons.length,
      uncoveredAndEmpty: uncovered.length,
    });
}

/** A target season with no weekly stat rows means the capture is broken. */
function checkTargetSeasonsPopulated(countsBySeason, seasons) {
  const empty = seasons.filter((s) => !(countsBySeason[String(s)] > 0));
  if (empty.length > 0) {
    throw new Error(
      `captured no player_stats rows for target season(s) ${empty.join(', ')} - ` +
      'a target season captured as empty is a broken capture, not a finding'
    );
  }
  return ok('targetSeasonsPopulated', 'both target seasons have weekly stat rows', countsBySeason);
}

/** No captured database row may be at or after the quarantine boundary. */
function checkCaptureQuarantine(captures) {
  for (const { name, rows } of captures) {
    for (const row of rows) {
      const season = store.seasonOf(row);
      if (season !== null && season >= store.QUARANTINE_FROM_SEASON) {
        throw new Error(
          `capture ${name}: a season ${season} row reached the extraction, at or after the ` +
          `quarantine boundary ${store.QUARANTINE_FROM_SEASON}`
        );
      }
    }
  }
  return ok('captureQuarantine', 'no captured database row is at or after 2026', {
    captures: captures.length,
  });
}

// ---------------------------------------------------------------------------
// Archived source access (hash-verified, never fetched)
// ---------------------------------------------------------------------------

/**
 * Read one archived Phase-0 source, verified against its pinned SHA-256.
 *
 * `sourcesDir` is a directory this tooling owns and `source.file` is a literal
 * from the frozen registry, re-proved to be a bare lowercase `.csv` basename by
 * `assertSafeSourceFile` before the join - it cannot introduce a separator, a
 * traversal segment, or an absolute path. Do not relax that validator without
 * revisiting this line.
 */
function makeArchivedSourceReader({ sourcesDir, provenancePath }) {
  const provenance = readProvenanceRecords(provenancePath);
  return function readSource(source) {
    const record = provenance.get(source.name);
    if (!record) {
      throw new Error(`${source.name}: no Phase-0 provenance record, so no pinned hash to verify against`);
    }
    const file = assertSafeSourceFile(source.file, { label: source.name });
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const full = path.join(sourcesDir, file);
    return readVerified(full, record.sha256, { label: source.name }).toString('utf8');
  };
}

// ---------------------------------------------------------------------------
// The extraction
// ---------------------------------------------------------------------------

function sourcesOfKind(kind) {
  return SOURCES.filter((s) => s.kind === kind);
}

/**
 * Everything the extraction would do, as data. Printable without a database,
 * which is what `--plan` shows and what the manifest records.
 */
function extractionPlan({ seasons = BACKTEST_SEASONS } = {}) {
  const firstSeason = Math.min(...seasons.map(Number)) - HISTORY_SEASONS;
  const lastSeason = Math.max(...seasons.map(Number));
  const historyWindow = Array.from(
    { length: lastSeason - firstSeason + 1 }, (unused, i) => firstSeason + i
  );
  return {
    studyId: STUDY_ID,
    seasons: [...seasons].map(Number).sort((a, b) => a - b),
    quarantineFromSeason: store.QUARANTINE_FROM_SEASON,
    weeklyStatSeasons: historyWindow,
    // `nfl_games` is captured over the SAME window as the weekly stats, not
    // just the target seasons.
    //
    // `historyWindowSchedule` (projectionFeatures.js:478) reads
    // `WHERE "season" >= $1` with `$1 = season - HISTORY_SEASONS`, so a target
    // of 2024 legitimately reaches 2022 and 2023 schedule rows, and those rows
    // feed `opponentByTeamWeek` - which is what resolves a prior-season stat
    // line to an opponent and an orientation. Capturing only 2024 and 2025
    // would have left the snapshot answering that query with a strictly smaller
    // set than the in-transaction oracle saw. The divergence would have been
    // invisible: it only bites the homeAway-on arms on the 2024 safety season,
    // and no check would have failed.
    scheduleSeasons: historyWindow,
    seasonStatsBelow: lastSeason,
    sqlSurface: sqlSurfaceSignatures(),
    oracleWeeks: ORACLE_WEEKS.map((w) => ({ ...w })),
    weekPositionCodes: [...WEEK_POSITION_CODES],
    datasets: [
      { dataset: 'players', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: false },
      { dataset: 'player_stats', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: true },
      { dataset: 'player_season_stats', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: true },
      ...historyWindow.map((season) => ({
        dataset: `nfl_games_${season}`,
        store: store.STORES.EVALUATION,
        path: store.PATHS.FEATURE,
        seasonScoped: true,
      })),
      { dataset: 'orientation_overlay', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: true },
      { dataset: 'position_rank', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: false },
      { dataset: 'player_name_rank', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: false },
      // Provenance, not a feature: this dataset keeps games.csv's 2026 rows, and
      // the provenance path is what makes it unreachable from a feature loader.
      { dataset: 'games_csv', store: store.STORES.RAW, path: store.PATHS.PROVENANCE, seasonScoped: true },
      ...ORACLE_WEEKS.map((w) => ({
        dataset: `oracle_${w.season}_w${w.week}`,
        store: store.STORES.EVALUATION,
        path: store.PATHS.OUTCOME,
        seasonScoped: true,
      })),
    ],
    integrityChecks: [
      'crosswalk', 'playerIds', 'rosterPlayerWeeks', 'injuryPlayerWeeks',
      'defenseMappings', 'sourceColumns', 'targetSeasonsPopulated', 'captureQuarantine',
      'overlayWindowCoverage',
    ],
    sources: SOURCES.map((s) => ({ name: s.name, file: s.file })),
  };
}

// ---------------------------------------------------------------------------
// Dry-run-first, enforced by a receipt
// ---------------------------------------------------------------------------

/**
 * Pure: the digest of everything that determines what this run will capture.
 *
 * Deliberately covers CONFIGURATION, not results: the archived source hashes,
 * the target and history-window seasons, BOTH SQL SURFACES, the oracle
 * settings, and the dataset inventory. Two invocations that would capture the
 * same thing produce the same digest; change a source byte, a season, a SQL
 * text, or the oracle cohort rule and it moves.
 *
 * BOTH surfaces, and the distinction matters. `plan.sqlSurface` is the 8
 * queries the client SERVES; `EXTRACTION_SQL` is what the extraction actually
 * RUNS to fill the snapshot. Only the first used to be an input, so a change to
 * a capture query - adding `external_id` to the players capture, say - left the
 * digest untouched and a receipt written beforehand would still have authorized
 * the apply afterwards. That is not hypothetical: this study made exactly that
 * change. A digest that promises "a SQL text moves it" has to mean both.
 *
 * It DOES cover the database name and role. Those are static configuration -
 * the operator names them on the command line and the extraction refuses to
 * read a row unless the server reports exactly them - so including them costs
 * nothing in false alarms and closes a real hole: without them, a receipt from
 * a dry run against staging would authorize an apply against production.
 *
 * It deliberately does NOT cover row counts. A dry run and the apply that
 * follows it are two separate transactions against a live database, so a row
 * count can legitimately differ between them; requiring those to match would
 * make the gate fire on ordinary traffic and train an operator to bypass it.
 *
 * **No credential is an input to this digest and none is recorded in the
 * receipt.** The connection string never reaches this module at all - the
 * database NAME and the ROLE name are not secrets, and they are what the
 * identity assertion already proved the server reported.
 */
function planDigest({
  plan, sourceHashes, oracleSettings, identity = null, extractionSql = EXTRACTION_SQL,
}) {
  return sha256Hex(Buffer.from(store.canonicalJson({
    studyId: plan.studyId,
    seasons: plan.seasons,
    weeklyStatSeasons: plan.weeklyStatSeasons,
    scheduleSeasons: plan.scheduleSeasons,
    seasonStatsBelow: plan.seasonStatsBelow,
    quarantineFromSeason: plan.quarantineFromSeason,
    sqlSurface: plan.sqlSurface.map((s) => ({ name: s.name, signature: s.signature })),
    // The queries the extraction RUNS, not just the ones the client serves.
    extractionSql: Object.entries(extractionSql)
      .map(([name, sql]) => ({ name, signature: sqlSignature(sql) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    datasets: plan.datasets,
    integrityChecks: plan.integrityChecks,
    weekPositionCodes: plan.weekPositionCodes,
    sourceHashes,
    oracleSettings,
    database: (identity && identity.database) || null,
    role: (identity && identity.role) || null,
  }), 'utf8'));
}

/**
 * Refuse to write unless a dry run of THIS run already happened.
 *
 * The plan requires dry-run-first, and a bare `--apply` flag does not deliver
 * it: an operator can type it on the first invocation and the sequence the plan
 * asks for never happens. The receipt makes the ordering a precondition instead
 * of a habit. It is not a security control - anyone who can run the extraction
 * can delete the file - it is a control against the realistic failure, which is
 * a tired operator running the wrong command against production once.
 */
function assertDryRunReceipt({ outDir, digest }) {
  const file = store.receiptFile(outDir);
  if (!fs.existsSync(file)) {
    throw new Error(
      `refusing to --apply: no dry-run receipt at ${file}. Run the extraction WITHOUT --apply ` +
      'first; it performs every read, every integrity check and every oracle, writes nothing, and ' +
      'leaves the receipt that authorizes the write.'
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`refusing to --apply: the dry-run receipt at ${file} is unreadable (${err.message})`);
  }
  if (receipt.planDigest !== digest) {
    throw new Error(
      `refusing to --apply: the dry-run receipt was written for plan digest ${receipt.planDigest}, ` +
      `but this run's plan digest is ${digest}. Something that determines what gets captured - a ` +
      'pinned source, a season, a SQL text, the oracle settings, or THE DATABASE AND ROLE THIS RUN ' +
      `IS POINTED AT (receipt: ${JSON.stringify(receipt.database || null)} as ` +
      `${JSON.stringify(receipt.role || null)}) - changed since the dry run. Re-run the dry run ` +
      'against the database you intend to write from, and read what it reports before writing.'
    );
  }
  return receipt;
}

/**
 * The extraction proper. Takes an already-open transaction client and the
 * injected production functions; performs every read, check and overlay build;
 * writes only when `apply` is true AND a matching dry-run receipt exists.
 */
async function runExtraction({
  client,
  identity,
  normalizeTeamKey,
  generateProjections,
  rules,
  hashValue,
  modelConstants,
  modelVersion = null,
  readSource,
  outDir,
  apply = false,
  seasons = BACKTEST_SEASONS,
  now = ORACLE_NOW,
  log = () => {},
}) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('runExtraction requires the transaction client');
  }
  if (typeof readSource !== 'function') {
    throw new Error('runExtraction requires an archived-source reader');
  }
  const plan = extractionPlan({ seasons });
  const targetSeasons = plan.seasons;
  const firstWeeklySeason = plan.weeklyStatSeasons[0];
  const lastWeeklySeason = plan.weeklyStatSeasons[plan.weeklyStatSeasons.length - 1];

  // --- archived sources -----------------------------------------------------
  const headersByName = new Map();
  const sourceText = new Map();
  for (const source of SOURCES) {
    const text = readSource(source);
    sourceText.set(source.name, text);
    headersByName.set(source.name, parseCsvHeader(text));
  }
  const checks = [checkSourceColumns(headersByName)];

  // --- database captures ----------------------------------------------------
  const captures = [];
  const push = async (spec) => {
    const result = await capture(client, spec);
    log(`  captured ${result.name}: ${result.rowCount} rows`);
    captures.push(result);
    return result;
  };

  const players = await push({ name: 'players', sql: EXTRACTION_SQL.players });
  const playerStats = await push({
    name: 'player_stats',
    sql: EXTRACTION_SQL.playerStats,
    params: [firstWeeklySeason, lastWeeklySeason],
  });
  const playerSeasonStats = await push({
    name: 'player_season_stats',
    sql: EXTRACTION_SQL.playerSeasonStats,
    params: [plan.seasonStatsBelow],
  });
  // Every season the history window can reach, not just the two target
  // seasons - see `extractionPlan.scheduleSeasons` for why.
  const gamesBySeason = new Map();
  for (const season of plan.scheduleSeasons) {
    gamesBySeason.set(season, await push({
      name: `nfl_games_${season}`,
      sql: EXTRACTION_SQL.nflGames,
      params: [season],
    }));
  }
  const positionRank = await push({
    name: 'position_rank',
    sql: EXTRACTION_SQL.positionRank,
    params: [[...WEEK_POSITION_CODES]],
  });
  const playerNameRank = await push({
    name: 'player_name_rank',
    sql: EXTRACTION_SQL.playerNameRank,
  });

  if (positionRank.rowCount !== WEEK_POSITION_CODES.length) {
    throw new Error(
      `collation artifact: asked PostgreSQL to order ${WEEK_POSITION_CODES.length} position codes, ` +
      `got ${positionRank.rowCount} back`
    );
  }
  if (playerNameRank.rowCount !== players.rowCount) {
    throw new Error(
      `collation artifact: ${playerNameRank.rowCount} name ranks for ${players.rowCount} players`
    );
  }

  // --- captured-as-empty ----------------------------------------------------
  //
  // A season the query reached and found nothing in is an OBSERVATION, and it
  // is recorded as one. That is what lets a later reader tell "the snapshot has
  // no 2022 rows because production has none" apart from "the snapshot has no
  // 2022 rows because nobody asked". Both relations the history window reaches
  // get the treatment, because both feed the feature bundle.
  const weeklyBySeason = {};
  for (const season of plan.weeklyStatSeasons) weeklyBySeason[String(season)] = 0;
  for (const row of playerStats.rows) {
    const key = String(Number(row.season));
    weeklyBySeason[key] = (weeklyBySeason[key] || 0) + 1;
  }
  const scheduleRowsBySeason = {};
  for (const season of plan.scheduleSeasons) {
    scheduleRowsBySeason[String(season)] = gamesBySeason.get(season).rowCount;
  }
  const capturedAsEmpty = {
    player_stats: plan.weeklyStatSeasons.filter((s) => weeklyBySeason[String(s)] === 0),
    nfl_games: plan.scheduleSeasons.filter((s) => scheduleRowsBySeason[String(s)] === 0),
  };

  checks.push(checkPlayerIds(players.rows));
  checks.push(checkTargetSeasonsPopulated(weeklyBySeason, targetSeasons));
  checks.push(checkCaptureQuarantine(captures));

  // --- source-side integrity ------------------------------------------------
  const crosswalkSource = sourcesOfKind('players')[0];
  const crosswalk = collectColumns(
    sourceText.get(crosswalkSource.name), ['gsis_id', 'espn_id'], { label: crosswalkSource.name }
  );
  checks.push(checkCrosswalkIntegrity(crosswalk.rows));

  for (const source of sourcesOfKind('roster_weekly')) {
    const parsed = collectColumns(
      sourceText.get(source.name), ['season', 'week', 'game_type', 'gsis_id'], { label: source.name }
    );
    checks.push(checkRosterPlayerWeeks(parsed.rows, { label: source.name }));
  }
  for (const source of sourcesOfKind('injuries')) {
    const header = headersByName.get(source.name);
    const hasDateModified = header.includes('date_modified');
    const columns = ['season', 'week', 'game_type', 'gsis_id', ...(hasDateModified ? ['date_modified'] : [])];
    const parsed = collectColumns(sourceText.get(source.name), columns, { label: source.name });
    checks.push(checkInjuryPlayerWeeks(parsed.rows, { label: source.name, hasDateModified }));
  }

  const scheduledTeamKeys = [];
  for (const season of targetSeasons) {
    for (const row of gamesBySeason.get(season).rows) {
      if (row.team_key) scheduledTeamKeys.push(row.team_key);
    }
  }
  checks.push(checkDefenseMappings({
    dbPlayers: players.rows, teamKeys: scheduledTeamKeys, normalizeTeamKey,
  }));

  // --- the orientation overlay ---------------------------------------------
  const gamesSource = sourcesOfKind('games')[0];
  const gamesCsv = collectColumns(
    sourceText.get(gamesSource.name), GAMES_OVERLAY_COLUMNS, { label: gamesSource.name }
  );
  const overlay = buildOrientationOverlay({
    gamesRows: gamesCsv.rows, seasons: targetSeasons, normalizeTeamKey,
  });
  log(`  orientation overlay: ${overlay.rows.length} team-rows, ${overlay.neutralGames} neutral games`);
  checks.push(checkOverlayWindowCoverage({
    scheduleSeasons: plan.scheduleSeasons,
    overlaySeasons: targetSeasons,
    weeklyRowsBySeason: weeklyBySeason,
  }));

  // games.csv's own rows, 2026 included, are provenance and live ONLY in the
  // raw store (preregistration section 17).
  const gamesProvenanceRows = gamesCsv.rows.map((row) => ({
    game_id: String(row.game_id),
    season: Number(row.season),
    game_type: String(row.game_type),
    week: Number(row.week),
    away_team: String(row.away_team),
    home_team: String(row.home_team),
    location: String(row.location == null ? '' : row.location),
  }));
  const quarantinedProvenanceRows = gamesProvenanceRows
    .filter((r) => r.season >= store.QUARANTINE_FROM_SEASON).length;

  // --- oracles --------------------------------------------------------------
  const nameRankById = new Map(playerNameRank.rows.map((r) => [Number(r.id), Number(r.rank)]));
  const oracles = await captureOracles({
    client,
    generateProjections,
    players: players.rows,
    nameRankById,
    rules,
    hashValue,
    modelConstants,
    now,
  });
  for (const oracle of oracles) {
    log(`  oracle ${oracle.season} W${oracle.week}: ${oracle.rows.length} projections, ` +
      `sql [${oracle.observedSql.join(', ')}]`);
  }

  // --- the manifest ---------------------------------------------------------
  // `storableRows` labels each row by dataset and index, so if a captured value
  // is ever undefined the error names exactly which row and key it was.
  const storableRows = (name, rows) => rows.map((row, i) => jsonSafe(row, `${name}[${i}]`));
  const datasetWrites = [
    { dataset: 'players', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: false, rows: storableRows('players', players.rows) },
    { dataset: 'player_stats', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: true, rows: storableRows('player_stats', playerStats.rows) },
    { dataset: 'player_season_stats', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: true, rows: storableRows('player_season_stats', playerSeasonStats.rows) },
    ...plan.scheduleSeasons.map((season) => ({
      dataset: `nfl_games_${season}`,
      store: store.STORES.EVALUATION,
      path: store.PATHS.FEATURE,
      seasonScoped: true,
      rows: storableRows(`nfl_games_${season}`, gamesBySeason.get(season).rows),
    })),
    { dataset: 'orientation_overlay', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: true, rows: overlay.rows },
    { dataset: 'position_rank', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: false, rows: storableRows('position_rank', positionRank.rows) },
    { dataset: 'player_name_rank', store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, seasonScoped: false, rows: storableRows('player_name_rank', playerNameRank.rows) },
    { dataset: 'games_csv', store: store.STORES.RAW, path: store.PATHS.PROVENANCE, seasonScoped: true, rows: gamesProvenanceRows },
    ...oracles.map((oracle) => ({
      dataset: oracle.dataset,
      store: store.STORES.EVALUATION,
      path: store.PATHS.OUTCOME,
      seasonScoped: true,
      rows: oracle.rows,
    })),
  ];

  const provenanceRecords = manifestSourceRecords(sourceText, headersByName);

  const manifest = {
    studyId: STUDY_ID,
    generator: 'scripts/backtest/extract-snapshot.js',
    extractedAt: new Date().toISOString(),
    quarantineFromSeason: store.QUARANTINE_FROM_SEASON,
    seasons: targetSeasons,
    weeklyStatSeasons: plan.weeklyStatSeasons,
    scheduleSeasons: plan.scheduleSeasons,
    capturedAsEmpty,
    database: identity ? { ...identity } : null,
    sqlSurface: plan.sqlSurface,
    schemaFingerprint: Object.fromEntries(
      captures.map((c) => [c.name, { fingerprint: c.fingerprint, fields: c.fields }])
    ),
    rowCounts: Object.fromEntries(captures.map((c) => [c.name, c.rowCount])),
    weeklyRowsBySeason: weeklyBySeason,
    scheduleRowsBySeason,
    collation: {
      positionRank: {
        codes: [...WEEK_POSITION_CODES],
        hash: sha256Hex(Buffer.from(
          store.canonicalJson(storableRows('position_rank', positionRank.rows)), 'utf8'
        )),
        rows: positionRank.rowCount,
      },
      playerNameRank: {
        hash: sha256Hex(Buffer.from(
          store.canonicalJson(storableRows('player_name_rank', playerNameRank.rows)), 'utf8'
        )),
        rows: playerNameRank.rowCount,
      },
    },
    oracles: oracles.map((o) => ({
      season: o.season,
      week: o.week,
      dataset: o.dataset,
      branches: o.branches,
      observedSql: o.observedSql,
      playerCount: o.playerIds.length,
      playerHash: o.playerHash,
      cohortHash: o.cohortHash,
      outputHash: o.outputHash,
      inputCutoff: o.inputCutoff,
    })),
    oracleSettings: {
      weeks: ORACLE_WEEKS.map((w) => ({ season: w.season, week: w.week })),
      playersPerPosition: ORACLE_PLAYERS_PER_POSITION,
      positions: [...WEEK_POSITION_CODES],
      weatherService: false,
      now: new Date(now).toISOString(),
      hashValue: hashValue == null ? null : String(hashValue),
      rulesHash: sha256Hex(Buffer.from(
        store.canonicalJson(jsonSafe(rules == null ? null : rules, 'rules')), 'utf8'
      )),
      modelConstantsHash: sha256Hex(Buffer.from(
        store.canonicalJson(jsonSafe(modelConstants == null ? null : modelConstants, 'modelConstants')),
        'utf8'
      )),
      modelVersion,
    },
    overlay: {
      source: gamesSource.name,
      regGamesBySeason: overlay.gamesBySeason,
      teamRowsBySeason: overlay.teamRowsBySeason,
      neutralGames: overlay.neutralGames,
      quarantinedProvenanceRows,
      writtenToDatabase: false,
    },
    sources: provenanceRecords,
    integrityChecks: checks,
    datasets: [],
  };

  const inventory = datasetWrites.map((d) => ({
    dataset: d.dataset, store: d.store, path: d.path, rowCount: d.rows.length,
  }));
  const digest = planDigest({
    plan,
    sourceHashes: Object.fromEntries(provenanceRecords.map((r) => [r.name, r.sha256])),
    oracleSettings: manifest.oracleSettings,
    identity,
  });
  manifest.planDigest = digest;

  if (!apply) {
    // The dry run did all the work: every capture, every integrity check, every
    // oracle. The receipt records that, so --apply can prove the sequence
    // happened rather than trusting that it did.
    const receipt = {
      studyId: STUDY_ID,
      generator: 'scripts/backtest/extract-snapshot.js',
      planDigest: digest,
      dryRunAt: new Date().toISOString(),
      // The database and role this receipt authorizes an apply against. Neither
      // is a secret - they are the accident guard the identity assertion
      // already proved - and recording them is what lets the refusal message
      // say WHICH database the receipt was cut for.
      database: (identity && identity.database) || null,
      role: (identity && identity.role) || null,
      seasons: targetSeasons,
      scheduleSeasons: plan.scheduleSeasons,
      weeklyStatSeasons: plan.weeklyStatSeasons,
      capturedAsEmpty,
      rowCounts: manifest.rowCounts,
      wouldWrite: inventory,
      integrityChecks: checks.map((c) => ({ name: c.name, status: c.status, counts: c.counts })),
      oracleWeeks: oracles.map((o) => ({
        season: o.season, week: o.week, branches: o.branches, rows: o.rows.length,
      })),
      // Deliberately absent: any connection string, host, user or password. The
      // receipt is written next to the snapshot and may be read by anyone who
      // can read the snapshot.
    };
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(store.receiptFile(outDir), `${store.canonicalJson(receipt)}\n`, 'utf8');
    log('DRY RUN - no snapshot written. Datasets that WOULD be written:');
    for (const spec of datasetWrites) {
      log(`  ${spec.store}/${spec.path}/${spec.dataset}: ${spec.rows.length} rows`);
    }
    log(`plan digest ${digest}`);
    log(`receipt -> ${store.receiptFile(outDir)}`);
    log('re-run with --apply to write the snapshot');
    return { manifest, datasets: inventory, applied: false, overlay, oracles, checks, receipt, digest };
  }

  // Checked BEFORE the first write, so a refused apply leaves the output
  // directory exactly as it was.
  const receipt = assertDryRunReceipt({ outDir, digest });

  const written = [];
  for (const spec of datasetWrites) {
    written.push(store.saveDataset({ root: outDir, ...spec }));
  }
  manifest.datasets = written;
  manifest.dryRunAt = receipt.dryRunAt;
  const manifestWrite = store.saveManifest(outDir, manifest);
  log(`snapshot written to ${outDir} (manifest sha256 ${manifestWrite.sha256})`);
  return {
    manifest, datasets: written, applied: true, overlay, oracles, checks, manifestWrite, digest,
  };
}

/**
 * Pure: the provenance summary the manifest pins - the hash of the exact bytes
 * each source was read as, recomputed here rather than copied from the
 * provenance file, so the manifest attests to what the extraction actually saw.
 */
function manifestSourceRecords(sourceText, headersByName) {
  return SOURCES.map((source) => ({
    name: source.name,
    file: source.file,
    sha256: sha256Hex(Buffer.from(sourceText.get(source.name), 'utf8')),
    byteLength: Buffer.byteLength(sourceText.get(source.name), 'utf8'),
    columnCount: headersByName.get(source.name).length,
  }));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    plan: false,
    apply: false,
    out: DEFAULT_SNAPSHOT_DIR,
    sourcesDir: DEFAULT_SOURCES_DIR,
    provenance: DEFAULT_PROVENANCE_PATH,
    // `--database` and `--role` are NOT secrets. They are the accident guard:
    // the extraction refuses to read anything unless the server it reached
    // reports exactly these, so a connection string pointed at the wrong
    // database stops before a row is captured. The connection string itself
    // never appears here - see the note on the missing --connection-string
    // flag below.
    database: null,
    role: null,
    statementTimeoutMs: 300000,
    idleInTransactionSessionTimeoutMs: 60000,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--plan') args.plan = true;
    else if (token === '--apply') args.apply = true;
    else if (token === '--out') args.out = argv[++i];
    else if (token === '--sources-dir') args.sourcesDir = argv[++i];
    else if (token === '--provenance') args.provenance = argv[++i];
    else if (token === '--database') args.database = argv[++i];
    else if (token === '--role') args.role = argv[++i];
    // There is deliberately NO --connection-string. A credential on argv is
    // world-readable (`ps`, /proc/<pid>/cmdline), lands in shell history, and
    // can be echoed back by an error message that quotes a neighbouring token.
    // The gated runner reads exactly one dedicated environment variable
    // instead; see server/scripts/run-backtest-extraction.js. This module never
    // sees a credential at all, which is also what keeps it inside the
    // no-process.env rule for scripts/backtest.
    else if (token === '--statement-timeout-ms') args.statementTimeoutMs = Number(argv[++i]);
    else if (token === '--idle-timeout-ms') args.idleInTransactionSessionTimeoutMs = Number(argv[++i]);
    else if (token === '--connection-string') {
      throw new Error(
        '--connection-string is not accepted: a database credential must never be passed on the ' +
        'command line, where `ps` and shell history can read it. Set BACKTEST_RO_DATABASE_URL in ' +
        'the environment and run server/scripts/run-backtest-extraction.js.'
      );
    } else throw new Error(`unknown argument ${redactArgument(token)}`);
  }
  return args;
}

/**
 * Pure: an argument safe to put in an error message.
 *
 * A parser that echoes whatever it did not recognize will happily print a
 * connection string somebody typed in the wrong position, into a log or a CI
 * transcript. Recognized flag NAMES are safe and useful to echo; anything else
 * is described rather than quoted.
 */
function redactArgument(token) {
  const text = String(token == null ? '' : token);
  return /^--[a-z0-9-]+$/.test(text) ? text : `<redacted ${text.length}-character non-flag argument>`;
}

function printPlan(plan, log = console.log) {
  log(`extraction plan for ${plan.studyId}`);
  log(`  seasons: ${plan.seasons.join(', ')}  (quarantine from ${plan.quarantineFromSeason})`);
  log(`  weekly stat seasons captured: ${plan.weeklyStatSeasons.join(', ')}`);
  log(`  nfl_games seasons captured:   ${plan.scheduleSeasons.join(', ')}`);
  log(`  player_season_stats: every season below ${plan.seasonStatsBelow}`);
  log('  production SQL surface (whitespace-normalized SHA-256):');
  for (const entry of plan.sqlSurface) {
    log(`    ${entry.name.padEnd(24)} ${entry.signature}  ${entry.conditional ? `[conditional: ${entry.conditional}]` : ''}`);
  }
  log('  oracle weeks (preregistration section 15):');
  for (const w of plan.oracleWeeks) {
    log(`    ${w.season} W${String(w.week).padStart(2)}  scan ${w.leagueScan ? 'ON ' : 'OFF'}  ` +
      `defenseCount ${w.defenseGameCount ? 'ON ' : 'OFF'}  ${w.evaluated ? 'evaluated' : 'branch-pin only'}`);
  }
  log('  datasets:');
  for (const d of plan.datasets) log(`    ${d.store}/${d.path}/${d.dataset}`);
  log(`  integrity checks: ${plan.integrityChecks.join(', ')}`);
}

/**
 * The CLI entry point. `--plan` is the only mode this file can run on its own;
 * a real extraction needs the production wiring and therefore runs through
 * `server/scripts/run-backtest-extraction.js`. That is not an inconvenience to
 * work around - it is the property that makes this tree structurally unable to
 * reach a database or a network.
 */
async function main(argv, deps = {}) {
  const args = parseArgs(argv);
  const log = deps.log || console.log;
  if (args.plan || !deps.connect) {
    printPlan(extractionPlan(), log);
    if (!args.plan) {
      log('');
      log('No database wiring was injected, so nothing was extracted.');
      log('The gated run is: node server/scripts/run-backtest-extraction.js [--apply]');
      return args.plan ? 0 : 1;
    }
    return 0;
  }

  const txn = await openReadOnlyTransaction({
    connect: deps.connect,
    pool: deps.pool,
    expectedDatabase: args.database,
    expectedRole: args.role,
    statementTimeoutMs: args.statementTimeoutMs,
    idleInTransactionSessionTimeoutMs: args.idleInTransactionSessionTimeoutMs,
  });
  try {
    const readSource = deps.readSource
      || makeArchivedSourceReader({ sourcesDir: args.sourcesDir, provenancePath: args.provenance });
    await runExtraction({
      client: txn.client,
      identity: txn.identity,
      normalizeTeamKey: deps.normalizeTeamKey,
      generateProjections: deps.generateProjections,
      rules: deps.rules,
      hashValue: deps.hashValue,
      modelConstants: deps.modelConstants,
      modelVersion: deps.modelVersion,
      readSource,
      outDir: args.out,
      apply: args.apply,
      log,
    });
  } finally {
    await txn.close();
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = {
  STUDY_ID,
  HISTORY_SEASONS,
  ORACLE_NOW,
  ORACLE_WEEKS,
  ORACLE_PLAYERS_PER_POSITION,
  WEEK_POSITION_CODES,
  SQL_SURFACE,
  SQL_BY_SIGNATURE,
  EXTRACTION_SQL,
  GAMES_OVERLAY_COLUMNS,
  DEFAULT_SNAPSHOT_DIR,
  DEFAULT_SOURCES_DIR,
  DEFAULT_PROVENANCE_PATH,
  normalizeSql,
  sqlSignature,
  sqlSurfaceSignatures,
  installPoolLockout,
  openReadOnlyTransaction,
  createRecordingClient,
  capture,
  jsonSafe,
  planDigest,
  assertDryRunReceipt,
  redactArgument,
  selectOracleCohort,
  captureOracles,
  buildOrientationOverlay,
  checkCrosswalkIntegrity,
  checkPlayerIds,
  checkRosterPlayerWeeks,
  checkInjuryPlayerWeeks,
  checkDefenseMappings,
  checkSourceColumns,
  checkTargetSeasonsPopulated,
  checkCaptureQuarantine,
  checkOverlayWindowCoverage,
  makeArchivedSourceReader,
  extractionPlan,
  runExtraction,
  parseArgs,
  printPlan,
  main,
};
