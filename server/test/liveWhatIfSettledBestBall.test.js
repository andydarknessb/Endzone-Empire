/**
 * #977: `liveWhatIf` on a settled week, and `liveWhatIf` in best ball.
 *
 * Two defects in one function, both about work it does that cannot change the
 * answer:
 *
 * 1. A settled week has no actionable move in it - every game has kicked off,
 *    so the candidate pool is empty and the answer is fixed at `delta: 0,
 *    swaps: []`. The old code still paid a lineup materialisation, the lock
 *    read and the schedule and bye reads behind it to arrive there. The one
 *    read that survives is the lineup population: `actualPoints` is summed
 *    from those rows and cannot be reproduced without them. Nothing on the
 *    wire moves - these tests pin the returned object field by field to what
 *    the old implementation returned for the same fixture.
 *
 * 2. Best ball seats nobody (the materialisation skips its optimizer seeding
 *    and lineup saves refuse any move outside bench and IR), so every row is
 *    BENCH and the old `row.slot !== BENCH` started total summed nothing:
 *    `actualPoints: 0, optimalPoints: 0` on every week. `weekHindsight` has
 *    carried the branch all along (best ball's actual IS its optimal over the
 *    whole pool, #635 / ADR 0022-0023); this function never got it.
 *
 * Deliberately NOT compared against `weekHindsight` on a live week: that
 * function throws a 409 unless every matchup for the league/season/week is
 * already final. The best-ball pair below (live and settled, same rows) is the
 * agreement check instead.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { liveWhatIf } = require('../services/decision.service');

const SEASON = 2026;
const WEEK = 8;
const LEAGUE_ID = 5;
const TEAM_ID = 10;

const ONE_RB_SLOT = [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] }];

const STARTER = { player_id: 1, name: 'Starter RB', position: 'RB', nfl_team: 'Chiefs' };
const BENCHED = { player_id: 2, name: 'Bench RB', position: 'RB', nfl_team: 'Eagles' };

/**
 * A SETTLED week: `isWeekFinal` answers true and NOTHING else is registered
 * beyond the league/team assertions and the one lineup population. The fake
 * throws on an unmatched statement, so a materialisation, a lock read, a
 * schedule read or a bye read fails this world outright - the absence of the
 * handlers IS the assertion, and `settledReadShapes` below names it out loud.
 */
function settledWorld(t, { entries, bestBall = false, rosterSlots = ONE_RB_SLOT }) {
  return createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: LEAGUE_ID,
        current_season: SEASON,
        current_week: WEEK,
        roster_slots: rosterSlots,
        bench_slots: 5,
        ir_slots: 1,
        scoring_rules: null,
        best_ball: bestBall,
      }],
    })],
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ ok: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS "n"/, () => ({ rows: [{ n: 2, all_final: true }] })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: entries.map((e) => ({ ...e })) })],
  ]).install(t);
}

/** A LIVE week: `isWeekFinal` answers false, so the live path runs in full. */
function liveWorld(t, { entries, bestBall = false, rosterSlots = ONE_RB_SLOT, kickedOff = [] }) {
  return createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: LEAGUE_ID,
        current_season: SEASON,
        current_week: WEEK,
        roster_slots: rosterSlots,
        bench_slots: 5,
        ir_slots: 1,
        scoring_rules: null,
        best_ball: bestBall,
      }],
    })],
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ ok: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS "n"/, () => ({ rows: [{ n: 2, all_final: false }] })],
    // materializeLineup: a live week, already fully materialized.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map(({ player_id, position }) => ({ player_id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: entries.map(({ player_id }) => ({ player_id })),
    })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: entries.map((e) => ({ ...e })) })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({
      rows: kickedOff.map((nfl_team) => ({ nfl_team })),
    })],
  ]).install(t);
}

const runWhatIf = () => liveWhatIf({
  leagueId: LEAGUE_ID, teamId: TEAM_ID, season: SEASON, week: WEEK,
});

/** The read shapes a settled week must NOT emit, each named by what it is. */
const FORBIDDEN_ON_A_SETTLED_WEEK = [
  ['materialisation (roster read)', /FROM "team_players"/],
  ['materialisation (finality probe)', /FROM "matchups"[\s\S]*"final" = true/],
  ['materialisation (seeded-lineup probe)', /^SELECT "player_id" FROM "lineup_entries"/],
  ['lineup write', /^(INSERT INTO|UPDATE|DELETE FROM) "lineup_entries"/],
  ['lock / schedule read', /FROM "nfl_games"/],
  ['bye read', /"bye_week"/],
];

