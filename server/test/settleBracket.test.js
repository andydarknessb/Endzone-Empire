/**
 * #2742: a Stat correction that flips a finished playoff round never brings a
 * beaten Team back as a bye. A bye is a seeded Team that played no earlier
 * non-consolation playoff game; no score decides it (CONTEXT.md, Playoff seed).
 *
 * Seams: settleWeek (Advance week's Settle pass), observed through a fake pool.
 * The scores below are the stored Scores of record after the correction.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');

const LEAGUE_ID = 7;
const SEASON = 2026;

const league = ({ playoffTeams, currentWeek, consolation = false }) => ({
  id: LEAGUE_ID,
  current_season: SEASON,
  current_week: currentWeek,
  season_status: 'playoffs',
  draft_status: 'complete',
  regular_season_weeks: 14,
  playoff_teams: playoffTeams,
  playoff_consolation: consolation,
});

const game = (id, week, round, home, away, homeScore, awayScore, final) => ({
  id,
  week,
  is_playoff: true,
  is_consolation: false,
  playoff_round: round,
  home_team_id: home,
  away_team_id: away,
  home_score: homeScore,
  away_score: awayScore,
  final,
});

const consolationGame = (...args) => ({ ...game(...args), is_consolation: true });

const seeded = (count) =>
  Array.from({ length: count }, (_, i) => ({ team_id: i + 1, seed: i + 1 }));

const teamsFor = (count) =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, owner_id: null }));

/** Runs Advance week for `lg` and reports what it wrote. */
async function advance(t, { lg, teams, seeds, consolationSeeds = [], matchups }) {
  const inserted = [];
  const leagueUpdates = [];
  const fake = createFakePool([
    [/^UPDATE "leagues" SET "board_version"/, () => ({ rows: [lg] }), 'client'],
    [/^SELECT \* FROM "matchups" WHERE "league_id" = \$1 AND "season" = \$2 AND "week" = \$3$/,
      (_text, params) => ({ rows: matchups.filter((m) => m.week === Number(params[2])) })],
    [/^SELECT \* FROM "matchups" WHERE "league_id" = \$1 AND "season" = \$2$/,
      () => ({ rows: matchups })],
    [/^UPDATE "matchups" SET "final" = true/, () => ({ rows: [] })],
    [/^SELECT "id", "name", "owner_id" FROM "teams"/, () => ({ rows: teams })],
    [/^SELECT "team_id", "seed" FROM "playoff_seeds"/, () => ({ rows: seeds })],
    [/^SELECT "team_id", "seed" FROM "consolation_seeds"/, () => ({ rows: consolationSeeds })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [] })],
    [/^INSERT INTO "matchups"/, (text, params) => {
      inserted.push({ home: params[3], away: params[4], round: params[5], consolation: /"is_consolation"/.test(text) });
      return { rows: [] };
    }],
    [/^UPDATE "leagues" SET "(?:season_status|current_week)"/, (text, params) => {
      leagueUpdates.push({ text, params });
      return { rows: [] };
    }],
  ]);
  fake.install(t);

  const seasonSvc = require('../services/season.service');
  const matchupScoring = require('../services/matchupScoring.service');
  const settleFollowUpSvc = require('../services/settleFollowUp.service');
  // The scoring pass, the announcement and the follow-up are not under test here.
  t.mock.method(matchupScoring, 'scoreMatchupsInTransaction', async () => ({
    league: null, scored: [], openMatchups: [],
  }));
  t.mock.method(matchupScoring, 'announceScored', async () => {});
  t.mock.method(seasonSvc, 'resetWaiverPriorities', async () => {});
  t.mock.method(seasonSvc, 'materializeNewWeekLineups', async () => {});
  t.mock.method(settleFollowUpSvc, 'settleFollowUp', async () => {});

  const { settleWeek } = require('../services/settle.service');
  const result = await settleWeek({ leagueId: LEAGUE_ID, expectedWeek: lg.current_week });
  fake.assertClean();
  return { outcome: result.advance, inserted, leagueUpdates };
}

test('4-Team bracket: a round-one loser whose stored score now wins is no bye; the final crowns a champion', async (t) => {
  // Round one was settled 1 over 4 and 2 over 3, and the final was 1 over 2. The
  // correction then flipped 1 vs 4: the stored score now puts Team 4 ahead.
  const matchups = [
    game(101, 15, 1, 1, 4, 90, 100, true),
    game(102, 15, 1, 2, 3, 95, 80, true),
    game(103, 16, 2, 1, 2, 100, 90, false),
  ];
  const r = await advance(t, {
    lg: league({ playoffTeams: 4, currentWeek: 16 }),
    teams: teamsFor(4),
    seeds: seeded(4),
    matchups,
  });

  assert.equal(r.outcome.seasonStatus, 'complete');
  assert.equal(r.outcome.championTeamId, 1);
  assert.deepEqual(r.inserted, []);
});

