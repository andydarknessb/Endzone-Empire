/**
 * Disposable-Postgres test for the player_stats integrity guard: a row
 * written from OUTSIDE the write funnel with points its stats do not support
 * (the 2026-09-15 audit's fixture shape) is recorded by the scan, and the
 * anomaly resolves once the row is rewritten through the funnel.
 *
 * Runs only in the CI migration-smoke job (PG_TESTS=1, PG* connection vars,
 * every DATABASE_URL* absent), through server/modules/pool.js like
 * playersFamilySync.pg.test.js. Uses a far-future season so nothing it
 * writes can collide with seeded data, and deletes its rows afterwards.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.PLAYERSTATSINTEGRITY_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('playerStatsIntegrity PG tests (skipped: set PG_TESTS=1 or PLAYERSTATSINTEGRITY_PG_TESTS=1; CI migration-smoke runs these)',
    { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('playerStatsIntegrity PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else if (!process.env.PGDATABASE) {
  test('playerStatsIntegrity PG tests refuse to run without PGDATABASE set', () => {
    assert.fail('set PGDATABASE (and the other PG* connection vars) to a disposable database');
  });
} else {
  const pool = require('../modules/pool');
  const { upsertPlayerStats } = require('../services/playerStatsWrite.service');
  const integrity = require('../services/playerStatsIntegrity.service');

  const SEASON = 2098;
  const FIXTURE = { receptions: 4, receivingYards: 40, receivingTDs: 1 };
  let playerId;

  test.before(async () => {
    const inserted = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ('PG Integrity WR', 'WR', 'IND') RETURNING "id"`
    );
    playerId = inserted.rows[0].id;
  });

  test.after(async () => {
    await pool.query(`DELETE FROM "player_stats_anomalies" WHERE "season" = $1`, [SEASON]);
    await pool.query(`DELETE FROM "player_stats_integrity_scans" WHERE "seasons" = $1::int[]`, [[SEASON]]);
    await pool.query(`DELETE FROM "player_stats" WHERE "season" = $1`, [SEASON]);
    await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [playerId]);
    await pool.end();
  });

  test('a hand-written row whose points disagree with its stats is recorded, then resolved once rewritten through the funnel', async () => {
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points") VALUES ($1, $2, 1, $3, 0)`,
      [playerId, SEASON, JSON.stringify(FIXTURE)]
    );

    const first = await integrity.scanPlayerStats({ seasons: [SEASON] });
    assert.equal(first.scanned, 1);
    assert.equal(first.open, 1);
    const anomalies = await pool.query(
      `SELECT "kind", "detail", "resolved_at" FROM "player_stats_anomalies" WHERE "player_id" = $1 AND "season" = $2`,
      [playerId, SEASON]
    );
    assert.equal(anomalies.rows.length, 1);
    assert.equal(anomalies.rows[0].kind, 'points-mismatch');
    assert.deepEqual(anomalies.rows[0].detail, { stored: 0, computed: 12 });
    assert.equal(anomalies.rows[0].resolved_at, null);

    const status = await integrity.getIntegrityStatus();
    assert.equal(status.ok, false);
    assert.ok(status.open >= 1);
    assert.ok(status.lastScanAt, 'the scan log row records when the scan finished');

    await upsertPlayerStats(pool, { playerId, season: SEASON, week: 1, stats: FIXTURE });
    const stored = await pool.query(
      `SELECT "fantasy_points"::float AS "points" FROM "player_stats" WHERE "player_id" = $1 AND "season" = $2 AND "week" = 1`,
      [playerId, SEASON]
    );
    assert.equal(stored.rows[0].points, 12, 'the funnel stores the score its stats support');

    const second = await integrity.scanPlayerStats({ seasons: [SEASON] });
    assert.equal(second.open, 0);
    assert.equal(second.resolved, 1);
    const resolved = await pool.query(
      `SELECT "resolved_at" FROM "player_stats_anomalies" WHERE "player_id" = $1 AND "season" = $2`,
      [playerId, SEASON]
    );
    assert.ok(resolved.rows[0].resolved_at, 'the anomaly is resolved in place, not deleted');
  });
}
