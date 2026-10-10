const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSuggestions,
  fitAdjustedValue,
  tradeVerdict,
  tradeFairnessSummary,
  upgradeFor,
  madeAppearance,
  liveWhatIf,
} = require('../services/decision.service');
const { DEFAULT_ROSTER_SLOTS } = require('../services/lineup.service');
const { createFakePool } = require('./helpers/fakePool');
const { resultFromLegacyMap } = require('./helpers/weeklyProjectionResult');
const projectionModel = require('../services/projectionModel');

// ---------------------------------------------------------------------------
// buildSuggestions
//
// buildSuggestions now runs the EXACT optimizer (see lineupOptimizer.js), so
// these cases pin explicit rosterSlots instead of leaning on the default
// 7-slot shape. Under the default shape a two-player lineup leaves five
// starting slots empty, and the optimizer correctly wants to fill them — which
// is a real improvement over the old greedy scan, but it is not what these
// swap-semantics cases are about. Empty-slot behavior has its own tests below.
//
// #1703: buildSuggestions takes the real Weekly projection result object, not
// a bare legacy map, so every fixture below builds its `Map<playerId, points
// | { points, ... }>` the way earlier tests always did and wraps it with
// `resultFromLegacyMap` right before handing it to `buildSuggestions`.
// ---------------------------------------------------------------------------

const entry = (playerId, position, slot, name = `p${playerId}`) => ({ playerId, name, position, slot });

// ADR 0061: every availability fact is the Weekly projection result's, never
// the lineup entry's. A fixture player carries the run's stored Availability
// input (`factors.availability`) the way the engine writes it; the Start verdict
// is derived from it on read.
const stored = (availability, points, extra = {}) => ({ points, factors: { availability, ...extra } });
const OUT = { available: false, activeProbability: 0, reason: 'out', status: 'O' };
const IR_STATUS = { available: false, activeProbability: 0, reason: 'ir', status: 'IR' };
const BYE = { available: false, activeProbability: 0, reason: 'bye', status: null };
const NO_TEAM = { available: false, activeProbability: 0, reason: 'no_team', status: null };
const PS = { available: false, activeProbability: 0, reason: 'practice_squad', status: null };
const withStatus = (status) => ({ available: true, activeProbability: null, reason: null, status });

const RB1 = [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] }];
const RB2 = [{ key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] }];
const FLEX1 = [{ key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] }];

test('buildSuggestions: suggests a swap when a bench player projects strictly higher', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 10 }], [2, { points: 15 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].slot, 'RB');
  assert.equal(result.suggestions[0].current.playerId, 1);
  assert.equal(result.suggestions[0].suggested.playerId, 2);
  assert.equal(result.suggestions[0].gain, 5);
  assert.equal(result.projectedTotal, 10);
  assert.equal(result.optimalTotal, 15);
});

test('buildSuggestions: locked starters and locked bench players are never suggested', () => {
  const lineup = [
    { ...entry(1, 'RB', 'RB'), locked: true }, // game started — can't be benched
    entry(2, 'RB', 'RB'),
    { ...entry(3, 'RB', 'BENCH'), locked: true }, // can't be started either
    entry(4, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([
    [1, { points: 5 }], [2, { points: 8 }], [3, { points: 30 }], [4, { points: 12 }],
  ]));
  const result = buildSuggestions(lineup, projections, new Map(), RB2);
  // Only the unlocked pair (2 out, 4 in) is suggestible
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].current.playerId, 2);
  assert.equal(result.suggestions[0].suggested.playerId, 4);
  // Projected total still counts the locked starter's points
  assert.equal(result.projectedTotal, 13);
  assert.equal(result.optimalTotal, 17);
  // The locked bench player never appears anywhere in the plan.
  assert.equal(result.movePlan.some((m) => m.playerId === 3), false);
});

test('buildSuggestions: no suggestion when the bench player projects lower', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 15 }], [2, { points: 10 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.projectedTotal, 15);
  assert.equal(result.optimalTotal, 15);
});

test('buildSuggestions: no suggestion when equal (must be strictly higher)', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 12 }], [2, { points: 12 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0);
});

test('buildSuggestions: no suggestion when the bench is empty', () => {
  const lineup = [entry(1, 'RB', 'RB')];
  const projections = resultFromLegacyMap(new Map([[1, { points: 10 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.optimalTotal, result.projectedTotal);
});

test('buildSuggestions: respects slot eligibility (a bench QB cannot fill FLEX)', () => {
  const lineup = [
    entry(1, 'WR', 'FLEX'),
    entry(2, 'QB', 'BENCH'), // higher projection, but ineligible for FLEX
    entry(3, 'RB', 'BENCH'), // eligible, but lower projection than starter
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 8 }], [2, { points: 30 }], [3, { points: 5 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), FLEX1);
  assert.equal(result.suggestions.length, 0);
});

test('buildSuggestions: FLEX-eligible bench player is a valid suggestion for FLEX', () => {
  const lineup = [
    entry(1, 'WR', 'FLEX'),
    entry(2, 'TE', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 8 }], [2, { points: 14 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), FLEX1);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggested.playerId, 2);
});

test('buildSuggestions: ignores IR players entirely (not a bench candidate)', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'IR'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 5 }], [2, { points: 20 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.optimalTotal, 5);
});

test('buildSuggestions: a bench player is only recommended once across slots', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'RB'),
    entry(3, 'RB', 'BENCH'), // best bench RB, can only fill one starting slot
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 5 }], [2, { points: 6 }], [3, { points: 20 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB2);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].current.playerId, 1); // the weaker starter is swapped
});

test('buildSuggestions: no player appears in two recommendations', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'RB'),
    entry(3, 'RB', 'BENCH'),
    entry(4, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([
    [1, { points: 4 }], [2, { points: 5 }], [3, { points: 22 }], [4, { points: 18 }],
  ]));
  const result = buildSuggestions(lineup, projections, new Map(), RB2);
  const mentioned = [
    ...result.suggestions.map((s) => s.current.playerId),
    ...result.suggestions.map((s) => s.suggested.playerId),
  ];
  assert.equal(new Set(mentioned).size, mentioned.length);
  const moved = result.movePlan.map((m) => m.playerId);
  assert.equal(new Set(moved).size, moved.length);
  assert.equal(result.optimalTotal, 40);
});

