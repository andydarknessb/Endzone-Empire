'use strict';

/**
 * Metric definitions and the inference machinery, exactly as preregistered
 * (sections 6, 8 and 10).
 *
 * THE ANALYSIS UNIT IS THE SEASON-WEEK. Every metric collapses to ONE number
 * per arm per season-week before any inference happens, and the season-week is
 * also the bootstrap cluster. That is not a convenience: player-weeks within a
 * week share a common shock (weather, a rules point of emphasis, Week 18 rest),
 * so treating them as independent observations would shrink every interval by a
 * factor nobody could defend.
 *
 * Three numbers in here are exact and are asserted rather than approximated:
 * **100,000** bootstrap draws, **10,000** permutations, and the shared-resample
 * rule that every bootstrap-based component reuses the SAME draws. "About a
 * hundred thousand" would make two components' CIs differ for reasons unrelated
 * to the data.
 *
 * Pure: no clock, no `Math.random`, no I/O. Every random quantity comes from a
 * preregistered seed through a local PRNG.
 */

const crypto = require('crypto');

const { isFiniteNumber, roundToTie } = require('./numbers');

// ---------------------------------------------------------------------------
// Preregistered constants (sections 8.3, 10.1, 10.5, 7.3)
// ---------------------------------------------------------------------------

/** Exactly this many. Not "at least", not "about" (prereg 10.1). */
const BOOTSTRAP_DRAWS = 100000;
const BOOTSTRAP_SEED = 1499811874;
/** Exactly this many seeded within-week-position permutations (prereg 7.3). */
const PERMUTATION_DRAWS = 10000;
const PERMUTATION_SEED = 940227589;
const MOVING_BLOCK_SEED = 588165040;
const MOVING_BLOCK_LENGTHS = Object.freeze([2, 3]);

/** Family one-sided alpha, and the fixed divisor of 7 (prereg 9.1). */
const FAMILY_ALPHA = 0.05;
const IUT_COMPONENTS = 7;
const COMPONENT_ALPHA = FAMILY_ALPHA / IUT_COMPONENTS;

/** The six evaluated positions, in the fixed macro-average order (prereg 3.3). */
const MACRO_POSITIONS = Object.freeze(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

/** The evaluated window: weeks 2-18 in both seasons (prereg 4.1). */
const EVALUATED_WEEKS = Object.freeze(
  Array.from({ length: 17 }, (unused, i) => i + 2)
);
/** More than 2 of the 17 dropping makes a component UNEVALUABLE (prereg 10.4). */
const MIN_SURVIVING_CLUSTERS = 15;

/** The 24 fixed candidate salts (prereg 8.1), in order. */
const SALTS = Object.freeze([
  'pit-01-879c6f8eae4b', 'pit-02-d5b1cf54d30c', 'pit-03-388e3522c0f7', 'pit-04-573e0d6504b9',
  'pit-05-fb867967639b', 'pit-06-b35a0c9b6418', 'pit-07-2e3ef103a04c', 'pit-08-2d5314ec308d',
  'pit-09-c1c56868a8a0', 'pit-10-b4de025c6e5e', 'pit-11-ae05d62de7d1', 'pit-12-a3c719ea03a9',
  'pit-13-f97ea63fe811', 'pit-14-feb2052528e4', 'pit-15-def75b2f44ea', 'pit-16-49f1dc9385d9',
  'pit-17-2f9533be661a', 'pit-18-4ea7c8257a8d', 'pit-19-39c034f0405e', 'pit-20-beaf8091175b',
  'pit-21-dc9b241925ce', 'pit-22-bc589c1a3cd8', 'pit-23-6402a70ab1ad', 'pit-24-6e1cc0e9aef6',
]);

/**
 * The two disjoint 12-salt halves for the split-salt SD (prereg 8.2).
 *
 * Mind the inversion: half A is the ODD-NUMBERED salts (`pit-01`, `pit-03`, ...)
 * and those live at EVEN ARRAY INDICES, because `pit-01` is at index 0. So
 * `i % 2 === 0` selects half A correctly, and reading it as "the even salts"
 * would have it exactly backwards.
 */
const SALT_HALF_A = Object.freeze(SALTS.filter((unused, i) => i % 2 === 0));
const SALT_HALF_B = Object.freeze(SALTS.filter((unused, i) => i % 2 === 1));

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** Pure: mulberry32. Local, seeded, and never the global RNG. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Per-week metrics (prereg 6.1 - 6.5)
// ---------------------------------------------------------------------------

/**
 * Pure: one season-week's REGRET score - the arithmetic mean over the 50
 * rosters (prereg 6.1). Lower is better.
 */
function weekRegret(rosterRegrets, { label = 'regret' } = {}) {
  if (!Array.isArray(rosterRegrets) || rosterRegrets.length === 0) {
    throw new Error(`${label}: a week with no roster-weeks has no regret score, and 0 would be a lie`);
  }
  let total = 0;
  for (const value of rosterRegrets) {
    if (!isFiniteNumber(value)) throw new Error(`${label}: roster regret ${JSON.stringify(value)} is not a number`);
    total += Number(value);
  }
  return total / rosterRegrets.length;
}

/**
 * Pure: PAIRWISE accuracy within one `(season, week, position)` cell
 * (prereg 6.2).
 *
 * A pair is ELIGIBLE only if both players have a non-null projection AND their
 * actual points DIFFER. A pair scores 1 for the right order, 0 for reversed,
 * and 0.5 when the two projections are exactly equal. Ties are decided at the
 * preregistered ten decimal places, so a floating-point artifact is not a tie.
 */
function cellPairwise(rows, { label = 'pairwise' } = {}) {
  const usable = rows.filter((r) => isFiniteNumber(r.projected));
  let score = 0;
  let eligible = 0;
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i];
      const b = usable[j];
      if (!isFiniteNumber(a.actual) || !isFiniteNumber(b.actual)) continue;
      // Equal ACTUALS remove the pair from the denominator entirely: there is
      // no right answer to get right.
      if (roundToTie(a.actual) === roundToTie(b.actual)) continue;
      eligible++;
      const pa = roundToTie(a.projected);
      const pb = roundToTie(b.projected);
      if (pa === pb) { score += 0.5; continue; }
      const projectedOrder = pa > pb;
      const actualOrder = roundToTie(a.actual) > roundToTie(b.actual);
      if (projectedOrder === actualOrder) score += 1;
    }
  }
  return { score: eligible === 0 ? null : score / eligible, eligible, label };
}

