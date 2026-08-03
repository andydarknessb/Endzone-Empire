'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const arms = require('../../scripts/backtest/lib/arms');
const metrics = require('../../scripts/backtest/lib/metrics');
const evidence = require('../../scripts/backtest/lib/sweepEvidence');

function fixture() {
  const estimate = (key, point = 0) => ({ key, status: 'estimated', point, lower: point - 0.01, upper: point + 0.01, weeks: metrics.EVALUATED_WEEKS.map((week) => ({ week, value: point })), reason: null });
  const rows = (point) => evidence.METRIC_KEYS.map((key, index) => estimate(key, point + index / 100));
  return {
    cells: arms.ALL_CELLS.map((cell, index) => ({ cell: cell.name, absoluteMetrics: rows(index + 1), pairedDeltas: rows(index / 10) })),
    movingBlock: arms.ALL_CELLS.flatMap((cell) => evidence.METRIC_KEYS.flatMap((key) => metrics.MOVING_BLOCK_LENGTHS.map((blockLength) => ({ cell: cell.name, key, blockLength, point: 0, lower: -0.01, upper: 0.01 })))),
    attribution: evidence.ATTRIBUTION_CELL_NAMES.flatMap((cell) => evidence.METRIC_KEYS.map((key) => ({ cell, key, usageMain: estimate(key, 0.01), homeAwayMain: estimate(key, 0.02), interaction: estimate(key, 0.03) }))),
    diagnostics: { controlNaive: rows(-0.1), usageSignal: rows(0.1), permutation: { seed: metrics.PERMUTATION_SEED, replicates: metrics.PERMUTATION_DRAWS, regretStatistic: -0.2, regretPValue: 0.0001, pairwiseStatistic: 0.03, pairwisePValue: 0.0001 } },
    activationProfiles: evidence.ON_CELL_NAMES.flatMap((cell) => ['2025', '2024'].flatMap((season) => metrics.EVALUATED_WEEKS.map((week) => ({ cell, season, week, positions: Object.fromEntries(metrics.MACRO_POSITIONS.map((position) => [position, { eligible: 1, activated: 1, excludedIneligible: 0, rate: 1 }])) })))),
    activationAggregates: evidence.ON_CELL_NAMES.flatMap((cell) => ['2025', '2024'].map((season) => ({ cell, season, positions: Object.fromEntries(metrics.MACRO_POSITIONS.map((position) => [position, { eligible: 17, activated: 17, excludedIneligible: 0, rate: 1 }])) }))),
  };
}

test('evidence contract requires all eight cells, descriptive diagnostics, sensitivities, composites, and weekly activation profiles', () => {
  const result = evidence.validateEvidence(fixture());
  assert.equal(result.cells.length, 8);
  assert.equal(result.movingBlock.length, 8 * evidence.METRIC_KEYS.length * 2);
  assert.equal(result.attribution.length, evidence.ATTRIBUTION_CELL_NAMES.length * evidence.METRIC_KEYS.length);
  assert.equal(result.activationProfiles.length, evidence.ON_CELL_NAMES.length * 2 * metrics.EVALUATED_WEEKS.length);
  assert.equal(result.activationAggregates.length, evidence.ON_CELL_NAMES.length * 2);
  assert.equal(result.diagnostics.permutation.replicates, 10000);
});

test('evidence normalization is deterministic under reordered input rows', () => {
  const a = fixture();
  const b = fixture();
  b.cells.reverse();
  b.movingBlock.reverse();
  b.attribution.reverse();
  b.activationProfiles.reverse();
  assert.deepEqual(evidence.validateEvidence(a), evidence.validateEvidence(b));
});

test('evidence mutations fail closed for omitted or extra rows', () => {
  const omitted = fixture();
  omitted.cells[0].absoluteMetrics.pop();
  assert.throws(() => evidence.validateEvidence(omitted), /requires each of the 7 metric keys exactly once/);
  const extra = fixture();
  extra.diagnostics.extraVerdict = 'pass';
  assert.throws(() => evidence.validateEvidence(extra), /closed shape violation/);
});

test('nonfinite values are explicitly encoded without loss, while unevaluable evidence requires a reason', () => {
  const nonfinite = fixture();
  nonfinite.cells[0].absoluteMetrics[0].point = Infinity;
  nonfinite.cells[0].absoluteMetrics[0].status = 'unevaluable';
  nonfinite.cells[0].absoluteMetrics[0].reason = 'input metric overflow';
  const result = evidence.validateEvidence(nonfinite);
  assert.deepEqual(result.cells[0].absoluteMetrics[0].point, { nonfinite: '+Infinity' });

  const missingReason = fixture();
  missingReason.cells[0].absoluteMetrics[0].status = 'unevaluable';
  missingReason.cells[0].absoluteMetrics[0].reason = null;
  assert.throws(() => evidence.validateEvidence(missingReason), /unevaluable evidence requires a reason/);
});