test('buildSuggestions: carries opponent context through when supplied', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 5 }], [2, { points: 12 }]]));
  const defenseByPlayer = new Map([
    [1, { opponent: 'NYG', opponentPointsAllowed: 10 }],
    [2, { opponent: 'DAL', opponentPointsAllowed: 22 }],
  ]);
  const result = buildSuggestions(lineup, projections, defenseByPlayer, RB1);
  const { current, suggested } = result.suggestions[0];
  assert.equal(current.playerId, 1);
  assert.equal(current.projection, 5);
  assert.equal(current.opponent, 'NYG');
  assert.equal(current.opponentPointsAllowed, 10);
  assert.equal(suggested.playerId, 2);
  assert.equal(suggested.projection, 12);
  assert.equal(suggested.opponent, 'DAL');
  assert.equal(suggested.opponentPointsAllowed, 22);
});

test('buildSuggestions: missing opponent context defaults to nulls', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 5 }], [2, { points: 12 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions[0].current.opponent, null);
  assert.equal(result.suggestions[0].current.opponentPointsAllowed, null);
});

test('buildSuggestions: carries opponentApplied through, current and suggested independently (#1485)', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 5 }], [2, { points: 12 }]]));
  const defenseByPlayer = new Map([
    // player 1's factor was seeded from the prior season and applied.
    [1, { opponent: 'NYG', opponentPointsAllowed: 10, opponentApplied: true }],
    // player 2's opponent sample was insufficient even with the seed.
    [2, { opponent: 'DAL', opponentPointsAllowed: 22, opponentApplied: false }],
  ]);
  const result = buildSuggestions(lineup, projections, defenseByPlayer, RB1);
  const { current, suggested } = result.suggestions[0];
  assert.equal(current.opponentApplied, true);
  assert.equal(suggested.opponentApplied, false);
});

// --- new behavior: empty slots, availability, distributions ---------------

test('buildSuggestions: an EMPTY starting slot is reported as a fill, not a swap', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 10 }], [2, { points: 6 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB2);
  assert.equal(result.suggestions.length, 0);
  assert.deepEqual(
    result.openSlotFills.map((f) => [f.slot, f.playerId, f.projection]),
    [['RB', 2, 6]]
  );
  assert.equal(result.optimalTotal, 16);
});

test('buildSuggestions: a starter on a bye is worth zero and gets replaced', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, stored(BYE, 20)], [2, { points: 8 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.projectedTotal, 0, 'a player on a bye scores 0, not his projection');
  assert.equal(result.optimalTotal, 8);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggested.playerId, 2);
  assert.deepEqual(result.unavailable, [{ playerId: 1, name: 'p1', slot: 'RB', reason: 'bye' }]);
});

test('buildSuggestions: Out and IR designations make a player unavailable', () => {
  for (const [status, reason, availability] of [['O', 'out', OUT], ['IR', 'ir', IR_STATUS]]) {
    const lineup = [
      entry(1, 'RB', 'RB'),
      entry(2, 'RB', 'BENCH'),
    ];
    const projections = resultFromLegacyMap(new Map([[1, stored(availability, 25)], [2, { points: 4 }]]));
    const result = buildSuggestions(lineup, projections, new Map(), RB1);
    assert.equal(result.suggestions.length, 1, status);
    assert.equal(result.suggestions[0].suggested.playerId, 2, status);
    assert.equal(result.unavailable[0].reason, reason);
  }
});

// #1767: a fresh Practice squad row is Unavailable - worth 0 as a starter
// (and replaced), never proposed from the bench.
test('buildSuggestions: a Practice squad starter is worth zero, reads practice_squad and gets replaced', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, stored(PS, 20)], [2, { points: 8 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.projectedTotal, 0);
  assert.equal(result.optimalTotal, 8);
  assert.equal(result.suggestions[0].suggested.playerId, 2);
  assert.deepEqual(result.unavailable, [{ playerId: 1, name: 'p1', slot: 'RB', reason: 'practice_squad' }]);
});

test('buildSuggestions: a Practice squad bench player with the highest projection is never proposed as a start', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 10 }], [2, stored(PS, 30)]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.optimalTotal, 10);
});

test('buildSuggestions: a Doubtful bench player is never auto-promoted', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 8 }], [2, stored(withStatus('D'), 25)]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0, 'no active-probability data means no automatic swap');
  assert.equal(result.optimalTotal, 8);
});

// Practice participation (ADR 0056): a Questionable player with no practice all
// week is never auto-promoted, and a starter keeps his slot, as Doubtful does.
// Coverage began Wednesday for a Sunday 1pm ET game, inside the deadline.
const SUNDAY_1PM = '2026-10-11T17:00:00Z';
const DNP_WEEK = [{ practiceStatus: 'Did Not Participate In Practice', practicePrimaryInjury: 'Hamstring', reportPrimaryInjury: 'Hamstring', observedAt: '2026-10-07T22:00:00Z' }];

// The read loads this week's Practice participation itself (`practiceById`).
test('buildSuggestions: a no-practice Questionable bench player is not suggested, a plain Questionable one still is', () => {
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH')];
  const projections = (observations, kickoffAt = SUNDAY_1PM) => resultFromLegacyMap(
    new Map([[1, { points: 8 }], [2, stored(withStatus('Q'), 25)]]),
    { practiceById: new Map([[2, { observations, kickoffAt }]]) }
  );
  const held = buildSuggestions(lineup, projections(DNP_WEEK), new Map(), RB1);
  assert.equal(held.suggestions.length, 0, 'no practice all week means no automatic promotion');
  assert.equal(held.optimalTotal, 8);
  const promoted = buildSuggestions(lineup, projections([]), new Map(), RB1);
  assert.equal(promoted.suggestions.length, 1, 'no observations is the status quo');
  assert.equal(promoted.suggestions[0].suggested.startVerdict.reason, 'questionable');
  const noKickoff = buildSuggestions(lineup, projections(DNP_WEEK, null), new Map(), RB1);
  assert.equal(noKickoff.suggestions.length, 1, 'no kickoff on file: the coverage deadline cannot be met, so the status quo');
});