test('#977 a settled week returns the same object with no materialisation, lock, schedule or bye read', async (t) => {
  // The bench RB is unlocked as far as this fixture is concerned (there is no
  // schedule to lock him with at all) and out-scores the starter three to one.
  // A settled week still has no actionable move in it, so he must not produce
  // a swap - the finality guard is the only thing that can suppress him here.
  const fake = settledWorld(t, {
    entries: [
      { ...STARTER, slot: 'RB', stats: { rushingYards: 100 } }, // 10
      { ...BENCHED, slot: 'BENCH', stats: { rushingYards: 300 } }, // 30
    ],
  });

  const result = await runWhatIf();

  // Field for field, exactly what the pre-#977 implementation returned for
  // this fixture (every player locked -> empty candidate pool -> fixed answer).
  assert.deepEqual(result, {
    teamId: TEAM_ID,
    week: WEEK,
    actualPoints: 10,
    optimalPoints: 10,
    delta: 0,
    swaps: [],
  });

  for (const [what, pattern] of FORBIDDEN_ON_A_SETTLED_WEEK) {
    assert.equal(fake.matching(pattern).length, 0,
      `a settled week must not pay for a ${what}`);
  }
  const population = fake.matching(/FROM "lineup_entries" JOIN "players"/);
  assert.equal(population.length, 1,
    'the lineup read stays: actualPoints is summed from those rows');
  fake.assertClean();
});

test('#977 best ball on a LIVE week reports its optimal over the whole pool as its actual', async (t) => {
  // Best ball seats nobody, so every row is BENCH. The old started total was
  // `row.slot !== BENCH`, which sums nothing here: actualPoints 0, and an
  // optimalPoints of 0 with it. The whole pool's best RB is worth 30.
  const fake = liveWorld(t, {
    bestBall: true,
    entries: [
      { ...STARTER, slot: 'BENCH', stats: { rushingYards: 100 } }, // 10
      { ...BENCHED, slot: 'BENCH', stats: { rushingYards: 300 } }, // 30
    ],
  });

  const result = await runWhatIf();

  assert.equal(result.optimalPoints, 30, 'the optimizer over the whole pool, one RB slot');
  assert.equal(result.actualPoints, result.optimalPoints,
    'best ball keeps no started total: its actual IS its optimal (ADR 0023)');
  assert.equal(result.actualPoints, 30, 'and it is the pool total, not zero');
  assert.equal(result.delta, 0, 'nothing is left on a bench nobody sets');
  assert.deepEqual(result.swaps, [], 'and there is no lineup to swap in');
  fake.assertClean();
});

test('#977 best ball on a SETTLED week returns the same figures as the live week for the same rows', async (t) => {
  // The two halves of this ticket must not disagree: the finality guard must
  // not change what a best-ball team scores.
  const entries = [
    { ...STARTER, slot: 'BENCH', stats: { rushingYards: 100 } }, // 10
    { ...BENCHED, slot: 'BENCH', stats: { rushingYards: 300 } }, // 30
  ];
  const fake = settledWorld(t, { bestBall: true, entries });

  const result = await runWhatIf();

  assert.deepEqual(result, {
    teamId: TEAM_ID,
    week: WEEK,
    actualPoints: 30,
    optimalPoints: 30,
    delta: 0,
    swaps: [],
  });
  for (const [what, pattern] of FORBIDDEN_ON_A_SETTLED_WEEK) {
    assert.equal(fake.matching(pattern).length, 0,
      `a settled best-ball week must not pay for a ${what} either`);
  }
  fake.assertClean();
});

test('#977 the best-ball branch is guarded: a redraft live week still answers with its starters', async (t) => {
  // The control for the branch. Apply the best-ball line unconditionally and
  // this goes red (as does liveWhatIfLock.test.js): a redraft team's actual is
  // its STARTERS' total, 10, and the bench upgrade is an actionable swap.
  const fake = liveWorld(t, {
    bestBall: false,
    entries: [
      { ...STARTER, slot: 'RB', stats: { rushingYards: 100 } }, // 10
      { ...BENCHED, slot: 'BENCH', stats: { rushingYards: 300 } }, // 30
    ],
  });

  const result = await runWhatIf();

  assert.equal(result.actualPoints, 10, 'redraft actual is the starters, not the pool optimum');
  assert.equal(result.delta, 20);
  assert.equal(result.swaps.length, 1);
  fake.assertClean();
});
