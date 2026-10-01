const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSuggestions,
  fitAdjustedValue,
  tradeVerdict,
  tradeFairnessSummary,
  upgradeFor,
} = require('../services/decision.service');
const { DEFAULT_ROSTER_SLOTS, slotEligible } = require('../services/lineup.service');
const { resultFromLegacyMap } = require('./helpers/weeklyProjectionResult');

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
    { ...entry(1, 'RB', 'RB'), onBye: true },
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 20 }], [2, { points: 8 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.projectedTotal, 0, 'a player on a bye scores 0, not his projection');
  assert.equal(result.optimalTotal, 8);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggested.playerId, 2);
  assert.deepEqual(result.unavailable, [{ playerId: 1, name: 'p1', slot: 'RB', reason: 'bye' }]);
});

test('buildSuggestions: Out and IR designations make a player unavailable', () => {
  for (const [status, reason] of [['O', 'out'], ['IR', 'ir']]) {
    const lineup = [
      { ...entry(1, 'RB', 'RB'), injuryStatus: status },
      entry(2, 'RB', 'BENCH'),
    ];
    const projections = resultFromLegacyMap(new Map([[1, { points: 25 }], [2, { points: 4 }]]));
    const result = buildSuggestions(lineup, projections, new Map(), RB1);
    assert.equal(result.suggestions.length, 1, status);
    assert.equal(result.suggestions[0].suggested.playerId, 2, status);
    assert.equal(result.unavailable[0].reason, reason);
  }
});

// #1767: a fresh Practice squad row is Unavailable - worth 0 as a starter
// (and replaced), never proposed from the bench.
const PRACTICE_SQUAD = () => ({ status: 'practice_squad', capturedAt: new Date(Date.now() - 3600 * 1000).toISOString() });

test('buildSuggestions: a Practice squad starter is worth zero, reads practice_squad and gets replaced', () => {
  const lineup = [
    { ...entry(1, 'RB', 'RB'), nflRosterStatus: PRACTICE_SQUAD() },
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 20 }], [2, { points: 8 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.projectedTotal, 0);
  assert.equal(result.optimalTotal, 8);
  assert.equal(result.suggestions[0].suggested.playerId, 2);
  assert.deepEqual(result.unavailable, [{ playerId: 1, name: 'p1', slot: 'RB', reason: 'practice_squad' }]);
});

test('buildSuggestions: a Practice squad bench player with the highest projection is never proposed as a start', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    { ...entry(2, 'RB', 'BENCH'), nflRosterStatus: PRACTICE_SQUAD() },
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 10 }], [2, { points: 30 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.optimalTotal, 10);
});

test('buildSuggestions: a Doubtful bench player is never auto-promoted', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    { ...entry(2, 'RB', 'BENCH'), injuryStatus: 'D' },
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 8 }], [2, { points: 25 }]]));
  const result = buildSuggestions(lineup, projections, new Map(), RB1);
  assert.equal(result.suggestions.length, 0, 'no active-probability data means no automatic swap');
  assert.equal(result.optimalTotal, 8);
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
    { ...entry(1, 'RB', 'RB'), injuryStatus: 'O' },
    entry(2, 'RB', 'BENCH'),
    entry(3, 'RB', 'BENCH'),
  ];
  const projections = resultFromLegacyMap(new Map([
    [1, { points: 20 }],
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
    { ...entry(2, 'RB', 'BENCH'), injuryStatus: 'Q' },
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 8 }], [2, { points: 25 }]]));
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
  assert.equal(result.suggestions[0].verdict, 'start');
  assert.equal(result.suggestions[0].probabilityBetter, 1);
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
// upgradeFor: eligible-slot-only comparison, no-starter = 0 (issue #1306
// Ruling item 1). The legacy batch-ranking wrapper and its dedicated parity
// test are gone with the retired waiver suggestions route (#1794);
// upgradeFor is the one Upgrade producer now, so these cases exercise it
// directly.
// ---------------------------------------------------------------------------

test('upgradeFor: points is the candidate projection minus the weakest starter projection, per candidate', () => {
  const currentStarters = [{ playerId: 99, slot: 'RB', name: 'Starter RB', projection: 10 }];
  const points = [12, 20, 8].map(
    (projection) => upgradeFor({ position: 'RB', projection }, currentStarters, DEFAULT_ROSTER_SLOTS).points
  );
  assert.deepEqual(points, [2, 10, -2]);
});