test('buildSuggestions: a no-practice Questionable starter keeps his slot, and every entry carries its verdict', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, stored(withStatus('Q'), 15)], [2, { points: 4 }]]), {
    practiceById: new Map([[1, { observations: DNP_WEEK, kickoffAt: SUNDAY_1PM }]]),
  });
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.projectedTotal, 15, 'his projection still counts');
  assert.equal(result.availabilityById.get(1).reason, 'no_practice', 'the verdict the card reads "No practice this week" off');
  assert.equal(result.availabilityById.get(1).status, 'Q');
  assert.equal(result.availabilityById.get(2).reason, null);
});

// #1775: a Position-baseline projection (its data-quality reasons carry
// `position baseline`) is the position's average, not the player's evidence.
const POSITION_BASELINE = { dataQuality: { reasons: ['position baseline'] } };

test('buildSuggestions: a Position-baseline bench player is never suggested, even with the highest number', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([
    [1, { points: 8 }],
    [2, { points: 25, factors: POSITION_BASELINE }],
  ]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.optimalTotal, 8);
});

test('buildSuggestions: a Position-baseline starter is left alone', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([
    [1, { points: 15, factors: POSITION_BASELINE }],
    [2, { points: 4 }],
  ]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0, 'not moved off his slot');
});

test('buildSuggestions: a bench player with a NON-baseline reason is still promoted', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([
    [1, { points: 8 }],
    [2, { points: 25, factors: { dataQuality: { reasons: ['prior season'] } } }],
  ]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggested.playerId, 2);
});

test('buildSuggestions: an Out starter is still replaced by a healthy bench player when the other bench player is a Position-baseline one', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
    entry(3, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([
    [1, stored(OUT, 20)],
    [2, { points: 25, factors: POSITION_BASELINE }],
    [3, { points: 6 }],
  ]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggested.playerId, 3);
});

test('buildSuggestions: a Questionable bench player CAN be promoted, flagged as such', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 8 }], [2, stored(withStatus('Q'), 25)]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggested.availability.status, 'Q');
  assert.equal(
    result.suggestions[0].suggested.availability.activeProbability,
    null,
    'a Q designation must not be turned into a made-up probability'
  );
});

test('buildSuggestions: a close call with overlapping ranges is a toss-up, not an instruction', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const overlapping = (median) => ({
    p10: median - 8, p25: median - 4, median, p75: median + 4, p90: median + 8,
  });
  const projections = resultFromLegacyMap(new Map([
    [1, { points: 10.0, projection: overlapping(10.0) }],
    [2, { points: 10.4, projection: overlapping(10.4) }],
  ]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].verdict, 'tossup');
  assert.ok(result.suggestions[0].probabilityBetter <= 0.6);
});

test('buildSuggestions: a clear edge is a start recommendation with a probability', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([
    [1, { points: 4, projection: { p10: 1, p25: 2, median: 4, p75: 6, p90: 8 } }],
    [2, { points: 18, projection: { p10: 14, p25: 16, median: 18, p75: 21, p90: 25 } }],
  ]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions[0].verdict, 'strong');
  assert.equal(result.suggestions[0].probabilityBetter, 1);
});

// The verdict bands live in Interval reading's verdictBand; these pin the
// builder reading them at each boundary (#1909).
test('buildSuggestions: the verdict is tossup at 0.6, start just above it, strong at 0.8, start when null', () => {
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH')];
  const projections = resultFromLegacyMap(new Map([[1, { points: 4 }], [2, { points: 18 }]]));
  const original = projectionModel.probabilityBetter;
  try {
    for (const [probability, verdict] of [[0.6, 'tossup'], [0.61, 'start'], [0.79, 'start'], [0.8, 'strong'], [null, 'start']]) {
      projectionModel.probabilityBetter = () => probability;
      const [suggestion] = buildSuggestions(lineup, projections, new Map(), RB1).suggestions;
      assert.equal(suggestion.verdict, verdict, `probability ${probability}`);
    }
  } finally {
    projectionModel.probabilityBetter = original;
  }
});

