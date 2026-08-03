'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const arms = require('../../scripts/backtest/lib/arms');
const metrics = require('../../scripts/backtest/lib/metrics');
const evidence = require('../../scripts/backtest/lib/sweepEvidence');

const permutation = {
  seed: metrics.PERMUTATION_SEED, replicates: metrics.PERMUTATION_DRAWS,
  regret: { observed: 0, p: 1 / 10001 }, pairwise: { observed: 1, p: 1 / 10001 },
};

function fixture() {
  const weekly = (point) => metrics.EVALUATED_WEEKS.map((week) => ({ week, value: point + (week - 2) * 0.001 }));
  return {
    metricWeeks: arms.ALL_CELLS.flatMap((cell, cellIndex) => ['absolute', 'paired-delta'].flatMap((estimand) => evidence.METRIC_KEYS.flatMap((endpoint, index) => weekly(cellIndex + index / 100).map(({ week, value }) => ({ season: '2025', scoringProfile: 'standard', cell: cell.name, endpoint, estimand, week, value }))))),
    movingBlockWeeks: arms.ALL_CELLS.flatMap((cell) => metrics.MOVING_BLOCK_LENGTHS.flatMap((blockLength) => evidence.METRIC_KEYS.flatMap((endpoint) => weekly(0).map(({ week, value }) => ({ season: '2025', scoringProfile: 'standard', cell: cell.name, endpoint, estimand: 'absolute', sensitivity: `moving-block-${blockLength}`, week, value }))))),
    attributionWeeks: evidence.ATTRIBUTION_CELL_NAMES.flatMap((cell) => ['usage-main', 'home-away-main', 'interaction'].flatMap((estimand, estimateIndex) => evidence.METRIC_KEYS.flatMap((endpoint) => weekly(estimateIndex / 100).map(({ week, value }) => ({ season: '2025', scoringProfile: 'standard', cell, endpoint, estimand, week, value }))))),
    diagnosticWeeks: ['control-naive', 'usage-signal'].flatMap((estimand, estimateIndex) => evidence.METRIC_KEYS.flatMap((endpoint) => weekly(estimateIndex / 10).map(({ week, value }) => ({ season: '2025', scoringProfile: 'standard', endpoint, estimand, week, value })))),
    activationWeeks: evidence.ON_CELL_NAMES.flatMap((cell) => evidence.SEASONS.flatMap((season) => metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.map((position) => ({ cell, season, scoringProfile: 'standard', week, position, eligible: 1, activated: 1, excludedIneligible: 0 }))))),
  };
}

test('evidence derives complete estimates, intervals, sensitivities, composites, diagnostics, and activation aggregates from raw weekly coordinates', () => {
  const result = evidence.deriveEvidence(fixture(), { permutation });
  assert.equal(result.cells.length, 8);
  assert.equal(result.cells[0].season, '2025');
  assert.equal(result.cells[0].scoringProfile, 'standard');
  assert.equal(result.cells[0].absoluteMetrics[0].point, 0.008);
  assert.ok(result.cells[0].absoluteMetrics[0].lower < 0.008);
  assert.ok(result.cells[0].absoluteMetrics[0].upper > 0.008);
  assert.equal(result.movingBlock.length, 8 * evidence.METRIC_KEYS.length * 2);
  assert.equal(result.attribution.length, evidence.ATTRIBUTION_CELL_NAMES.length * evidence.METRIC_KEYS.length);
  assert.equal(result.activationProfiles.length, evidence.ON_CELL_NAMES.length * 2 * 17 * 6);
  assert.equal(result.activationAggregates[0].positions.QB.eligible, 17);
  assert.equal(result.diagnostics.permutation.replicates, 10000);
});

test('evidence rejects empty, missing, duplicate, extra, and reordered raw coordinates before publication', () => {
  assert.throws(() => evidence.deriveEvidence({ ...fixture(), metricWeeks: [] }, { permutation }), /non-empty complete row set/);
  const missing = fixture();
  missing.metricWeeks.pop();
  assert.throws(() => evidence.deriveEvidence(missing, { permutation }), /incomplete coordinate set; missing 1/);
  const duplicate = fixture();
  duplicate.movingBlockWeeks.push({ ...duplicate.movingBlockWeeks[0] });
  assert.throws(() => evidence.deriveEvidence(duplicate, { permutation }), /duplicate coordinate/);
  const extra = fixture();
  extra.diagnosticWeeks.push({ ...extra.diagnosticWeeks[0], week: 1 });
  assert.throws(() => evidence.deriveEvidence(extra, { permutation }), /invalid diagnostic coordinate/);
  const reordered = fixture();
  reordered.metricWeeks.reverse();
  assert.deepEqual(evidence.deriveEvidence(fixture(), { permutation }), evidence.deriveEvidence(reordered, { permutation }));
});

test('nonfinite weekly evidence is retained as an explicit unevaluable marker rather than silently converted or dropped', () => {
  const input = fixture();
  input.metricWeeks[0].value = Infinity;
  const result = evidence.deriveEvidence(input, { permutation });
  const estimate = result.cells[0].absoluteMetrics[0];
  assert.equal(estimate.status, 'unevaluable');
  assert.deepEqual(estimate.point, { nonfinite: '+Infinity' });
  assert.match(estimate.reason, /nonfinite weekly evidence/);
});