/**
 * Pure: one season-week's PAIRWISE score - the macro-average over the six
 * positions, equally weighted, in the fixed order (prereg 6.2).
 *
 * A position with zero eligible pairs is DROPPED and the drop is reported. If
 * more than one position drops, the WHOLE WEEK drops - and that counts against
 * the missing-cell budget, so it is returned rather than silently absorbed.
 */
function weekPairwise(rowsByPosition, { label = 'pairwise' } = {}) {
  const perPosition = {};
  const dropped = [];
  const scores = [];
  for (const position of MACRO_POSITIONS) {
    const cell = cellPairwise(rowsByPosition[position] || [], { label: `${label}:${position}` });
    perPosition[position] = cell;
    if (cell.score === null) dropped.push(position);
    else scores.push(cell.score);
  }
  const weekDropped = dropped.length > 1;
  return {
    // Equally weighted across the SURVIVING positions - a macro-average, so a
    // position with thousands of pairs cannot drown one with dozens.
    score: weekDropped || scores.length === 0
      ? null
      : scores.reduce((a, b) => a + b, 0) / scores.length,
    perPosition,
    droppedPositions: dropped,
    weekDropped,
  };
}

/**
 * Pure: MAE, RMSE and Spearman rho for one week (prereg 6.3), plus the null
 * exclusion count.
 *
 * Rows with a null projection are excluded AND COUNTED. RMSE is computed
 * per-week and never pooled across weeks: the week values are the analysis
 * units.
 */
function weekPointMetrics(rows, { label = 'points' } = {}) {
  const usable = rows.filter((r) => isFiniteNumber(r.projected) && isFiniteNumber(r.actual));
  const excludedNullProjection = rows.length - usable.length;
  if (usable.length === 0) {
    return { mae: null, rmse: null, spearman: null, n: 0, excludedNullProjection, label };
  }
  let absSum = 0;
  let sqSum = 0;
  for (const row of usable) {
    const e = Number(row.projected) - Number(row.actual);
    absSum += Math.abs(e);
    sqSum += e * e;
  }
  return {
    mae: absSum / usable.length,
    rmse: Math.sqrt(sqSum / usable.length),
    spearman: spearman(usable.map((r) => Number(r.projected)), usable.map((r) => Number(r.actual))),
    n: usable.length,
    excludedNullProjection,
    label,
  };
}

/** Pure: midranks, so ties are handled the way Spearman requires (prereg 6.3). */
function midranks(values) {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].i] = rank;
    i = j + 1;
  }
  return ranks;
}