test('buildSuggestions: a missing projection never becomes a recommendation', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  // Player 2 has no projection at all (a rookie with no history, say).
  const projections = resultFromLegacyMap(new Map([[1, { points: 3 }], [2, { points: null, source: 'unavailable' }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.openSlotFills.length, 0);
});

// ---------------------------------------------------------------------------
// buildSuggestions: the #1483 red-tell pair, under the two ranking statistics
// (#1442 ruling (4)/#1483). `startSitAdvice` itself picks `lineupRanking` off
// `constantsForVersion(run.modelVersion)` (decision.service.js line ~427),
// but exercising that end to end would mean mocking `pool.query` for the
// league and lineup reads, `lineupService.getLineup`, both
// `projectionService.getWeeklyProjections`/`getPositionDefense`, and the
// module-private `getWeekOpponents` helper - considerably more entangled than
// the seam this suite actually needs, so this drives `buildSuggestions`
// directly instead, the same seam decisionRule.test.js already exercises.
// ---------------------------------------------------------------------------

test('buildSuggestions: the #1483 pair (starter mean 9.03/median 8.21, bench mean 7.37/median 10.06) disagrees by ranking statistic', () => {
  const projectionService = require('../services/projection.service');
  const model = require('../services/projectionModel');
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH')];
  const dist = (mean, median) => ({ mean, median, p10: median - 6, p25: median - 3, p75: median + 3, p90: median + 6 });

  // A v3.2-stamped run: the DISPLAYED points (`pointsFor`, resolved off each
  // entry's own `modelVersion`) print the MEAN.
  const v32Projections = projectionService.toWeeklyProjectionResult({
    projections: new Map([
      [1, { ...dist(9.03, 8.21), modelVersion: model.SUCCESSOR_MODEL_VERSION, factors: {} }],
      [2, { ...dist(7.37, 10.06), modelVersion: model.SUCCESSOR_MODEL_VERSION, factors: {} }],
    ]),
  });
  const v32 = buildSuggestions(lineup, v32Projections, new Map(), RB1, { lineupRanking: 'mean' });
  assert.equal(v32.suggestions.length, 0, 'the starter (mean 9.03) outranks the bench (mean 7.37): no swap');
  assert.equal(v32.optimalTotal, 9.03);

  // The SAME pair under a v3.1-stamped run: the displayed points print the
  // MEDIAN, and the median disagrees - a skewed pool pushed the bench
  // player's median above his mean.
  const v31Projections = projectionService.toWeeklyProjectionResult({
    projections: new Map([
      [1, { ...dist(9.03, 8.21), modelVersion: model.MODEL_VERSION, factors: {} }],
      [2, { ...dist(7.37, 10.06), modelVersion: model.MODEL_VERSION, factors: {} }],
    ]),
  });
  const v31 = buildSuggestions(lineup, v31Projections, new Map(), RB1, { lineupRanking: 'median' });
  assert.equal(v31.suggestions.length, 1, 'the bench median (10.06) outranks the starter median (8.21): swap suggested');
  assert.equal(v31.suggestions[0].suggested.playerId, 2);
  assert.equal(v31.optimalTotal, 10.06);
});

test('buildSuggestions: ranking follows projectionService.pointEstimateFor (#1678)', () => {
  const projectionService = require('../services/projection.service');
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH')];
  const dist = (mean, median) => ({ mean, median, p10: 0, p25: 1, p75: 20, p90: 30 });
  const legacyProjections = new Map([
    [1, { points: 9, projection: dist(9, 8) }],
    [2, { points: 7, projection: dist(7, 10) }],
  ]);
  const projections = resultFromLegacyMap(legacyProjections);
  for (const lineupRanking of ['mean', 'median']) {
    const constants = { decision: { lineupRanking } };
    const estimate = (id) => projectionService.pointEstimateFor(legacyProjections.get(id).projection, constants);
    const benchWins = estimate(2) > estimate(1);
    const result = buildSuggestions(lineup, projections, new Map(), RB1, { lineupRanking });
    assert.equal(result.movePlan.some((m) => m.playerId === 2 && m.toSlot === 'RB'), benchWins,
      `${lineupRanking}: the ranking agrees with pointEstimateFor`);
  }
});

test('buildSuggestions: a finite mean with no display points ranks by the mean (#1678)', () => {
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH')];
  const projections = resultFromLegacyMap(new Map([
    [1, { points: 3 }],
    // No display points and no median: pointEstimateFor falls back to the mean.
    [2, { points: null, projection: { mean: 9, median: null, p10: 4, p25: 6, p75: 12, p90: 15 } }],
  ]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1, { lineupRanking: 'median' });
  assert.deepEqual(result.movePlan.map((m) => [m.playerId, m.toSlot]), [[2, 'RB'], [1, 'BENCH']]);
});

// ---------------------------------------------------------------------------
// buildSuggestions: present-but-no-estimate vs. genuinely absent (#1703
// formal review f1) - a run entry is present but has no Point estimate at
// all (mean AND median null) reads as 0, the legacy map's own "missing -> 0"
// contract; a player with no entry in the run whatsoever also reads as 0
// here (unlike the raw `pointsFor`/wire-level accessors, which report null
// for an absent entry - this function's own contract has always been "points
// (number or { points, ... })", never null, since `effectivePoints` coerces
// either case the same way for the optimizer and the totals).
// ---------------------------------------------------------------------------

test('buildSuggestions: a present entry with no Point estimate at all reads as 0, same as an absent one', () => {
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH'), entry(3, 'RB', 'BENCH')];
  const projections = resultFromLegacyMap(new Map([
    [1, { points: 5 }],
    // Player 2 is PRESENT with mean/median both null (a player not found in
    // the bundle, or a distribution with no computable mean, #1703 f1).
    [2, { points: null, projection: { mean: null, median: null } }],
    // Player 3 has NO entry in the run at all.
  ]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.projectedTotal, 5);
  assert.equal(result.suggestions.length, 0, 'neither bench candidate (both worth 0) outprojects the starter');
});

// ---------------------------------------------------------------------------
// fitAdjustedValue
// ---------------------------------------------------------------------------

test('fitAdjustedValue: surplus discount when the position (incl. FLEX capacity) is already full', () => {
  // RB capacity = RB slot count (2) + FLEX slot count (1) = 3
  const rosterPositions = ['RB', 'RB', 'RB'];
  const value = fitAdjustedValue(100, 'RB', rosterPositions, DEFAULT_ROSTER_SLOTS);
  assert.equal(value, 85);
});

test('fitAdjustedValue: empty-slot premium when none of the position is rostered', () => {
  const rosterPositions = ['QB', 'WR', 'WR'];
  const value = fitAdjustedValue(100, 'RB', rosterPositions, DEFAULT_ROSTER_SLOTS);
  assert.equal(value, 115);
});

test('fitAdjustedValue: neutral when the position is partially filled', () => {
  // RB capacity = 3 (2 dedicated + 1 FLEX); one RB already rostered
  const rosterPositions = ['RB'];
  const value = fitAdjustedValue(100, 'RB', rosterPositions, DEFAULT_ROSTER_SLOTS);
  assert.equal(value, 100);
});

test('fitAdjustedValue: a position with zero starting capacity (no FLEX eligibility) is treated as surplus', () => {
  // K is not FLEX-eligible, so zero dedicated K slots means zero capacity outright.
  const noK = DEFAULT_ROSTER_SLOTS.map((s) => (s.key === 'K' ? { ...s, count: 0 } : s));
  const value = fitAdjustedValue(100, 'K', [], noK);
  assert.equal(value, 85);
});

test('fitAdjustedValue: FLEX capacity counts toward WR and TE too', () => {
  // WR capacity = 2 dedicated + 1 FLEX = 3; two WRs rostered -> still below capacity, neutral
  const value = fitAdjustedValue(50, 'WR', ['WR', 'WR'], DEFAULT_ROSTER_SLOTS);
  assert.equal(value, 50);
  // three WRs rostered -> at capacity, surplus
  const surplus = fitAdjustedValue(50, 'WR', ['WR', 'WR', 'WR'], DEFAULT_ROSTER_SLOTS);
  assert.equal(surplus, 42.5);
});

// ---------------------------------------------------------------------------
// tradeVerdict
// ---------------------------------------------------------------------------

test('tradeVerdict: identical values are fair', () => {
  assert.equal(tradeVerdict(100, 100), 'fair');
});

test('tradeVerdict: exactly 10% apart is still fair (band edge, inclusive)', () => {
  assert.equal(tradeVerdict(100, 90), 'fair');
  assert.equal(tradeVerdict(90, 100), 'fair');
});

test('tradeVerdict: just over 10% apart favors the side that received more', () => {
  assert.equal(tradeVerdict(100, 89.9), 'favors_proposer');
  assert.equal(tradeVerdict(89.9, 100), 'favors_receiver');
});

test('tradeVerdict: both sides zero is fair', () => {
  assert.equal(tradeVerdict(0, 0), 'fair');
});

test('tradeFairnessSummary: applies exact badge and commissioner-review boundaries', () => {
  assert.deepEqual(tradeFairnessSummary(100, 85), {
    fairnessMarginPct: 15,
    statusBadge: 'Even / Fair',
    isBlocked: false,
    collusion_risk: 'LOW',
  });
  assert.equal(tradeFairnessSummary(100, 84.99).statusBadge, 'Imbalanced');
  assert.equal(tradeFairnessSummary(100, 64.99).statusBadge, 'Highly Imbalanced');
  assert.equal(tradeFairnessSummary(100, 50).isBlocked, false);
  assert.deepEqual(tradeFairnessSummary(100, 49.99), {
    fairnessMarginPct: 50.01,
    statusBadge: 'Highly Imbalanced',
    isBlocked: true,
    collusion_risk: 'HIGH',
  });
});

test('tradeFairnessSummary: safely defaults missing and non-finite totals to zero', () => {
  assert.deepEqual(tradeFairnessSummary(undefined, Number.POSITIVE_INFINITY), {
    fairnessMarginPct: 0,
    statusBadge: 'Even / Fair',
    isBlocked: false,
    collusion_risk: 'LOW',
  });
});

// ---------------------------------------------------------------------------
// upgradeFor (#1910, ADR 0055): the gain to this week's OPTIMAL lineup, over
// the whole roster (starters and bench). `roster` rows are
// { playerId, name, position, slot, projection, unavailable?, kickedOff? },
// an Unavailable player already zeroed by the caller.
// ---------------------------------------------------------------------------

const rosterRow = (playerId, position, slot, projection, extra = {}) => ({
  playerId, name: `p${playerId}`, position, slot, projection, unavailable: null, kickedOff: false, ...extra,
});

test('upgradeFor: a bench player who would fill an Unavailable starter\'s slot is netted out (#1910 red-tell)', () => {
  const roster = [
    rosterRow(1, 'RB', 'RB', 0, { unavailable: 'out' }),
    rosterRow(2, 'RB', 'BENCH', 12),
  ];
  assert.deepEqual(upgradeFor({ position: 'RB', projection: 10 }, roster, RB1), { points: 0, overPlayer: null, slot: null });
  assert.deepEqual(upgradeFor({ position: 'RB', projection: 15 }, roster, RB1), {
    points: 3,
    overPlayer: { id: 2, name: 'p2', points: 12, unavailable: null },
    slot: 'RB',
  });
});

test('upgradeFor: points is the candidate projection over the starter he beats, never below 0', () => {
  const roster = [rosterRow(99, 'RB', 'RB', 10)];
  const points = [12, 20, 8].map((projection) => upgradeFor({ position: 'RB', projection }, roster, RB1).points);
  assert.deepEqual(points, [2, 10, 0]);
});

test('upgradeFor: a starter in a non-eligible slot is ignored', () => {
  const roster = [
    rosterRow(10, 'RB', 'RB', 1),
    rosterRow(11, 'TE', 'TE', 6),
    rosterRow(12, 'WR', 'FLEX', 4),
  ];
  const slots = [
    { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
    { key: 'TE', label: 'TE', count: 1, eligiblePositions: ['TE'] },
    { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  ];
  const upgrade = upgradeFor({ position: 'TE', projection: 10 }, roster, slots);
  assert.equal(upgrade.points, 6);
  assert.deepEqual(upgrade.overPlayer, { id: 12, name: 'p12', points: 4, unavailable: null });
  assert.equal(upgrade.slot, 'TE');
});

test('upgradeFor: a candidate who fills an empty slot has no overPlayer', () => {
  const upgrade = upgradeFor({ position: 'QB', projection: 18 }, [rosterRow(10, 'RB', 'RB', 25)], DEFAULT_ROSTER_SLOTS);
  assert.equal(upgrade.points, 18);
  assert.equal(upgrade.overPlayer, null);
  assert.equal(upgrade.slot, 'QB');
});

test('upgradeFor: overPlayer carries the Unavailable reason and his zeroed points', () => {
  const roster = [rosterRow(21, 'WR', 'WR', 0, { unavailable: 'bye' })];
  const upgrade = upgradeFor({ position: 'WR', projection: 10 }, roster, [{ key: 'WR', label: 'WR', count: 1, eligiblePositions: ['WR'] }]);
  assert.equal(upgrade.points, 10);
  assert.deepEqual(upgrade.overPlayer, { id: 21, name: 'p21', points: 0, unavailable: 'bye' });
});

test('upgradeFor: a kicked-off starter is pinned and a kicked-off bench player is not a lineup candidate', () => {
  const pinnedRoster = [rosterRow(1, 'RB', 'RB', 5, { kickedOff: true })];
  assert.deepEqual(upgradeFor({ position: 'RB', projection: 20 }, pinnedRoster, RB1), { points: 0, overPlayer: null, slot: null });
  const lockedBench = [rosterRow(1, 'RB', 'RB', 5), rosterRow(2, 'RB', 'BENCH', 30, { kickedOff: true })];
  assert.equal(upgradeFor({ position: 'RB', projection: 20 }, lockedBench, RB1).points, 15);
});

test('upgradeFor: overPlayer on a tie does not depend on the input order of the roster', () => {
  const wr2 = [{ key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] }];
  const starters = [
    rosterRow(3, 'WR', 'WR', 0, { unavailable: 'bye' }),
    rosterRow(4, 'WR', 'WR', 0, { unavailable: 'bye' }),
  ];
  const candidate = { position: 'WR', projection: 9 };
  const forward = upgradeFor(candidate, starters, wr2);
  const reversed = upgradeFor(candidate, [...starters].reverse(), wr2);
  assert.equal(forward.points, 9);
  assert.deepEqual(reversed, forward);
  assert.ok([3, 4].includes(forward.overPlayer.id));
  // A healthy tie: an RB starter at 8 and a bench RB at 8.
  const rbs = [rosterRow(1, 'RB', 'RB', 8), rosterRow(2, 'RB', 'BENCH', 8)];
  assert.deepEqual(
    upgradeFor({ position: 'RB', projection: 12 }, [...rbs].reverse(), RB1),
    upgradeFor({ position: 'RB', projection: 12 }, rbs, RB1),
  );
});

test('upgradeFor: a gain that arrives through a FLEX chain is found', () => {
  // RB 9 starts at RB, WR 8 at FLEX. A candidate RB 20 takes RB, the RB 9 moves to FLEX, WR 8 leaves.
  const roster = [rosterRow(1, 'RB', 'RB', 9), rosterRow(2, 'WR', 'FLEX', 8)];
  const slots = [
    { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
    { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR'] },
  ];
  const upgrade = upgradeFor({ position: 'RB', projection: 20 }, roster, slots);
  assert.equal(upgrade.points, 12);
  assert.equal(upgrade.overPlayer.id, 2);
});

// #1668: a released player (nfl_team null) is Unavailable and never proposed.
test('buildSuggestions: a released bench player with the highest projection is never proposed as a start', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 10 }], [2, stored(NO_TEAM, 30)]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0);
});

test('buildSuggestions: carries line, weather and their applied flags through; defaults to null (#1853)', () => {
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH')];
  const projections = resultFromLegacyMap(new Map([[1, { points: 5 }], [2, { points: 12 }]]));
  const line = { spread: -7.5, total: 49.5, favoredBy: 7.5 };
  const weather = { indoor: false, windSpeedMph: 22, windGustMph: 30, precipitationProbability: 70, shortForecast: 'Rain' };
  const defenseByPlayer = new Map([
    [1, { opponent: 'NYG', opponentPointsAllowed: 10, line, weather, weatherApplied: false, marketApplied: false }],
  ]);
  const { current, suggested } = buildSuggestions(lineup, projections, defenseByPlayer, RB1).suggestions[0];
  assert.deepEqual(current.line, line);
  assert.deepEqual(current.weather, weather);
  assert.equal(current.weatherApplied, false);
  assert.equal(current.marketApplied, false);
  assert.equal(suggested.line, null);
  assert.equal(suggested.weather, null);
});

// ---------------------------------------------------------------------------
// #1856: an open called shot pins its pair like a locked pair
// ---------------------------------------------------------------------------

test('buildSuggestions: an open called shot keeps its starter in his slot and its benched player out of the suggestions and the plan (#1856)', () => {
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'RB'), entry(3, 'RB', 'BENCH'), entry(4, 'RB', 'BENCH')];
  const projections = resultFromLegacyMap(new Map([
    [1, { points: 5 }], [2, { points: 8 }], [3, { points: 30 }], [4, { points: 12 }],
  ]));
  const open = buildSuggestions(lineup, projections, new Map(), RB2);
  // Without the shot the optimizer wants both bench players in.
  assert.deepEqual(open.suggestions.map((s) => s.suggested.playerId).sort(), [3, 4]);

  const shot = buildSuggestions(lineup, projections, new Map(), RB2, { calledShot: { starterId: 1, benchedId: 3 } });
  assert.equal(shot.suggestions.length, 1);
  assert.equal(shot.suggestions[0].current.playerId, 2);
  assert.equal(shot.suggestions[0].suggested.playerId, 4);
  for (const move of shot.movePlan) {
    assert.ok(![1, 3].includes(move.playerId), `movePlan touches shot player ${move.playerId}`);
  }
  assert.equal(shot.openSlotFills.some((f) => [1, 3].includes(f.playerId)), false);
});

test('buildSuggestions: a called shot no longer pins once the lineup stopped matching it (#1856)', () => {
  // The starter now sits: there is nothing to hold, so the advice is unchanged.
  const lineup = [entry(1, 'RB', 'BENCH'), entry(3, 'RB', 'RB')];
  const projections = resultFromLegacyMap(new Map([[1, { points: 20 }], [3, { points: 5 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1, { calledShot: { starterId: 1, benchedId: 3 } });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggested.playerId, 1);
});

// ---------------------------------------------------------------------------
// Volatility tag on each suggestion side (#1858)
// ---------------------------------------------------------------------------


test('buildSuggestions: each side carries the volatility its context holds, null when it holds none', () => {
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH')];
  const projections = resultFromLegacyMap(new Map([[1, { points: 10 }], [2, { points: 15 }]]));
  const context = new Map([
    [1, { opponent: null, opponentPointsAllowed: null, volatility: 'steady' }],
    [2, { opponent: null, opponentPointsAllowed: null, volatility: 'boom_or_bust' }],
  ]);
  const tagged = buildSuggestions(lineup, projections, context, RB1).suggestions[0];
  assert.equal(tagged.current.volatility, 'steady');
  assert.equal(tagged.suggested.volatility, 'boom_or_bust');

  const bare = buildSuggestions(lineup, projections, new Map(), RB1).suggestions[0];
  assert.equal(bare.current.volatility, null);
  assert.equal(bare.suggested.volatility, null);
});

// #1860: Appearance (CONTEXT.md). A stat row alone is not one: the box writes
// zeros for rostered players who never took the field.
test('#1860 madeAppearance: a snap or any non-zero figure is an Appearance; a row of zeros or nulls is not', () => {
  assert.equal(madeAppearance({ usageOffenseSnaps: 12 }), true, 'a blocking tight end with snaps and no touches');
  assert.equal(madeAppearance({ usageDefenseSnaps: 30, usageOffenseSnaps: 0 }), true);
  assert.equal(madeAppearance({ fieldGoal: 2, usageOffenseSnaps: 0 }), true, 'a kicker has no offense snaps');
  assert.equal(madeAppearance({ receptions: 0, passingYards: 0, usageOffenseSnaps: null, gameTeam: 'KC' }), false, 'a zero stat row');
  assert.equal(madeAppearance({ usageOffenseSnaps: 0, usageOffenseSnapPct: 0 }), false);
  assert.equal(madeAppearance({}), false);
  assert.equal(madeAppearance(null), false, 'no stat row at all (a bye week)');
});

// ---------------------------------------------------------------------------
// #1861: the manager's season points left and rank, from the stored weekly rows
// ---------------------------------------------------------------------------

const { pointsLeftStanding } = require('../services/decision.service');

// A pool that serves the stored rows of one league-season, as the real query would.
const poolWith = (...weeks) => ({
  query: async () => ({
    rows: weeks.map((left, i) => ({
      week: i + 1,
      data: { teams: Object.entries(left).map(([teamId, pointsLeft]) => ({ teamId: Number(teamId), pointsLeft })) },
    })),
  }),
});

test('#1861 pointsLeftStanding: the season total and the rank among the league\'s teams, fewest first', async () => {
  const db = poolWith({ 1: 10.1, 2: 4, 3: 20 }, { 1: 31.1, 2: 4, 3: 1 });
  // Totals: team 1 -> 41.2, team 2 -> 8, team 3 -> 21.
  assert.deepEqual(await pointsLeftStanding(db, { leagueId: 7, season: 2026, teamId: 1 }), { total: 41.2, rank: 3, teams: 3 });
  assert.deepEqual(await pointsLeftStanding(db, { leagueId: 7, season: 2026, teamId: 2 }), { total: 8, rank: 1, teams: 3 });
});

test('#1861 pointsLeftStanding: a tie shares the better rank', async () => {
  const db = poolWith({ 1: 5, 2: 5, 3: 9 });
  assert.equal((await pointsLeftStanding(db, { leagueId: 7, season: 2026, teamId: 2 })).rank, 1);
  assert.equal((await pointsLeftStanding(db, { leagueId: 7, season: 2026, teamId: 3 })).rank, 3);
});

test('#1861 pointsLeftStanding: no stored rows, or a team with none, is no standing', async () => {
  assert.equal(await pointsLeftStanding(poolWith(), { leagueId: 7, season: 2026, teamId: 1 }), null);
  assert.equal(await pointsLeftStanding(poolWith({ 1: 5 }), { leagueId: 7, season: 2026, teamId: 9 }), null);
});

// #1862: the as-of time and the season record on the advice payload.
test('#1862 startSitAdvice reads the lineup at the as-of time and carries the manager\'s season record', async (t) => {
  const { createFakePool } = require('./helpers/fakePool');
  const lineupService = require('../services/lineup.service');
  const projectionService = require('../services/projection.service');
  const decisionCardContext = require('../services/decisionCardContext.service');
  const { startSitAdvice } = require('../services/decision.service');
  createFakePool([
    [/FROM "leagues"/, () => ({ rows: [{ id: 3, best_ball: false, scoring_rules: null, regular_season_weeks: 14 }] })],
    [/^SELECT "called", "outcome" FROM "lineup_overrides"/, () => ({ rows: [
      { called: false, outcome: 'hit' }, { called: false, outcome: 'miss' }, { called: true, outcome: 'hit' },
    ] })],
    [/./, () => ({ rows: [] })],
  ]).install(t);
  const reads = [];
  t.mock.method(lineupService, 'getLineup', async (args) => {
    reads.push(args);
    return { teamId: 10, season: 2026, week: 6, rosterSlots: [], entries: [] };
  });
  t.mock.method(projectionService, 'getWeeklyProjections', async () => resultFromLegacyMap(new Map()));
  t.mock.method(projectionService, 'getPositionDefense', async () => new Map());
  t.mock.method(decisionCardContext, 'loadGameChipContext', async () => new Map());
  t.mock.method(decisionCardContext, 'loadVolatilityTags', async () => new Map());

  const asOf = new Date('2026-10-11T16:59:00.000Z');
  const advice = await startSitAdvice({ leagueId: 3, userId: 7, now: asOf });

  assert.equal(reads[0].now, asOf, 'the lock is read at the as-of time');
  assert.deepEqual(advice.overrideRecord, { hits: 1, misses: 1 });
  assert.deepEqual(advice.calledShotRecord, { hits: 1, resolved: 1, streak: 1 });
});

// #2144: the advice's dependencies are arguments. The ambient pool (what the
// schedule reads still use) refuses a league read, so a league read that
// bypassed `db` fails rather than passes; the projection fake records what it
// was handed.
test('#2144 startSitAdvice reads the league once and hands that row to the lineup read and the projection read', async (t) => {
  const lineupService = require('../services/lineup.service');
  const decisionCardContext = require('../services/decisionCardContext.service');
  const { startSitAdvice } = require('../services/decision.service');
  const leagueRow = { id: 3, best_ball: false, scoring_rules: null, regular_season_weeks: 14 };
  const db = createFakePool([
    [/FROM "leagues"/, () => ({ rows: [leagueRow] })],
    [/./, () => ({ rows: [] })],
  ]);
  createFakePool([
    [/FROM "leagues"/, () => { throw new Error('the league was read off the ambient pool, not db'); }],
    [/./, () => ({ rows: [] })],
  ]).install(t);
  const lineupReads = [];
  t.mock.method(lineupService, 'getLineup', async (args) => {
    lineupReads.push(args);
    return { teamId: 10, season: 2026, week: 6, rosterSlots: [], entries: [] };
  });
  t.mock.method(decisionCardContext, 'loadGameChipContext', async () => new Map());
  t.mock.method(decisionCardContext, 'loadVolatilityTags', async () => new Map());
  const projectionReads = [];
  const projections = {
    getWeeklyProjections: async (args) => {
      projectionReads.push(args);
      return resultFromLegacyMap(new Map());
    },
    getPositionDefense: async () => new Map(),
  };

  await startSitAdvice({ leagueId: 3, userId: 7 }, { db, projections });

  assert.equal(projectionReads.length, 1);
  assert.equal(projectionReads[0].league, leagueRow, 'the projection read is priced under the league read');
  assert.equal(lineupReads[0].league, leagueRow, 'the lineup read is handed the league, not left to read it again');
  assert.equal(db.matching(/FROM "leagues"/).length, 1, 'the league is read exactly once, through db');
});

// ADR 0057: a Backup quarterback (his chart verdict rides the Weekly projection
// result's `startVerdictFor`) is never auto-recommended, like a Position-baseline one,
// but his own number is untouched.
const QB1 = [{ key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] }];

test('buildSuggestions: a Backup quarterback on the bench is never suggested, even with the highest number', () => {
  const lineup = [entry(1, 'QB', 'QB'), entry(2, 'QB', 'BENCH')];
  const projections = resultFromLegacyMap(new Map([[1, { points: 12 }], [2, { points: 20.25 }]]), { backupIds: new Set([2]) });
  const result = buildSuggestions(lineup, projections, new Map(), QB1);
  assert.equal(result.suggestions.length, 0);
});

// Start verdict (spec #2042, #2044): a run that stored the bench rookie
// Unavailable (IR) and marked him Position-baseline is never a candidate.
// The verdict's outcome gates, not the flags rebuilt from its reason (#1775).
test('buildSuggestions: a stale-IR Position-baseline bench rookie is never a candidate, whatever else the run holds', () => {
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH')];
  const staleIr = {
    points: 20,
    factors: { availability: { available: false, status: 'IR', reason: 'ir' }, dataQuality: { reasons: ['position baseline'] } },
  };
  const projections = resultFromLegacyMap(new Map([[1, { points: 12 }], [2, staleIr]]));
  assert.equal(projections.startVerdictFor(2).outcome, 'unavailable', 'the fixture: the run says Unavailable');
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0);
});

// ---------------------------------------------------------------------------
// liveWhatIf and Held (#2141): the live advisor asks lineup.service's
// `heldLineup` who may move, then the one Optimizer for the best lineup. A
// kicked-off bench player is no candidate however high he projects, and a
// kicked-off starter keeps his slot instead of being re-seated.
// ---------------------------------------------------------------------------

const WHATIF_LEAGUE_ID = 5;
const WHATIF_TEAM_ID = 10;

function whatIfWorld(t, { entries, kickedOff, rosterSlots, bestBall = false }) {
  return createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: WHATIF_LEAGUE_ID, current_season: 2026, current_week: 8,
        roster_slots: rosterSlots, bench_slots: 5, ir_slots: 1, scoring_rules: null,
        best_ball: bestBall,
      }],
    })],
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ ok: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS "n"/, () => ({ rows: [{ n: 2, all_final: false }] })],
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

