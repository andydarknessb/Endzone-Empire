'use strict';

/**
 * Interval reading (spec #1845): three readings off a Weekly projection's five
 * stored quantiles. Pure: no database, no engine, no Model version (ADR 0044).
 *
 *   - `volatilityTags`: a Volatility tag (`steady` | `boom_or_bust` | null)
 *     against the reference set of the same position in the same run;
 *   - `thresholdProbabilities`: the probability of reaching each fixed
 *     per-position threshold, in the run's own scoring;
 *   - `verdictBand`: `tossup` | `start` | `strong` for a start/sit probability.
 *
 * Floor and Ceiling are the 10th and 90th percentiles of the Interval,
 * presentation names for it and never a separate estimate (CONTEXT.md), so
 * width here is `p90 - p10`.
 *
 * A row is the camelCased shape of one cached `player_week_projections` row
 * (`projectionFromCachedRow`) or one `projection_snapshot_players` row, plus
 * `pointEstimate`: the run's ranking statistic (`pointEstimateFor`), supplied
 * by the caller so this module needs neither the service nor a pool.
 */

/**
 * Every constant of the readings, in one place. The print script
 * (`scripts/print-interval-readings.js`) exists so the owner can confirm or
 * adjust these before any tag ships.
 */
const CONSTANTS = Object.freeze({
  // Positions that get any reading at all.
  positions: Object.freeze(['QB', 'RB', 'WR', 'TE']),
  // Reference set: a player must be projected from his own residuals on at
  // least this many games.
  minSampleSize: 8,
  // Reference set: a player must project at least this many points (Point
  // estimate). Below it a width-vs-point line is fitted to noise.
  minPointEstimate: 5,
  // Fewer eligible players than this at a position in a run: no tags.
  minReferenceSetSize: 10,
  // The tagged fifth: each tag takes floor(eligible / 5) players.
  taggedFractionDenominator: 5,
  // Two distances closer than this are the same distance (float noise from
  // the least-squares fit must not break an exact tie).
  distanceEpsilon: 1e-9,
  // Threshold probabilities: fixed per-position points thresholds.
  thresholds: Object.freeze({
    QB: Object.freeze([15, 25]),
    RB: Object.freeze([10, 20]),
    WR: Object.freeze([10, 20]),
    TE: Object.freeze([10, 20]),
  }),
  // Clamps: a threshold at or below the Floor reads the first, at or above the
  // Ceiling the second. Literals, so the clamp is exact rather than 1 - 0.9.
  floorReading: 0.9,
  ceilingReading: 0.1,
  // Verdict band: at or below this is a tossup; above it, a start.
  tossupCeiling: 0.6,
  // At or above this, a strong start.
  strongFloor: 0.8,
});

const TAG_STEADY = 'steady';
const TAG_BOOM_OR_BUST = 'boom_or_bust';

const QUANTILE_FIELDS = ['p10', 'p25', 'median', 'p75', 'p90'];
const QUANTILE_LEVELS = [0.1, 0.25, 0.5, 0.75, 0.9];

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function quantilesOf(row) {
  const values = QUANTILE_FIELDS.map((field) => row[field]);
  return values.every(isNumber) ? values : null;
}

/**
 * Eligible: QB/RB/WR/TE, Available, projected from his own residuals, at least
 * `minSampleSize` games, not a Position-baseline projection, and a complete
 * Interval with a Point estimate. Anything else reads null on every reading.
 */
function isEligible(row) {
  if (!row || !CONSTANTS.positions.includes(row.position)) return false;
  const factors = row.factors;
  if (!factors || !factors.availability || factors.availability.available !== true) return false;
  const quality = factors.dataQuality;
  if (!quality || quality.residualSource !== 'player') return false;
  if (Array.isArray(quality.reasons) && quality.reasons.includes('position baseline')) return false;
  if (!isNumber(row.sampleSize) || row.sampleSize < CONSTANTS.minSampleSize) return false;
  if (!isNumber(row.pointEstimate)) return false;
  return quantilesOf(row) !== null;
}

const widthOf = (row) => row.p90 - row.p10;

/**
 * Ordinary least squares of `y` on `x`. With no spread in `x` the slope is 0
 * and the line is the mean of `y`.
 */