/** Pure: Spearman rank correlation with midranks. Null when it is undefined. */
function spearman(xs, ys) {
  if (xs.length < 2) return null;
  const rx = midranks(xs);
  const ry = midranks(ys);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  // Zero variance on either side (every value tied) leaves rho undefined.
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/**
 * Pure: prediction-interval COVERAGE for one week (prereg 6.4).
 *
 * The fraction of the week's cohort whose ACTUAL falls in the inclusive
 * `[p10, p90]` band. **Rows with a null interval are excluded and counted** -
 * that exclusion is stated explicitly in 6.4, and it is what lets the
 * interval-free benchmarks be scored on the metrics they can support.
 */
function weekCoverage(rows, { label = 'coverage' } = {}) {
  let covered = 0;
  let scored = 0;
  let excludedNullInterval = 0;
  for (const row of rows) {
    if (!isFiniteNumber(row.p10) || !isFiniteNumber(row.p90) || !isFiniteNumber(row.actual)) {
      excludedNullInterval++;
      continue;
    }
    scored++;
    const actual = Number(row.actual);
    if (actual >= Number(row.p10) && actual <= Number(row.p90)) covered++;
  }
  return {
    coverage: scored === 0 ? null : covered / scored,
    scored,
    excludedNullInterval,
    label,
  };
}

/**
 * Pure: the Weighted Interval Score for one week (prereg 6.5).
 *
 * ```
 * IS_a(y; l, u) = (u - l) + (2/a)(l - y)1{y<l} + (2/a)(y - u)1{y>u}
 * WIS(y) = ( 0.5|y - m| + SUM_k (a_k/2) IS_{a_k}(y) ) / (K + 0.5),  K = 2
 * ```
 * with the 50% (`p25`,`p75`, a=0.5) and 80% (`p10`,`p90`, a=0.2) intervals.
 *
 * **NULL-INTERVAL ROWS ARE SKIPPED AND COUNTED, and that rule is implemented
 * HERE rather than quoted.** Section 6.5 does NOT state it - it states only the
 * formula - so it is applied BY ANALOGY with 6.4, which excludes-and-counts
 * null intervals from coverage, and 6.6, whose global convention excludes a
 * null projection from every point metric and counts it. Both of those are
 * explicit; the WIS gap is not, and leaving it implicit would have meant either
 * scoring the benchmarks on fabricated bands or dropping them from WIS with no
 * count. The count is returned so the report can state it per arm per week.
 */
function weekWis(rows, { label = 'wis' } = {}) {
  const K = 2;
  const intervals = [{ alpha: 0.5, lower: 'p25', upper: 'p75' }, { alpha: 0.2, lower: 'p10', upper: 'p90' }];
  let total = 0;
  let scored = 0;
  let excludedNullInterval = 0;

  for (const row of rows) {
    const complete = isFiniteNumber(row.actual) && isFiniteNumber(row.median)
      && intervals.every((i) => isFiniteNumber(row[i.lower]) && isFiniteNumber(row[i.upper]));
    if (!complete) { excludedNullInterval++; continue; }
    const y = Number(row.actual);
    let sum = 0.5 * Math.abs(y - Number(row.median));
    for (const { alpha, lower, upper } of intervals) {
      const l = Number(row[lower]);
      const u = Number(row[upper]);
      let is = u - l;
      if (y < l) is += (2 / alpha) * (l - y);
      if (y > u) is += (2 / alpha) * (y - u);
      sum += (alpha / 2) * is;
    }
    total += sum / (K + 0.5);
    scored++;
  }
  return { wis: scored === 0 ? null : total / scored, scored, excludedNullInterval, label };
}

// ---------------------------------------------------------------------------
// Contrasts (prereg 6.7)
// ---------------------------------------------------------------------------

/**
 * Pure: one season-week's contrast value - the arithmetic mean of the 24
 * SAME-SALT deltas (prereg 6.7).
 *
 * Same-salt pairing is the whole design: candidate and comparator are run under
 * identical seeds, so the simulation noise cancels within a pair instead of
 * being averaged over independently.
 *
 * Sign conventions, used everywhere downstream: a REGRET delta is favourable
 * when NEGATIVE; a PAIRWISE delta is favourable when POSITIVE.
 */
function saltPairedDelta({ candidateBySalt, comparatorBySalt, salts = SALTS, label = 'contrast' }) {
  const deltas = [];
  for (const salt of salts) {
    const a = candidateBySalt[salt];
    const b = comparatorBySalt[salt];
    if (!isFiniteNumber(a) || !isFiniteNumber(b)) {
      throw new Error(
        `${label}: salt ${salt} is missing from the candidate or the comparator. Every formal ` +
        'contrast is a mean of the 24 SAME-SALT deltas, so a missing salt breaks the pairing ' +
        'rather than shrinking the average.'
      );
    }
    deltas.push(Number(a) - Number(b));
  }
  return deltas.reduce((s, d) => s + d, 0) / deltas.length;
}

// ---------------------------------------------------------------------------
// The cluster bootstrap (prereg 10.1)
// ---------------------------------------------------------------------------

/**
 * Build the SHARED resample index once.
 *
 * Every bootstrap-based component of every claim reuses these exact draws:
 * the same 100,000 week-index resamples for every arm, comparator, endpoint and
 * component. Deltas are computed WITHIN a draw, never across draws. Two
 * components drawing independently would differ for reasons that have nothing
 * to do with the data, and their CIs would not be comparable.
 *
 * **The sharing rests on DETERMINISM, not on object identity.** Callers are not
 * required to pass one shared object around; what makes two components' draws
 * identical is that the same `(seed, clusterCount)` always produces the same
 * index, because the PRNG is a pure function of the seed and is consumed in a
 * fixed order. Anyone "optimizing" the seed derivation - salting it per
 * component, deriving it from anything positional, reordering the fill loop -
 * would silently break the guarantee while every test that passes one object
 * around kept passing. Change this function's derivation only with that in
 * mind.
 *
 * Resampling is over the SURVIVING clusters and `n` is the surviving count:
 * week dropping happens FIRST and symmetrically across candidate and every
 * comparator (prereg 10.1).
 */
function buildBootstrapResamples({
  clusterCount, draws = BOOTSTRAP_DRAWS, seed = BOOTSTRAP_SEED, label = 'bootstrap',
}) {
  if (!Number.isInteger(clusterCount) || clusterCount <= 0) {
    throw new Error(`${label}: cluster count must be a positive integer, got ${clusterCount}`);
  }
  if (draws !== BOOTSTRAP_DRAWS) {
    throw new Error(
      `${label}: the preregistration fixes the bootstrap at EXACTLY ${BOOTSTRAP_DRAWS} draws, not ` +
      `${draws}. "At least" and "about" are both excluded, because the draw count is part of what ` +
      'makes two components\' intervals comparable.'
    );
  }
  const rng = makeRng(seed);
  // A flat typed array: 100,000 x n indices is large enough that an array of
  // arrays would cost real memory for no benefit.
  const index = new Uint16Array(draws * clusterCount);
  for (let d = 0; d < draws; d++) {
    for (let c = 0; c < clusterCount; c++) {
      index[d * clusterCount + c] = Math.floor(rng() * clusterCount);
    }
  }
  return { index, draws, clusterCount, seed };
}

/**
 * Pure: the one-sided percentile bound from a set of bootstrap statistics.
 *
 * The order statistic at `ceil(q * draws)` clamped to `[1, draws]` - a fixed
 * rule with NO interpolation (prereg 10.1), so the bound is reproducible to the
 * last digit on any machine.
 */
function percentileBound(sorted, q, { label = 'bound' } = {}) {
  if (sorted.length === 0) throw new Error(`${label}: no bootstrap statistics`);
  const rank = Math.min(Math.max(Math.ceil(q * sorted.length), 1), sorted.length);
  return sorted[rank - 1];
}

/**
 * Bootstrap a per-week statistic and return both one-sided bounds at the
 * component level.
 *
 * `weekValues` is one number per surviving cluster, already collapsed. The
 * statistic is the MEAN over the drawn multiset, which is what "per-week mean
 * delta" means in every component of section 9.
 */
function bootstrapMean({ weekValues, resamples, alpha = COMPONENT_ALPHA, label = 'bootstrap' }) {
  const n = weekValues.length;
  if (n !== resamples.clusterCount) {
    throw new Error(
      `${label}: ${n} surviving clusters but the shared resamples were built for ` +
      `${resamples.clusterCount}. The resample index must be built AFTER week dropping, and shared.`
    );
  }
  for (const v of weekValues) {
    if (!isFiniteNumber(v)) throw new Error(`${label}: week value ${JSON.stringify(v)} is not a number`);
  }
  const stats = new Float64Array(resamples.draws);
  for (let d = 0; d < resamples.draws; d++) {
    let sum = 0;
    const base = d * n;
    for (let c = 0; c < n; c++) sum += weekValues[resamples.index[base + c]];
    stats[d] = sum / n;
  }
  const sorted = Float64Array.prototype.slice.call(stats).sort();
  const point = weekValues.reduce((s, v) => s + v, 0) / n;
  return {
    point,
    lower: percentileBound(sorted, alpha, { label }),
    upper: percentileBound(sorted, 1 - alpha, { label }),
    draws: resamples.draws,
    clusters: n,
    // How many DISTINCT values the resampled statistic took, counted AFTER
    // ten-decimal (roundToTie) normalization (PHASE5_EXECUTION_SPEC.md
    // section 4.4 item 1) - a genuinely discrete metric (e.g. pairwise
    // accuracy over few eligible pairs) can otherwise register as
    // non-degenerate purely from floating-point representation noise, since
    // two resampled means that are the "same" value can differ in their last
    // bit depending on summation order. Fewer than 100 means the bootstrap
    // distribution is degenerate and the exact-inference trigger fires
    // (prereg 10.2).
    distinctValues: new Set(Array.from(sorted, (v) => roundToTie(v))).size,
  };
}

/**
 * The exact-inference trigger (prereg 10.2): fewer than 12 clusters, OR fewer
 * than 100 distinct resampled statistics. Returns which condition fired, since
 * the report has to name it.
 */
function exactInferenceTrigger({ clusters, distinctValues }) {
  const reasons = [];
  if (clusters < 12) reasons.push(`fewer than 12 clusters (${clusters})`);
  if (distinctValues < 100) reasons.push(`a degenerate bootstrap distribution (${distinctValues} distinct values)`);
  return { fired: reasons.length > 0, reasons };
}

/**
 * The moving-block bootstrap SENSITIVITY (prereg 10.5), block lengths 2 and 3.
 *
 * Reported alongside the primary CIs and gates NOTHING. It exists because the
 * primary bootstrap assumes weeks are exchangeable, and a season has obvious
 * serial structure; if the two disagree, that is worth seeing.
 */
function movingBlockBootstrap({
  weekValues, blockLength, draws = BOOTSTRAP_DRAWS, seed = MOVING_BLOCK_SEED,
  alpha = COMPONENT_ALPHA, label = 'moving block',
}) {
  if (!MOVING_BLOCK_LENGTHS.includes(blockLength)) {
    throw new Error(`${label}: block length must be one of ${MOVING_BLOCK_LENGTHS.join(', ')}`);
  }
  // The SAME draw count as the primary bootstrap (prereg 10.5). The discipline
  // is uniform on purpose: a sensitivity run at a different resolution than the
  // thing it is a sensitivity TO would differ for a reason that has nothing to
  // do with the serial structure it exists to probe.
  if (draws !== BOOTSTRAP_DRAWS) {
    throw new Error(
      `${label}: the preregistration fixes the moving-block sensitivity at the SAME ` +
      `${BOOTSTRAP_DRAWS} draws as the primary bootstrap, not ${draws}`
    );
  }
  const n = weekValues.length;
  if (n < blockLength) throw new Error(`${label}: ${n} clusters cannot form a block of ${blockLength}`);
  const rng = makeRng(seed);
  const blocks = Math.ceil(n / blockLength);
  const stats = new Float64Array(draws);
  for (let d = 0; d < draws; d++) {
    let sum = 0;
    let taken = 0;
    for (let b = 0; b < blocks && taken < n; b++) {
      const start = Math.floor(rng() * (n - blockLength + 1));
      for (let k = 0; k < blockLength && taken < n; k++) {
        sum += weekValues[start + k];
        taken++;
      }
    }
    stats[d] = sum / n;
  }
  const sorted = Float64Array.prototype.slice.call(stats).sort();
  return {
    blockLength,
    point: weekValues.reduce((s, v) => s + v, 0) / n,
    lower: percentileBound(sorted, alpha, { label }),
    upper: percentileBound(sorted, 1 - alpha, { label }),
    draws,
    gates: false,
  };
}

// ---------------------------------------------------------------------------
// Week dropping (prereg 10.4)
// ---------------------------------------------------------------------------

/**
 * Drop weeks with no rows for an arm - SYMMETRICALLY across the candidate and
 * every comparator - and refuse the component if too many go.
 *
 * A dropped week is never drawn, never counted in a denominator, and never
 * imputed. More than 2 of the 17 dropping makes the component UNEVALUABLE, and
 * an unevaluable component FAILS the claim (prereg 9.1) rather than being
 * skipped.
 */
function dropWeeks({ series, evaluatedWeeks = EVALUATED_WEEKS, label = 'week dropping' }) {
  const names = Object.keys(series);
  if (names.length === 0) throw new Error(`${label}: no series to align`);
  const surviving = [];
  const dropped = [];
  for (const week of evaluatedWeeks) {
    const present = names.every((name) => isFiniteNumber(series[name][week]));
    if (present) surviving.push(week);
    else dropped.push(week);
  }
  const evaluable = surviving.length >= MIN_SURVIVING_CLUSTERS;
  return {
    surviving,
    dropped,
    evaluable,
    reason: evaluable ? null
      : `${dropped.length} of ${evaluatedWeeks.length} weeks dropped, leaving ${surviving.length} `
        + `clusters; the component requires at least ${MIN_SURVIVING_CLUSTERS}`,
    aligned: Object.fromEntries(names.map((name) => [name, surviving.map((w) => series[name][w])])),
  };
}

// ---------------------------------------------------------------------------
// The permutation control (prereg 7.3)
// ---------------------------------------------------------------------------

/**
 * Build the 10,000 within-week-position permutations ONCE.
 *
 * Each replicate is ONE permutation, and that same permutation is reused across
 * all 24 salts and BOTH co-primary endpoints. Drawing fresh permutations per
 * salt would average away exactly the assignment noise the control exists to
 * measure.
 *
 * The permutation shuffles the PROJECTION-TO-PLAYER assignment inside a
 * `(week, position)` cell, so it destroys any real skill while preserving the
 * marginal distribution of projections and of actuals.
 */
function buildPermutations({
  cells, draws = PERMUTATION_DRAWS, seed = PERMUTATION_SEED, label = 'permutation control',
}) {
  if (draws !== PERMUTATION_DRAWS) {
    throw new Error(
      `${label}: the preregistration fixes exactly ${PERMUTATION_DRAWS} permutations, not ${draws}`
    );
  }
  if (seed !== PERMUTATION_SEED) {
    throw new Error(`${label}: the permutation seed is fixed at ${PERMUTATION_SEED}, not ${seed}`);
  }
  if (!cells || typeof cells !== 'object' || Array.isArray(cells)) {
    throw new Error(`${label}: cells must map canonical season:week:position keys to playerId arrays`);
  }
  const members = new Map();
  for (const [cellKey, playerIds] of Object.entries(cells)) {
    if (!/^\d+:\d+:(QB|RB|WR|TE|K|DEF)$/.test(cellKey)) {
      throw new Error(`${label}: cell key ${JSON.stringify(cellKey)} must be season:week:position`);
    }
    if (!Array.isArray(playerIds)) throw new Error(`${label}: ${cellKey} playerIds must be an array`);
    const canonical = playerIds.map((playerId) => {
      const id = Number(playerId);
      if (!Number.isFinite(id)) throw new Error(`${label}: ${cellKey} has a non-numeric playerId`);
      return id;
    }).sort((a, b) => a - b);
    if (new Set(canonical).size !== canonical.length) {
      throw new Error(`${label}: ${cellKey} has duplicate playerId values; the cohort is malformed`);
    }
    members.set(cellKey, canonical);
  }

  /**
   * Permutations are REGENERATED ON DEMAND rather than materialized.
   *
   * Materializing them would mean `draws x cells x cellSize` integers held at
   * once: with 34 season-weeks x 6 positions and a realistic cohort that is
   * tens of millions of numbers, hundreds of megabytes, for data that is read
   * once per use and is a pure function of its coordinates anyway.
   *
   * The preregistered requirement is that each replicate is ONE permutation
   * REUSED across all 24 salts and both co-primary endpoints. A regenerable
   * stream satisfies that MORE robustly than an array does: the permutation is
   * a pure function of `(seed, replicate, cellKey)`, so every caller that asks
   * for the same replicate and cell gets the same permutation by construction,
   * with no shared object to pass around and drop.
   *
   * The per-cell seed is derived by hash rather than by consuming one long RNG
   * stream, precisely so that asking for replicate 9,999 does not require
   * having asked for the 9,998 before it.
   *
   * The seed is 32 bits (readUInt32BE into mulberry32's state), so for a cell
   * of size >= 13 at most 2^32 of the n! permutations are reachable. That is
   * immaterial here: 10,000 draws from a ~4-billion-wide seed space collide
   * with probability ~2e-5, the permutation statistic is an aggregate over
   * cells rather than a property of any single permutation, and the SHA-256
   * derivation avoids the adjacent-seed correlation that would be the real
   * hazard if seeds were consecutive integers.
   */
  const seedFor = (replicate, cellKey) => crypto.createHash('sha256')
    .update(`${seed}|${replicate}|${cellKey}`, 'utf8')
    .digest()
    .readUInt32BE(0);

  const permutationFor = (replicate, cellKey) => {
    if (!Number.isInteger(replicate) || replicate < 0 || replicate >= draws) {
      throw new Error(`${label}: replicate ${replicate} is outside 0..${draws - 1}`);
    }
    if (!members.has(cellKey)) throw new Error(`${label}: unknown cell ${JSON.stringify(cellKey)}`);
    const size = members.get(cellKey).length;
    const rng = makeRng(seedFor(replicate, cellKey));
    const order = Array.from({ length: size }, (unused, i) => i);
    for (let i = size - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  };

  return {
    draws,
    seed,
    cellKeys: [...members.keys()],
    seedFor,
    canonicalPlayerIds(cellKey) {
      if (!members.has(cellKey)) throw new Error(`${label}: unknown cell ${JSON.stringify(cellKey)}`);
      return [...members.get(cellKey)];
    },
    permutationFor,
    /** One replicate across every cell, for a caller that wants them together. */
    replicate(index) {
      return Object.fromEntries([...members.keys()].map((k) => [k, permutationFor(index, k)]));
    },
  };
}

/** GATHER assignment: target player i receives the projection at source order[i]. */
function gatherPermutedProjections({ playerIds, projections, order, label = 'permutation' }) {
  if (!Array.isArray(playerIds) || !Array.isArray(projections) || !Array.isArray(order)
    || playerIds.length !== projections.length || projections.length !== order.length) {
    throw new Error(`${label}: playerIds, projections, and order must have the same array length`);
  }
  return playerIds.map((playerId, i) => ({ playerId, projected: projections[order[i]] }));
}

/**
 * The plus-one Monte Carlo p-value (prereg 7.3):
 * `p = (1 + #{b : T_b >= T_obs}) / (1 + B)`.
 *
 * The plus-one is not a rounding nicety - it is what keeps the p-value valid:
 * without it a statistic more extreme than all B draws would report p = 0,
 * claiming more evidence than B draws can supply.
 */
function permutationPValue({ observed, permuted, label = 'permutation p' }) {
  if (!Array.isArray(permuted) || permuted.length === 0) {
    throw new Error(`${label}: no permuted statistics`);
  }
  if (!isFiniteNumber(observed)) throw new Error(`${label}: the observed statistic is not a number`);
  let atLeastAsExtreme = 0;
  for (const value of permuted) if (Number(value) >= Number(observed)) atLeastAsExtreme++;
  return {
    p: (1 + atLeastAsExtreme) / (1 + permuted.length),
    atLeastAsExtreme,
    draws: permuted.length,
  };
}

/**
 * The control's pipeline assertion (prereg 7.3): the shipped control must beat
 * the permutation null at `p <= 0.001` on BOTH co-primary endpoints, or the run
 * is declared broken and VOID.
 *
 * This is a PIPELINE ASSERTION, not a scientific finding: if the real control
 * cannot beat a shuffle, the harness cannot distinguish signal from noise and
 * nothing downstream means anything.
 */
const PERMUTATION_P_THRESHOLD = 0.001;

function assertPermutationControl({ regretP, pairwiseP, label = 'perm-control' }) {
  const failures = [];
  for (const [endpoint, p] of [['regret', regretP], ['pairwise', pairwiseP]]) {
    if (!isFiniteNumber(p) || Number(p) < 0 || Number(p) > 1) throw new Error(`${label}: the ${endpoint} p-value must be within [0, 1]`);
    if (Number(p) > PERMUTATION_P_THRESHOLD) failures.push(`${endpoint} p = ${p}`);
  }
  if (failures.length > 0) {
    return {
      void: true,
      reason: 'permutation-control-failed',
      detail:
        `the shipped control did not beat the permutation null at p <= ${PERMUTATION_P_THRESHOLD} `
        + `on ${failures.join(' and ')}. The harness cannot distinguish signal from noise, so the `
        + 'run is VOID - this is a pipeline assertion, not a finding about the model.',
      failures,
    };
  }
  return { void: false, reason: null, detail: 'the control beats the permutation null on both endpoints', failures: [] };
}

/**
 * The allowed keys are RAW INPUTS and INJECTED MACHINERY only. No key here
 * carries a statistic: section 5's whole point is that the control's numbers are
 * derived from raw observations rather than supplied, and this list is what
 * enforces it. Adding a key that names a result would defeat the check.
 */
const PERMUTATION_CONTROL_INPUT_KEYS = Object.freeze([
  'observations', 'rosterRows', 'label',
  // Section 5 defines T_regret as mean DEPLOYED-POLICY regret over the week's
  // rosters, so the control needs the same roster/cohort artifacts and the same
  // lineup machinery the control cell evaluator uses. Without them it can only
  // compute a per-player error, which is invariant to the permutation.
  'rosterWeeks', 'cohortWeeks', 'positionRank', 'nameRankById', 'rosterSlots',
  'availabilityFor', 'optimize', 'ordering',
]);

function computePermutationControl(input) {
  const { observations, rosterRows, label = 'perm-control' } = input || {};
  const extra = Object.keys(input || {}).filter((key) => !PERMUTATION_CONTROL_INPUT_KEYS.includes(key));
  if (extra.length > 0) {
    throw new Error(`${label}: caller-supplied permutation statistics are prohibited (${extra.join(', ')})`);
  }
  if (!Array.isArray(observations) || !Array.isArray(rosterRows)) {
    throw new Error(`${label}: requires canonical raw control observations; caller-supplied statistics are prohibited`);
  }
  if (typeof input.optimize !== 'function' || typeof input.availabilityFor !== 'function') {
    throw new Error(`${label}: the production optimizer and availability rule must be injected; section 5's statistic is a lineup outcome, not a projection error`);
  }
  // Deliberately lazy: the raw reducer depends on the metric primitives above,
  // while this remains the sole public control entry point.
  return require('./permutationControl').computePermutationControlFromObservations({ ...input, label });
}

// ---------------------------------------------------------------------------
// Split-salt SD (prereg 8.2) - DESCRIPTIVE ONLY
// ---------------------------------------------------------------------------

/**
 * The split-salt SD across the two disjoint 12-salt halves.
 *
 * **Descriptive only. No formal gate uses it**, and this function returns
 * `gates: false` so a caller cannot mistake it for one. It answers "how much
 * does this number move if you change only the seeds", which is worth
 * publishing and is not evidence for or against any claim.
 */
function splitSaltSd({ bySalt, halfA = SALT_HALF_A, halfB = SALT_HALF_B, label = 'split-salt SD' }) {
  const mean = (salts) => {
    const values = salts.map((s) => bySalt[s]);
    for (const v of values) {
      if (!isFiniteNumber(v)) throw new Error(`${label}: a salt in the half is missing a value`);
    }
    return values.reduce((s, v) => s + Number(v), 0) / values.length;
  };
  if (halfA.length !== 12 || halfB.length !== 12) {
    throw new Error(`${label}: the halves must be 12 and 12, got ${halfA.length} and ${halfB.length}`);
  }
  if (halfA.some((s) => halfB.includes(s))) {
    throw new Error(`${label}: the two halves must be DISJOINT`);
  }
  const a = mean(halfA);
  const b = mean(halfB);
  return {
    halfA: a,
    halfB: b,
    difference: a - b,
    // The SD of the two half-means, which is what "split-salt SD" names.
    sd: Math.abs(a - b) / 2,
    gates: false,
    note: 'descriptive only; no formal gate uses the split-salt SD (preregistration 8.2)',
  };
}

module.exports = {
  BOOTSTRAP_DRAWS,
  BOOTSTRAP_SEED,
  PERMUTATION_DRAWS,
  PERMUTATION_SEED,
  PERMUTATION_P_THRESHOLD,
  MOVING_BLOCK_SEED,
  MOVING_BLOCK_LENGTHS,
  FAMILY_ALPHA,
  IUT_COMPONENTS,
  COMPONENT_ALPHA,
  MACRO_POSITIONS,
  EVALUATED_WEEKS,
  MIN_SURVIVING_CLUSTERS,
  SALTS,
  SALT_HALF_A,
  SALT_HALF_B,
  makeRng,
  weekRegret,
  cellPairwise,
  weekPairwise,
  weekPointMetrics,
  midranks,
  spearman,
  weekCoverage,
  weekWis,
  saltPairedDelta,
  buildBootstrapResamples,
  percentileBound,
  bootstrapMean,
  exactInferenceTrigger,
  movingBlockBootstrap,
  dropWeeks,
  buildPermutations,
  gatherPermutedProjections,
  permutationPValue,
  assertPermutationControl,
  computePermutationControl,
  splitSaltSd,
};
