const test = require('node:test');
const assert = require('node:assert/strict');

const metrics = require('../../scripts/backtest/lib/metrics');

// ---------------------------------------------------------------------------
// The preregistered constants
// ---------------------------------------------------------------------------

test('every inference constant matches the sealed preregistration exactly', () => {
  assert.equal(metrics.BOOTSTRAP_DRAWS, 100000, 'exactly, not "at least" and not "about"');
  assert.equal(metrics.BOOTSTRAP_SEED, 1499811874);
  assert.equal(metrics.PERMUTATION_DRAWS, 10000);
  assert.equal(metrics.PERMUTATION_SEED, 940227589);
  assert.equal(metrics.PERMUTATION_P_THRESHOLD, 0.001);
  assert.equal(metrics.MOVING_BLOCK_SEED, 588165040);
  assert.deepEqual([...metrics.MOVING_BLOCK_LENGTHS], [2, 3]);
  assert.equal(metrics.FAMILY_ALPHA, 0.05);
  assert.equal(metrics.IUT_COMPONENTS, 7, 'the divisor is FIXED at 7, whatever a claim skips');
  assert.ok(Math.abs(metrics.COMPONENT_ALPHA - 1 / 140) < 1e-15, 'alpha/7 is exactly 1/140');
  assert.deepEqual([...metrics.MACRO_POSITIONS], ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
  assert.equal(metrics.EVALUATED_WEEKS.length, 17);
  assert.equal(metrics.EVALUATED_WEEKS[0], 2, 'week 1 is outside the evaluation window');
  assert.equal(metrics.EVALUATED_WEEKS[16], 18, 'week 18 is included, distortion and all');
  assert.equal(metrics.MIN_SURVIVING_CLUSTERS, 15, 'more than 2 dropped weeks makes it unevaluable');
});

test('the 24 salts are the preregistered list, split into two disjoint 12s', () => {
  assert.equal(metrics.SALTS.length, 24);
  assert.equal(metrics.SALTS[0], 'pit-01-879c6f8eae4b');
  assert.equal(metrics.SALTS[23], 'pit-24-6e1cc0e9aef6');
  assert.equal(new Set(metrics.SALTS).size, 24, 'no duplicates');
  // Half A is the odd-numbered salts, half B the even ones (prereg 8.2).
  assert.equal(metrics.SALT_HALF_A.length, 12);
  assert.equal(metrics.SALT_HALF_B.length, 12);
  assert.equal(metrics.SALT_HALF_A[0], 'pit-01-879c6f8eae4b');
  assert.equal(metrics.SALT_HALF_B[0], 'pit-02-d5b1cf54d30c');
  assert.equal(metrics.SALT_HALF_A.some((s) => metrics.SALT_HALF_B.includes(s)), false, 'disjoint');
  assert.deepEqual([...metrics.SALT_HALF_A, ...metrics.SALT_HALF_B].sort(), [...metrics.SALTS].sort());
});

// ---------------------------------------------------------------------------
// Week-unit metrics
// ---------------------------------------------------------------------------

test('a week\'s regret is the mean over its rosters, and an empty week is an error', () => {
  assert.equal(metrics.weekRegret([0, 2, 4, 6]), 3);
  assert.equal(metrics.weekRegret([1.5]), 1.5);
  // A week with no roster-weeks has no score; returning 0 would read as "the
  // arm was perfect that week".
  assert.throws(() => metrics.weekRegret([]), /a week with no roster-weeks has no regret score/);
  assert.throws(() => metrics.weekRegret([1, null]), /is not a number/);
});

test('pairwise scores order, halves an exact projection tie, and drops equal-actual pairs', () => {
  // Right order scores 1.
  assert.equal(metrics.cellPairwise([
    { projected: 10, actual: 20 }, { projected: 5, actual: 8 },
  ]).score, 1);
  // Reversed scores 0.
  assert.equal(metrics.cellPairwise([
    { projected: 10, actual: 5 }, { projected: 5, actual: 20 },
  ]).score, 0);
  // An exact projection tie scores 0.5 - the model expressed no preference.
  assert.equal(metrics.cellPairwise([
    { projected: 7, actual: 20 }, { projected: 7, actual: 5 },
  ]).score, 0.5);
  // EQUAL ACTUALS remove the pair from the denominator: there is no right
  // answer to get right.
  const equalActuals = metrics.cellPairwise([
    { projected: 10, actual: 12 }, { projected: 5, actual: 12 },
  ]);
  assert.equal(equalActuals.eligible, 0);
  assert.equal(equalActuals.score, null);
  // A null projection contributes to no pair at all.
  const withNull = metrics.cellPairwise([
    { projected: null, actual: 20 }, { projected: 5, actual: 8 }, { projected: 9, actual: 30 },
  ]);
  assert.equal(withNull.eligible, 1, 'only the two real projections pair');
  // Float artifacts are not ties (10 decimal places).
  assert.equal(metrics.cellPairwise([
    { projected: 0.1 + 0.2, actual: 20 }, { projected: 0.3, actual: 5 },
  ]).score, 0.5, 'a float artifact IS a tie at the preregistered precision');
});

test('the week pairwise score is an equally weighted macro-average over six positions', () => {
  const rows = (score) => (score === 1
    ? [{ projected: 10, actual: 20 }, { projected: 5, actual: 8 }]
    : [{ projected: 10, actual: 5 }, { projected: 5, actual: 20 }]);
  const allRight = metrics.weekPairwise(Object.fromEntries(
    metrics.MACRO_POSITIONS.map((p) => [p, rows(1)])
  ));
  assert.equal(allRight.score, 1);
  assert.deepEqual(allRight.droppedPositions, []);

  // A position with one pair counts as much as one with many: that is what
  // "macro" means, and it is why DEF cannot be drowned by WR.
  const lopsided = metrics.weekPairwise({
    QB: rows(1), RB: rows(1), WR: rows(1), TE: rows(1), K: rows(1),
    DEF: rows(0),
  });
  assert.ok(Math.abs(lopsided.score - 5 / 6) < 1e-12, 'five positions right, one wrong');

  // ONE position with no eligible pairs is dropped and reported.
  const oneDropped = metrics.weekPairwise({
    QB: rows(1), RB: rows(1), WR: rows(1), TE: rows(1), K: rows(1), DEF: [],
  });
  assert.deepEqual(oneDropped.droppedPositions, ['DEF']);
  assert.equal(oneDropped.weekDropped, false);
  assert.equal(oneDropped.score, 1, 'the average is over the five survivors');

  // MORE than one dropped drops the WHOLE WEEK, which counts against the
  // missing-cell budget rather than being absorbed.
  const weekGone = metrics.weekPairwise({
    QB: rows(1), RB: rows(1), WR: rows(1), TE: rows(1), K: [], DEF: [],
  });
  assert.equal(weekGone.weekDropped, true);
  assert.equal(weekGone.score, null);
  assert.deepEqual(weekGone.droppedPositions, ['K', 'DEF']);
});

test('MAE, RMSE and rho exclude null projections AND count the exclusion', () => {
  const rows = [
    { projected: 10, actual: 12 }, { projected: 5, actual: 3 }, { projected: null, actual: 99 },
  ];
  const result = metrics.weekPointMetrics(rows);
  assert.equal(result.n, 2);
  assert.equal(result.excludedNullProjection, 1, 'the exclusion is counted, not silent');
  assert.equal(result.mae, 2);
  assert.equal(result.rmse, 2);
  // Rho is undefined when every value ties on one side.
  assert.equal(metrics.weekPointMetrics([
    { projected: 5, actual: 1 }, { projected: 5, actual: 2 },
  ]).spearman, null);
  // And a week with nothing usable yields nulls rather than zeros.
  const empty = metrics.weekPointMetrics([{ projected: null, actual: 1 }]);
  assert.deepEqual([empty.mae, empty.rmse, empty.spearman], [null, null, null]);
  assert.equal(empty.excludedNullProjection, 1);
});

test('Spearman uses MIDRANKS, so ties do not silently reorder', () => {
  assert.deepEqual(metrics.midranks([10, 20, 30]), [1, 2, 3]);
  assert.deepEqual(metrics.midranks([10, 10, 30]), [1.5, 1.5, 3]);
  assert.deepEqual(metrics.midranks([5, 5, 5]), [2, 2, 2]);
  assert.equal(metrics.spearman([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(metrics.spearman([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(metrics.spearman([1], [1]), null, 'one point has no correlation');
});

test('COVERAGE excludes null-interval rows and counts them (prereg 6.4)', () => {
  const rows = [
    { p10: 0, p90: 10, actual: 5 }, // covered
    { p10: 0, p90: 10, actual: 20 }, // not covered
    { p10: null, p90: null, actual: 5 }, // no interval: excluded AND counted
  ];
  const result = metrics.weekCoverage(rows);
  assert.equal(result.scored, 2);
  assert.equal(result.coverage, 0.5);
  assert.equal(result.excludedNullInterval, 1);
  // The band is INCLUSIVE at both ends.
  assert.equal(metrics.weekCoverage([{ p10: 5, p90: 10, actual: 5 }]).coverage, 1);
  assert.equal(metrics.weekCoverage([{ p10: 5, p90: 10, actual: 10 }]).coverage, 1);
  // An all-null week yields null coverage, never 0.
  const none = metrics.weekCoverage([{ p10: null, p90: null, actual: 5 }]);
  assert.equal(none.coverage, null);
  assert.equal(none.excludedNullInterval, 1);
});

test('WIS matches the preregistered formula on a worked fixture', () => {
  // A point inside both intervals: the penalty terms vanish and only the
  // widths and the median term remain.
  const row = { actual: 10, median: 10, p25: 8, p75: 12, p10: 5, p90: 15 };
  // 0.5*|10-10| = 0; (0.5/2)*(12-8) = 1; (0.2/2)*(15-5) = 1; total 2 / 2.5.
  assert.ok(Math.abs(metrics.weekWis([row]).wis - (2 / 2.5)) < 1e-12);

  // Below the lower bound: the (2/alpha) penalty applies to BOTH intervals.
  const below = { actual: 0, median: 10, p25: 8, p75: 12, p10: 5, p90: 15 };
  const is50 = (12 - 8) + (2 / 0.5) * (8 - 0);
  const is80 = (15 - 5) + (2 / 0.2) * (5 - 0);
  const expected = (0.5 * 10 + 0.25 * is50 + 0.1 * is80) / 2.5;
  assert.ok(Math.abs(metrics.weekWis([below]).wis - expected) < 1e-12);
  // A wider interval scores worse when the point is captured either way.
  const tight = metrics.weekWis([{ actual: 10, median: 10, p25: 9, p75: 11, p10: 8, p90: 12 }]).wis;
  const wide = metrics.weekWis([{ actual: 10, median: 10, p25: 5, p75: 15, p10: 0, p90: 20 }]).wis;
  assert.ok(tight < wide, 'WIS punishes an uninformatively wide interval');
});

test('WIS SKIPS AND COUNTS null-interval rows - the rule 6.5 does not state', () => {
  // Section 6.5 gives only the formula. The skip-and-count is applied by
  // analogy with 6.4 (coverage) and 6.6 (the global null convention), and it is
  // what lets the interval-free benchmarks be scored on what they support
  // instead of being handed fabricated bands.
  const rows = [
    { actual: 10, median: 10, p25: 8, p75: 12, p10: 5, p90: 15 },
    { actual: 10, median: 10, p25: null, p75: null, p10: null, p90: null },
    { actual: 10, median: null, p25: 8, p75: 12, p10: 5, p90: 15 },
  ];
  const result = metrics.weekWis(rows);
  assert.equal(result.scored, 1, 'only the complete row is scored');
  assert.equal(result.excludedNullInterval, 2, 'and both incomplete rows are COUNTED');
  assert.ok(Math.abs(result.wis - (2 / 2.5)) < 1e-12, 'the score is unaffected by the skipped rows');

  // A benchmark row - point estimate, no distribution at all - is skipped
  // entirely and the week reports null rather than a fabricated score.
  const benchmarkOnly = metrics.weekWis([
    { actual: 10, median: 9, p10: null, p25: null, p75: null, p90: null },
  ]);
  assert.equal(benchmarkOnly.wis, null);
  assert.equal(benchmarkOnly.excludedNullInterval, 1);
  assert.equal(benchmarkOnly.scored, 0);
});

// ---------------------------------------------------------------------------
// Contrasts
// ---------------------------------------------------------------------------

test('a contrast is the mean of the 24 SAME-SALT deltas, and a missing salt is an error', () => {
  const candidate = Object.fromEntries(metrics.SALTS.map((s, i) => [s, 10 + i]));
  const comparator = Object.fromEntries(metrics.SALTS.map((s, i) => [s, 8 + i]));
  assert.equal(metrics.saltPairedDelta({
    candidateBySalt: candidate, comparatorBySalt: comparator,
  }), 2, 'every same-salt delta is 2, so the mean is 2');

  // Worth stating precisely, because it is easy to over-claim: the MEAN of
  // paired deltas is identically `mean(candidate) - mean(comparator)`, so
  // same-salt pairing does NOT move the point estimate. What it buys is
  // VARIANCE - the candidate and comparator share a seed, so the simulation
  // noise cancels inside each pair and the bootstrap interval around this mean
  // is far tighter than it would be for independent runs. The mean is
  // pairing-invariant, and this pins that rather than pretending otherwise.
  const rotated = Object.fromEntries(metrics.SALTS.map((s, i) => [s, 8 + ((i + 7) % 24)]));
  const meanOf = (bySalt) => metrics.SALTS.reduce((sum, s) => sum + bySalt[s], 0) / 24;
  assert.ok(Math.abs(
    metrics.saltPairedDelta({ candidateBySalt: candidate, comparatorBySalt: rotated })
    - (meanOf(candidate) - meanOf(rotated))
  ) < 1e-12, 'the mean delta is the difference of means, whatever the pairing');

  // What pairing DOES enforce here is that both sides carry the same 24 salts,
  // so a candidate run under a different seed set can never be compared.

  const missing = { ...comparator };
  delete missing[metrics.SALTS[5]];
  assert.throws(() => metrics.saltPairedDelta({
    candidateBySalt: candidate, comparatorBySalt: missing,
  }), /salt pit-06-b35a0c9b6418 is missing.*breaks the pairing/s);
});

// ---------------------------------------------------------------------------
// The cluster bootstrap
// ---------------------------------------------------------------------------

test('the bootstrap is EXACTLY 100,000 draws and refuses any other count', () => {
  const resamples = metrics.buildBootstrapResamples({ clusterCount: 17 });
  assert.equal(resamples.draws, 100000);
  assert.equal(resamples.clusterCount, 17);
  assert.equal(resamples.index.length, 100000 * 17);
  assert.throws(() => metrics.buildBootstrapResamples({ clusterCount: 17, draws: 99999 }),
    /fixes the bootstrap at EXACTLY 100000 draws/);
  assert.throws(() => metrics.buildBootstrapResamples({ clusterCount: 17, draws: 200000 }),
    /EXACTLY 100000/);
  assert.throws(() => metrics.buildBootstrapResamples({ clusterCount: 0 }), /positive integer/);
});

test('the SHARED resamples are identical for every component that uses them', () => {
  // Two components drawing independently would produce different intervals for
  // reasons unrelated to the data, so the same index is reused everywhere.
  const a = metrics.buildBootstrapResamples({ clusterCount: 17 });
  const b = metrics.buildBootstrapResamples({ clusterCount: 17 });
  assert.deepEqual(Array.from(a.index.slice(0, 200)), Array.from(b.index.slice(0, 200)),
    'the preregistered seed makes the draws reproducible');

  // The SAME resample object, applied to two endpoints, draws the same weeks.
  const regret = Array.from({ length: 17 }, (unused, i) => -0.1 - i * 0.01);
  const pairwise = Array.from({ length: 17 }, (unused, i) => 0.01 + i * 0.001);
  const r1 = metrics.bootstrapMean({ weekValues: regret, resamples: a });
  const r2 = metrics.bootstrapMean({ weekValues: regret, resamples: a });
  assert.deepEqual(r1, r2, 'the same input through the same resamples is deterministic');
  const p1 = metrics.bootstrapMean({ weekValues: pairwise, resamples: a });
  assert.equal(p1.draws, 100000);
  assert.equal(p1.clusters, 17);

  // A resample index built for a different cluster count cannot be used.
  assert.throws(() => metrics.bootstrapMean({
    weekValues: regret.slice(0, 15), resamples: a,
  }), /15 surviving clusters but the shared resamples were built for 17/);
});

test('percentile bounds use the fixed order statistic, with no interpolation', () => {
  const sorted = Array.from({ length: 100 }, (unused, i) => i + 1);
  // ceil(q * n), clamped to [1, n].
  assert.equal(metrics.percentileBound(sorted, 0.5), 50);
  assert.equal(metrics.percentileBound(sorted, 0.005), 1, 'clamped at the bottom');
  assert.equal(metrics.percentileBound(sorted, 1), 100);
  assert.equal(metrics.percentileBound(sorted, 0.0071428571), 1);
  // No interpolation: a q that lands between two order statistics takes the
  // upper one, exactly and reproducibly.
  assert.equal(metrics.percentileBound(sorted, 0.501), 51);
  assert.throws(() => metrics.percentileBound([], 0.5), /no bootstrap statistics/);
});

test('a bootstrap CI brackets the point estimate and reports its own degeneracy', () => {
  const resamples = metrics.buildBootstrapResamples({ clusterCount: 17 });
  const weekValues = Array.from({ length: 17 }, (unused, i) => -0.3 + i * 0.02);
  const result = metrics.bootstrapMean({ weekValues, resamples });
  assert.ok(result.lower < result.point && result.point < result.upper);
  assert.ok(result.distinctValues > 100, 'a healthy bootstrap has many distinct statistics');

  // A constant series has exactly one distinct resampled statistic, which is
  // what the exact-inference trigger is looking for.
  const constant = metrics.bootstrapMean({
    weekValues: new Array(17).fill(0.5), resamples,
  });
  assert.equal(constant.point, 0.5);
  assert.equal(constant.lower, 0.5);
  assert.equal(constant.upper, 0.5);
  assert.equal(constant.distinctValues, 1);
  assert.deepEqual(metrics.exactInferenceTrigger(constant).fired, true);
  assert.match(metrics.exactInferenceTrigger(constant).reasons.join(' '), /degenerate bootstrap/);
});

test('the exact-inference trigger fires on few clusters or a degenerate distribution', () => {
  assert.equal(metrics.exactInferenceTrigger({ clusters: 17, distinctValues: 5000 }).fired, false);
  const fewClusters = metrics.exactInferenceTrigger({ clusters: 11, distinctValues: 5000 });
  assert.equal(fewClusters.fired, true);
  assert.match(fewClusters.reasons[0], /fewer than 12 clusters \(11\)/);
  assert.equal(metrics.exactInferenceTrigger({ clusters: 12, distinctValues: 5000 }).fired, false,
    'exactly 12 does not fire');
  assert.equal(metrics.exactInferenceTrigger({ clusters: 17, distinctValues: 99 }).fired, true);
  assert.equal(metrics.exactInferenceTrigger({ clusters: 17, distinctValues: 100 }).fired, false);
});

test('the moving-block sensitivity is deterministic, uses lengths 2 and 3, and GATES NOTHING', () => {
  const weekValues = Array.from({ length: 17 }, (unused, i) => -0.2 + i * 0.015);
  for (const blockLength of [2, 3]) {
    const a = metrics.movingBlockBootstrap({ weekValues, blockLength });
    const b = metrics.movingBlockBootstrap({ weekValues, blockLength });
    assert.deepEqual(a, b, `block length ${blockLength} is deterministic`);
    assert.equal(a.gates, false, 'it is a sensitivity and gates nothing');
    assert.equal(a.draws, 100000);
    assert.ok(a.lower < a.upper);
  }
  // Different block lengths give different answers, or running both would be
  // pointless.
  assert.notEqual(
    metrics.movingBlockBootstrap({ weekValues, blockLength: 2 }).lower,
    metrics.movingBlockBootstrap({ weekValues, blockLength: 3 }).lower
  );
  assert.throws(() => metrics.movingBlockBootstrap({ weekValues, blockLength: 4 }),
    /block length must be one of 2, 3/);

  // The draw count is held to the SAME 100,000 as the primary bootstrap
  // (prereg 10.5). A sensitivity run at a different resolution than the thing
  // it is a sensitivity TO would differ for a reason unrelated to the serial
  // structure it exists to probe - and the primary bootstrap already refuses
  // anything else, so the discipline has to be uniform.
  for (const draws of [9999, 10000, 200000]) {
    assert.throws(() => metrics.movingBlockBootstrap({ weekValues, blockLength: 2, draws }),
      /the SAME 100000 draws as the primary bootstrap/,
      `${draws} draws must be refused`);
  }
});

// ---------------------------------------------------------------------------
// Week dropping
// ---------------------------------------------------------------------------

test('weeks drop SYMMETRICALLY across candidate and comparator, and too many is UNEVALUABLE', () => {
  const full = Object.fromEntries(metrics.EVALUATED_WEEKS.map((w) => [w, 1]));
  const missingOne = { ...full };
  delete missingOne[9];

  // A week missing from EITHER series drops from BOTH.
  const one = metrics.dropWeeks({ series: { candidate: full, comparator: missingOne } });
  assert.deepEqual(one.dropped, [9]);
  assert.equal(one.surviving.length, 16);
  assert.equal(one.evaluable, true);
  assert.equal(one.aligned.candidate.length, 16, 'the candidate loses week 9 too');
  assert.equal(one.aligned.comparator.length, 16);

  // Exactly 2 dropped is still evaluable (15 survivors is the floor).
  const missingTwo = { ...full };
  delete missingTwo[9];
  delete missingTwo[10];
  assert.equal(metrics.dropWeeks({ series: { a: full, b: missingTwo } }).evaluable, true);

  // Three dropped is UNEVALUABLE, and an unevaluable component fails the claim.
  const missingThree = { ...missingTwo };
  delete missingThree[11];
  const tooMany = metrics.dropWeeks({ series: { a: full, b: missingThree } });
  assert.equal(tooMany.evaluable, false);
  assert.equal(tooMany.surviving.length, 14);
  assert.match(tooMany.reason, /leaving 14 clusters; the component requires at least 15/);
  assert.throws(() => metrics.dropWeeks({ series: {} }), /no series to align/);
});

// ---------------------------------------------------------------------------
// The permutation control
// ---------------------------------------------------------------------------

test('the permutation control is EXACTLY 10,000 replicates, canonically seeded and reusable', () => {
  const cells = { '2025:2:QB': [10, 2, 4, 1], '2025:2:RB': [8, 3, 7, 1, 2, 9] };
  const built = metrics.buildPermutations({ cells });
  assert.equal(built.draws, 10000);
  assert.throws(() => metrics.buildPermutations({ cells, draws: 9999 }),
    /fixes exactly 10000 permutations/);
  assert.throws(() => metrics.buildPermutations({ cells, seed: 1 }), /seed is fixed at 940227589/);

  // Each replicate is a real permutation of each cell, not a resample.
  for (let d = 0; d < 50; d++) {
    const replicate = built.replicate(d);
    assert.deepEqual([...replicate['2025:2:QB']].sort((a, b) => a - b), [0, 1, 2, 3]);
    assert.deepEqual([...replicate['2025:2:RB']].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  }
  // Seeded: the same build gives the same permutations, so ONE replicate can be
  // reused across all 24 salts and both endpoints.
  const again = metrics.buildPermutations({ cells });
  assert.deepEqual(built.replicate(0), again.replicate(0));
  assert.deepEqual(built.replicate(9999), again.replicate(9999));
  // And they are not all the same permutation.
  const distinct = new Set(
    Array.from({ length: 200 }, (unused, d) => built.permutationFor(d, '2025:2:RB').join(','))
  );
  assert.ok(distinct.size > 1, 'the permutations actually differ');
});

test('permutations REGENERATE identically rather than being materialized', () => {
  const cells = { '2025:2:QB': [1, 2, 3, 4], '2025:2:RB': [1, 2, 3, 4, 5, 6] };
  const built = metrics.buildPermutations({ cells });

  // The requirement the array shape used to carry: ONE permutation per
  // replicate, reused across all 24 salts and both co-primary endpoints. With a
  // regenerable stream that identity is a property of the function, so ask for
  // the same coordinates repeatedly and out of order.
  const first = built.permutationFor(7, '2025:2:RB');
  built.permutationFor(9998, '2025:2:QB');
  built.permutationFor(0, '2025:2:RB');
  assert.deepEqual(built.permutationFor(7, '2025:2:RB'), first,
    'the same replicate and cell must yield the same permutation no matter what was asked between');
  // Independent of construction order too: a fresh builder, asked only for
  // replicate 7, must agree with one that walked the whole range.
  assert.deepEqual(metrics.buildPermutations({ cells }).permutationFor(7, '2025:2:RB'), first);

  // Cells are independent draws, not one stream sliced - so the QB order is not
  // a function of the RB order.
  const bigger = metrics.buildPermutations({ cells: { ...cells, '2025:2:WR': [1, 2, 3, 4, 5, 6, 7, 8, 9] } });
  assert.deepEqual(bigger.permutationFor(7, '2025:2:RB'), first,
    'adding a cell must not shift another cell permutations');

  // Independent means DIFFERENT, not merely unshifted. Two cells of the SAME
  // size within one replicate must not receive the same permutation: if the
  // seed ignored the cell key, every same-size cell in a replicate would be
  // shuffled identically, which correlates the null across positions and weeks
  // and quietly shrinks the permutation null's spread.
  const forty = Array.from({ length: 40 }, (unused, i) => i + 1);
  const twins = metrics.buildPermutations({ cells: { '2025:2:RB': forty, '2025:2:WR': forty, '2025:9:RB': forty } });
  const seen = new Set();
  for (let d = 0; d < 25; d++) {
    for (const cell of ['2025:2:RB', '2025:2:WR', '2025:9:RB']) seen.add(`${d}|${twins.permutationFor(d, cell).join(',')}`);
    assert.notDeepEqual(twins.permutationFor(d, '2025:2:RB'), twins.permutationFor(d, '2025:2:WR'),
      `replicate ${d}: same-size cells must draw independently`);
    assert.notDeepEqual(twins.permutationFor(d, '2025:2:RB'), twins.permutationFor(d, '2025:9:RB'),
      `replicate ${d}: the same position in another week must draw independently`);
  }
  assert.equal(seen.size, 75, 'all 25 replicates x 3 cells are distinct permutations');

  // Nothing is materialized: a cohort-scale cell count would be tens of
  // millions of integers if it were, and this must stay instant.
  const wide = {};
  for (let w = 2; w <= 18; w++) for (const p of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) wide[`2025:${w}:${p}`] = Array.from({ length: 400 }, (unused, i) => i + 1);
  const t0 = Date.now();
  const big = metrics.buildPermutations({ cells: wide });
  assert.ok(Date.now() - t0 < 250, 'construction must not enumerate the replicates');
  assert.equal(big.permutationFor(9999, '2025:18:WR').length, 400);

  // The coordinates are validated, so a typo cannot silently return the wrong
  // permutation - or an undefined that Number() would turn into 0.
  assert.throws(() => built.permutationFor(10000, '2025:2:QB'), /outside 0\.\.9999/);
  assert.throws(() => built.permutationFor(-1, '2025:2:QB'), /outside 0\.\.9999/);
  assert.throws(() => built.permutationFor(1.5, '2025:2:QB'), /outside 0\.\.9999/);
  assert.throws(() => built.permutationFor(0, '2025:2:XX'), /unknown cell/);
});

test('the permutation transition, seed, canonical order, and GATHER direction are pinned', () => {
  const rng = metrics.makeRng(123456789);
  assert.deepEqual([rng(), rng(), rng(), rng(), rng()], [
    0.2577907438389957, 0.9707721115555614, 0.7853280142880976, 0.20616457983851433, 0.30307188746519387,
  ]);
  const built = metrics.buildPermutations({ cells: { '2025:9:RB': [10, 2, 9, 1] } });
  assert.equal(built.seedFor(17, '2025:9:RB'), 544340815);
  assert.deepEqual(built.canonicalPlayerIds('2025:9:RB'), [1, 2, 9, 10]);
  const order = built.permutationFor(17, '2025:9:RB');
  assert.deepEqual(order, [1, 0, 2, 3]);
  assert.deepEqual(
    metrics.gatherPermutedProjections({ playerIds: [1, 2, 9, 10], projections: ['a', 'b', 'c', 'd'], order }),
    [{ playerId: 1, projected: 'b' }, { playerId: 2, projected: 'a' }, { playerId: 9, projected: 'c' }, { playerId: 10, projected: 'd' }]
  );
  assert.throws(() => metrics.buildPermutations({ cells: { '2025:2:QB': [1, 1] } }), /duplicate playerId/);
});

test('the plus-one Monte Carlo p-value can never report zero evidence as certainty', () => {
  // More extreme than every draw still cannot be p = 0: B draws support at most
  // 1/(B+1).
  const permuted = Array.from({ length: 9999 }, (unused, i) => i / 10000);
  const beatsAll = metrics.permutationPValue({ observed: 5, permuted });
  assert.equal(beatsAll.atLeastAsExtreme, 0);
  assert.ok(Math.abs(beatsAll.p - 1 / 10000) < 1e-12, 'the floor is 1/(B+1), never 0');
  // Ties count as at-least-as-extreme.
  assert.equal(metrics.permutationPValue({ observed: 0, permuted: [0, -1, -2] }).atLeastAsExtreme, 1);
  assert.throws(() => metrics.permutationPValue({ observed: 1, permuted: [] }), /no permuted statistics/);
  assert.throws(() => metrics.permutationPValue({ observed: null, permuted: [1] }), /not a number/);
});

test('a control that cannot beat the shuffle VOIDS the run on either endpoint', () => {
  const ok = metrics.assertPermutationControl({ regretP: 0.0001, pairwiseP: 0.0005 });
  assert.equal(ok.void, false);
  // The threshold is <=, so exactly 0.001 passes.
  assert.equal(metrics.assertPermutationControl({ regretP: 0.001, pairwiseP: 0.001 }).void, false);
  // EITHER endpoint failing voids the run - it is a pipeline assertion.
  const badRegret = metrics.assertPermutationControl({ regretP: 0.02, pairwiseP: 0.0001 });
  assert.equal(badRegret.void, true);
  assert.match(badRegret.detail, /cannot distinguish signal from noise.*VOID/s);
  assert.deepEqual(badRegret.failures, ['regret p = 0.02']);
  const bothBad = metrics.assertPermutationControl({ regretP: 0.02, pairwiseP: 0.5 });
  assert.equal(bothBad.failures.length, 2);
  assert.throws(() => metrics.assertPermutationControl({ regretP: null, pairwiseP: 0.1 }),
    /the regret p-value must be within \[0, 1\]/);
});

test('permutation control permits raw observations only', () => {
  assert.throws(() => metrics.computePermutationControl({}), /canonical raw control observations/);
  assert.throws(() => metrics.computePermutationControl({ regret: { observed: 1, permuted: [0] } }), /caller-supplied permutation statistics are prohibited/);
  assert.throws(() => metrics.computePermutationControl({ observations: [], rosterRows: [], pairwise: { observed: 1 } }), /caller-supplied permutation statistics are prohibited/);
  assert.throws(() => metrics.assertPermutationControl({ regretP: -0.01, pairwiseP: 0.001 }), /within \[0, 1\]/);
});

// ---------------------------------------------------------------------------
// Split-salt SD
// ---------------------------------------------------------------------------

test('the split-salt SD is DESCRIPTIVE ONLY and says so in its own output', () => {
  const bySalt = Object.fromEntries(metrics.SALTS.map((s, i) => [s, i % 2 === 0 ? 10 : 12]));
  const result = metrics.splitSaltSd({ bySalt });
  assert.equal(result.halfA, 10, 'the odd salts');
  assert.equal(result.halfB, 12, 'the even salts');
  assert.equal(result.difference, -2);
  assert.equal(result.sd, 1);
  // The one assertion that matters: nothing may treat this as a gate.
  assert.equal(result.gates, false);
  assert.match(result.note, /descriptive only; no formal gate/);

  assert.throws(() => metrics.splitSaltSd({
    bySalt, halfA: metrics.SALTS.slice(0, 11), halfB: metrics.SALT_HALF_B,
  }), /must be 12 and 12/);
  assert.throws(() => metrics.splitSaltSd({
    bySalt, halfA: metrics.SALTS.slice(0, 12), halfB: metrics.SALTS.slice(6, 18),
  }), /must be DISJOINT/);
});

test('metrics touches no global RNG and no clock', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', 'metrics.js'), 'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/Math\.random/.test(src), 'every random quantity comes from a preregistered seed');
  assert.ok(!/Date\.now|new Date\(/.test(src));
  assert.ok(!/process\.env/.test(src));
});
