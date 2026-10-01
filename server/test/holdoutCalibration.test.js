const test = require('node:test');
const assert = require('node:assert/strict');
const cal = require('../../scripts/holdout/lib/calibration');

function row(playerId, { position = 'WR', median = 12, floor = 6, ceiling = 20, ...over } = {}) {
  return {
    playerId,
    position,
    pointEstimate: median,
    mean: median,
    median,
    p10: floor,
    p25: floor + (median - floor) / 2,
    p75: median + (ceiling - median) / 2,
    p90: ceiling,
    sampleSize: 12,
    factors: {
      availability: { available: true },
      dataQuality: { residualSource: 'player', reasons: [] },
    },
    ...over,
  };
}

const obs = (predicted, outcome, count) => Array.from({ length: count }, () => ({ predicted, outcome }));

test('binOf: ten-point bins, 1 in the top bin, float edges land on their own bin', () => {
  assert.equal(cal.binOf(0), 0);
  assert.equal(cal.binOf(0.1), 1);
  assert.equal(cal.binOf(0.3), 3);
  assert.equal(cal.binOf(0.7), 7);
  assert.equal(cal.binOf(0.9), 9);
  assert.equal(cal.binOf(1), 9);
});

test('reliabilityTable: a bin within 10 points passes, outside fails, under 50 is not judged', () => {
  const pass = cal.reliabilityTable([...obs(0.7, 1, 40), ...obs(0.7, 0, 20)]); // observed .667
  assert.equal(pass.rows[0].n, 60);
  assert.equal(pass.rows[0].pass, true);
  assert.equal(pass.pass, true);

  const fail = cal.reliabilityTable([...obs(0.7, 1, 30), ...obs(0.7, 0, 30)]); // observed .5, gap -.2
  assert.equal(fail.rows[0].pass, false);
  assert.equal(fail.pass, false);

  const thin = cal.reliabilityTable(obs(0.7, 0, 49));
  assert.equal(thin.rows[0].judged, false);
  assert.equal(thin.rows[0].pass, null);
  assert.equal(thin.pass, false, 'no judged bin is no evidence');
});

test('reliabilityTable: a gap of exactly 10 points passes', () => {
  const table = cal.reliabilityTable([...obs(0.5, 1, 30), ...obs(0.5, 0, 20)]); // observed .6
  assert.equal(table.rows[0].pass, true);
});

test('thresholdObservations: eligible rows only, hit is points >= threshold, no stat row is left out', () => {
  const rows = [row(1), row(2), row(3, { position: 'K' }), row(4, { sampleSize: 3 })];
  const actuals = new Map([[1, 10], [3, 30], [4, 30]]); // 2 has no stat row; 3 and 4 are ineligible
  const out = cal.thresholdObservations(rows, actuals);
  assert.deepEqual(out.map((o) => [o.threshold, o.outcome]), [[10, 1], [20, 0]]);
});

test('thresholdObservations: a QB is read at 15 and 25', () => {
  const out = cal.thresholdObservations([row(1, { position: 'QB', median: 20, floor: 10, ceiling: 30 })], new Map([[1, 25]]));
  assert.deepEqual(out.map((o) => [o.threshold, o.outcome]), [[15, 1], [25, 1]]);
});

test('pairObservations: favored side is the one above .5, ties in points count half, same position only', () => {
  const strong = row(1, { median: 20, floor: 15, ceiling: 25 });
  const weak = row(2, { median: 8, floor: 4, ceiling: 12 });
  const otherPosition = row(3, { position: 'RB', median: 8, floor: 4, ceiling: 12 });
  // Pass the weak side first: the pair must still be read from the favored side.
  const out = cal.pairObservations([weak, strong, otherPosition], new Map([[1, 9], [2, 14], [3, 1]]));
  assert.equal(out.length, 1);
  assert.equal(out[0].predicted, 1);
  assert.equal(out[0].outcome, 0, 'the favored player scored less');

  const tie = cal.pairObservations([weak, strong], new Map([[1, 7], [2, 7]]));
  assert.equal(tie[0].outcome, 0.5);
});

test('pairObservations: a pair at exactly .5 favors nobody and is skipped', () => {
  const a = row(1);
  const b = row(2);
  assert.deepEqual(cal.pairObservations([a, b], new Map([[1, 5], [2, 9]])), []);
});

test('buildReadout and renderReadout: a table per threshold, a verdict line each section', () => {
  const rows = Array.from({ length: 60 }, (_, i) => row(i + 1, { median: 12, floor: 6, ceiling: 20 }));
  const actuals = new Map(rows.map((r) => [r.playerId, 12]));
  const result = cal.buildReadout([{ week: 1, profile: 'ppr', rows, actuals }]);
  assert.deepEqual(result.threshold.byThreshold.map((t) => t.threshold), [10, 20]);
  const md = cal.renderReadout(result, { season: 2026, weeks: [1], profiles: ['ppr'], basis: 'stat row' });
  assert.match(md, /### 10\+ points/);
  assert.match(md, /weeks included: 1/);
  assert.equal((md.match(/\*\*(PASS|FAIL)\*\*/g) || []).length, 2);
});
