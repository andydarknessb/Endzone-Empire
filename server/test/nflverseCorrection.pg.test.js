/**
 * Disposable-Postgres tests for the 'nflverse-correction' Sync run (#1676,
 * ADR 0036): the nflverse week rewrite runs in units of one game (both teams'
 * player rows and the two DST rows), each unit in its own `withTransaction`,
 * with the whole run's outcome on one data_sync_runs row.
 *
 * What a matcher fake (nflverseSync.service.test.js) cannot prove and this file
 * does, against real rows and a real constraint:
 *  - two seeded games write both games' player and DST rows and one ok run row
 *    with two units;
 *  - a game whose apply throws a REAL Postgres error (numeric overflow on
 *    player_stats.fantasy_points) rolls back that game's own earlier rows, leaves
 *    the other game's rows in place, and records the run write_failed with that
 *    game in its detail (red when the per-unit transaction is removed: the
 *    failing game's first player would survive; red when the transaction is
 *    slate-wide: the first game would vanish);
 *  - a Tank01-filled week keeps its play-by-play and snap carry-forward keys
 *    (red when the merge is dropped).
 *
 * Gated exactly like the other *.pg.test.js files: PG_TESTS=1 (or the per-file
 * NFLVERSECORRECTION_PG_TESTS=1) must be set and every DATABASE_URL* variable
 * ABSENT - connections are built from PG* variables only, so a stray local run
 * can never touch the shared production database. Locally these report as a
 * visible SKIP; CI's migration-smoke job is the binding run.
 *
 * Run with `PG_TESTS=1 node --test server/test/nflverseCorrection.pg.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const ENABLED = process.env.PG_TESTS === '1' || process.env.NFLVERSECORRECTION_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);
const missingPgDatabase = !process.env.PGDATABASE;

if (!ENABLED) {
  test('nflverseCorrection PG tests (skipped: set PG_TESTS=1 or NFLVERSECORRECTION_PG_TESTS=1; CI migration-smoke runs these)',
    { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('nflverseCorrection PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else if (missingPgDatabase) {
  test('nflverseCorrection PG tests refuse to run without PGDATABASE set', () => {
    assert.fail('set PGDATABASE (and the other PG* connection vars) to a disposable database - '
      + 'this file connects through server/modules/pool.js, which falls back to the local dev '
      + 'database name ("endzone_empire") when PGDATABASE is unset, and these tests write and delete real rows');
  });
} else {
  const pool = require('../modules/pool');
  const { syncNflverseCorrection, correctWeekFromNflverse } = require('../services/nflverseSync.service');
  const { lastRun } = require('../modules/syncRun');

  // Disposable-DB-only marker values (int4 columns: keep them small).
  const SEASON = 900430;
  const WEEK = 1;
  const GAME_1 = `${SEASON}_01_BUF_KC`;
  const GAME_2 = `${SEASON}_01_PHI_DAL`;

  const fileStartedAt = new Date();
  const seededPlayerIds = [];

  test.after(async () => {
    try {
      for (const id of seededPlayerIds) {
        await pool.query(`DELETE FROM "player_stats" WHERE "player_id" = $1`, [id]);
        await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [id]);
      }
      await pool.query(`DELETE FROM "player_stats" WHERE "season" = $1`, [SEASON]);
      await pool.query(
        `DELETE FROM "data_sync_runs" WHERE "job" = 'nflverse-correction' AND "started_at" >= $1`,
        [fileStartedAt]
      );
    } finally {
      await pool.end();
    }
  });

  let nextExternalId = SEASON;
  async function seedPlayer(name, position, team, { external = true } = {}) {
    const externalId = external ? nextExternalId++ : null;
    const row = (await pool.query(
      `INSERT INTO "players" ("external_id", "name", "position", "nfl_team") VALUES ($1, $2, $3, $4) RETURNING "id"`,
      [externalId, name, position, team]
    )).rows[0];
    seededPlayerIds.push(row.id);
    return { id: row.id, externalId, gsis: `00-disposable-${row.id}` };
  }

  const teamRow = (gameId, team, opponent) => ({
    season: String(SEASON), week: String(WEEK), season_type: 'REG', game_id: gameId, team, opponent_team: opponent,
  });
  const playerRow = (gsis, team, opponent, extra = {}) => ({
    season: String(SEASON), week: String(WEEK), season_type: 'REG', player_id: gsis,
    team, opponent_team: opponent, passing_yards: '300', ...extra,
  });
  const TEAM_ROWS = [
    teamRow(GAME_1, 'KC', 'BUF'), teamRow(GAME_1, 'BUF', 'KC'),
    teamRow(GAME_2, 'DAL', 'PHI'), teamRow(GAME_2, 'PHI', 'DAL'),
  ];
  const SCORES = new Map([
    [GAME_1, { homeTeam: 'KC', awayTeam: 'BUF', homeScore: 27, awayScore: 20 }],
    [GAME_2, { homeTeam: 'DAL', awayTeam: 'PHI', homeScore: 17, awayScore: 24 }],
  ]);
  const statRow = async (playerId) => (await pool.query(
    `SELECT "stats" FROM "player_stats" WHERE "player_id" = $1 AND "season" = $2 AND "week" = $3`,
    [playerId, SEASON, WEEK]
  )).rows[0];

  test('syncNflverseCorrection: two games write both games\' player and DST rows and one ok run row with two units', async () => {
    const qb1 = await seedPlayer('Disposable QB 1', 'QB', 'KC');
    const qb2 = await seedPlayer('Disposable QB 2', 'QB', 'DAL');
    const def1 = await seedPlayer('Disposable DEF KC', 'DEF', 'KC', { external: false });
    const def2 = await seedPlayer('Disposable DEF DAL', 'DEF', 'DAL', { external: false });

    const out = await syncNflverseCorrection({
      season: SEASON,
      week: WEEK,
      playerRows: [playerRow(qb1.gsis, 'KC', 'BUF'), playerRow(qb2.gsis, 'DAL', 'PHI')],
      teamRows: TEAM_ROWS,
      scoresByGameId: SCORES,
      crosswalk: new Map([[qb1.gsis, String(qb1.externalId)], [qb2.gsis, String(qb2.externalId)]]),
    });
    assert.equal(out.playersUpdated, 2);
    assert.equal(out.dstUpdated, 2);
    assert.equal(out.gamesInFile, 2);

    for (const p of [qb1, qb2, def1, def2]) {
      assert.ok(await statRow(p.id), `player_stats row written for ${p.gsis}`);
    }
    assert.equal((await statRow(def1.id)).stats.pointsAllowed, 20, 'KC DST: BUF scored 20');

    const { latest } = await lastRun('nflverse-correction');
    assert.equal(latest.ok, true);
    assert.equal(latest.detail.results.length, 2, 'one run row, two units (one per game)');
    assert.deepEqual(latest.detail.results.map((r) => r.gameId), [GAME_1, GAME_2]);
  });

  // Red-tell: remove the per-unit transaction and game 2's first player survives
  // its second player's real overflow; make it slate-wide and game 1 vanishes.
  test('syncNflverseCorrection: a game whose apply throws rolls back that game only, and the run is write_failed naming it', async () => {
    const qbA = await seedPlayer('Disposable Fail QB A', 'QB', 'KC');
    const qbB1 = await seedPlayer('Disposable Fail QB B1', 'QB', 'DAL');
    const qbB2 = await seedPlayer('Disposable Fail QB B2', 'QB', 'PHI');
    await pool.query(`DELETE FROM "player_stats" WHERE "season" = $1`, [SEASON]);

    await assert.rejects(
      syncNflverseCorrection({
        season: SEASON,
        week: WEEK,
        playerRows: [
          playerRow(qbA.gsis, 'KC', 'BUF'),
          playerRow(qbB1.gsis, 'DAL', 'PHI'),
          // idp.safety (2/unit) x 1e9 overflows decimal(8,2) fantasy_points: a real 22003.
          playerRow(qbB2.gsis, 'PHI', 'DAL', { def_safeties: '1000000000' }),
        ],
        teamRows: TEAM_ROWS,
        scoresByGameId: SCORES,
        crosswalk: new Map([
          [qbA.gsis, String(qbA.externalId)],
          [qbB1.gsis, String(qbB1.externalId)],
          [qbB2.gsis, String(qbB2.externalId)],
        ]),
      }),
      (err) => {
        assert.equal(err.code, '22003', 'a real Postgres numeric-overflow error, not a JS-level throw');
        return true;
      }
    );

    assert.ok(await statRow(qbA.id), 'game 1 stays applied');
    assert.equal(await statRow(qbB1.id), undefined, 'game 2 rolled back as one unit, including its first player');
    assert.equal(await statRow(qbB2.id), undefined);

    const { latest } = await lastRun('nflverse-correction');
    assert.equal(latest.ok, false);
    assert.equal(latest.detail.reason, 'write_failed');
    assert.equal(latest.detail.failed.length, 1);
    assert.match(latest.detail.failed[0].message, new RegExp(`game ${GAME_2}`), 'the failing game is named in the run detail');
  });

  // Red-tell: drop the preserveKeys merge and the play-by-play arrays and snap
  // keys Tank01 wrote are overwritten by the wholesale nflverse upsert.
  test('correctWeekFromNflverse: a Tank01-filled week keeps its play-by-play and snap carry-forward keys', async (t) => {
    const qb = await seedPlayer('Disposable Carry QB', 'QB', 'KC');
    await pool.query(`DELETE FROM "player_stats" WHERE "season" = $1`, [SEASON]);
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points") VALUES ($1, $2, $3, $4, 1)`,
      [qb.id, SEASON, WEEK, JSON.stringify({
        passingYards: 288, passingTDLengths: [42, 7], usageOffenseSnaps: 61, usageOffenseSnapPct: 0.93,
      })]
    );
    t.mock.method(axios, 'get', async (url) => {
      if (url.includes('stats_player_week')) {
        return {
          data: [
            'season,week,season_type,player_id,passing_yards,team,opponent_team',
            `${SEASON},${WEEK},REG,${qb.gsis},300,KC,BUF`,
          ].join('\n'),
        };
      }
      if (url.includes('players.csv')) return { data: `gsis_id,espn_id\n${qb.gsis},${qb.externalId}\n` };
      if (url.includes('stats_team_week')) {
        return {
          data: [
            'season,week,season_type,game_id,team,opponent_team',
            `${SEASON},${WEEK},REG,${GAME_1},KC,BUF`,
            `${SEASON},${WEEK},REG,${GAME_1},BUF,KC`,
          ].join('\n'),
        };
      }
      return { data: 'game_id,season,game_type,week\n' };
    });

    await correctWeekFromNflverse({ season: SEASON, week: WEEK, rescoreLeagues: false });

    const { stats } = await statRow(qb.id);
    assert.equal(stats.passingYards, 300, 'nflverse\'s corrected number wins');
    assert.deepEqual(stats.passingTDLengths, [42, 7], 'the play-by-play array survived');
    assert.equal(stats.usageOffenseSnaps, 61, 'the snap key survived');
    assert.equal(stats.usageOffenseSnapPct, 0.93);
  });
}
