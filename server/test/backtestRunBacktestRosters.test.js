'use strict';

/**
 * `server/scripts/run-backtest-rosters.js`'s own real-wiring functions -
 * specifically the DEF prior-game history a candidate ranking needs
 * (`buildDefensePriorGamesIndex`, `computeDefenseTeamPoints`) and the branch
 * in `makeBuildCandidatesFor` that looks a DEF pseudo-player's history up by
 * `teamKey` instead of `gsisId`.
 *
 * WHY THIS FILE EXISTS, AND WHY THE BUG IT COVERS WAS INVISIBLE BEFORE IT
 *
 * `scripts/backtest/lib/rosterGeneration.js`'s own tests
 * (`backtestRosterGeneration.test.js`) inject a FAKE `buildCandidatesFor`, so
 * they can never catch a bug in this file's REAL `makeBuildCandidatesFor` - and
 * until this file existed, nothing exercised it at all. The bug: every cohort
 * member's prior-game history was looked up by `member.gsisId`, but a DEF
 * pseudo-player has no `gsisId` (`cohort.js` sets it to `null` for DEF
 * members), so every DEF candidate's `priorGames` was always `[]`,
 * `rosters.recencyWeightedScore` always returned `null` ("no prior game"), and
 * every DEF candidate was silently dropped before the DEF quota
 * (`CANDIDATE_QUOTAS.DEF = 10`) could ever be filled.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const runRosters = require('../scripts/run-backtest-rosters');
const rosters = require('../../scripts/backtest/lib/rosters');

// ---------------------------------------------------------------------------
// fixtures - same shape as `backtestCohort.test.js`'s DEF synthesis fixtures
// ---------------------------------------------------------------------------

const GAME_W3 = {
  game_id: '2025_03_WAS_KC', season: 2025, week: 3, game_type: 'REG',
  home_team: 'KC', away_team: 'WAS', home_score: 27, away_score: 20,
};
const GAME_W4 = {
  game_id: '2025_04_KC_DEN', season: 2025, week: 4, game_type: 'REG',
  home_team: 'DEN', away_team: 'KC', home_score: 17, away_score: 24,
};

const TEAM_WEEK_ROWS = [
  {
    season: 2025, week: 3, season_type: 'REG', team: 'KC', opponent_team: 'WAS', game_id: GAME_W3.game_id,
    def_sacks: 3, def_interceptions: 1, def_fumbles_forced: 0, def_tds: 0, def_safeties: 0,
    passing_yards: 200, sack_yards_lost: -10, rushing_yards: 80,
  },
  {
    season: 2025, week: 3, season_type: 'REG', team: 'WAS', opponent_team: 'KC', game_id: GAME_W3.game_id,
    def_sacks: 1, def_interceptions: 0, def_fumbles_forced: 0, def_tds: 0, def_safeties: 0,
    passing_yards: 180, sack_yards_lost: 0, rushing_yards: 60,
  },
  {
    season: 2025, week: 4, season_type: 'REG', team: 'KC', opponent_team: 'DEN', game_id: GAME_W4.game_id,
    def_sacks: 2, def_interceptions: 0, def_fumbles_forced: 1, def_tds: 0, def_safeties: 0,
    passing_yards: 150, sack_yards_lost: -5, rushing_yards: 90,
  },
  {
    season: 2025, week: 4, season_type: 'REG', team: 'DEN', opponent_team: 'KC', game_id: GAME_W4.game_id,
    def_sacks: 0, def_interceptions: 1, def_fumbles_forced: 0, def_tds: 0, def_safeties: 0,
    passing_yards: 220, sack_yards_lost: 0, rushing_yards: 40,
  },
];
const GAMES_ROWS = [GAME_W3, GAME_W4];

function outcomeSourceContextFor(season) {
  assert.equal(season, 2025, 'this fixture only carries 2025 rows');
  return { playerWeekRows: [], teamWeekRows: TEAM_WEEK_ROWS, gamesRows: GAMES_ROWS };
}

// ---------------------------------------------------------------------------
// computeDefenseTeamPoints
// ---------------------------------------------------------------------------

test('computeDefenseTeamPoints scores a team-week present in both pinned sources', () => {
  const teamWeekRowByTeamKey = new Map([
    ['KC', TEAM_WEEK_ROWS[0]],
    ['WAS', TEAM_WEEK_ROWS[1]],
  ]);
  const gameByTeamKey = new Map([['KC', GAME_W3], ['WAS', GAME_W3]]);
  const points = runRosters.computeDefenseTeamPoints({
    teamKey: 'KC', teamWeekRowByTeamKey, gameByTeamKey, season: 2025, week: 3,
  });
  assert.equal(typeof points, 'number');
  assert.equal(Number.isFinite(points), true);
});

test('computeDefenseTeamPoints returns null, never a guessed value, when a source is missing', () => {
  const teamWeekRowByTeamKey = new Map([['KC', TEAM_WEEK_ROWS[0]]]);
  const gameByTeamKey = new Map(); // no game this week
  assert.equal(runRosters.computeDefenseTeamPoints({
    teamKey: 'KC', teamWeekRowByTeamKey, gameByTeamKey, season: 2025, week: 3,
  }), null);
});

// ---------------------------------------------------------------------------
// buildDefensePriorGamesIndex - Fix 1
// ---------------------------------------------------------------------------

test('buildDefensePriorGamesIndex builds a nonzero-length prior-game history per DEF team key', () => {
  const index = runRosters.buildDefensePriorGamesIndex({ outcomeSourceContextFor, seasons: [2025] });

  const kc = index.get('KC');
  assert.ok(Array.isArray(kc), 'KC has an entry at all');
  assert.equal(kc.length, 2, 'KC appears in both pinned weeks of the fixture');
  assert.deepEqual(kc.map((g) => g.week).sort(), [3, 4]);
  for (const game of kc) {
    assert.equal(game.season, 2025);
    assert.equal(typeof game.points, 'number');
    assert.equal(Number.isFinite(game.points), true);
  }

  const den = index.get('DEN');
  assert.equal(den.length, 1, 'DEN only appears in the week-4 fixture row');
  assert.equal(den[0].week, 4);
});

test('buildDefensePriorGamesIndex never invents a game for a team absent from a week', () => {
  const index = runRosters.buildDefensePriorGamesIndex({ outcomeSourceContextFor, seasons: [2025] });
  // WAS only appears in week 3's fixture rows, never week 4.
  const was = index.get('WAS');
  assert.equal(was.length, 1);
  assert.equal(was[0].week, 3);
});

// ---------------------------------------------------------------------------
// makeBuildCandidatesFor - the regression this whole file exists to catch
// ---------------------------------------------------------------------------

function makeRankFixture() {
  return {
    positionRankRows: [{ code: 'DEF', rank: 1 }, { code: 'QB', rank: 2 }],
    // buildRankIndex refuses an empty name-rank artifact even though a DEF
    // candidate never consults it (rosters.rankCandidates skips the lookup
    // for isDefense candidates) - one row is enough to satisfy the shape.
    playerNameRankRows: [{ id: 1, rank: 1 }],
  };
}

test('a DEF pseudo-player is looked up by teamKey, not gsisId - it is not silently dropped', () => {
  const priorGamesByGsis = new Map(); // deliberately empty: no human history in this fixture
  const priorGamesByTeamKey = new Map([
    ['KC', [{ season: 2025, week: 3, points: 8 }, { season: 2025, week: 4, points: 5 }]],
  ]);
  const { positionRankRows, playerNameRankRows } = makeRankFixture();

  const buildCandidatesFor = runRosters.makeBuildCandidatesFor({
    priorGamesByGsis, priorGamesByTeamKey, positionRankRows, playerNameRankRows,
  });

  const cohort = {
    members: [
      { playerId: 999, teamKey: 'KC', position: 'DEF', isDefense: true, gsisId: null },
    ],
  };

  const { candidates } = buildCandidatesFor({ season: 2025, week: 5, cohort });

  // Before the fix, this member's priorGames came from
  // `priorGamesByGsis.get(null)` -> `undefined` -> `[]`, `recencyWeightedScore`
  // returned `null`, and the candidate was filtered out entirely (0 candidates).
  assert.equal(candidates.length, 1, 'the DEF candidate must survive into the pool, not be dropped');
  assert.equal(candidates[0].playerId, 999);
  assert.equal(candidates[0].teamKey, 'KC');
  assert.equal(candidates[0].isDefense, true);
});

test('the DEF branch does not accidentally also satisfy a human member from priorGamesByTeamKey', () => {
  const priorGamesByGsis = new Map([
    ['00-0012345', [{ season: 2025, week: 3, points: 12 }]],
  ]);
  const priorGamesByTeamKey = new Map(); // no DEF history at all in this fixture
  const { positionRankRows, playerNameRankRows } = makeRankFixture();

  const buildCandidatesFor = runRosters.makeBuildCandidatesFor({
    priorGamesByGsis, priorGamesByTeamKey, positionRankRows, playerNameRankRows,
  });

  const cohort = {
    members: [
      { playerId: 42, teamKey: 'KC', position: 'QB', isDefense: false, gsisId: '00-0012345' },
      { playerId: 999, teamKey: 'KC', position: 'DEF', isDefense: true, gsisId: null },
    ],
  };

  const { candidates } = buildCandidatesFor({ season: 2025, week: 5, cohort });
  // The human is rankable (his gsisId history exists); the DEF is not (its
  // teamKey has no entry in this fixture's priorGamesByTeamKey) - each kind
  // consults its OWN index, never the other's.
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].playerId, 42);
});

test('DEF prior games flow all the way to a fillable DEF quota in selectCandidatePool', () => {
  const teamKeys = ['KC', 'DEN', 'WAS', 'BUF', 'SF', 'DAL', 'GB', 'NE', 'MIA', 'LAR'];
  const priorGamesByTeamKey = new Map(
    teamKeys.map((teamKey, i) => [teamKey, [{ season: 2025, week: 3, points: 5 + i }]])
  );
  const { positionRankRows, playerNameRankRows } = makeRankFixture();

  const buildCandidatesFor = runRosters.makeBuildCandidatesFor({
    priorGamesByGsis: new Map(), priorGamesByTeamKey, positionRankRows, playerNameRankRows,
  });

  const cohort = {
    members: teamKeys.map((teamKey, i) => ({
      playerId: 100 + i, teamKey, position: 'DEF', isDefense: true, gsisId: null,
    })),
  };

  const { candidates, positionRank, nameRankById } = buildCandidatesFor({ season: 2025, week: 5, cohort });
  assert.equal(candidates.length, 10, 'all ten DEF candidates are rankable');

  const ranked = rosters.rankCandidates({ candidates, positionRank, nameRankById, label: 'test' });
  const pool = rosters.selectCandidatePool({ ranked, quotas: { DEF: 10 }, label: 'test' });
  assert.equal(pool.length, 10, 'the DEF quota is exactly filled, not short');
});
