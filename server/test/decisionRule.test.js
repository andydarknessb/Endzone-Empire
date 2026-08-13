const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSuggestions } = require('../services/decision.service');
const model = require('../services/projectionModel');

// ---------------------------------------------------------------------------
// The lineup decision rule (MODEL_CONSTANTS.decision.lineupRanking).
//
// Ships 'median' - the exact behavior production has always had - and the
// first tests prove that shipped value is inert to the byte. 'mean' is the
// measured alternative: over the frozen pit-sweep artifacts it cut lineup
// regret by 1.90 points per roster-week, consistent in both seasons.
// ---------------------------------------------------------------------------

const entry = (playerId, position, slot, name = `p${playerId}`) => ({ playerId, name, position, slot });
const RB1 = [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] }];

/** A projection entry shaped like toLegacyProjectionMap's output. */
const proj = (median, mean, extra = {}) => ({
  points: median,
  projection: { mean, median, p10: median - 6, p25: median - 3, p75: median + 3, p90: median + 6 },
  ...extra,
});

// A steady starter and a boom bench player: the median prefers the starter
// (10 > 9.5), the mean prefers the bench (14 > 10). The two rules must
// genuinely disagree on this fixture or every assertion below is vacuous.
const disagreeing = () => ({
  lineup: [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH')],
  projections: new Map([[1, proj(10, 10)], [2, proj(9.5, 14)]]),
});

test('the shipped constant is median, and the default path is the median path exactly', () => {
  assert.equal(model.MODEL_CONSTANTS.decision.lineupRanking, 'median');
  const { lineup, projections } = disagreeing();
  const byDefault = buildSuggestions(lineup, projections, new Map(), RB1);
  const byExplicitMedian = buildSuggestions(lineup, projections, new Map(), RB1, { lineupRanking: 'median' });
  assert.deepEqual(byDefault, byExplicitMedian);
  // Median-ranked: the steady starter keeps the slot and nothing is suggested.
  assert.equal(byDefault.suggestions.length, 0);
  assert.deepEqual(byDefault.movePlan, []);
  assert.equal(byDefault.optimalTotal, 10);
});

test("'mean' ranks the boom player into the lineup the median would bench", () => {
  const { lineup, projections } = disagreeing();
  const result = buildSuggestions(lineup, projections, new Map(), RB1, { lineupRanking: 'mean' });
  // The optimizer's choice changes: 2 in, 1 out.
  assert.deepEqual(result.movePlan.map((m) => `${m.playerId}:${m.fromSlot}->${m.toSlot}`).sort(),
    ['1:RB->BENCH', '2:BENCH->RB']);
  // But every DISPLAYED number stays median-based: the optimal total is the
  // started player's median (9.5), not his mean (14) - a mean printed next to
  // per-player medians would be a total that does not add up on screen.
  assert.equal(result.optimalTotal, 9.5);
  assert.equal(result.projectedTotal, 10);
  // And no swap CARD is surfaced, deliberately: buildSwapSuggestions gates on
  // the displayed (median) gain being positive, and this move's median gain is
  // negative. The movePlan is the complete answer; a card claiming a negative
  // gain would read as a bug. Pinned so a refactor cannot silently change it.
  assert.equal(result.suggestions.length, 0);
});

test("'mean' surfaces a swap card when the median agrees, with the gain computed from medians", () => {
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH')];
  const projections = new Map([[1, proj(10, 10)], [2, proj(11, 15)]]);
  const result = buildSuggestions(lineup, projections, new Map(), RB1, { lineupRanking: 'mean' });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggested.playerId, 2);
  assert.equal(result.suggestions[0].gain, 1, 'gain is median 11 - median 10, never mean 15 - mean 10');
  assert.equal(result.suggestions[0].current.projection, 10);
  assert.equal(result.suggestions[0].suggested.projection, 11);
  assert.equal(result.optimalTotal, 11);
});

test("'mean' falls back to the displayed points for a projection with no distribution", () => {
  const lineup = [entry(1, 'RB', 'RB'), entry(2, 'RB', 'BENCH')];
  // Player 2 has a bare legacy number - no distribution to take a mean from.
  const projections = new Map([[1, proj(10, 10)], [2, { points: 12 }]]);
  const result = buildSuggestions(lineup, projections, new Map(), RB1, { lineupRanking: 'mean' });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggested.playerId, 2, '12 must outrank 10 through the fallback');
});

test("'mean' gives an unavailable player rank 0, same as the display rule", () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    { ...entry(2, 'RB', 'BENCH'), onBye: true },
  ];
  // The bye player's mean towers over the starter; he still must not start.
  const projections = new Map([[1, proj(4, 4)], [2, proj(20, 25)]]);
  const result = buildSuggestions(lineup, projections, new Map(), RB1, { lineupRanking: 'mean' });
  assert.equal(result.suggestions.length, 0);
  assert.deepEqual(result.movePlan, []);
  assert.equal(result.optimalTotal, 4);
});

test('an unknown ranking value behaves as median, never as something new', () => {
  const { lineup, projections } = disagreeing();
  const byDefault = buildSuggestions(lineup, projections, new Map(), RB1);
  const byUnknown = buildSuggestions(lineup, projections, new Map(), RB1, { lineupRanking: 'p99-yolo' });
  assert.deepEqual(byUnknown, byDefault);
});
