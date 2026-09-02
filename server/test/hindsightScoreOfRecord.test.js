const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { tenureHandlers, tenure } = require('./helpers/tenureFakes');
const { weekHindsight } = require('../services/decision.service');
const { scoreMatchups } = require('../services/scoring.service');

/**
 * Issue #736: hindsight over a SETTLED week must not contradict the score of
 * record.
 *
 * Before #736, `weekHindsight` ran `optimalLineup` over every `lineup_entries`
 * row of the week with no tenure exclusion: neither the own-kickoff rule
 * (#228) nor the last-kickoff rule best ball carries (#635, ADR 0022). The
 * settle pass applies both, so for any team that churned after a kickoff the
 * two numbers disagreed. In best ball the optimal lineup IS the score of
 * record, so the disagreement showed on the matchup page and the weekly recap
 * named a phantom "bench blunder". Hindsight now reads the settle pass's
 * population (ADR 0023); these tests hold it there.
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
const IR_STASH = 9; // RB, 50.0, Bills, Sunday; held all season, parked on IR

const HELD_ALL_SEASON = '2026-08-01T00:00:00.000Z';
const THURSDAY_KICKOFF = '2026-10-23T00:15:00.000Z';
const FRIDAY = '2026-10-23T12:00:00.000Z';
const KICKOFF = '2026-10-25T17:00:00.000Z'; // the week's LAST kickoff
const AFTER_GAMES = '2026-10-26T12:00:00.000Z';

const ROSTER_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
];

// Each player carries the raw `stats` the reader now prices (#739) AND the
// stored `fantasy_points` column, set to the DEFAULT-rules price. In this
// default-scoring suite (scoring_rules null) the two agree, so the numbers
// these tests assert are unchanged; the custom-scoring suite below is where
// they diverge and the column is proven unread.
const PLAYER = new Map([
  [QB_A, { name: 'QB A', position: 'QB', nfl_team: 'Chiefs', stats: { passingYards: 200 }, fantasy_points: 8 }],
  [ACQUIRED, { name: 'Acquired RB', position: 'RB', nfl_team: 'Eagles', stats: { rushingYards: 300 }, fantasy_points: 30 }],
  [THURSDAY_MAN, { name: 'Thursday Man', position: 'QB', nfl_team: 'Ravens', stats: { passingYards: 250 }, fantasy_points: 10 }],
  [IR_STASH, { name: 'IR Stash', position: 'RB', nfl_team: 'Bills', stats: { rushingYards: 500 }, fantasy_points: 50 }],
]);

const SCHEDULE = {
  Chiefs: new Date(KICKOFF),
  Eagles: new Date(KICKOFF),
  Ravens: new Date(THURSDAY_KICKOFF),
  Bills: new Date(KICKOFF),
};

/**
 * A settled week. `tenures` is explicit and `heldSince` stays null: this
 * suite is about the tenure predicate (see helpers/tenureFakes.js).
 */
