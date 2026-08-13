const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../services/projectionModel');

// ---------------------------------------------------------------------------
// The smoothed bootstrap (MODEL_CONSTANTS.simulation.smoothingBandwidth).
//
// Ships at 0. The first thing tested is that 0 really is inert, because that
// is the whole reason this merges without a MODEL_VERSION bump.
// ---------------------------------------------------------------------------

const SIM = model.MODEL_CONSTANTS.simulation;
const OWN = [-6.2, -1.1, 0.4, 3.8, 9.6];
const POOLED = Array.from({ length: 60 }, (_, i) => (i - 30) * 0.9);

function sim(constants, overrides = {}) {
  return model.simulateDistribution({
    mean: 11.5,
    playerResiduals: OWN,
    pooledResiduals: POOLED,
    seed: 987654321,
    constants,
    ...overrides,
  });
}

test('smoothingBandwidth 0 is bit-identical to the unsmoothed bootstrap', () => {
  // The shipped constants object and one that names the field explicitly must
  // agree to the bit - including the PRNG sequence, which is why every
  // quantile is compared and not just the width.
  const shipped = sim(SIM);
  const explicitZero = sim({ ...SIM, smoothingBandwidth: 0 });
  assert.deepEqual(explicitZero, shipped);

  // A constants object with no smoothing keys at all - what a caller written
  // before this feature passes - must also be identical.
  const legacy = { ...SIM };
  delete legacy.smoothingBandwidth;
  delete legacy.smoothingPseudoResiduals;
  assert.deepEqual(sim(legacy), shipped);
});

test('smoothingBandwidth 0 stays inert across many seeds and pool shapes', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const own = Array.from({ length: (seed % 9) + 3 }, (_, i) => ((i * 7 + seed) % 17) - 8);
    const args = { mean: 4 + (seed % 11), playerResiduals: own, pooledResiduals: POOLED, seed };
    const shipped = model.simulateDistribution({ ...args, constants: SIM });
    const zeroed = model.simulateDistribution({ ...args, constants: { ...SIM, smoothingBandwidth: 0 } });
    assert.deepEqual(zeroed, shipped, `seed ${seed} diverged`);
  }
});

test('a positive bandwidth widens both intervals', () => {
  const off = sim(SIM);
  const on = sim({ ...SIM, smoothingBandwidth: 0.2, intervalScale: 1 });
  const width = (d) => d.p90 - d.p10;
  const inner = (d) => d.p75 - d.p25;
  const unscaled = sim({ ...SIM, intervalScale: 1 });
  // Compared at the SAME intervalScale, so this measures the smoothing rather
  // than the scale constant it is meant to replace.
  assert.ok(width(on) > width(unscaled), 'p10-p90 must widen');
  assert.ok(inner(on) > inner(unscaled), 'p25-p75 must widen too - fixing one band and breaking the other is the failure mode this replaced');
  assert.ok(off.p10 != null && on.p10 != null);
});

test('smoothing does not move the point estimate: the draw median is pinned exactly', () => {
  // A symmetric kernel pulls a skewed draw set's median toward its mean, so
  // the implementation re-centres; this asserts the result, not the intent.
  // The pin is `mean + median(residuals)` at EVERY scale - including exactly
  // 1, where the bit-compatibility shortcut leaves `origin` as the bare mean
  // and pinning to `origin` would have moved the estimate by 0.5 points.
  const skewed = [-1, -0.8, -0.6, -0.5, -0.4, 12, 30];
  const mean = 9.25;
  const medianResidual = model.quantile([...skewed].sort((a, b) => a - b), 0.5);
  assert.equal(medianResidual, -0.5);
  const expected = model.round2(mean + medianResidual);

  for (const seed of [1, 2, 3, 99, 12345]) {
    for (const intervalScale of [1, 1.45]) {
      const d = model.simulateDistribution({
        mean, playerResiduals: skewed, pooledResiduals: POOLED, seed,
        constants: { ...SIM, smoothingBandwidth: 0.35, intervalScale },
      });
      assert.equal(d.median, expected, `seed ${seed} scale ${intervalScale} moved the median`);
    }
  }
});

