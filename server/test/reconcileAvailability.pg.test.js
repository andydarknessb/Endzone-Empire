/**
 * Disposable-Postgres test for `reconcileAvailability` (#1789).
 *
 * The mockPool suite in projection.service.test.js proves the statement TEXT
 * (the SET list names only factors/active_probability/updated_at, the bye
 * guard predicate, the id scoping) since that is a claim about SQL the
 * engine issues, which a matcher fake can assert on directly. What a fake
 * cannot prove is that the UPDATE, run against a real row, actually leaves
 * every other stored column byte-identical - `jsonb ||` merge behavior and
 * `IS DISTINCT FROM` jsonb equality are real Postgres semantics no fake
 * re-implements. This file seeds one real `player_week_projections` row and
 * proves that.
 *
 * Gated exactly like the other *.pg.test.js files: PG_TESTS=1 (or the
 * per-file RECONCILEAVAILABILITY_PG_TESTS=1) must be set, and every
 * DATABASE_URL* variable must be ABSENT - connections are built from PG*
 * variables only (via the app's own server/modules/pool, the same pool
 * `reconcileAvailability` itself defaults to), so a stray local run can never
 * touch the shared production database. Locally these report as a visible
 * SKIP, never a silent green. CI's migration-smoke job (postgres:17 service,
 * every migration applied) is the binding run; this could not be run in this
 * session (no local Postgres available).
 *
 * Run with `node --test server/test/reconcileAvailability.pg.test.js`
 * (needs PG_TESTS=1).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.RECONCILEAVAILABILITY_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);
const missingPgDatabase = !process.env.PGDATABASE;

if (!ENABLED) {
  test('reconcileAvailability PG tests (skipped: set PG_TESTS=1 or RECONCILEAVAILABILITY_PG_TESTS=1; CI migration-smoke runs these)',
    { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('reconcileAvailability PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else if (missingPgDatabase) {
  test('reconcileAvailability PG tests refuse to run without PGDATABASE set', () => {
    assert.fail('set PGDATABASE (and the other PG* connection vars) to a disposable database - '
      + 'this file connects through server/modules/pool.js, which falls back to the local dev '
      + 'database name ("endzone_empire") when PGDATABASE is unset, and these tests write and delete real rows');
  });
} else {
  const pool = require('../modules/pool');
  const { reconcileAvailability, MODEL_VERSION } = require('../services/projection.service');

  const SEASON = 2099; // out of any real season's range, so a stray leak is obvious
  const SCORING_HASH = 'reconcileavailability-pgtest-hash';
  const seededPlayers = [];
  const seededRuns = [];

  test.after(async () => {
    try {
      for (const id of seededRuns) {
        await pool.query(`DELETE FROM "projection_runs" WHERE "id" = $1`, [id]);
      }
      for (const id of seededPlayers) {
        await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [id]);
      }
    } finally {
      await pool.end();
    }
  });

  /** Inserts one player and returns its id, tracked for cleanup. */
  async function seedPlayer(overrides = {}) {
    const res = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team", "injury_status")
       VALUES ($1, $2, $3, $4) RETURNING "id"`,
      [
        `reconcileavailability-pgtest-${Date.now()}-${Math.random()}`,
        overrides.position || 'RB',
        overrides.nflTeam === undefined ? 'MIN' : overrides.nflTeam,
        overrides.injuryStatus === undefined ? null : overrides.injuryStatus,
      ]
    );
    const id = res.rows[0].id;
    seededPlayers.push(id);
    return id;
  }

  /** Inserts one run and returns its id, tracked for cleanup. */
  async function seedRun(week) {
    const res = await pool.query(
      `INSERT INTO "projection_runs" ("season", "week", "scoring_hash", "model_version", "input_cutoff")
       VALUES ($1, $2, $3, $4, now()) RETURNING "id"`,
      [SEASON, week, SCORING_HASH, MODEL_VERSION]
    );
    const id = res.rows[0].id;
    seededRuns.push(id);
    return id;
  }

  /** Inserts one player_week_projections row with a full set of numbers. */
  async function seedRow(runId, playerId, availability) {
    await pool.query(
      `INSERT INTO "player_week_projections"
         ("run_id", "player_id", "mean", "median", "p10", "p25", "p75", "p90",
          "active_probability", "confidence", "sample_size", "factors")
       VALUES ($1, $2, 11.5, 10.75, 4.2, 7.1, 14.3, 19.8, $3, 'high', 6, $4::jsonb)`,
      [runId, playerId, availability.activeProbability, JSON.stringify({
        opponent: { available: true, rank: 12, of: 32 },
        availability,
      })]
    );
  }

  async function readRow(runId, playerId) {
    const res = await pool.query(
      `SELECT * FROM "player_week_projections" WHERE "run_id" = $1 AND "player_id" = $2`,
      [runId, playerId]
    );
    return res.rows[0];
  }

  test('the UPDATE patches only availability/active_probability/updated_at on a seeded run; every number and confidence survives byte-identical', async () => {
    const playerId = await seedPlayer({ injuryStatus: 'O' });
    const runId = await seedRun(5);
    await seedRow(runId, playerId, {
      available: true, activeProbability: 1, reason: null, status: null, locked: false, lockedSlot: null,
    });
    const before = await readRow(runId, playerId);

    const result = await reconcileAvailability({ season: SEASON, fromWeek: 5, playerIds: [playerId], client: pool });
    assert.equal(result.updated, 1, 'the one drifted row is patched');

    const after = await readRow(runId, playerId);
    assert.equal(after.factors.availability.reason, 'out', 'the O designation now reads out');
    assert.equal(after.factors.availability.available, false);
    assert.equal(Number(after.active_probability), 0);
    // Every other number, byte-identical (ADR 0044: the reconcile moves no number).
    assert.equal(Number(after.mean), Number(before.mean));
    assert.equal(Number(after.median), Number(before.median));
    assert.equal(Number(after.p10), Number(before.p10));
    assert.equal(Number(after.p25), Number(before.p25));
    assert.equal(Number(after.p75), Number(before.p75));
    assert.equal(Number(after.p90), Number(before.p90));
    assert.equal(after.confidence, before.confidence, 'confidence keeps its generation-time value (#1789 ruling item 2)');
    assert.equal(after.sample_size, before.sample_size);
    // The rest of `factors` (non-availability keys) survives the jsonb merge untouched.
    assert.deepEqual(after.factors.opponent, before.factors.opponent);
    assert.ok(new Date(after.updated_at).getTime() > new Date(before.updated_at).getTime(), 'updated_at moved');
  });

  test('a stored bye verdict is never overwritten, even when the player now reads Out', async () => {
    const playerId = await seedPlayer({ injuryStatus: 'O' });
    const runId = await seedRun(6);
    await seedRow(runId, playerId, {
      available: false, activeProbability: 0, reason: 'bye', status: 'O', locked: false, lockedSlot: null,
    });
    const before = await readRow(runId, playerId);

    const result = await reconcileAvailability({ season: SEASON, fromWeek: 6, playerIds: [playerId], client: pool });
    assert.equal(result.updated, 0, 'the bye row is guarded out of the write entirely');

    const after = await readRow(runId, playerId);
    assert.deepEqual(after.factors, before.factors, 'the bye verdict is untouched');
    assert.equal(after.updated_at.getTime(), before.updated_at.getTime());
  });

  test('a 49h-stale practice_squad roster-status row reconciles to Active under an injected now', async () => {
    const playerId = await seedPlayer({ injuryStatus: null });
    // `nflRosterStatusColumn` filters on `captured_date >= CURRENT_DATE - 2`,
    // the database's REAL wall-clock date (not mockable through `now`), so
    // `captured_date` is pinned to yesterday - always inside that window,
    // whatever real day this runs on. The 49h staleness `unavailableFor`
    // actually checks reads `updated_at` (a timestamptz) against the
    // INJECTED `now` below, which is what makes this test's clock real
    // rather than the database's.
    const now = new Date();
    const capturedAt = new Date(now.getTime() - 49 * 60 * 60 * 1000); // 49h before now: stale
    const capturedDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // yesterday
    await pool.query(
      `INSERT INTO "player_nfl_roster_status" ("player_id", "team_code", "roster_status", "captured_date", "updated_at")
       VALUES ($1, 'MIN', 'practice_squad', $2::date, $3)`,
      [playerId, capturedDate, capturedAt]
    );
    const runId = await seedRun(7);
    await seedRow(runId, playerId, {
      available: false, activeProbability: 0, reason: 'practice_squad', status: null, locked: false, lockedSlot: null,
    });

    const result = await reconcileAvailability({ season: SEASON, fromWeek: 7, playerIds: [playerId], client: pool, now });
    assert.equal(result.updated, 1);

    const after = await readRow(runId, playerId);
    assert.equal(after.factors.availability.reason, null, 'stale practice_squad reads Active');
    assert.equal(after.factors.availability.available, true);
    assert.equal(Number(after.active_probability), 1);

    await pool.query(`DELETE FROM "player_nfl_roster_status" WHERE "player_id" = $1`, [playerId]);
  });
}