test('6-Team bracket: the top two seeds skip round one and play round two', async (t) => {
  const matchups = [
    game(201, 15, 1, 3, 6, 100, 90, false),
    game(202, 15, 1, 4, 5, 80, 110, false),
  ];
  const r = await advance(t, {
    lg: league({ playoffTeams: 6, currentWeek: 15 }),
    teams: teamsFor(6),
    seeds: seeded(6),
    matchups,
  });

  assert.equal(r.outcome.seasonStatus, 'playoffs');
  assert.equal(r.outcome.playoffRound, 2);
  assert.deepEqual(
    r.inserted.map((g) => [g.home, g.away]),
    [[1, 5], [2, 3]]
  );
  assert.ok(r.inserted.every((g) => g.round === 2));
});

const pairs = (games) => games.map((g) => [g.home, g.away, g.round]);

test('4-Team Consolation bracket: round-one winners meet in round two; the championship is unchanged', async (t) => {
  const matchups = [
    game(301, 15, 1, 1, 4, 100, 90, true),
    game(302, 15, 1, 2, 3, 95, 80, true),
    consolationGame(303, 15, 1, 5, 8, 100, 90, true),
    consolationGame(304, 15, 1, 6, 7, 99, 98, true),
  ];
  const r = await advance(t, {
    lg: league({ playoffTeams: 4, currentWeek: 15, consolation: true }),
    teams: teamsFor(8),
    seeds: seeded(4),
    consolationSeeds: [5, 6, 7, 8].map((team_id, i) => ({ team_id, seed: i + 1 })),
    matchups,
  });

  assert.deepEqual(pairs(r.inserted.filter((g) => g.consolation)), [[5, 6, 2]]);
  assert.deepEqual(pairs(r.inserted.filter((g) => !g.consolation)), [[1, 2, 2]]);
});

test('6-Team Consolation bracket: byes join round two, and round three is the final', async (t) => {
  // Championship: 5 playoff Teams, Team 4 beats Team 5; seeds 1-3 bye.
  // Consolation: seeds 1 and 2 (Teams 6, 7) bye; 3v6 and 4v5 are round one.
  const weekOne = [
    game(401, 15, 1, 4, 5, 100, 90, false),
    consolationGame(402, 15, 1, 8, 11, 100, 90, false),
    consolationGame(403, 15, 1, 9, 10, 100, 90, false),
  ];
  const weekTwo = [
    game(501, 16, 2, 1, 4, 100, 90, false),
    game(502, 16, 2, 2, 3, 100, 90, false),
    consolationGame(503, 16, 2, 6, 9, 100, 90, false),
    consolationGame(504, 16, 2, 7, 8, 100, 90, false),
  ];
  const consolationSeeds = [6, 7, 8, 9, 10, 11].map((team_id, i) => ({ team_id, seed: i + 1 }));
  const args = { teams: teamsFor(11), seeds: seeded(5), consolationSeeds };

  const roundTwo = await advance(t, {
    ...args,
    lg: league({ playoffTeams: 5, currentWeek: 15, consolation: true }),
    matchups: weekOne,
  });
  assert.deepEqual(pairs(roundTwo.inserted.filter((g) => g.consolation)), [[6, 9, 2], [7, 8, 2]]);
  assert.deepEqual(pairs(roundTwo.inserted.filter((g) => !g.consolation)), [[1, 4, 2], [2, 3, 2]]);

  const roundThree = await advance(t, {
    ...args,
    lg: league({ playoffTeams: 5, currentWeek: 16, consolation: true }),
    matchups: weekOne.concat(weekTwo),
  });
  assert.deepEqual(pairs(roundThree.inserted.filter((g) => g.consolation)), [[6, 7, 3]]);
  assert.deepEqual(pairs(roundThree.inserted.filter((g) => !g.consolation)), [[1, 2, 3]]);
});

test('the consolation final in the championship final week: the season completes once, on the championship winner', async (t) => {
  const matchups = [
    game(601, 15, 1, 1, 4, 100, 90, true),
    game(602, 15, 1, 2, 3, 95, 80, true),
    consolationGame(603, 15, 1, 5, 8, 100, 90, true),
    consolationGame(604, 15, 1, 6, 7, 99, 98, true),
    game(605, 16, 2, 1, 2, 100, 90, true),
    consolationGame(606, 16, 2, 5, 6, 80, 90, true),
  ];
  const r = await advance(t, {
    lg: league({ playoffTeams: 4, currentWeek: 16, consolation: true }),
    teams: teamsFor(8),
    seeds: seeded(4),
    consolationSeeds: [5, 6, 7, 8].map((team_id, i) => ({ team_id, seed: i + 1 })),
    matchups,
  });

  assert.equal(r.outcome.seasonStatus, 'complete');
  assert.equal(r.outcome.championTeamId, 1);
  assert.deepEqual(r.inserted, []);
});
