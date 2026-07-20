/** @jest-environment node */

const {
  buildOpeningBrackets,
  computeStandings,
  roundRobinPairings,
} = require('../../server/services/season.service');
const { runSimulation } = require('../../server/services/montecarlo.service');

const matchup = (week, home, away, homeScore, awayScore) => ({
  week,
  home_team_id: home,
  away_team_id: away,
  home_score: homeScore,
  away_score: awayScore,
  final: true,
  is_playoff: false,
});

const FOUR_WAY_TIE_TEAMS = [1, 2, 3, 4].map((id) => ({ id, name: `Tie Team ${id}` }));

// Complete 14-week matrix: every team finishes 7-7 with exactly 1,400.00 PF.
const FOUR_WAY_TIE_14_WEEK_MATRIX = Array.from({ length: 14 }, (_, index) => {
  const week = index + 1;
  const firstHalf = week <= 7;
  return [
    matchup(week, 1, 2, firstHalf ? 101.25 : 98.75, firstHalf ? 98.75 : 101.25),
    matchup(week, 3, 4, firstHalf ? 101.25 : 98.75, firstHalf ? 98.75 : 101.25),
  ];
}).flat();

const BRACKET_TEAMS = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  name: `Bracket Team ${index + 1}`,
}));

// Double round-robin matrix: 14 weeks, four games per week, each team plays
// every opponent twice. Lower ids are intentionally stronger for clear seeds.
const BRACKET_14_WEEK_MATRIX = Array.from({ length: 14 }, (_, index) => {
  const week = index + 1;
  return roundRobinPairings(BRACKET_TEAMS.map((team) => team.id), week).map(({ home, away }) => {
    const homeWins = home < away;
    return matchup(week, home, away, homeWins ? 130 : 90, homeWins ? 90 : 130);
  });
}).flat();

describe('Monte Carlo playoff projection and week-14 scheduling', () => {
  test('head-to-head record is the primary standing tiebreaker', () => {
    const teams = [1, 2, 3, 4].map((id) => ({ id, name: `Team ${id}` }));
    const standings = computeStandings(teams, [
      matchup(1, 1, 2, 50, 40),
      matchup(2, 2, 4, 200, 10),
      matchup(2, 1, 3, 20, 100),
    ]);
    const team1 = standings.find((row) => row.teamId === 1);
    const team2 = standings.find((row) => row.teamId === 2);

    expect(team1.winPct).toBe(team2.winPct);
    expect(team2.pf).toBeGreaterThan(team1.pf);
    expect(team1.rank).toBeLessThan(team2.rank);
  });

  test('points-for is the secondary tiebreaker when head-to-head is even', () => {
    const teams = [
      { id: 1, name: 'Team 1' },
      { id: 2, name: 'Team 2' },
    ];
    const standings = computeStandings(teams, [
      matchup(1, 1, 2, 100, 90),
      matchup(2, 2, 1, 105, 90),
    ]);

    expect(standings.map((row) => row.teamId)).toEqual([2, 1]);
    expect(standings[0]).toMatchObject({ wins: 1, losses: 1, pf: 195 });
    expect(standings[1]).toMatchObject({ wins: 1, losses: 1, pf: 190 });
  });

  test('four identical 7-7 teams remain finite and deterministic under simulation', () => {
    const standings = computeStandings(FOUR_WAY_TIE_TEAMS, FOUR_WAY_TIE_14_WEEK_MATRIX);
    expect(standings).toHaveLength(4);
    expect(standings.map(({ wins, losses, pf }) => ({ wins, losses, pf }))).toEqual(
      Array.from({ length: 4 }, () => ({ wins: 7, losses: 7, pf: 1400 }))
    );

    const models = new Map(FOUR_WAY_TIE_TEAMS.map(({ id }) => [id, { mean: 100, sigma: 15 }]));
    const odds = runSimulation({
      teams: FOUR_WAY_TIE_TEAMS,
      playedMatchups: FOUR_WAY_TIE_14_WEEK_MATRIX,
      remainingMatchups: [],
      models,
      playoffTeams: 2,
      runs: 500,
      seed: 2026,
    });
    const values = [...odds.values()];

    expect(values.every(({ playoffOdds, titleOdds }) =>
      Number.isFinite(playoffOdds) && Number.isFinite(titleOdds)
      && playoffOdds >= 0 && playoffOdds <= 1
      && titleOdds >= 0 && titleOdds <= 1)).toBe(true);
    expect(values.reduce((sum, row) => sum + row.playoffOdds, 0)).toBeCloseTo(2, 2);
    expect(values.reduce((sum, row) => sum + row.titleOdds, 0)).toBeCloseTo(1, 2);
  });

  test('week-14 standings populate championship and consolation brackets', () => {
    expect(BRACKET_14_WEEK_MATRIX).toHaveLength(56);
    for (let week = 1; week <= 14; week += 1) {
      const weekTeamIds = BRACKET_14_WEEK_MATRIX
        .filter((game) => game.week === week)
        .flatMap((game) => [game.home_team_id, game.away_team_id]);
      expect(new Set(weekTeamIds).size).toBe(8);
    }

    const standings = computeStandings(BRACKET_TEAMS, BRACKET_14_WEEK_MATRIX);
    const brackets = buildOpeningBrackets({
      standings,
      playoffTeams: 4,
      consolationEnabled: true,
    });

    expect(standings.map((row) => row.teamId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(brackets.playoff).toEqual({
      games: [{ home: 1, away: 4 }, { home: 2, away: 3 }],
      byes: [],
    });
    expect(brackets.consolation).toEqual({
      games: [{ home: 5, away: 8 }, { home: 6, away: 7 }],
      byes: [],
    });
  });
});
