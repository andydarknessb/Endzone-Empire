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
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.HOLDOUT_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('holdout PG tests (skipped: HOLDOUT_PG_TESTS not set — CI migration-smoke runs these)', { skip: true }, () => {});
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
    // Register the matching manifest: the capture refuses seasons without one.
    require('../services/holdout.service').SEASON_MANIFESTS.set(season, built.manifest);
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

  async function insertHeader({ season, firstKickoffAt, isLate = false }) {
    const result = await pool.query(
      `INSERT INTO "projection_snapshots"
         ("season", "week", "scoring_profile", "scoring_hash", "model_version", "constants_hash",
          "release_sha", "cohort_hash", "cohort_size", "schedule_games", "schedule_hash",
          "protocol_version", "first_kickoff_at", "is_late")
       VALUES ($1, 1, 'standard', $4, 'test_model', 'chash', 'sha', 'cohash', 1, 2, 'shash', 1, $2, $3)
       RETURNING "id"`,
      [season, firstKickoffAt, isLate, `hash-${season}-${isLate ? 'late' : 'ontime'}`]
    );
    return result.rows[0].id;
  }

  test('UPDATE, DELETE and TRUNCATE are rejected on both ledger tables, even for the owner', async () => {
    const id = await insertHeader({ season: 2077, firstKickoffAt: new Date(Date.now() + 3600 * 1000) });
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

  test('the header CHECK rejects unlabeled post-kickoff captures and admits labeled late ones', async () => {
    const past = new Date(Date.now() - 3600 * 1000);
    await assert.rejects(
      insertHeader({ season: 2078, firstKickoffAt: past }),
      /pre_kickoff_check/,
      'an unlabeled late capture must fail at the database'
    );
    const lateId = await insertHeader({ season: 2078, firstKickoffAt: past, isLate: true });
    assert.ok(lateId > 0, 'explicitly labeled non-holdout captures are allowed through');
  });

  test('the child trigger independently rejects insertion after the parent kickoff passes', async () => {
    const kickoff = new Date(Date.now() + KICKOFF_SOON_MS);
    const id = await insertHeader({ season: 2079, firstKickoffAt: kickoff });
    // Before kickoff: accepted.
    await pool.query(
      `INSERT INTO "projection_snapshot_players" ("snapshot_id", "player_id", "sample_size") VALUES ($1, $2, 0)`,
      [id, seededPlayerIds[0]]
    );
    await new Promise((resolve) => setTimeout(resolve, KICKOFF_SOON_MS + 400));
    // After kickoff: the SAME pre-kickoff header refuses new children — no
    // partial snapshot can ever be completed late.
    await assert.rejects(
      pool.query(
        `INSERT INTO "projection_snapshot_players" ("snapshot_id", "player_id", "sample_size") VALUES ($1, $2, 0)`,
        [id, seededPlayerIds[1]]
      ),
      /past its kickoff cutoff/
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
            "protocol_version", "first_kickoff_at")
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
      rules: require('../services/scoring.service').SCORING_PRESETS.standard,
      client: pool,
    });
    assert.ok(first.snapshotId > 0);
    assert.ok(first.inserted >= 3, 'cohort-complete: every seeded fantasy-position player');

    const again = await holdout.snapshotWeek({
      season, week: 1, profileName: 'standard',
      rules: require('../services/scoring.service').SCORING_PRESETS.standard,
      client: pool,
    });
    assert.equal(again.skipped, 'already complete', 'byte-for-byte identical provenance skips');

    // Cohort drift: a player appears after the capture.
    await pool.query(`INSERT INTO "players" ("name", "position", "nfl_team") VALUES ('PG TE', 'TE', 'NYJ')`);
    await assert.rejects(
      holdout.snapshotWeek({
        season, week: 1, profileName: 'standard',
        rules: require('../services/scoring.service').SCORING_PRESETS.standard,
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

  test('rolling back a NONEMPTY ledger refuses destructively', async () => {
    const count = await pool.query('SELECT COUNT(*)::int AS "n" FROM "projection_snapshots"');
    assert.ok(count.rows[0].n > 0, 'earlier tests left captured rows — the guard must see them');
    const migration = require(path.join(__dirname, '..', 'db', 'migrations', '20260730000001_projection_holdout_ledger.js'));
    await assert.rejects(migration.down(knex), /refusing to roll back a NONEMPTY holdout ledger/);
    const still = await pool.query('SELECT COUNT(*)::int AS "n" FROM "projection_snapshots"');
    assert.equal(still.rows[0].n, count.rows[0].n, 'nothing was destroyed by the refused rollback');
  });
}
