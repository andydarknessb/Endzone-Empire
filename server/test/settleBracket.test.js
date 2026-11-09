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

const league = ({ playoffTeams, currentWeek }) => ({
  id: LEAGUE_ID,
  current_season: SEASON,
  current_week: currentWeek,
  season_status: 'playoffs',
  draft_status: 'complete',
  regular_season_weeks: 14,
  playoff_teams: playoffTeams,
  playoff_consolation: false,
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

const seeded = (count) =>
  Array.from({ length: count }, (_, i) => ({ team_id: i + 1, seed: i + 1 }));

const teamsFor = (count) =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, owner_id: null }));

/** Runs Advance week for `lg` and reports what it wrote. */
async function advance(t, { lg, teams, seeds, matchups }) {
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
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [] })],
    [/^INSERT INTO "matchups"/, (_text, params) => {
      inserted.push({ home: params[3], away: params[4], round: params[5] });
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
