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
  const { reconcileAvailability, liveReconcileScope, MODEL_VERSION } = require('../services/projection.service');

  const SEASON = 2099; // out of any real season's range, so a stray leak is obvious
  const SCORING_HASH = 'reconcileavailability-pgtest-hash';
  const seededPlayers = [];
  const seededRuns = [];
  const seededLeagues = [];
  let seededUserId = null;

  test.after(async () => {
    try {
      for (const id of seededRuns) {
        await pool.query(`DELETE FROM "projection_runs" WHERE "id" = $1`, [id]);
      }
      for (const id of seededPlayers) {
        await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [id]);
      }
      if (seededLeagues.length > 0) {
        await pool.query(`DELETE FROM "leagues" WHERE "id" = ANY($1::int[])`, [seededLeagues]);
      }
      if (seededUserId != null) {
        await pool.query(`DELETE FROM "users" WHERE "id" = $1`, [seededUserId]);
      }
      // QA f4's schedule fixture: every nfl_games row this file ever writes
      // is under the out-of-range SEASON constant, so one delete by season
      // sweeps all of them regardless of which test seeded which team/week.
      await pool.query(`DELETE FROM "nfl_games" WHERE "season" = $1`, [SEASON]);
    } finally {
      await pool.end();
    }
  });

  /** Inserts a team's regular-season schedule (weeks 1..18) for `season`,
   * skipping `byeWeek` - exactly the shape `bye.service.computeByeWeeks`
   * expects to derive that one gap back out of. */
  async function seedTeamSchedule(team, season, byeWeek) {
    const weeks = [];
    for (let week = 1; week <= 18; week++) {
      if (week !== byeWeek) weeks.push(week);
    }
    await pool.query(
      `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "kickoff_at")
       SELECT $1, "w", $2, now() FROM unnest($3::int[]) AS "w"`,
      [season, team, weeks]
    );
  }

  /** Inserts one live (draft-complete, season-not-complete) fantasy league
   * and returns its id, tracked for cleanup. Lazily seeds the one owning
   * user this file needs. */
  async function seedLiveLeague({ season, week }) {
    if (seededUserId == null) {
      const user = await pool.query(
        `INSERT INTO "users" ("username", "email", "password")
         VALUES ($1, $2, 'x') RETURNING "id"`,
        [`reconcileavailability-pgtest-${Date.now()}`, `reconcileavailability-pgtest-${Date.now()}@example.invalid`]
      );
      seededUserId = user.rows[0].id;
    }
    const res = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "draft_status", "current_season", "current_week")
       VALUES ($1, $2, $3, 'complete', $4, $5) RETURNING "id"`,
      [`reconcileavailability-pgtest-${season}`, seededUserId, `ra${season}${Math.floor(Math.random() * 1e4)}`, season, week]
    );
    const id = res.rows[0].id;
    seededLeagues.push(id);
    return id;
  }

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

  test('QA f1: a stored no_team row stays deferred, untouched, once the player has a team again but his new team\'s bye week cannot be resolved (no synced schedule)', async () => {
    // Signed mid-week: he now has a real team, so the freshly computed
    // verdict is no longer no_team - but his cached rows were generated with
    // onBye always false (byeByTeam.get(null) resolved nothing), so nothing
    // here can tell his new team's bye week apart from any other week.
    // Reconciling this row the ordinary way would wrongly flip it to
    // available. The main UPDATE's guard skips it, and the bye-aware second
    // pass (reconcileByeAwareSignings) finds no bye week for his team - KC
    // has NO nfl_games rows for SEASON, deliberately (asserted below, so a
    // future fixture that seeds one cannot silently change what this proves)
    // - so it logs and leaves the row deferred to regeneration. The resolvable
    // schedule case is the QA f4 test below.
    const playerId = await seedPlayer({ injuryStatus: null, nflTeam: 'KC' });
    const scheduled = await pool.query(
      `SELECT COUNT(*)::int AS "n" FROM "nfl_games" WHERE "season" = $1 AND "nfl_team" = 'KC'`,
      [SEASON]
    );
    assert.equal(scheduled.rows[0].n, 0, 'KC has no schedule for SEASON: the bye lookup fails on purpose');
    const runId = await seedRun(8);
    await seedRow(runId, playerId, {
      available: false, activeProbability: 0, reason: 'no_team', status: null, locked: false, lockedSlot: null,
    });
    const before = await readRow(runId, playerId);

    const result = await reconcileAvailability({ season: SEASON, fromWeek: 8, playerIds: [playerId], client: pool });
    assert.equal(result.updated, 0, 'the no_team row is guarded out of the write entirely');

    const after = await readRow(runId, playerId);
    assert.deepEqual(after.factors, before.factors, 'the stale no_team verdict is untouched, not flipped to available');
    assert.equal(after.updated_at.getTime(), before.updated_at.getTime());
  });

  test('QA f4: a signed ex-no_team player with a resolvable schedule gets a real per-week verdict - his new team\'s bye week becomes bye, every other week reconciles', async () => {
    const team = 'HOU'; // distinct from the other no-schedule cases in this file
    const byeWeek = 12; // weeks 5-11 are already claimed by earlier tests' seedRun() calls
    await seedTeamSchedule(team, SEASON, byeWeek);
    const playerId = await seedPlayer({ injuryStatus: null, nflTeam: team });
    const byeRunId = await seedRun(byeWeek);
    const otherRunId = await seedRun(byeWeek + 1);
    for (const runId of [byeRunId, otherRunId]) {
      await seedRow(runId, playerId, {
        available: false, activeProbability: 0, reason: 'no_team', status: null, locked: false, lockedSlot: null,
      });
    }

    const result = await reconcileAvailability({ season: SEASON, fromWeek: byeWeek, playerIds: [playerId], client: pool });
    assert.equal(result.updated, 2, 'both rows (his bye week and the week after) reconcile');

    const byeRow = await readRow(byeRunId, playerId);
    assert.equal(byeRow.factors.availability.reason, 'bye', 'his new team\'s real bye week stays unavailable');
    assert.equal(byeRow.factors.availability.available, false);
    assert.equal(Number(byeRow.active_probability), 0);

    const otherRow = await readRow(otherRunId, playerId);
    assert.equal(otherRow.factors.availability.reason, null, 'every other week reconciles to his real, healthy verdict');
    assert.equal(otherRow.factors.availability.available, true);
    assert.equal(Number(otherRow.active_probability), 1);
  });

  test("QA f1: the no_team guard does not block the OTHER direction - a departed player's row still reconciles to no_team", async () => {
    const playerId = await seedPlayer({ injuryStatus: null, nflTeam: null }); // already departed
    const runId = await seedRun(9);
    // Stored as though generated before he left - a healthy, available row.
    await seedRow(runId, playerId, {
      available: true, activeProbability: 1, reason: null, status: null, locked: false, lockedSlot: null,
    });

    const result = await reconcileAvailability({ season: SEASON, fromWeek: 9, playerIds: [playerId], client: pool });
    assert.equal(result.updated, 1, 'the departure reconciles normally');

    const after = await readRow(runId, playerId);
    assert.equal(after.factors.availability.reason, 'no_team');
    assert.equal(after.factors.availability.available, false);
    assert.equal(Number(after.active_probability), 0);
  });

  test('QA f3: a verdict that has not changed writes 0 rows - the no-op guard that keeps a full sweep cheap', async () => {
    // The stored verdict is EXACTLY what reconcile will recompute for a
    // healthy, on-team, non-practice-squad player: nothing should be
    // written. `autoRecommend: true` is part of that exact shape -
    // unavailableFor's healthy branch (unavailable.js) sets it, and
    // omitting it here (an earlier draft of this fixture did) makes the
    // stored and recomputed jsonb objects genuinely UNEQUAL, so the row
    // legitimately gets rewritten - caught by a real-Postgres run, not the
    // mockPool suite (jsonb structural equality is a real-Postgres claim).
    const playerId = await seedPlayer({ injuryStatus: null, nflTeam: 'DAL' });
    const runId = await seedRun(10);
    const unchanged = {
      available: true, autoRecommend: true, activeProbability: 1, reason: null, status: null, locked: false, lockedSlot: null,
    };
    await seedRow(runId, playerId, unchanged);
    const before = await readRow(runId, playerId);

    const result = await reconcileAvailability({ season: SEASON, fromWeek: 10, playerIds: [playerId], client: pool });
    assert.equal(result.checked, 1, 'the player was read');
    assert.equal(result.updated, 0, 'an unchanged verdict is a no-op write, not a rewrite of the same value');

    const after = await readRow(runId, playerId);
    assert.deepEqual(after.factors, before.factors);
    assert.equal(after.updated_at.getTime(), before.updated_at.getTime(), 'updated_at only moves on an actual write');
  });

  test('QA f2: a verdict that has not changed writes 0 rows even with a NON-null stored reason (an O player stored as out)', async () => {
    // The f3 case above seeds reason: null (healthy) - and at the pre-fix
    // head that test PASSED for the wrong reason, because the f1 NULL-logic
    // bug made every healthy-stored row a no-op regardless of the real
    // IS DISTINCT FROM guard (CI's own red). This case pins the guard
    // independently of that bug: a NON-null unchanged reason must still be
    // a no-op write.
    const playerId = await seedPlayer({ injuryStatus: 'O', nflTeam: 'DAL' });
    const runId = await seedRun(11);
    const unchanged = { available: false, activeProbability: 0, reason: 'out', status: 'O', locked: false, lockedSlot: null };
    await seedRow(runId, playerId, unchanged);
    const before = await readRow(runId, playerId);

    const result = await reconcileAvailability({ season: SEASON, fromWeek: 11, playerIds: [playerId], client: pool });
    assert.equal(result.checked, 1);
    assert.equal(result.updated, 0, 'the O -> out verdict already matches what is stored');

    const after = await readRow(runId, playerId);
    assert.deepEqual(after.factors, before.factors);
    assert.equal(after.updated_at.getTime(), before.updated_at.getTime());
  });

  test('QA f5: liveReconcileScope picks the newest live season on a rollover overlap, not the lowest week across seasons', async () => {
    // The old season's league sits on the LOWER week (1) and the new
    // season's on a HIGHER one (3) - deliberately, so a week-only
    // `ORDER BY current_week ASC` (1 < 3) would ALSO return the old season
    // here, and this test could not tell that ordering apart from the
    // season-first one it actually pins (re-QA f3: the original version of
    // this test - old week 15, new week 1 - passed under EITHER ordering,
    // since week-only already preferred week 1 too). Only `ORDER BY
    // current_season DESC, current_week ASC` picks the new season despite
    // its higher week.
    const oldSeason = SEASON; // 2099
    const newSeason = SEASON + 1; // 2100
    await seedLiveLeague({ season: oldSeason, week: 1 });
    await seedLiveLeague({ season: newSeason, week: 3 });

    const scope = await liveReconcileScope(pool);
    assert.deepEqual(scope, { season: newSeason, fromWeek: 3 }, 'the newest live season wins even though its own current_week is HIGHER');
  });
}
