/**
 * Disposable-Postgres test of the one Stat line write (#1760, spec #1758): one
 * Player-week goes through every source in turn, on a real Postgres, and the
 * stored `stats` and `fantasy_points` are asserted after each step:
 *
 *   box apply -> nflverse week unit -> snap unit -> nflverse correction -> box apply
 *
 * What the table test (storedStatLine.test.js) and the writers' fakes cannot
 * prove and this does: the four writers and the box path, wired to the real
 * write module and a real jsonb column, leave each other's keys alone. Red when
 * a writer stops passing its source or prior line, or the table's carry
 * changes: the snap keys and touchdown-length lists would vanish at the
 * correction, or the second box apply would drop the nflverse keys.
 *
 * Gated exactly like the other *.pg.test.js files: PG_TESTS=1 (or the per-file
 * STATLINESOURCES_PG_TESTS=1) must be set and every DATABASE_URL* variable
 * ABSENT - connections are built from PG* variables only, so a stray local run
 * can never touch the shared production database. Locally these report as a
 * visible SKIP; CI's migration-smoke job is the binding run.
 *
 * Run with `PG_TESTS=1 node --test server/test/statLineSources.pg.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const ENABLED = process.env.PG_TESTS === '1' || process.env.STATLINESOURCES_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);
const missingPgDatabase = !process.env.PGDATABASE;

if (!ENABLED) {
  test('statLineSources PG tests (skipped: set PG_TESTS=1 or STATLINESOURCES_PG_TESTS=1; CI migration-smoke runs these)',
    { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('statLineSources PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else if (missingPgDatabase) {
  test('statLineSources PG tests refuse to run without PGDATABASE set', () => {
    assert.fail('set PGDATABASE (and the other PG* connection vars) to a disposable database - '
      + 'this file connects through server/modules/pool.js, which falls back to the local dev '
      + 'database name ("endzone_empire") when PGDATABASE is unset, and these tests write and delete real rows');
  });
} else {
  const pool = require('../modules/pool');
  const { applyGameBoxScore, loadWeekMaps } = require('../services/boxScoreApply.service');
  const { calculateFantasyPoints } = require('../services/scoringRules');
  const {
    applyNflverseWeek, syncNflverseSnaps, syncNflverseCorrection,
  } = require('../services/nflverseSync.service');

  // Disposable-DB-only marker values (int4 columns: keep them small).
  const SEASON = 900431;
  const WEEK = 1;
  const GAME = `${SEASON}_01_BUF_KC`;
  const JOBS = ['nflverse-correction', 'nflverse-snaps'];

  const fileStartedAt = new Date();
  let player = null;

  test.after(async () => {
    try {
      if (player) {
        await pool.query(`DELETE FROM "player_stats" WHERE "player_id" = $1`, [player.id]);
        await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [player.id]);
      }
      await pool.query(`DELETE FROM "player_stats" WHERE "season" = $1`, [SEASON]);
      await pool.query(
        `DELETE FROM "data_sync_runs" WHERE "job" = ANY($1) AND "started_at" >= $2`,
        [JOBS, fileStartedAt]
      );
    } finally {
      await pool.end();
    }
  });

  const stored = async () => {
    const row = (await pool.query(
      `SELECT "stats", "fantasy_points" FROM "player_stats" WHERE "player_id" = $1 AND "season" = $2 AND "week" = $3`,
      [player.id, SEASON, WEEK]
    )).rows[0];
    assert.ok(row, 'a player_stats row exists');
    // The funnel scores the row it stores, at every step.
    assert.equal(Number(row.fantasy_points), calculateFantasyPoints(row.stats), 'fantasy_points describes the stored stats');
    return { stats: row.stats, points: Number(row.fantasy_points) };
  };

  const boxApply = async (stats) => {
    const maps = await loadWeekMaps({ season: SEASON, week: WEEK });
    return applyGameBoxScore({
      liveBox: { gameId: GAME, source: 'tank01', isFinal: false, players: [{ externalId: String(player.externalId), stats }], teamDefense: {} },
      season: SEASON,
      week: WEEK,
      maps,
    });
  };

  test('one Player-week through box, week unit, snap unit, correction and a second box apply', async (t) => {
    const externalId = SEASON + 100; // clear of the sibling nflverseCorrection file's range
    const row = (await pool.query(
      `INSERT INTO "players" ("external_id", "name", "position", "nfl_team") VALUES ($1, 'Disposable Line QB', 'QB', 'KC') RETURNING "id"`,
      [externalId]
    )).rows[0];
    player = { id: row.id, externalId, gsis: `00-disposable-${row.id}` };
    const crosswalk = new Map([[player.gsis, String(externalId)]]);

    // 1. box apply creates the line.
    await boxApply({ passingYards: 250, passingTDs: 2, passingTDLengths: [30, 10], receptions: 0 });
    const afterBox = await stored();
    assert.equal(afterBox.stats.passingYards, 250);
    assert.equal(afterBox.points, 18, '250 yards at 0.04 plus two touchdowns at 4');
    assert.deepEqual(afterBox.stats.passingTDLengths, [30, 10]);

    // 2. the nflverse week unit patches its owned keys onto that line.
    const weekRows = [{
      season: String(SEASON), week: String(WEEK), season_type: 'REG', player_id: player.gsis,
      def_sack_yards: '5', target_share: '0.3', air_yards_share: '0.2', wopr: '0.5', receiving_epa: '1.5',
    }];
    const week = await applyNflverseWeek({ season: SEASON, week: WEEK, defRows: weekRows, crosswalk, rescoreLeagues: false });
    assert.equal(week.playersUpdated, 1);
    const afterWeek = await stored();
    assert.equal(afterWeek.stats.passingYards, 250, 'the box keys survive the patch');
    assert.deepEqual(afterWeek.stats.passingTDLengths, [30, 10]);
    assert.equal(afterWeek.stats.idpSackYards, 5);
    assert.equal(afterWeek.points, 18, 'the unscored patch keys move no points');
    assert.equal(afterWeek.stats.usageTargetShare, 0.3);
    assert.equal(afterWeek.stats.epaReceiving, 1.5);

    // 3. the snap unit patches the four snap keys onto the same line.
    t.mock.method(axios, 'get', async (url) => {
      if (url.includes('snap_counts_')) {
        return {
          data: [
            'season,week,game_type,pfr_player_id,team,offense_snaps,offense_pct,defense_snaps,defense_pct',
            `${SEASON},${WEEK},REG,PfrDisposable01,KC,61,0.93,0,0`,
          ].join('\n'),
        };
      }
      return { data: '' };
    });
    const snaps = await syncNflverseSnaps({
      season: SEASON, week: WEEK, pfrCrosswalk: new Map([['PfrDisposable01', String(externalId)]]),
    });
    assert.equal(snaps.playersUpdated, 1);
    t.mock.restoreAll();
    const afterSnaps = await stored();
    assert.equal(afterSnaps.stats.usageOffenseSnaps, 61);
    assert.equal(afterSnaps.stats.usageOffenseSnapPct, 0.93);
    assert.equal(afterSnaps.stats.usageTargetShare, 0.3, 'the week keys survive the snap patch');
    assert.equal(afterSnaps.stats.passingYards, 250);
    assert.equal(afterSnaps.points, 18, 'snap keys are unscored');

    // 4. the correction replaces the value it owns and carries what it does not.
    const correction = await syncNflverseCorrection({
      season: SEASON,
      week: WEEK,
      playerRows: [{
        season: String(SEASON), week: String(WEEK), season_type: 'REG', player_id: player.gsis,
        team: 'KC', opponent_team: 'BUF', passing_yards: '260', passing_tds: '3',
        def_sack_yards: '5', target_share: '0.35',
      }],
      teamRows: [
        { season: String(SEASON), week: String(WEEK), season_type: 'REG', game_id: GAME, team: 'KC', opponent_team: 'BUF' },
        { season: String(SEASON), week: String(WEEK), season_type: 'REG', game_id: GAME, team: 'BUF', opponent_team: 'KC' },
      ],
      scoresByGameId: new Map([[GAME, { homeTeam: 'KC', awayTeam: 'BUF', homeScore: 27, awayScore: 20 }]]),
      crosswalk,
    });
    assert.equal(correction.playersUpdated, 1);
    const afterCorrection = await stored();
    assert.equal(afterCorrection.stats.passingYards, 260, 'the correction value replaces the box value');
    assert.equal(afterCorrection.stats.passingTDs, 3);
    assert.equal(afterCorrection.points, 22.4, '260 yards at 0.04 plus three touchdowns at 4');
    assert.notEqual(afterCorrection.points, afterBox.points, 'the corrected line is scored again');
    assert.deepEqual(afterCorrection.stats.passingTDLengths, [30, 10], 'touchdown-length lists survive the correction');
    assert.equal(afterCorrection.stats.usageOffenseSnaps, 61, 'snap keys survive the correction');
    assert.equal(afterCorrection.stats.usageOffenseSnapPct, 0.93);
    assert.equal(afterCorrection.stats.usageTargetShare, 0.35, 'a key the correction owns takes its fresh value');
    assert.equal(afterCorrection.stats.gameTeam, 'KC');

    // 5. a second box apply keeps every nflverse key and replaces its own.
    await boxApply({ passingYards: 255, passingTDs: 3, passingTDLengths: [30, 10, 5], receptions: 0 });
    const afterSecondBox = await stored();
    assert.equal(afterSecondBox.stats.passingYards, 255, 'the box value replaces the correction value');
    assert.deepEqual(afterSecondBox.stats.passingTDLengths, [30, 10, 5]);
    assert.equal(afterSecondBox.points, 22.2, '255 yards at 0.04 plus three touchdowns at 4');
    assert.equal(afterSecondBox.stats.usageOffenseSnaps, 61, 'snap keys survive the second box apply');
    assert.equal(afterSecondBox.stats.usageTargetShare, 0.35);
    assert.equal(afterSecondBox.stats.idpSackYards, 5);
    assert.equal(afterSecondBox.stats.gameTeam, 'KC');
    assert.equal(afterSecondBox.stats.gameOpponent, 'BUF');
  });
}
