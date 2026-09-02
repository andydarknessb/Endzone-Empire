const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { tenureHandlers, tenure } = require('./helpers/tenureFakes');
const { weekHindsight } = require('../services/decision.service');

/**
 * Issue #736: hindsight over a SETTLED week must not contradict the score of
 * record.
 *
 * `weekHindsight` runs `optimalLineup` over every `lineup_entries` row of the
 * week with no tenure exclusion: neither the own-kickoff rule (#228) nor the
 * last-kickoff rule best ball carries (#635, ADR 0022). The settle pass
 * applies both, so for any team that churned after a kickoff the two numbers
 * disagree. In best ball the optimal lineup IS the score of record, so the
 * disagreement is visible on the matchup recap and the weekly recap names a
 * phantom "bench blunder".
 *
 * The fixture is the #635 churn case from settleScoreOfRecord.test.js, seeded
 * AFTER the advance rather than replayed: that suite proves the settle pass
 * writes 30 for it, so the week here is final with away_score 30 and both
 * bodies still have a row (#197 spares the Thursday row, the acquisition
 * materialized the Sunday one).
 */

const SEASON = 2026;
const WEEK = 8;
const LEAGUE_ID = 5;
const TEAM_A = 10;
const TEAM_B = 20;

const QB_A = 1; // Team A's QB, 8.0, Chiefs, Sunday
const ACQUIRED = 4; // RB, 30.0, Eagles, Sunday; picked up FRIDAY
const THURSDAY_MAN = 8; // QB, 10.0, Ravens, Thursday; cut FRIDAY

const HELD_ALL_SEASON = '2026-08-01T00:00:00.000Z';
const THURSDAY_KICKOFF = '2026-10-23T00:15:00.000Z';
const FRIDAY = '2026-10-23T12:00:00.000Z';
const KICKOFF = '2026-10-25T17:00:00.000Z'; // the week's LAST kickoff
const AFTER_GAMES = '2026-10-26T12:00:00.000Z';

const ROSTER_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
];

const PLAYER = new Map([
  [QB_A, { name: 'QB A', position: 'QB', nfl_team: 'Chiefs', fantasy_points: 8 }],
  [ACQUIRED, { name: 'Acquired RB', position: 'RB', nfl_team: 'Eagles', fantasy_points: 30 }],
  [THURSDAY_MAN, { name: 'Thursday Man', position: 'QB', nfl_team: 'Ravens', fantasy_points: 10 }],
]);

const SCHEDULE = {
  Chiefs: new Date(KICKOFF),
  Eagles: new Date(KICKOFF),
  Ravens: new Date(THURSDAY_KICKOFF),
};

/**
 * A settled week. `tenures` is explicit and `heldSince` stays null: this
 * suite is about the tenure predicate (see helpers/tenureFakes.js).
 */
function settledWorld({ bestBall, lineupEntries, tenures, awayScore }) {
  const league = {
    id: LEAGUE_ID,
    current_season: SEASON,
    current_week: WEEK + 1,
    best_ball: bestBall,
    roster_slots: ROSTER_SLOTS,
    bench_slots: 5,
    ir_slots: 1,
    scoring_rules: null,
    owner_id: 101,
  };
  const matchups = [{
    id: 90, league_id: LEAGUE_ID, season: SEASON, week: WEEK,
    home_team_id: TEAM_A, away_team_id: TEAM_B, final: true,
    home_score: 8, away_score: awayScore,
  }];
  const handlers = [
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [league] })],
    [/^SELECT 1 FROM "teams" WHERE "id" = \$1 AND "league_id" = \$2/, (text, [teamId]) => ({
      rows: [TEAM_A, TEAM_B].includes(teamId) ? [{ '?column?': 1 }] : [],
    })],
    [/^SELECT COUNT\(\*\)::int AS "n", BOOL_AND\("final"\) AS "all_final" FROM "matchups"/,
      (text, [leagueId, season, week]) => {
        const rows = matchups.filter((m) => m.league_id === leagueId && m.season === season && m.week === week);
        return { rows: [{ n: rows.length, all_final: rows.length > 0 && rows.every((m) => m.final) }] };
      }],
    ...tenureHandlers({ schedule: SCHEDULE, tenures, heldSince: null }),
    // weekHindsight's read: the week's rows joined to players and stats.
    [/^SELECT "lineup_entries"\."player_id", "players"\."name", "players"\."position"/,
      (text, [teamId, season, week]) => ({
        rows: lineupEntries
          .filter((e) => e.team_id === teamId && e.season === season && e.week === week)
          .map((e) => {
            const p = PLAYER.get(e.player_id);
            return {
              player_id: e.player_id, name: p.name, position: p.position,
              nfl_team: p.nfl_team, slot: e.slot, fantasy_points: p.fantasy_points,
            };
          }),
      })],
  ];
  return { league, matchups, fake: createFakePool(handlers) };
}

