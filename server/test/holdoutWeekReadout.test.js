'use strict';

// #2080: the pure assembly behind scripts/holdout/week-readout.js. One Holdout
// ledger fixture, hand-computed figures; the runner's SQL is not exercised here.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../services/projectionModel');
const { buildWeekReadout } = require('../../scripts/holdout/lib/weekReadout');

// median === mean so the ranking statistic cannot change the fixture; the
// interval is median +/- 8 (80%) and +/- 4 (50%) unless a row overrides it.
function ledgerRow(playerId, position, median, over = {}) {
  return {
    playerId,
    position,
    team: 'KC',
    injury: null,
    mean: median,
    median,
    p10: median - 8,
    p25: median - 4,
    p75: median + 4,
    p90: median + 8,
    activeProbability: 1,
    sampleSize: 10,
    factors: { availability: { available: true } },
    modelVersion: model.MODEL_VERSION,
    ...over,
  };
}

const rows = [
  ledgerRow('qb1', 'QB', 20),
  // actual 24 sits above p90 23: the one miss of QB's 80% interval
  ledgerRow('qb2', 'QB', 18, { p90: 23 }),
  ledgerRow('rb1', 'RB', 10),
  // projected >= 8, available, no stat row
  ledgerRow('rb2', 'RB', 9),
  ledgerRow('wr1', 'WR', 12),
  // Position-baseline projection: no history behind it
  ledgerRow('wr2', 'WR', 5, { sampleSize: 0 }),
  // unavailable at capture, yet a stat row scored
  ledgerRow('wr3', 'WR', 0, { activeProbability: 0, p10: 0, p25: 0, p75: 0, p90: 0 }),
  ledgerRow('te1', 'TE', 6),
  ledgerRow('k1', 'K', 7),
  ledgerRow('def1', 'DEF', 7),
];

const actuals = new Map([
  ['qb1', 15], ['qb2', 24], ['rb1', 8], ['wr1', 12], ['wr2', 3],
  ['wr3', 6], ['te1', 4], ['k1', 9], ['def1', 9],
]);

const priorByPlayer = new Map([
  ['qb1', [14, 16]], ['qb2', [20, 22]], ['wr1', [10, 14]], ['te1', [5]],
]);

const players = new Map(rows.map((r) => [r.playerId, { name: `Player ${r.playerId}` }]));

describe('buildWeekReadout (#2080)', () => {
  const report = buildWeekReadout({
    season: 2026, week: 4, profile: 'half_ppr', modelVersion: model.MODEL_VERSION, snapshotId: 31,
    rows, actuals, priorByPlayer, players,
  });

  test('overall is on the Appearance basis: stat row present, activeProbability 0 left out', () => {
    // errors (projected - actual): +5 -6 +2 0 +2 -2 -2 +2 over the 8 scored rows
    assert.equal(report.overall.n, 8);
    assert.equal(report.overall.mae, 2.625);
    assert.equal(report.overall.bias, 0.125);
    assert.equal(report.cohort, 10);
    assert.equal(report.withStatRow, 9);
    assert.equal(report.unavailable, 1);
    assert.equal(report.noHistory, 1);
  });

  test('per position: exact MAE, bias, 80% coverage and the naive MAE beside it', () => {
    assert.deepEqual(Object.keys(report.perPosition).sort(), ['DEF', 'K', 'QB', 'RB', 'TE', 'WR']);
    const qb = report.perPosition.QB;
    assert.equal(qb.n, 2);
    assert.equal(qb.mae, 5.5);
    assert.equal(qb.bias, -0.5);
    assert.equal(qb.cov80, 0.5);
    assert.equal(qb.covN, 2);
    // naive = mean of earlier weeks: 15 vs 15, 21 vs 24
    assert.equal(qb.naive.n, 2);
    assert.equal(qb.naive.mae, 1.5);
    // the unavailable WR3 is not in WR's n; the no-history WR2 is
    assert.equal(report.perPosition.WR.n, 2);
    assert.equal(report.perPosition.WR.bias, 1);
    // a position with no earlier weeks has no naive figure rather than a zero
    assert.equal(report.perPosition.RB.naive.n, 0);
    assert.equal(report.perPosition.RB.naive.mae, null);
    assert.equal(report.overall.naive.n, 4);
    assert.equal(report.overall.naive.mae, 1);
  });

  test('flags count the unavailable-but-scored row and the projected >= 8 row with no stat row', () => {
    assert.equal(report.flags.unavailableButScored.count, 1);
    assert.equal(report.flags.unavailableButScored.top[0].id, 'wr3');
    // qb1, qb2, rb1, rb2, wr1 are available at >= 8; only rb2 has no stat row
    assert.equal(report.flags.projectedGe8NoStatRow.count, 1);
    assert.equal(report.flags.projectedGe8NoStatRow.of, 5);
    assert.equal(report.flags.projectedGe8NoStatRow.top[0].id, 'rb2');
    assert.equal(report.flags.biggestMisses[0].id, 'qb2');
  });

  test('sealed basis scores the absent actual as 0 and excludes the unavailable row', () => {
    // 9 available rows; qb2 (24 > 23) and rb2 (0 < p10 1) fall outside, 7 of 9 inside
    assert.equal(report.sealedBasis.counts.cov80, 9);
    assert.equal(report.sealedBasis.counts.excludedUnavailable, 1);
    assert.equal(report.sealedBasis.cov80, 0.778);
  });
});
