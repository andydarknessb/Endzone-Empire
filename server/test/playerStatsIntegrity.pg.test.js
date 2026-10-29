/**
 * Disposable-Postgres test for the player_stats integrity guard: a row
 * written from OUTSIDE the write funnel with points its stats do not support
 * (the 2026-09-15 audit's fixture shape) is recorded by the scan, and the
 * anomaly resolves once the row is rewritten through the funnel. A third case
 * covers `unlabelled-appearance` (#2629) against a real `data_sync_runs`
 * frontier: a row on a week the correction pass settled, flagged then resolved
 * once the row carries a `gameTeam`.
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
  const UNLABELLED = { soloTackle: 1 };
  let playerId;

  test.before(async () => {
    const inserted = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ('PG Integrity WR', 'WR', 'IND') RETURNING "id"`
    );
    playerId = inserted.rows[0].id;
  });

  test.after(async () => {
    await pool.query(
      `DELETE FROM "data_sync_runs" WHERE "job" = 'nflverse-correction' AND "detail"->>'season' = $1`,
      [String(SEASON)]
    );
    await pool.query(`DELETE FROM "player_stats_anomalies" WHERE "season" = $1`, [SEASON]);
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

    await upsertPlayerStats(pool, { playerId, season: SEASON, week: 1, source: 'box', fresh: FIXTURE, prior: null });
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

  test('a row deleted after being flagged resolves on the next scan', async () => {
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points") VALUES ($1, $2, 2, $3, 0)`,
      [playerId, SEASON, JSON.stringify(FIXTURE)]
    );
    assert.equal((await integrity.scanPlayerStats({ seasons: [SEASON] })).open, 1);
    await pool.query(`DELETE FROM "player_stats" WHERE "player_id" = $1 AND "season" = $2 AND "week" = 2`, [playerId, SEASON]);
    const after = await integrity.scanPlayerStats({ seasons: [SEASON] });
    assert.equal(after.open, 0);
    assert.equal(after.resolved, 1, 'the incident fix (deleting the fabricated row) clears its anomaly');
  });

  // finished_at is explicit so the ordering case below can finish a run for an
  // older week later than one for a newer week.
  const insertCorrectionRun = (week, finishedAt) => pool.query(
    `INSERT INTO "data_sync_runs" ("job", "started_at", "ok", "finished_at", "detail")
     VALUES ('nflverse-correction', $1, true, $1, $2::jsonb)`,
    [finishedAt, JSON.stringify({ season: SEASON, week, gamesInFile: 16, games: [] })]
  );

  test('an unlabelled non-zero row on a week the correction pass settled is flagged, then resolved once labelled', async () => {
    await insertCorrectionRun(3, '2026-10-01T02:00:00Z');
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points") VALUES ($1, $2, 3, $3, 0)`,
      [playerId, SEASON, JSON.stringify(UNLABELLED)]
    );

    await integrity.scanPlayerStats({ seasons: [SEASON] });
    const flagged = await pool.query(
      `SELECT "kind", "resolved_at" FROM "player_stats_anomalies"
        WHERE "player_id" = $1 AND "season" = $2 AND "week" = 3 AND "kind" = 'unlabelled-appearance'`,
      [playerId, SEASON]
    );
    assert.equal(flagged.rows.length, 1);
    assert.equal(flagged.rows[0].resolved_at, null);

    await pool.query(
      `UPDATE "player_stats" SET "stats" = $3 WHERE "player_id" = $1 AND "season" = $2 AND "week" = 3`,
      [playerId, SEASON, JSON.stringify({ ...UNLABELLED, gameTeam: 'IND' })]
    );
    const second = await integrity.scanPlayerStats({ seasons: [SEASON] });
    assert.ok(second.resolved >= 1);

    const resolved = await pool.query(
      `SELECT "resolved_at" FROM "player_stats_anomalies"
        WHERE "player_id" = $1 AND "season" = $2 AND "week" = 3 AND "kind" = 'unlabelled-appearance'`,
      [playerId, SEASON]
    );
    assert.ok(resolved.rows[0].resolved_at, 'the anomaly resolves in place once the row is labelled');
  });

  test('a run that finished later for an older week does not move the settled frontier backwards', async () => {
    await insertCorrectionRun(4, '2026-10-02T00:00:00Z');
    await insertCorrectionRun(3, '2026-10-03T00:00:00Z'); // finishes last, names the older week
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points") VALUES ($1, $2, 4, $3, 0)`,
      [playerId, SEASON, JSON.stringify(UNLABELLED)]
    );

    await integrity.scanPlayerStats({ seasons: [SEASON] });

    const flagged = await pool.query(
      `SELECT "resolved_at" FROM "player_stats_anomalies"
        WHERE "player_id" = $1 AND "season" = $2 AND "week" = 4 AND "kind" = 'unlabelled-appearance'`,
      [playerId, SEASON]
    );
    assert.equal(flagged.rows.length, 1, 'week 4 stays settled although week 3 finished later');
    assert.equal(flagged.rows[0].resolved_at, null);
  });
}