const row = (teamId, playerId, slot) =>
  ({ team_id: teamId, player_id: playerId, season: SEASON, week: WEEK, slot });

/** The #635 churn fixture, as the week looks once it has settled at 30. */
function churnedBestBall() {
  return settledWorld({
    bestBall: true,
    awayScore: 30,
    lineupEntries: [
      row(TEAM_A, QB_A, 'QB'),
      row(TEAM_B, THURSDAY_MAN, 'BENCH'),
      row(TEAM_B, ACQUIRED, 'BENCH'),
    ],
    tenures: [
      tenure(TEAM_A, QB_A, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, THURSDAY_MAN, new Date(HELD_ALL_SEASON), new Date(FRIDAY)),
      tenure(TEAM_B, ACQUIRED, new Date(FRIDAY)),
    ],
  });
}

const scoreOfRecord = (world) => Number(world.matchups[0].away_score);

test('#736 best ball: hindsight for a settled week agrees with the score of record after post-kickoff churn', async (t) => {
  const world = churnedBestBall();
  world.fake.install(t);

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  assert.equal(h.optimalPoints, scoreOfRecord(world),
    'the Thursday man was not held at the week\'s last kickoff, so he is not in the pool the score of record was settled from');
});

test('#736 best ball: a settled team never has points left on the bench (the optimal lineup IS the score of record)', async (t) => {
  const world = churnedBestBall();
  world.fake.install(t);

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  assert.equal(h.pointsLeftOnBench, 0,
    'the recap\'s "bench blunder" is this number; a best-ball team cannot leave points on a bench it does not set');
});

test('#736 standard: hindsight counts a player acquired AFTER his game, whom the settle pass excluded (#228)', async (t) => {
  // Same gap, standard league, own-kickoff rule: Team B picked up ACQUIRED on
  // Monday, after the Eagles played. The settle pass excluded him (#228) and
  // the week settled on the Thursday man alone at 10. Hindsight tells the
  // manager he left 30 points on a bench he could never have started from.
  const world = settledWorld({
    bestBall: false,
    awayScore: 10,
    lineupEntries: [
      row(TEAM_A, QB_A, 'QB'),
      row(TEAM_B, THURSDAY_MAN, 'QB'),
      row(TEAM_B, ACQUIRED, 'BENCH'),
    ],
    tenures: [
      tenure(TEAM_A, QB_A, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, THURSDAY_MAN, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, ACQUIRED, new Date(AFTER_GAMES)),
    ],
  });
  world.fake.install(t);

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  assert.equal(h.optimalPoints, 10, 'a post-game pickup was never startable, so he is not an optimal starter');
  assert.equal(h.pointsLeftOnBench, 0);
});

/* ------------------------------------------------------------------ *
 * Controls: what must stay green                                      *
 * ------------------------------------------------------------------ */

test('#736 control, best ball: a roster held through the week\'s last kickoff already agrees with the score of record', async (t) => {
  const world = settledWorld({
    bestBall: true,
    awayScore: 40,
    lineupEntries: [
      row(TEAM_A, QB_A, 'QB'),
      row(TEAM_B, THURSDAY_MAN, 'BENCH'),
      row(TEAM_B, ACQUIRED, 'BENCH'),
    ],
    tenures: [
      tenure(TEAM_A, QB_A, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, THURSDAY_MAN, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, ACQUIRED, new Date(HELD_ALL_SEASON)),
    ],
  });
  world.fake.install(t);

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  assert.equal(h.optimalPoints, 40);
});

test('#736 control, standard: the last-kickoff bound is best ball\'s alone; a Thursday starter cut on Friday still counts in hindsight', async (t) => {
  // Standard-league twin of the churn fixture. #190: his row survived and
  // scored, and the settle pool is bounded by slot occupancy, so hindsight
  // may legitimately see both bodies (QB 10 + RB 30).
  const world = settledWorld({
    bestBall: false,
    awayScore: 10,
    lineupEntries: [
      row(TEAM_A, QB_A, 'QB'),
      row(TEAM_B, THURSDAY_MAN, 'QB'),
      row(TEAM_B, ACQUIRED, 'BENCH'),
    ],
    tenures: [
      tenure(TEAM_A, QB_A, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, THURSDAY_MAN, new Date(HELD_ALL_SEASON), new Date(FRIDAY)),
      tenure(TEAM_B, ACQUIRED, new Date(FRIDAY)),
    ],
  });
  world.fake.install(t);

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  assert.equal(h.optimalPoints, 40, 'both were held at their own kickoffs; the RB was benched, so 30 really was left there');
  assert.equal(h.pointsLeftOnBench, 30);
});
