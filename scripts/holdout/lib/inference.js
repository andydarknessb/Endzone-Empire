'use strict';

/**
 * Inference machinery for `holdout-confirm-2026` (PREREGISTRATION.md §8, §10).
 *
 * Pure: no database, no filesystem, no clock, no environment. Every random
 * number comes from the production `mulberry32` under a seed the caller
 * supplies, so a rerun is a reproduction, not a resample.
 */

const model = require('../../../server/services/projectionModel');

/**
 * The sealed CI contract's resample matrix, generated ONCE per evaluation:
 * `draws` rows of `n` week-indices drawn with replacement. Section 10 requires
 * IDENTICAL resamples for every arm, endpoint and component - which is only
 * checkable if the matrix is a first-class value handed to every bound
 * computation rather than regenerated inside each one.
 */
function buildResamples({ n, draws, seed }) {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`buildResamples: n must be a positive integer, got ${n}`);
  if (!Number.isInteger(draws) || draws <= 0) throw new Error(`buildResamples: draws must be a positive integer, got ${draws}`);
  const rand = model.mulberry32(seed);
  const matrix = new Array(draws);
  for (let b = 0; b < draws; b++) {
    const row = new Array(n);
    for (let i = 0; i < n; i++) row[i] = Math.floor(rand() * n) % n;
    matrix[b] = row;
  }
  return matrix;
}

/**
 * One-sided percentile bound of the resampled MEAN of `weeklyValues`.
 *
 * `quantile` follows §10's fixed rule: the order statistic at index
 * `ceil(q * draws)` clamped to [1, draws], no interpolation. `side` names
 * which bound the caller wants: 'upper' at level alpha is the (1 - alpha)
 * quantile, 'lower' is the alpha quantile - the pit-sweep §10.1 convention,
 * restated in this study's §10.
 */
function bootstrapBound({ weeklyValues, resamples, alpha, side }) {
  const n = weeklyValues.length;
  if (n === 0) throw new Error('bootstrapBound: no surviving weeks');
  if (resamples[0].length !== n) {
    throw new Error(`bootstrapBound: resample width ${resamples[0].length} != series length ${n} - the matrix was built for a different survivor set`);
  }
  const stats = new Array(resamples.length);
  for (let b = 0; b < resamples.length; b++) {
    const row = resamples[b];
    let sum = 0;
    for (let i = 0; i < row.length; i++) sum += weeklyValues[row[i]];
    stats[b] = sum / n;
  }
  stats.sort((a, b) => a - b);
  const q = side === 'upper' ? 1 - alpha : alpha;
  const index = Math.min(Math.max(Math.ceil(q * stats.length), 1), stats.length);
  const distinct = new Set(stats).size;
  return {
    bound: stats[index - 1],
    quantile: q,
    index,
    draws: stats.length,
    distinctValues: distinct,
    // §10's degeneracy half of the exact-inference trigger.
    degenerate: distinct < 100,
  };
}

/** Exact binomial upper tail: P(Binomial(n, 1/2) >= k), in log-free exact arithmetic for the n <= 18 this study can see. */
function binomialUpperTail(n, k) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  // C(n, j) via incremental multiplication - exact in doubles far beyond n = 18.
  let coeff = 1;
  let sum = 0;
  for (let j = 0; j <= n; j++) {
    if (j >= k) sum += coeff;
    coeff = (coeff * (n - j)) / (j + 1);
  }
  return sum / 2 ** n;
}

/**
 * The exact fallback (§10): a one-sided sign test on weekly deltas against a
 * boundary, at the same alpha as the bootstrap it replaces.
 *
 * `direction: 'below'` tests the claim "the true median lies below the
 * boundary" (an upper-bound claim); `'above'` the mirror. Weeks whose shifted
 * value is exactly zero - on values rounded to 10 decimals, the study's
 * global tie rule - are DROPPED, per pit-sweep §9.8.
 */
function exactSignTest({ weeklyValues, boundary, alpha, direction }) {
  const shifted = weeklyValues
    .map((v) => Math.round((v - boundary) * 1e10) / 1e10)
    .filter((v) => v !== 0);
  const n = shifted.length;
  const favorable = shifted.filter((v) => (direction === 'below' ? v < 0 : v > 0)).length;
  const p = binomialUpperTail(n, favorable);
  return { n, favorable, p, passes: n > 0 && p <= alpha };
}

/**
 * A component verdict under the full §10 contract: percentile bootstrap,
 * switching to the exact test when the trigger fires (fewer than
 * `exactTriggerClusters` surviving weeks, or a degenerate bootstrap), and
 * saying which method decided.
 *
 * `passes` is strict inequality against the boundary in the favorable
 * direction, exactly as §8 words every gate.
 */
function decideComponent({
  label, weeklyValues, resamples, alpha, boundary, side, exactTriggerClusters = 12,
}) {
  const n = weeklyValues.length;
  const mean = weeklyValues.reduce((a, b) => a + b, 0) / (n || 1);
  const clusterTrigger = n < exactTriggerClusters;
  let bootstrap = null;
  if (!clusterTrigger) {
    bootstrap = bootstrapBound({ weeklyValues, resamples, alpha, side });
  }
  const useExact = clusterTrigger || bootstrap.degenerate;
  if (useExact) {
    const exact = exactSignTest({
      weeklyValues, boundary, alpha,
      direction: side === 'upper' ? 'below' : 'above',
    });
    return {
      label, method: 'exact-sign-test', n, mean,
      triggerReason: clusterTrigger ? `fewer than ${exactTriggerClusters} clusters` : 'degenerate bootstrap',
      exact, boundary, passes: exact.passes,
    };
  }
  const passes = side === 'upper' ? bootstrap.bound < boundary : bootstrap.bound > boundary;
  return { label, method: 'percentile-cluster-bootstrap', n, mean, bound: bootstrap.bound, quantile: bootstrap.quantile, boundary, passes };
}

/**
 * The permutation floor (§9.3): plus-one Monte Carlo p-value for the claim
 * that the observed statistic beats `permStats` in the favorable direction.
 * For regret, favorable is LOWER, so a permutation ties-or-beats when its
 * statistic is <= the observed one.
 */
function permutationP({ observed, permStats, lowerIsBetter = true }) {
  const beats = permStats.filter((s) => (lowerIsBetter ? s <= observed : s >= observed)).length;
  return (1 + beats) / (1 + permStats.length);
}

module.exports = {
  buildResamples,
  bootstrapBound,
  binomialUpperTail,
  exactSignTest,
  decideComponent,
  permutationP,
};