test('upgradeFor: a starter in a non-eligible slot is ignored, even one weaker than the eligible starters', () => {
  const currentStarters = [
    { playerId: 10, slot: 'RB', name: 'Starter RB', projection: 1 }, // not TE-eligible, ignored despite being weakest overall
    { playerId: 11, slot: 'TE', name: 'Starter TE', projection: 6 },
    { playerId: 12, slot: 'FLEX', name: 'Starter FLEX', projection: 4 }, // TE-eligible via FLEX, weaker
  ];
  const candidate = { position: 'TE', projection: 10 };
  const upgrade = upgradeFor(candidate, currentStarters, DEFAULT_ROSTER_SLOTS);
  assert.equal(upgrade.points, 6);
  assert.deepEqual(upgrade.overPlayer, { id: 12, name: 'Starter FLEX', points: 4, unavailable: null });
  assert.equal(slotEligible(upgrade.slot, candidate.position, DEFAULT_ROSTER_SLOTS), true);
});

test('upgradeFor: no starter at an eligible slot -> weakest is 0, overPlayer and slot are null', () => {
  const candidate = { position: 'QB', projection: 18 };
  const currentStarters = [{ playerId: 10, slot: 'RB', name: 'Starter RB', projection: 25 }];
  const upgrade = upgradeFor(candidate, currentStarters, DEFAULT_ROSTER_SLOTS);
  assert.equal(upgrade.points, 18);
  assert.equal(upgrade.overPlayer, null);
  assert.equal(upgrade.slot, null);
});

test('upgradeFor: names the weakest eligible starter as overPlayer', () => {
  const candidate = { position: 'TE', projection: 10 };
  const currentStarters = [
    { playerId: 11, slot: 'TE', name: 'Starter TE', projection: 6 },
    { playerId: 12, slot: 'FLEX', name: 'Starter FLEX', projection: 4 },
  ];
  const upgrade = upgradeFor(candidate, currentStarters, DEFAULT_ROSTER_SLOTS);
  assert.equal(upgrade.points, 6);
  assert.deepEqual(upgrade.overPlayer, { id: 12, name: 'Starter FLEX', points: 4, unavailable: null });
  assert.equal(upgrade.slot, 'FLEX');
});

// Ruling on #1793 (option B): overPlayer carries his own effective points
// (the same zeroed-if-Unavailable value `weakestEligibleStarter` compared
// against) and the Unavailable reason or null, so a client can tell "zero
// because Unavailable" from "zero because he genuinely projects 0" without
// re-deriving it.
test('upgradeFor: overPlayer.points is the starter\'s own effective projection, not the candidate\'s', () => {
  const candidate = { position: 'WR', projection: 10 };
  const currentStarters = [{ playerId: 20, slot: 'WR', name: 'Starter WR', projection: 6 }];
  const upgrade = upgradeFor(candidate, currentStarters, DEFAULT_ROSTER_SLOTS);
  assert.deepEqual(upgrade.overPlayer, { id: 20, name: 'Starter WR', points: 6, unavailable: null });
});

test('upgradeFor: overPlayer.unavailable carries the reason straight from currentStarters (already zeroed there)', () => {
  const candidate = { position: 'WR', projection: 10 };
  const currentStarters = [{ playerId: 21, slot: 'WR', name: 'Bye Starter', projection: 0, unavailable: 'bye' }];
  const upgrade = upgradeFor(candidate, currentStarters, DEFAULT_ROSTER_SLOTS);
  assert.equal(upgrade.points, 10);
  assert.deepEqual(upgrade.overPlayer, { id: 21, name: 'Bye Starter', points: 0, unavailable: 'bye' });
});

test('upgradeFor: a currentStarters row with no unavailable field reads overPlayer.unavailable as null', () => {
  const candidate = { position: 'WR', projection: 10 };
  const currentStarters = [{ playerId: 22, slot: 'WR', name: 'Plain Starter', projection: 3 }];
  const upgrade = upgradeFor(candidate, currentStarters, DEFAULT_ROSTER_SLOTS);
  assert.equal(upgrade.overPlayer.unavailable, null);
});

// #1668: a released player (nfl_team null) is Unavailable and never proposed.
test('buildSuggestions: a released bench player with the highest projection is never proposed as a start', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    { ...entry(2, 'RB', 'BENCH'), nflTeam: null },
  ];
  const projections = resultFromLegacyMap(new Map([[1, { points: 10 }], [2, { points: 30 }]]));
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
