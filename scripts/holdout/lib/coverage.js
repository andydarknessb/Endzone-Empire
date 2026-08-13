'use strict';

/**
 * Candidate B's per-week metrics (PREREGISTRATION.md §7): coverage-80,
 * coverage-50, WIS and width over one arm's ledger rows for one week.
 *
 * Eligibility (§5, §7): a row participates iff its `active_probability` is
 * not 0 (bye/Out/IR at capture never enters a coverage denominator) and the
 * interval being scored is fully present. Exclusions are counted, never
 * silent. Actuals: pinned, absent -> 0.
 */

function num(v) {
  if (v === null || v === undefined) return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pit-sweep §6.5's interval score. */
function intervalScore({ actual, lower, upper, alpha }) {
  let score = upper - lower;
  if (actual < lower) score += (2 / alpha) * (lower - actual);
  if (actual > upper) score += (2 / alpha) * (actual - upper);
  return score;
}

/**
 * One arm-week's metrics. Returns nulls (never fabricated zeros) when no row
 * is eligible for a metric, and the per-metric exclusion counts §7 requires
 * the report to publish.
 */
function armWeekMetrics({ rows, actuals, season, week }) {
  let cov80Hits = 0; let cov80N = 0;
  let cov50Hits = 0; let cov50N = 0;
  let wisSum = 0; let wisN = 0;
  let widthSum = 0;
  let excludedUnavailable = 0;
  let excludedNullInterval = 0;

  for (const row of rows) {
    if (num(row.activeProbability) === 0) { excludedUnavailable += 1; continue; }
    const actualRaw = actuals.get(`${season}:${week}:${row.playerId}`);
    const actual = actualRaw === undefined ? 0 : Number(actualRaw);
    const p10 = num(row.p10); const p25 = num(row.p25);
    const p75 = num(row.p75); const p90 = num(row.p90);
    const median = num(row.median);

    const has80 = p10 !== null && p90 !== null;
    const has50 = p25 !== null && p75 !== null;
    if (!has80 && !has50) { excludedNullInterval += 1; continue; }

    if (has80) {
      cov80N += 1;
      if (actual >= p10 && actual <= p90) cov80Hits += 1;
      widthSum += p90 - p10;
    }
    if (has50) {
      cov50N += 1;
      if (actual >= p25 && actual <= p75) cov50Hits += 1;
    }
    // WIS needs the median and BOTH intervals (K = 2).
    if (has80 && has50 && median !== null) {
      wisSum += (
        0.5 * Math.abs(actual - median)
        + (0.5 / 2) * intervalScore({ actual, lower: p25, upper: p75, alpha: 0.5 })
        + (0.2 / 2) * intervalScore({ actual, lower: p10, upper: p90, alpha: 0.2 })
      ) / 2.5;
      wisN += 1;
    }
  }

  return {
    cov80: cov80N > 0 ? cov80Hits / cov80N : null,
    cov50: cov50N > 0 ? cov50Hits / cov50N : null,
    wis: wisN > 0 ? wisSum / wisN : null,
    width: cov80N > 0 ? widthSum / cov80N : null,
    counts: { cov80: cov80N, cov50: cov50N, wis: wisN, excludedUnavailable, excludedNullInterval },
  };
}

/**
 * The §9.2 median-shift diagnostic for one candidate arm against control,
 * over one week's rows: sum of signed (candidate - control) medians and the
 * sum of their absolute values, with the row count, so a season-level mean
 * aggregates exactly rather than averaging weekly averages.
 */
function medianShift({ controlRows, candidateRows }) {
  const controlById = new Map(controlRows.map((r) => [r.playerId, r]));
  let signedSum = 0; let absSum = 0; let n = 0;
  for (const row of candidateRows) {
    const control = controlById.get(row.playerId);
    if (!control) continue;
    const a = num(row.median); const b = num(control.median);
    if (a === null || b === null) continue;
    signedSum += a - b;
    absSum += Math.abs(a - b);
    n += 1;
  }
  return { signedSum, absSum, n };
}

module.exports = { intervalScore, armWeekMetrics, medianShift };
