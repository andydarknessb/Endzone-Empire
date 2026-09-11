/**
 * Disposable-Postgres tests for the players-table-family Sync run jobs
 * (#1204, ADR 0036): `players`, `season-stats` and `nflverse-week` now run
 * through runSyncJob, each writing its unit inside one `withTransaction`
 * (ADR 0033) instead of the per-row try/catch each one hand-rolled before.
 *
 * The issue's own red-tell, per job: apply throws partway through a
 * multi-row unit, and the table it writes is byte-identical to before - a
 * claim a matcher fake (fakePool, used in scoring.service.test.js and
 * nflverseSync.service.test.js) cannot prove against real Postgres, since it
 * never touches a real row or a real constraint. Each case forces the SECOND
 * row of a two-row unit to fail a REAL Postgres constraint (an integer-
 * column type error for `players.external_id`, a `numeric field overflow`
 * for the two stats tables' `decimal(8,2) fantasy_points` columns) while the
 * FIRST row's write is one a solo run would have kept - proving the two
 * rows share one transaction, not one each.
 *
 * `team-defenses` has no dedicated case here: its INSERT sets no column any
 * constraint protects (external_id stays NULL; `name`/`position`/`nfl_team`
 * carry no UNIQUE or CHECK), so no real feed data can make its second row
 * fail on this schema. Its wiring into runSyncJob/withTransaction is covered
 * by scoring.service.test.js's fakePool-based rollback-wiring test instead.
 *
 * Gated exactly like the other *.pg.test.js files: PG_TESTS=1 (or the
 * per-file PLAYERSFAMILYSYNC_PG_TESTS=1) must be set, and every DATABASE_URL*
 * variable must be ABSENT - connections are built from PG* variables only
 * (via the app's own server/modules/pool, the same pool runSyncJob itself
 * uses), so a stray local run can never touch the shared production
 * database. Locally these report as a visible SKIP, never a silent green.
 * CI's migration-smoke job (postgres:17 service, every migration applied) is
 * the binding run.
 *
 * Run with `node --test server/test/playersFamilySync.pg.test.js` (needs
 * PG_TESTS=1), alongside `node --test server/test/scoring.service.test.js
 * server/test/nflverseSync.service.test.js` (red-tell: those suites' fakePool
 * tests for the same jobs keep passing unchanged).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const ENABLED = process.env.PG_TESTS === '1' || process.env.PLAYERSFAMILYSYNC_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);
const missingPgDatabase = !process.env.PGDATABASE;

if (!ENABLED) {
  test('playersFamilySync PG tests (skipped: set PG_TESTS=1 or PLAYERSFAMILYSYNC_PG_TESTS=1; CI migration-smoke runs these)',
    { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('playersFamilySync PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else if (missingPgDatabase) {
  test('playersFamilySync PG tests refuse to run without PGDATABASE set', () => {
    assert.fail('set PGDATABASE (and the other PG* connection vars) to a disposable database - '
      + 'this file connects through server/modules/pool.js, which falls back to the local dev '
      + 'database name ("endzone_empire") when PGDATABASE is unset, and these tests write and delete real rows');
  });
} else {
  // The same pool runSyncJob itself requires, connected from PG* env.
  const pool = require('../modules/pool');
  const { syncPlayers, syncPlayerSeasonStats } = require('../services/scoring.service');
  const { syncNflverseWeek } = require('../services/nflverseSync.service');
  const { lastRun } = require('../modules/syncRun');

  // Disposable-DB-only marker values, well outside any real feed data, so
  // cleanup is exact and never touches another pg test file's fixtures.
  // players.external_id and player_stats/player_season_stats.season/week are
  // all real Postgres INTEGER columns (int4) - unlike the other *.pg.test.js
  // files' six-digit season constants, these must ALSO fit comfortably under
  // int4's ~2.1 billion ceiling with room for the `+N` offsets below, so they
  // stay small (900xxx), never a Date.now() timestamp (~1.7 trillion, already
  // out of int4 range on its own - confirmed against a real database while
  // authoring this file). `players.position` is varchar(10), so the
  // disposable position tag stays short too.
  const PLAYERS_VALID_EXTERNAL_ID = 900401;
  const SEASON_STATS_SEASON = 900410;
  const SEASON_STATS_CUTOFF = 900411;
  const SEASON_STATS_POSITION = 'ZZ9004';
  const NFLVERSE_SEASON = 900420;
  const NFLVERSE_WEEK = 1;
  const NFLVERSE_ESPN_A = 900421;
  const NFLVERSE_ESPN_B = 900422;

  const fileStartedAt = new Date();
  const seededPlayerIds = [];

  test.after(async () => {
    try {
      for (const id of seededPlayerIds) {
        await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [id]);
      }
      await pool.query(`DELETE FROM "players" WHERE "external_id" = $1`, [PLAYERS_VALID_EXTERNAL_ID]);
      await pool.query(`DELETE FROM "player_season_stats" WHERE "season" = $1`, [SEASON_STATS_SEASON]);
      await pool.query(`DELETE FROM "player_stats" WHERE "season" IN ($1, $2)`, [SEASON_STATS_SEASON, NFLVERSE_SEASON]);
      // Every data_sync_runs row this file's three jobs wrote since it
      // started (scheduleSync.pg.test.js's pattern): a failed run's detail
      // carries no season to filter on, so started_at is the only exact bound.
      await pool.query(
        `DELETE FROM "data_sync_runs" WHERE "job" IN ('players', 'season-stats', 'nflverse-week')
           AND "started_at" >= $1`,
        [fileStartedAt]
      );
    } finally {
      await pool.end();
    }
  });

  // Red-tell (players): remove withTransaction from the players job's apply
  // (or run it against the bare pool instead of the transaction client) and
  // this goes red - the valid first player survives despite the second
  // entry's real type error.
  test('syncPlayers: a later entry with a non-numeric external_id rolls back the whole run, including a valid entry already upserted', async () => {
    const api = async (path) => {
      assert.equal(path, '/getNFLPlayerList');
      return {
        data: {
          body: [
            { playerID: String(PLAYERS_VALID_EXTERNAL_ID), longName: 'Disposable Valid', pos: 'WR', team: 'BUF' },
            // players.external_id is INTEGER (20260710000001_initial_schema.js) -
            // a non-numeric playerID passes normalizePlayerEntry (truthy) but
            // fails Postgres's integer parse on INSERT (22P02).
            { playerID: 'not-a-number', longName: 'Disposable Invalid', pos: 'WR', team: 'MIA' },
          ],
        },
      };
    };

    await assert.rejects(syncPlayers({ season: 2026, api }), (err) => {
      assert.equal(err.code, '22P02', 'a real Postgres integer-parse error, not a JS-level throw');
      return true;
    });

    const after = await pool.query(`SELECT "id" FROM "players" WHERE "external_id" = $1`, [PLAYERS_VALID_EXTERNAL_ID]);
    assert.equal(after.rows.length, 0, 'the valid entry never persisted: the whole unit rolled back with the invalid one');

    const { latest } = await lastRun('players');
    assert.equal(latest.ok, false);
    assert.equal(latest.detail.reason, 'write_failed');
  });

  // Red-tell (season-stats): remove withTransaction from the season-stats
  // job's apply and this goes red - player A's rollup survives despite
  // player B's real numeric-overflow error.
  test('syncPlayerSeasonStats: a later player:season rollup that overflows fantasy_points rolls back the whole run, including one already upserted', async () => {
    const playerA = (await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, $2, 'BUF') RETURNING "id"`,
      ['Disposable Season-Stats A', SEASON_STATS_POSITION]
    )).rows[0];
    const playerB = (await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, $2, 'MIA') RETURNING "id"`,
      ['Disposable Season-Stats B', SEASON_STATS_POSITION]
    )).rows[0];
    seededPlayerIds.push(playerA.id, playerB.id);

    // A's single week is a normal total. B's rollup sums TWO weeks, each
    // individually within player_stats' own decimal(8,2) ceiling (999999.99)
    // but together (1999998) over player_season_stats' SAME decimal(8,2)
    // column - a real Postgres 22003 the job's SUM produces, not a
    // fabricated one.
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
       VALUES ($1, $2, 1, '{}', 12.5)`,
      [playerA.id, SEASON_STATS_SEASON]
    );
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
       VALUES ($1, $2, 1, '{}', 999999), ($1, $2, 2, '{}', 999999)`,
      [playerB.id, SEASON_STATS_SEASON]
    );

    await assert.rejects(
      syncPlayerSeasonStats({ currentSeason: SEASON_STATS_CUTOFF, positions: [SEASON_STATS_POSITION] }),
      (err) => {
        assert.equal(err.code, '22003', 'a real Postgres numeric-overflow error, not a JS-level throw');
        return true;
      }
    );

    const after = await pool.query(
      `SELECT "player_id" FROM "player_season_stats" WHERE "player_id" = ANY($1)`,
      [[playerA.id, playerB.id]]
    );
    assert.equal(after.rows.length, 0, 'player A\'s rollup never persisted: the whole unit rolled back with player B\'s overflow');

    const { latest } = await lastRun('season-stats');
    assert.equal(latest.ok, false);
    assert.equal(latest.detail.reason, 'write_failed');
  });

  // Red-tell (nflverse-week): remove withTransaction from the nflverse-week
  // job's apply and this goes red - player A's patch survives despite player
  // B's real numeric-overflow error. Also proves the unit covers only the
  // player_stats writes (#1204 ruling #2): the league re-score loop never
  // has a chance to run, since runSyncJob throws before syncNflverseWeek
  // reaches it.
  test('syncNflverseWeek: a later player patch that overflows fantasy_points rolls back the whole run, including one already written', async (t) => {
    const playerA = (await pool.query(
      `INSERT INTO "players" ("external_id", "name", "position", "nfl_team") VALUES ($1, $2, 'DL', 'BUF') RETURNING "id"`,
      [NFLVERSE_ESPN_A, 'Disposable IDP A']
    )).rows[0];
    const playerB = (await pool.query(
      `INSERT INTO "players" ("external_id", "name", "position", "nfl_team") VALUES ($1, $2, 'DL', 'MIA') RETURNING "id"`,
      [NFLVERSE_ESPN_B, 'Disposable IDP B']
    )).rows[0];
    seededPlayerIds.push(playerA.id, playerB.id);

    const gsisA = '00-disposable-a';
    const gsisB = '00-disposable-b';
    t.mock.method(axios, 'get', async (url) => {
      if (url.includes('stats_player_week')) {
        return {
          data: [
            'season,week,season_type,player_id,def_safeties',
            // A: a normal one-safety patch. idp.safety defaults to 2 points,
            // nowhere near player_stats' decimal(8,2) ceiling.
            `${NFLVERSE_SEASON},${NFLVERSE_WEEK},REG,${gsisA},1`,
            // B: idp.safety (2/unit) x 1e9 safeties overflows decimal(8,2) on
            // INSERT into player_stats.fantasy_points - a real Postgres 22003.
            `${NFLVERSE_SEASON},${NFLVERSE_WEEK},REG,${gsisB},1000000000`,
          ].join('\n'),
        };
      }
      if (url.includes('players.csv')) {
        return { data: `gsis_id,espn_id\n${gsisA},${NFLVERSE_ESPN_A}\n${gsisB},${NFLVERSE_ESPN_B}\n` };
      }
      return { data: '' };
    });

    await assert.rejects(syncNflverseWeek({ season: NFLVERSE_SEASON, week: NFLVERSE_WEEK }), (err) => {
      assert.equal(err.code, '22003', 'a real Postgres numeric-overflow error, not a JS-level throw');
      return true;
    });

    const after = await pool.query(
      `SELECT "player_id" FROM "player_stats" WHERE "player_id" = ANY($1) AND "season" = $2 AND "week" = $3`,
      [[playerA.id, playerB.id], NFLVERSE_SEASON, NFLVERSE_WEEK]
    );
    assert.equal(after.rows.length, 0, 'player A\'s patch never persisted: the whole unit rolled back with player B\'s overflow');

    const { latest } = await lastRun('nflverse-week');
    assert.equal(latest.ok, false);
    assert.equal(latest.detail.reason, 'write_failed');
  });
}