function settledWorld({
  bestBall, lineupEntries, tenures, awayScore,
  scoringRules = null, players = PLAYER, rosterSlots = ROSTER_SLOTS, schedule = SCHEDULE,
}) {
  const league = {
    id: LEAGUE_ID,
    current_season: SEASON,
    current_week: WEEK + 1,
    best_ball: bestBall,
    roster_slots: rosterSlots,
    bench_slots: 5,
    ir_slots: 1,
    scoring_rules: scoringRules,
    owner_id: 101,
  };
  const matchups = [{
    id: 90, league_id: LEAGUE_ID, season: SEASON, week: WEEK,
    home_team_id: TEAM_A, away_team_id: TEAM_B, final: true,
    home_score: 8, away_score: awayScore,
  }];
  const rowsFor = (teamId, season, week) => lineupEntries
    .filter((e) => e.team_id === teamId && e.season === season && e.week === week);
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
    ...tenureHandlers({ schedule, tenures, heldSince: null }),
    // weekHindsight's read: the week's rows joined to players and stats. Each
    // row carries the raw `stats` the reader prices (#739) and the stored
    // default-rules `fantasy_points` column, so a test can prove the column is
    // unread by making the two disagree.
    [/^SELECT "lineup_entries"\."player_id", "players"\."name", "players"\."position"/,
      (text, [teamId, season, week]) => ({
        rows: rowsFor(teamId, season, week).map((e) => {
          const p = players.get(e.player_id);
          return {
            player_id: e.player_id, name: p.name, position: p.position,
            nfl_team: p.nfl_team, slot: e.slot, stats: p.stats, fantasy_points: p.fantasy_points,
          };
        }),
      })],
    // --- scoreMatchups (settle pass), for the best-ball agreement test ------
    [/^SELECT \* FROM "matchups"/, (text, [leagueId, season, week]) => ({
      rows: matchups
        .filter((m) => m.league_id === leagueId && m.season === season
          && (week === undefined || m.week === week))
        .map((m) => ({ ...m })),
    })],
    // Best ball's candidate read on the settle pass.
    [/^SELECT "lineup_entries"\."player_id", "lineup_entries"\."slot"/,
      (text, [teamId, season, week]) => ({
        rows: rowsFor(teamId, season, week).map((e) => {
          const p = players.get(e.player_id);
          return {
            player_id: e.player_id, slot: e.slot, position: p.position,
            nfl_team: p.nfl_team, stats: p.stats,
          };
        }),
      })],
    [/^UPDATE "matchups" SET "home_score"/, (text, [homeScore, awayScoreValue, id]) => {
      const matchup = matchups.find((m) => m.id === id);
      matchup.home_score = homeScore;
      matchup.away_score = awayScoreValue;
      return { rows: [] };
    }],
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
  assert.equal(world.fake.matching(/FROM "nfl_games"/).length, 1,
    'both kickoff questions are answered from one read of the week\'s schedule (#261)');
});

test('#736 best ball: an IR occupant stays stashed and never enters the hindsight pool', async (t) => {
  // The settle pass filters IR out of the best-ball pool after both tenure
  // exclusions; hindsight reads the same pool, so a 50-point stash cannot
  // become an optimal starter beside the 30-point replacement.
  const world = settledWorld({
    bestBall: true,
    awayScore: 30,
    lineupEntries: [
      row(TEAM_A, QB_A, 'QB'),
      row(TEAM_B, THURSDAY_MAN, 'BENCH'),
      row(TEAM_B, ACQUIRED, 'BENCH'),
      row(TEAM_B, IR_STASH, 'IR'),
    ],
    tenures: [
      tenure(TEAM_A, QB_A, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, THURSDAY_MAN, new Date(HELD_ALL_SEASON), new Date(FRIDAY)),
      tenure(TEAM_B, ACQUIRED, new Date(FRIDAY)),
      tenure(TEAM_B, IR_STASH, new Date(HELD_ALL_SEASON)),
    ],
  });
  world.fake.install(t);

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  assert.equal(h.optimalPoints, 30);
  assert.ok(!h.optimalStarters.some((s) => s.playerId === IR_STASH), 'the stash is not a starter');
});

test('#736 best ball: a settled team never has points left on the bench (the optimal lineup IS the score of record)', async (t) => {
  const world = churnedBestBall();
  world.fake.install(t);

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  assert.equal(h.pointsLeftOnBench, 0,
    'the recap\'s "bench blunder" is this number; a best-ball team cannot leave points on a bench it does not set');
});