const whatIfRow = (player_id, position, slot, nfl_team, stats) => ({
  player_id, name: `p${player_id}`, position, slot, nfl_team, stats,
});
const runLiveWhatIf = () => liveWhatIf({
  leagueId: WHATIF_LEAGUE_ID, teamId: WHATIF_TEAM_ID, season: 2026, week: 8,
});

test('liveWhatIf: a kicked-off bench player with the highest projection is not started', async (t) => {
  // p2 is worth 30 and has kicked off (KC); p3 is worth 15 and has not. The
  // only thing that keeps p2 out of the swap is Held's bench exclusion.
  const fake = whatIfWorld(t, {
    rosterSlots: RB1,
    kickedOff: ['KC'],
    entries: [
      whatIfRow(1, 'RB', 'RB', 'BUF', { rushingYards: 100 }), // 10
      whatIfRow(2, 'RB', 'BENCH', 'KC', { rushingYards: 300 }), // 30, kicked off
      whatIfRow(3, 'RB', 'BENCH', 'BUF', { rushingYards: 150 }), // 15
    ],
  });

  const result = await runLiveWhatIf();

  assert.deepEqual(result.swaps.map((s) => [s.out.playerId, s.in.playerId]), [[1, 3]]);
  assert.equal(result.delta, 5);
  assert.equal(result.optimalPoints, 15);
  fake.assertClean();
});