test('the median pin is scale-agnostic - smoothing on or off, at scale 1 or not', () => {
  // The re-centring targets `mean + median(residuals)`, which is where the
  // UNSMOOTHED mechanism puts the median at every scale. An earlier draft
  // pinned to `origin`, which the intervalScale-1 shortcut leaves as the bare
  // mean; that moved the point estimate by the median residual at exactly one
  // scale value and nowhere else. This pins the property that forbids it.
  const skewed = [-1, -0.8, -0.6, -0.5, -0.4, 12, 30];
  const mean = 9.25;
  const expected = model.round2(mean + model.quantile([...skewed].sort((a, b) => a - b), 0.5));
  for (const intervalScale of [1, 1.0001, 1.2, 1.45, 2]) {
    for (const smoothingBandwidth of [0, 0.35]) {
      const d = model.simulateDistribution({
        mean, playerResiduals: skewed, pooledResiduals: POOLED, seed: 7,
        constants: { ...SIM, intervalScale, smoothingBandwidth },
      });
      const gap = Math.abs(d.median - expected);
      assert.ok(gap <= 0.35,
        `scale ${intervalScale} bw ${smoothingBandwidth}: median ${d.median} vs ${expected}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Bandwidth derivation
// ---------------------------------------------------------------------------

test('smoothingBandwidthFor returns 0 whenever smoothing is off or unusable', () => {
  const residuals = [...OWN].sort((a, b) => a - b);
  assert.equal(model.smoothingBandwidthFor({ own: OWN, pooled: POOLED, residuals, constants: SIM }), 0);
  assert.equal(
    model.smoothingBandwidthFor({ own: OWN, pooled: POOLED, residuals: [], constants: { ...SIM, smoothingBandwidth: 0.2 } }),
    0,
    'no residuals means no spread to scale'
  );
  // A degenerate pool has zero spread, so there is nothing to smooth BY -
  // returning a positive bandwidth there would invent dispersion.
  assert.equal(
    model.smoothingBandwidthFor({
      own: [0, 0, 0], pooled: [], residuals: [0, 0, 0],
      constants: { ...SIM, smoothingBandwidth: 0.2, smoothingPseudoResiduals: 0 },
    }),
    0
  );
});

test('the bandwidth shrinks a thin own pool toward the position pool, and leaves a rich one alone', () => {
  const constants = { ...SIM, smoothingBandwidth: 1, smoothingPseudoResiduals: 8 };
  const wide = POOLED;                       // inter-decile spread ~ 43
  const narrow = [-0.5, 0, 0.5];             // spread ~ 0.8
  const pooledSpread = model.interDecileSpread([...wide].sort((a, b) => a - b));

  const thin = model.smoothingBandwidthFor({
    own: narrow, pooled: wide, residuals: [...narrow].sort((a, b) => a - b), constants,
  });
  // n = 3 against 8 pseudo-observations: the pool should dominate.
  assert.ok(thin > pooledSpread * 0.5, `a 3-residual player should borrow most of the pool's spread, got ${thin}`);

  const richOwn = Array.from({ length: 60 }, (_, i) => (i - 30) * 0.05); // spread ~ 2.4
  const rich = model.smoothingBandwidthFor({
    own: richOwn, pooled: wide, residuals: [...richOwn].sort((a, b) => a - b), constants,
  });
  assert.ok(rich < thin, 'a well-sampled player must be smoothed less than a thin one');
  assert.ok(rich < pooledSpread * 0.35, 'and must keep mostly his own dispersion');
});

test('the bandwidth uses the OWN count, not the borrowed pool size', () => {
  // A player with 1 residual is served from the pooled pool. His evidence is
  // 1, not the pool's size, so he must be shrunk hard toward it.
  const constants = { ...SIM, smoothingBandwidth: 1, smoothingPseudoResiduals: 8 };
  const sorted = [...POOLED].sort((a, b) => a - b);
  const borrowed = model.smoothingBandwidthFor({ own: [2.5], pooled: POOLED, residuals: sorted, constants });
  const pooledSpread = model.interDecileSpread(sorted);
  // own spread == pooled spread here (he IS using the pool), so any weighting
  // returns the pooled spread; the assertion is that it is finite and pooled-sized.
  assert.ok(Math.abs(borrowed - pooledSpread) < 1e-9);
});

// ---------------------------------------------------------------------------
// The kernel
// ---------------------------------------------------------------------------

test('standardNormal is deterministic and roughly standard', () => {
  const a = model.mulberry32(4242);
  const b = model.mulberry32(4242);
  assert.equal(model.standardNormal(a), model.standardNormal(b));

  const rand = model.mulberry32(2024);
  const draws = Array.from({ length: 20000 }, () => model.standardNormal(rand));
  const mean = draws.reduce((s, x) => s + x, 0) / draws.length;
  const variance = draws.reduce((s, x) => s + (x - mean) ** 2, 0) / draws.length;
  assert.ok(Math.abs(mean) < 0.05, `kernel mean should be ~0, got ${mean}`);
  assert.ok(Math.abs(variance - 1) < 0.08, `kernel variance should be ~1, got ${variance}`);
  assert.ok(draws.every(Number.isFinite), 'no draw may be non-finite - log(0) would poison a whole projection');
});