function fitWidthLine(points) {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - meanX) ** 2;
    sxy += (p.x - meanX) * (p.y - meanY);
  }
  if (sxx === 0) return { slope: 0, intercept: meanY };
  const slope = sxy / sxx;
  return { slope, intercept: meanY - slope * meanX };
}

/** Tags one position's rows; writes into `tags`. */
function tagPosition(rows, tags) {
  const reference = rows.filter((r) => isEligible(r) && r.pointEstimate >= CONSTANTS.minPointEstimate);
  if (reference.length < CONSTANTS.minReferenceSetSize) return;

  const line = fitWidthLine(reference.map((r) => ({ x: r.pointEstimate, y: widthOf(r) })));
  const distances = reference.map((r) => ({
    playerId: r.playerId,
    distance: widthOf(r) - (line.intercept + line.slope * r.pointEstimate),
  }));
  const fifth = Math.floor(reference.length / CONSTANTS.taggedFractionDenominator);
  const eps = CONSTANTS.distanceEpsilon;

  // A player is in the widest fifth only if fewer than `fifth` players are
  // strictly wider AND the whole group tied with him fits inside the fifth.
  // A tie that straddles the cut tags none of its members: the cut would
  // otherwise be decided by row order, which is not a fact about the players.
  for (const d of distances) {
    const wider = distances.filter((o) => o.distance > d.distance + eps).length;
    const narrower = distances.filter((o) => o.distance < d.distance - eps).length;
    const tied = distances.length - wider - narrower; // includes d
    if (wider + tied <= fifth) tags.set(d.playerId, TAG_BOOM_OR_BUST);
    else if (narrower + tied <= fifth) tags.set(d.playerId, TAG_STEADY);
  }
}

/**
 * The Volatility tag for every row of one run: `Map<playerId, tag|null>`.
 * Rows of every position may be passed together; each position is its own
 * reference set. Every input row has an entry.
 */
function volatilityTags(rows) {
  const tags = new Map();
  const byPosition = new Map();
  for (const row of rows) {
    tags.set(row.playerId, null);
    if (!byPosition.has(row.position)) byPosition.set(row.position, []);
    byPosition.get(row.position).push(row);
  }
  for (const positionRows of byPosition.values()) tagPosition(positionRows, tags);
  return tags;
}

/**
 * P(points >= threshold) by linear interpolation of the cdf through
 * (0.10, p10), (0.25, p25), (0.50, median), (0.75, p75), (0.90, p90).
 * At or below the Floor it reads 0.90 and at or above the Ceiling 0.10: the
 * Interval says nothing beyond its ends, so the reading is clamped there.
 * `null` for an ineligible row.
 */
function thresholdProbability(row, threshold) {
  if (!isEligible(row) || !isNumber(threshold)) return null;
  const q = quantilesOf(row);
  const last = q.length - 1;
  if (threshold <= q[0]) return CONSTANTS.floorReading;
  if (threshold >= q[last]) return CONSTANTS.ceilingReading;
  // First segment whose upper end reaches the threshold. A flat stretch is
  // matched at its start, so the denominator below is never zero.
  let i = 0;
  while (threshold > q[i + 1]) i += 1;
  const share = (threshold - q[i]) / (q[i + 1] - q[i]);
  const cdf = QUANTILE_LEVELS[i] + share * (QUANTILE_LEVELS[i + 1] - QUANTILE_LEVELS[i]);
  return 1 - cdf;
}

/** `[{ threshold, probability }]` for the row's position; `null` if ineligible. */
function thresholdProbabilities(row) {
  if (!isEligible(row)) return null;
  return CONSTANTS.thresholds[row.position].map((threshold) => ({
    threshold,
    probability: thresholdProbability(row, threshold),
  }));
}

/** Verdict band for a start/sit probability; a null probability is `start`. */
function verdictBand(probability) {
  if (!isNumber(probability)) return 'start';
  if (probability <= CONSTANTS.tossupCeiling) return 'tossup';
  if (probability >= CONSTANTS.strongFloor) return 'strong';
  return 'start';
}

module.exports = {
  CONSTANTS,
  TAG_STEADY,
  TAG_BOOM_OR_BUST,
  isEligible,
  fitWidthLine,
  volatilityTags,
  thresholdProbability,
  thresholdProbabilities,
  verdictBand,
};