test('liveWhatIf: a kicked-off starter keeps his slot, so no swap needs him to move', async (t) => {
  // p1 started at FLEX and has kicked off. Re-seating him at RB would let p3
  // take FLEX, but setLineup would refuse that move: advice must hold him in
  // FLEX, where the open RB slot can only take p2.
  const fake = whatIfWorld(t, {
    rosterSlots: [...RB1, ...FLEX1],
    kickedOff: ['KC'],
    entries: [
      whatIfRow(1, 'RB', 'FLEX', 'KC', { rushingYards: 120 }), // 12, kicked off
      whatIfRow(2, 'RB', 'RB', 'BUF', { rushingYards: 40 }), // 4
      whatIfRow(3, 'WR', 'BENCH', 'BUF', { receivingYards: 90 }), // 9
    ],
  });

  const result = await runLiveWhatIf();

  assert.deepEqual(result.swaps, []);
  assert.equal(result.delta, 0);
  fake.assertClean();
});

test('liveWhatIf: best ball fills every slot that has a player, so a negative K and DEF still count', async (t) => {
  // QB 20, K -2, DEF -2 are the whole pool: the best-ball optimal is 16, the
  // greedy it replaced said 16, and an Optimizer that left empty slots for
  // negative values would say 20 (#2141, Ruling B).
  const fake = whatIfWorld(t, {
    rosterSlots: DEFAULT_ROSTER_SLOTS,
    kickedOff: [],
    bestBall: true,
    entries: [
      whatIfRow(1, 'QB', 'BENCH', 'BUF', { passingYards: 500 }), // 20
      whatIfRow(2, 'K', 'BENCH', 'BUF', { interceptions: 1 }), // -2
      whatIfRow(3, 'DEF', 'BENCH', 'BUF', { interceptions: 1 }), // -2
    ],
  });

  const result = await runLiveWhatIf();

  assert.equal(result.optimalPoints, 16);
  assert.equal(result.actualPoints, 16);
  fake.assertClean();
});