test('#736 standard: a player acquired AFTER his game, whom the settle pass excluded (#228), is not left on the bench', async (t) => {
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

test('#736 standard: a post-game pickup seated in a STARTING slot leaves actual as well as optimal', async (t) => {
  // The settle pass selects starters and then applies the exclusion, so a
  // pickup seated in a starting slot after his game contributed nothing to
  // the score of record (#190). Hindsight's actual is the same sum: it does
  // not credit him and then report the credit as nothing left on the bench.
  const world = settledWorld({
    bestBall: false,
    awayScore: 10,
    lineupEntries: [
      row(TEAM_A, QB_A, 'QB'),
      row(TEAM_B, THURSDAY_MAN, 'QB'),
      row(TEAM_B, ACQUIRED, 'RB'),
    ],
    tenures: [
      tenure(TEAM_A, QB_A, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, THURSDAY_MAN, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, ACQUIRED, new Date(AFTER_GAMES)),
    ],
  });
  world.fake.install(t);

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  assert.equal(h.actualPoints, scoreOfRecord(world), 'actual is what the score of record counted');
  assert.equal(h.optimalPoints, 10);
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

/* ------------------------------------------------------------------ *
 * #741: a standard league's IR occupant is not an optimal starter.    *
 * The advisor never advises moving a man off IR before his kickoff,   *
 * and the settle pass never counts an IR row, so hindsight must not    *
 * offer his points as left on the bench. Standard and best ball agree. *
 * ------------------------------------------------------------------ */

test('#741 standard: an IR occupant is never an optimal starter, so his points are not left on the bench', async (t) => {
  // Standard league, one QB slot and one RB slot. The QB started and scored
  // 10; a 30-point RB sits on IR, held at his own kickoff so the tenure rule
  // (#228) keeps him in the as-played pool. The ONLY thing that must keep him
  // out of the optimal-lineup candidates is his IR slot. Before this ticket
  // the standard branch dropped IR from `actualPoints` but still pushed the
  // row into the candidate pool, so optimal read 40 and the recap named a
  // 30-point "bench blunder" for a man the advisor would never have started.
  const world = settledWorld({
    bestBall: false,
    awayScore: 10,
    lineupEntries: [
      row(TEAM_A, QB_A, 'QB'),
      row(TEAM_B, THURSDAY_MAN, 'QB'),
      row(TEAM_B, ACQUIRED, 'IR'),
    ],
    tenures: [
      tenure(TEAM_A, QB_A, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, THURSDAY_MAN, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, ACQUIRED, new Date(HELD_ALL_SEASON)),
    ],
  });
  world.fake.install(t);

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  assert.equal(h.actualPoints, 10, 'the IR row never counted toward the score of record');
  assert.equal(h.optimalPoints, 10, 'and could not have, so optimal is the started QB alone');
  assert.equal(h.pointsLeftOnBench, 0);
  assert.ok(!h.optimalStarters.some((s) => s.playerId === ACQUIRED),
    'the IR stash is not named an optimal starter');
  // Control: re-add the IR row to the candidate pool (the pre-fix standard
  // path, or flipping this row to BENCH) and optimal climbs to 40 with the
  // stash named a starter - which is exactly the #736 standard control above.
});

/* ------------------------------------------------------------------ *
 * #739: hindsight prices the week under the LEAGUE's rules, not the   *
 * stored default-rules fantasy_points column.                         *
 * ------------------------------------------------------------------ */

// A full-PPR league: reception is worth 1, not the half-PPR default 0.5.
const PPR_RULES = { receiving: { reception: 1 } };

const CUST_QB = 101;
const CUST_RB_PPR = 102; // catches make him worth more under PPR than the column says
const CUST_RB_YARDS = 103; // pure yardage: the same under either rule

// Each carries the raw `stats` the reader prices and the DEFAULT-rules
// `fantasy_points` column, deliberately set to the half-PPR price so a reader
// that used the column (or default rules) returns a different, wrong number.
//   PPR RB: 50 rush yds (5) + 18 catches -> default 5 + 9 = 14, full PPR 5 + 18 = 23
//   Yards RB: 200 rush yds -> 20 under either rule
const CUSTOM_PLAYERS = new Map([
  [CUST_QB, { name: 'Cust QB', position: 'QB', nfl_team: 'Chiefs', stats: { passingYards: 200 }, fantasy_points: 8 }],
  [CUST_RB_PPR, { name: 'PPR RB', position: 'RB', nfl_team: 'Eagles', stats: { rushingYards: 50, receptions: 18 }, fantasy_points: 14 }],
  [CUST_RB_YARDS, { name: 'Yards RB', position: 'RB', nfl_team: 'Bills', stats: { rushingYards: 200 }, fantasy_points: 20 }],
]);

const ONE_RB_SLOT = [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] }];

test('#739 custom scoring: weekHindsight prices actual and optimal under the league rules, not the stored column', async (t) => {
  const world = settledWorld({
    bestBall: false,
    awayScore: 31,
    scoringRules: PPR_RULES,
    players: CUSTOM_PLAYERS,
    lineupEntries: [
      row(TEAM_B, CUST_QB, 'QB'),
      row(TEAM_B, CUST_RB_PPR, 'RB'),
    ],
    tenures: [
      tenure(TEAM_B, CUST_QB, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, CUST_RB_PPR, new Date(HELD_ALL_SEASON)),
    ],
  });
  world.fake.install(t);

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  // Under full PPR the RB's 18 catches are worth 18: 8 + 23 = 31. The stored
  // column holds the half-PPR default (8 + 14 = 22), so pointing the reader
  // back at the column - or pricing under the default rules - returns 22 and
  // fails this assertion. That is the criterion's control.
  assert.equal(h.actualPoints, 31);
  assert.equal(h.optimalPoints, 31);
  world.fake.assertClean();
});

test('#739 custom scoring: default and league pricing choose a DIFFERENT optimal starter; hindsight names the league-priced one', async (t) => {
  // One RB slot, two bench candidates. Under the half-PPR column the yardage
  // RB (20) outscores the PPR RB (14); under the league's full PPR the PPR RB
  // (23) outscores the yardage RB (20). optimalStarters must name the
  // league-priced winner.
  const world = settledWorld({
    bestBall: false,
    awayScore: 0,
    scoringRules: PPR_RULES,
    players: CUSTOM_PLAYERS,
    rosterSlots: ONE_RB_SLOT,
    lineupEntries: [
      row(TEAM_B, CUST_RB_PPR, 'BENCH'),
      row(TEAM_B, CUST_RB_YARDS, 'BENCH'),
    ],
    tenures: [
      tenure(TEAM_B, CUST_RB_PPR, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, CUST_RB_YARDS, new Date(HELD_ALL_SEASON)),
    ],
  });
  world.fake.install(t);

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  const starterIds = h.optimalStarters.map((s) => s.playerId);
  assert.deepEqual(starterIds, [CUST_RB_PPR],
    'full PPR makes the reception RB the optimal starter; the column would have named the yardage RB');
  assert.equal(h.optimalPoints, 23, 'and his league-priced points, not the column\'s 20');
  world.fake.assertClean();
});

// Best-ball agreement (#739 / ADR 0023 consequence): hindsight's actual (=
// optimal) equals the score the settle pass writes for the same team under the
// same custom rules. The #736 churn fixture, best ball, full PPR.
//   QB A (home) 200 pass -> 8; Thursday Man cut Friday, excluded by the
//   last-kickoff bound; Acquired RB 100 rush + 10 catches -> 20 under full PPR.
const BB_PLAYERS = new Map([
  [QB_A, { name: 'QB A', position: 'QB', nfl_team: 'Chiefs', stats: { passingYards: 200 }, fantasy_points: 8 }],
  [THURSDAY_MAN, { name: 'Thursday Man', position: 'QB', nfl_team: 'Ravens', stats: { passingYards: 250 }, fantasy_points: 10 }],
  [ACQUIRED, { name: 'Acquired RB', position: 'RB', nfl_team: 'Eagles', stats: { rushingYards: 100, receptions: 10 }, fantasy_points: 15 }],
]);

test('#739 best-ball agreement: hindsight actual equals the settle pass score under the same custom rules', async (t) => {
  const world = settledWorld({
    bestBall: true,
    awayScore: 0, // written by the settle pass below, not seeded
    scoringRules: PPR_RULES,
    players: BB_PLAYERS,
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
  world.fake.install(t);

  // Settle the week under the league's rules, then read hindsight over the
  // same fixture. The two must agree because they price the same pool with the
  // one pricer under the one rules object.
  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK, settle: true });
  const settled = scoreOfRecord(world);
  assert.equal(settled, 20,
    'the replacement RB, held through the last kickoff, priced under full PPR: 10 rush + 10 catches');

  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  assert.equal(h.actualPoints, settled, 'best-ball hindsight equals the settle pass under the same custom rules');
  assert.equal(h.optimalPoints, settled);
  assert.equal(h.pointsLeftOnBench, 0);
  world.fake.assertClean();
});
