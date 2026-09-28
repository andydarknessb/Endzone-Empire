/**
 * Disposable-Postgres tests for the holdout ledger's DATABASE-enforced
 * guarantees — the properties the mocked unit tests can only imitate:
 * append-only triggers, the child kickoff cutoff, transactional atomicity,
 * the nonempty-rollback refusal, and role/RLS compatibility.
 *
 * These run ONLY in the CI migration-smoke job (postgres:17 service), gated
 * twice: HOLDOUT_PG_TESTS=1 must be set explicitly, and every DATABASE_URL*
 * variable must be ABSENT — connections are built from PG* variables only,
 * so a stray local run can never touch the shared production database
 * (server/knexfile.js loads .env; this file deliberately does not).
 *
 * Runs LAST among the pg files (scripts/run-pg-tests.js pins it there). The
 * reason is defensive and not established: these tests insert ledger rows
 * that are permanent for the rest of the job, so a future pg file that
 * asserted anything globally about ledger emptiness would break if it ran
 * after this one. No such file exists today, so nothing is actually protected
 * yet -- keeping this file last is cheap insurance. Its own
 * `rolling back a NONEMPTY ledger refuses destructively` test below depends on
 * rows left by earlier tests in this same file, not on any other pg file's
 * position.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.HOLDOUT_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('holdout PG tests (skipped: set PG_TESTS=1 or HOLDOUT_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('holdout PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} — these tests must only ever see a disposable PG* database`);
  });
} else {
  const pg = require('pg');
  const connection = {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
  const pool = new pg.Pool({ ...connection, max: 2 });
  const knex = require('knex')({
    client: 'pg',
    connection,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  });

  const KICKOFF_SOON_MS = 2000;
  let seededPlayerIds = [];

  test.before(async () => {
    await knex.migrate.latest();
    // Seed a tiny four-team world for the end-to-end capture. Distinct
    // far-future seasons per test avoid identity collisions, since ledger
    // rows can never be deleted.
    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('PG QB', 'QB', 'KC'), ('PG WR', 'WR', 'DET'), ('PG RB', 'RB', 'BUF')
       RETURNING "id"`
    );
    seededPlayerIds = players.rows.map((r) => r.id);
  });

  test.after(async () => {
    await pool.end();
    await knex.destroy();
  });

  /**
   * A REAL closed-season fixture: all 32 canonical teams, weeks 1-18, 17
   * appearances each, seeded from the same generator the unit suite
   * validates against — so the capture's canonical-domain schedule
   * certification runs for real against a season that satisfies it.
   */
  async function seedSeason({ season, firstKickoffInMs = 60 * 60 * 1000 }) {
    const { buildSeason } = require('./helpers/holdoutSeason');
    const first = new Date(Date.now() + firstKickoffInMs);
    const built = buildSeason({ season, firstKickoff: first.toISOString() });
    // Register the matching manifest through the verifying gate: the capture
    // refuses seasons without one, and registration refuses a manifest whose
    // digest or per-week deadlines do not hold.
    require('../services/holdout.service').registerSeasonManifest(built.manifest);
    const values = [];
    const params = [];
    let i = 0;
    for (const [week, rows] of built.rowsByWeek) {
      for (const row of rows) {
        values.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}, $${i + 7})`);
        params.push(season, week, row.nfl_team, row.opponent, row.kickoff_at, row.home_away, row.game_key);
        i += 7;
      }
    }
    await pool.query(
      `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at", "home_away", "game_key")
       VALUES ${values.join(', ')}`,
      params
    );
    return first;
  }

  async function insertHeader({ season, captureNotAfter, isLate = false }) {
    const result = await pool.query(
      `INSERT INTO "projection_snapshots"
         ("season", "week", "scoring_profile", "scoring_hash", "model_version", "constants_hash",
          "release_sha", "cohort_hash", "cohort_size", "schedule_games", "schedule_hash",
          "protocol_version", "capture_not_after", "is_late")
       VALUES ($1, 1, 'standard', $4, 'test_model', 'chash', 'sha', 'cohash', 1, 2, 'shash', 1, $2, $3)
       RETURNING "id"`,
      [season, captureNotAfter, isLate, `hash-${season}-${isLate ? 'late' : 'ontime'}`]
    );
    return result.rows[0].id;
  }

  test('UPDATE, DELETE and TRUNCATE are rejected on both ledger tables, even for the owner', async () => {
    const id = await insertHeader({ season: 2077, captureNotAfter: new Date(Date.now() + 3600 * 1000) });
    await pool.query(
      `INSERT INTO "projection_snapshot_players" ("snapshot_id", "player_id", "sample_size")
       VALUES ($1, $2, 0)`,
      [id, seededPlayerIds[0]]
    );
    await assert.rejects(pool.query('UPDATE "projection_snapshots" SET "cohort_size" = 99 WHERE "id" = $1', [id]), /append-only/);
    await assert.rejects(pool.query('DELETE FROM "projection_snapshots" WHERE "id" = $1', [id]), /append-only/);
    await assert.rejects(pool.query('UPDATE "projection_snapshot_players" SET "sample_size" = 9 WHERE "snapshot_id" = $1', [id]), /append-only/);
    await assert.rejects(pool.query('DELETE FROM "projection_snapshot_players" WHERE "snapshot_id" = $1', [id]), /append-only/);
    await assert.rejects(pool.query('TRUNCATE "projection_snapshot_players"'), /append-only/);
    await assert.rejects(pool.query('TRUNCATE "projection_snapshots" CASCADE'), /append-only/);
  });

  test('the header CHECK rejects unlabeled post-deadline captures and admits labeled late ones', async () => {
    const past = new Date(Date.now() - 3600 * 1000);
    await assert.rejects(
      insertHeader({ season: 2078, captureNotAfter: past }),
      /pre_deadline_check/,
      'an unlabeled late capture must fail at the database'
    );
    const lateId = await insertHeader({ season: 2078, captureNotAfter: past, isLate: true });
    assert.ok(lateId > 0, 'explicitly labeled non-holdout captures are allowed through');
  });

  test('the child trigger independently rejects insertion after the parent deadline passes', async () => {
    const deadline = new Date(Date.now() + KICKOFF_SOON_MS);
    const id = await insertHeader({ season: 2079, captureNotAfter: deadline });
    // Before the deadline: accepted.
    await pool.query(
      `INSERT INTO "projection_snapshot_players" ("snapshot_id", "player_id", "sample_size") VALUES ($1, $2, 0)`,
      [id, seededPlayerIds[0]]
    );
    await new Promise((resolve) => setTimeout(resolve, KICKOFF_SOON_MS + 400));
    // After the deadline: the SAME pre-deadline header refuses new children —
    // no partial snapshot can ever be completed late.
    await assert.rejects(
      pool.query(
        `INSERT INTO "projection_snapshot_players" ("snapshot_id", "player_id", "sample_size") VALUES ($1, $2, 0)`,
        [id, seededPlayerIds[1]]
      ),
      /past its capture deadline/
    );
  });

  test('a mid-batch failure inside the capture transaction persists nothing', async () => {
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      const header = await conn.query(
        `INSERT INTO "projection_snapshots"
           ("season", "week", "scoring_profile", "scoring_hash", "model_version", "constants_hash",
            "release_sha", "cohort_hash", "cohort_size", "schedule_games", "schedule_hash",
            "protocol_version", "capture_not_after")
         VALUES (2080, 1, 'standard', 'hash-2080', 'test_model', 'c', 'r', 'co', 2, 2, 's', 1, $1)
         RETURNING "id"`,
        [new Date(Date.now() + 3600 * 1000)]
      );
      const id = header.rows[0].id;
      await conn.query(
        `INSERT INTO "projection_snapshot_players" ("snapshot_id", "player_id", "sample_size") VALUES ($1, $2, 0)`,
        [id, seededPlayerIds[0]]
      );
      // The injected failure: a child referencing a snapshot that does not exist.
      await assert.rejects(
        conn.query(
          `INSERT INTO "projection_snapshot_players" ("snapshot_id", "player_id", "sample_size") VALUES (999999, $1, 0)`,
          [seededPlayerIds[1]]
        )
      );
      await conn.query('ROLLBACK');
    } finally {
      conn.release();
    }
    const remains = await pool.query(`SELECT COUNT(*)::int AS "n" FROM "projection_snapshots" WHERE "season" = 2080`);
    assert.equal(remains.rows[0].n, 0, 'header and child both rolled back');
  });

  test('the real capture pipeline runs end-to-end, skips exact matches, and fails loudly on cohort drift', async (t) => {
    process.env.APP_RELEASE = 'pg-test-sha';
    t.after(() => { delete process.env.APP_RELEASE; });
    const holdout = require('../services/holdout.service');
    // The one-snapshot contract, enforced for real: if ANY read in the whole
    // capture pipeline (features, byes, anything) goes through the global
    // pool instead of the injected transaction connection, this throws and
    // the capture fails. This is the REAL generateProjections, not a mock.
    const poolModule = require('../modules/pool');
    t.mock.method(poolModule, 'query', async () => {
      throw new Error('capture leaked a read to the global pool');
    });
    const season = 2081;
    await seedSeason({ season });

    const first = await holdout.snapshotWeek({
      season, week: 1, profileName: 'standard',
      rules: require('../services/scoringRules').SCORING_PRESETS.standard,
      client: pool,
    });
    assert.ok(first.snapshotId > 0);
    assert.ok(first.inserted >= 3, 'cohort-complete: every seeded fantasy-position player');

    const again = await holdout.snapshotWeek({
      season, week: 1, profileName: 'standard',
      rules: require('../services/scoringRules').SCORING_PRESETS.standard,
      client: pool,
    });
    assert.equal(again.skipped, 'already complete', 'byte-for-byte identical provenance skips');

    // Cohort drift: a player appears after the capture.
    await pool.query(`INSERT INTO "players" ("name", "position", "nfl_team") VALUES ('PG TE', 'TE', 'NYJ')`);
    await assert.rejects(
      holdout.snapshotWeek({
        season, week: 1, profileName: 'standard',
        rules: require('../services/scoringRules').SCORING_PRESETS.standard,
        client: pool,
      }),
      /provenance mismatch/,
      'a drifted cohort must never silently replace or extend the captured one'
    );
  });

  test('the ledger tables are owned by the migrating role and usable by it despite policy-less RLS', async () => {
    const who = await pool.query('SELECT current_user AS "u"');
    const owners = await pool.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS "owner", c.relrowsecurity AS "rls"
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('projection_snapshots', 'projection_snapshot_players')`
    );
    assert.equal(owners.rows.length, 2);
    for (const row of owners.rows) {
      assert.equal(row.owner, who.rows[0].u, `${row.relname} must be owned by the migrating role — production runtime IS that role`);
      assert.equal(row.rls, true, `${row.relname} must have RLS enabled`);
    }
    // And a non-owner role, even WITH table grants, is stopped by policy-less
    // RLS — which is why ownership is the compatibility invariant above.
    await pool.query(`DO $$ BEGIN CREATE ROLE holdout_probe; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await pool.query('GRANT SELECT ON "projection_snapshots" TO holdout_probe');
    const conn = await pool.connect();
    try {
      await conn.query('SET ROLE holdout_probe');
      const blocked = await conn.query('SELECT COUNT(*)::int AS "n" FROM "projection_snapshots"');
      assert.equal(blocked.rows[0].n, 0, 'policy-less RLS filters every row for a non-owner');
      await conn.query('RESET ROLE');
    } finally {
      conn.release();
    }
  });

  // ---- Shadow-arm (Challenger) capture prototype, ADR 0050 -----------------
  // Test database only: nothing here attaches to a live capture. Each test
  // takes its own far-future season, because ledger rows can never be deleted.
  const CHALLENGER = Object.freeze({ kind: 'challenger:free_baseline_v3.2', modelVersion: 'free_baseline_v3.2' });
  const SERVED_VERSION = 'free_baseline_v3.1';

  function shadowCapture(season, challengers) {
    const holdout = require('../services/holdout.service');
    return holdout.snapshotWeek({
      season, week: 1, profileName: 'standard',
      rules: require('../services/scoringRules').SCORING_PRESETS.standard,
      client: pool,
      ...(challengers === undefined ? {} : { challengers }),
    });
  }

  async function ledgerHeaders(season) {
    const res = await pool.query(
      `SELECT "id", "capture_kind", "model_version" FROM "projection_snapshots"
       WHERE "season" = $1 AND "week" = 1 ORDER BY "capture_kind"`,
      [season]
    );
    return res.rows;
  }

  /**
   * Wrap the REAL generateProjections; `alter(args, run)` may replace the run
   * for one arm (identified by its constants), so every other arm stays real.
   */
  function alterRuns(t, alter) {
    const projection = require('../services/projection.service');
    const real = projection.generateProjections;
    t.mock.method(projection, 'generateProjections', async (args) => {
      const run = await real(args);
      return alter(args, run);
    });
  }

  const isChallengerRun = (args) => args.modelVersion === CHALLENGER.modelVersion;
  const shiftMeans = (run, delta) => ({
    ...run,
    projections: new Map([...run.projections].map(([id, p]) => [id, { ...p, mean: (p.mean ?? 0) + delta }])),
  });

  function shadowSetup(t, season, firstKickoffInMs) {
    process.env.APP_RELEASE = 'pg-test-sha';
    t.after(() => { delete process.env.APP_RELEASE; });
    return seedSeason({ season, firstKickoffInMs });
  }

  test('a Challenger arm writes a fourth header under its own kind and model version', async (t) => {
    await shadowSetup(t, 2090);
    const result = await shadowCapture(2090, [CHALLENGER]);
    assert.deepEqual(result.challengerFailures, [], 'the Challenger must not have been isolated away');
    const headers = await ledgerHeaders(2090);
    assert.deepEqual(
      headers.map((h) => [h.capture_kind, h.model_version]),
      [
        ['candidate:bw-15', SERVED_VERSION],
        ['candidate:bw-20', SERVED_VERSION],
        [CHALLENGER.kind, CHALLENGER.modelVersion],
        ['scheduled', SERVED_VERSION],
      ]
    );
    assert.equal(result.armSnapshotIds[CHALLENGER.kind], headers.find((h) => h.capture_kind === CHALLENGER.kind).id);
    assert.deepEqual(result.challengerFailures, []);
  });

  test('a Challenger whose means differ commits; the scheduled arm is untouched', async (t) => {
    await shadowSetup(t, 2091);
    alterRuns(t, (args, run) => (isChallengerRun(args) ? shiftMeans(run, 1) : run));
    await shadowCapture(2091, [CHALLENGER]);
    const headers = await ledgerHeaders(2091);
    assert.equal(headers.length, 4);
    const means = await pool.query(
      `SELECT "s"."capture_kind", "p"."player_id", "p"."mean"
       FROM "projection_snapshots" "s" JOIN "projection_snapshot_players" "p" ON "p"."snapshot_id" = "s"."id"
       WHERE "s"."season" = 2091 AND "s"."capture_kind" IN ('scheduled', $1)`,
      [CHALLENGER.kind]
    );
    const byKind = (kind) => new Map(means.rows.filter((r) => r.capture_kind === kind).map((r) => [r.player_id, Number(r.mean)]));
    const control = byKind('scheduled');
    const challenger = byKind(CHALLENGER.kind);
    assert.ok(control.size > 0);
    for (const [id, mean] of control) assert.equal(challenger.get(id), mean + 1);
  });

  test('a candidate:* arm whose means differ still rolls the whole capture back', async (t) => {
    await shadowSetup(t, 2092);
    alterRuns(t, (args, run) => (
      !isChallengerRun(args) && args.modelConstants.simulation.smoothingBandwidth === 0.2 ? shiftMeans(run, 1) : run
    ));
    await assert.rejects(shadowCapture(2092, [CHALLENGER]), /candidate:bw-20 mean diverged/);
    assert.equal((await ledgerHeaders(2092)).length, 0, 'the mean-equality abort is unchanged for candidate arms');
  });

  test('a Challenger that throws is isolated: three headers commit, no Challenger, retry skips', async (t) => {
    await shadowSetup(t, 2093);
    alterRuns(t, (args, run) => {
      if (isChallengerRun(args)) throw new Error('challenger engine exploded');
      return run;
    });
    const result = await shadowCapture(2093, [CHALLENGER]);
    const headers = await ledgerHeaders(2093);
    assert.deepEqual(headers.map((h) => h.capture_kind), ['candidate:bw-15', 'candidate:bw-20', 'scheduled']);
    assert.equal(result.challengerFailures.length, 1);
    assert.equal(result.challengerFailures[0].kind, CHALLENGER.kind);
    assert.match(result.challengerFailures[0].message, /challenger engine exploded/);

    // The week is complete for its required arms: asking again neither throws
    // nor appends a Challenger from a different day's computation.
    const again = await shadowCapture(2093, [CHALLENGER]);
    assert.equal(again.skipped, 'already complete');
    assert.equal((await ledgerHeaders(2093)).length, 3);

    // /api/health's obligation reader counts only REQUIRED_ARMS, so the
    // missing Challenger does not make the week incomplete.
    const holdout = require('../services/holdout.service');
    const reconciled = await holdout.reconcileObligations({ client: pool });
    const week = reconciled.obligations.find((o) => o.season === 2093 && o.week === 1 && o.profile === 'standard');
    assert.equal(week.state, 'captured');
    assert.equal(week.missingArms, undefined);
  });

  test('a Challenger that finishes after the cutoff is rolled back alone', async (t) => {
    await shadowSetup(t, 2094, 9000);
    const holdout = require('../services/holdout.service');
    const cutoff = holdout.captureNotAfterFor(2094, 1);
    alterRuns(t, async (args, run) => {
      if (isChallengerRun(args)) {
        const wait = new Date(cutoff).getTime() - Date.now() + 250;
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      return run;
    });
    const result = await shadowCapture(2094, [CHALLENGER]);
    const headers = await ledgerHeaders(2094);
    assert.deepEqual(headers.map((h) => h.capture_kind), ['candidate:bw-15', 'candidate:bw-20', 'scheduled']);
    assert.equal(result.challengerFailures.length, 1);
    assert.equal(result.challengerFailures[0].kind, CHALLENGER.kind);
  });

  test('a second call after a complete four-arm capture skips as already complete', async (t) => {
    await shadowSetup(t, 2095);
    const first = await shadowCapture(2095, [CHALLENGER]);
    const again = await shadowCapture(2095, [CHALLENGER]);
    assert.equal(again.skipped, 'already complete');
    assert.deepEqual(again.armSnapshotIds, first.armSnapshotIds);
    assert.equal((await ledgerHeaders(2095)).length, 4);
    // Calling without the opt-in (the scheduled path) is equally a skip.
    assert.equal((await shadowCapture(2095)).skipped, 'already complete');
  });

  test('a Challenger request that names a version this checkout cannot run fails before any write', async (t) => {
    await shadowSetup(t, 2096);
    await assert.rejects(
      shadowCapture(2096, [{ kind: 'challenger:no_such_version', modelVersion: 'no_such_version' }]),
      /no_such_version/
    );
    await assert.rejects(
      shadowCapture(2096, [{ kind: 'candidate:sneaky', modelVersion: CHALLENGER.modelVersion }]),
      /challenger:/
    );
    assert.equal((await ledgerHeaders(2096)).length, 0);
  });

  test('rolling back a NONEMPTY ledger refuses destructively', async () => {
    const count = await pool.query('SELECT COUNT(*)::int AS "n" FROM "projection_snapshots"');
    assert.ok(count.rows[0].n > 0, 'earlier tests left captured rows — the guard must see them');
    const migration = require(path.join(__dirname, '..', 'db', 'migrations', '20260730000001_projection_holdout_ledger.js'));
    await assert.rejects(migration.down(knex), /refusing to roll back a NONEMPTY holdout ledger/);
    const still = await pool.query('SELECT COUNT(*)::int AS "n" FROM "projection_snapshots"');
    assert.equal(still.rows[0].n, count.rows[0].n, 'nothing was destroyed by the refused rollback');
  });
}
