'use strict';

/**
 * The two benchmarks, `naive-recency` and `usage-signal` (preregistration 7.2).
 *
 * Neither is ever selectable. They exist to answer a question the arm-versus-arm
 * contrasts cannot: is the engine beating a trivial estimator at all? A sweep
 * in which every cell narrowly beats the shipped control but none of them beats
 * "his recent average" has not found a better model, and component (d) of the
 * IUT is what makes that a failure rather than a footnote.
 *
 * Both are PURE ESTIMATORS - no simulation, no residual pool, and therefore
 * **no intervals**. They emit `null` for every quantile, which is deliberate:
 * preregistration 6.4 says a null interval is excluded from COVERAGE and
 * counted, and 6.6's global null convention says the same for the point
 * metrics. **6.5 (WIS) does NOT state a skip-and-count rule**, so the analogous
 * behaviour there is not something this module can rely on - Phase 3b's metrics
 * must implement the WIS exclusion EXPLICITLY, by analogy with 6.4 and 6.6,
 * and count it. Recorded here rather than assumed, because a benchmark handed
 * fabricated bands would be flattered by exactly the metric that punishes wide
 * ones.
 *
 * They run under the deployed-policy wrapper (Phase 3b) so the comparison is on
 * the same DECISION rather than on the raw numbers, which is why the output
 * shape below matches what the wrapper consumes from the real engine.
 *
 * Pure: no database, no clock, no randomness. Scoring is done by the caller -
 * these take already-scored prior games, because re-scoring is the pinned
 * profile's job and not a benchmark's.
 */

const { RECENCY_HALF_LIFE_WEEKS, HISTORY_SEASONS, weeksAgo } = require('./rosters');
const { isFiniteNumber } = require('./numbers');

/** The benchmark names, as they appear in the report. Never selectable. */
const BENCHMARKS = Object.freeze({ NAIVE_RECENCY: 'naive-recency', USAGE_SIGNAL: 'usage-signal' });

/**
 * The usage keys that make a game "usage-bearing".
 *
 * Mirrors `projectionFeatures.usageFromStats` (:153): the three opportunity
 * counts the model's usage component reads. A game is usage-bearing when at
 * least one of them is a real number - a genuine stored `0` counts, because he
 * dressed and touched the ball zero times, and that IS a measurement. An absent
 * key is not.
 */
const USAGE_KEYS = Object.freeze(['passAttempts', 'carries', 'targets']);

/** Pure: does this prior game carry an opportunity count at all? */
function isUsageBearing(game) {
  const usage = game && game.usage;
  if (!usage || typeof usage !== 'object') return false;
  return USAGE_KEYS.some((key) => isFiniteNumber(usage[key]));
}

/**
 * Pure: the recency-weighted mean of a set of already-scored prior games.
 *
 * Weight `0.5^(weeksAgo/8)`, two-season window, strictly before the target
 * week, at least one prior game. Returns `null` when the gate is not met -
 * "at least one prior game" is a REQUIREMENT, not a preference, and a
 * benchmark that answered 0 for a player with no history would be scored as
 * confidently wrong rather than absent.
 */
function recencyWeightedMean({
  priorGames,
  season,
  week,
  halfLifeWeeks = RECENCY_HALF_LIFE_WEEKS,
  historySeasons = HISTORY_SEASONS,
  seasonWeekSpan = 18,
  filter = null,
}) {
  const firstSeason = Number(season) - historySeasons;
  let weighted = 0;
  let weight = 0;
  let games = 0;
  for (const game of priorGames || []) {
    const gameSeason = Number(game.season);
    const gameWeek = Number(game.week);
    // The two-season window, and the input cutoff. Both are inclusive of the
    // window's first season and strictly exclusive of the target week.
    if (!Number.isFinite(gameSeason) || !Number.isFinite(gameWeek)) continue;
    if (gameSeason < firstSeason) continue;
    if (gameSeason > Number(season)) continue;
    if (gameSeason === Number(season) && gameWeek >= Number(week)) continue;
    if (filter && !filter(game)) continue;
    const points = Number(game.points);
    if (!Number.isFinite(points)) continue;
    const ago = weeksAgo({ gameSeason, gameWeek, season, week, seasonWeekSpan });
    const w = Math.pow(0.5, ago / halfLifeWeeks);
    weighted += w * points;
    weight += w;
    games++;
  }
  if (games < 1 || weight <= 0) return { value: null, games, weight };
  return { value: weighted / weight, games, weight };
}

/**
 * Pure: the projection shape the deployed-policy wrapper consumes.
 *
 * Deliberately the same field set the real engine emits, so the wrapper needs
 * no special case for a benchmark - it reads `median` like it reads any other
 * arm. The quantiles are null because a point estimator has no distribution;
 * `sampleSize` carries the prior-game count so the report can say how much
 * history each estimate rested on.
 */
function projectionShape({ playerId, value, games, benchmark }) {
  return {
    playerId,
    benchmark,
    // What every point-accuracy metric reads.
    median: value,
    mean: value,
    // No simulation, so no interval. Null here is what makes coverage and WIS
    // skip-and-count this arm instead of scoring a fabricated band.
    p10: null,
    p25: null,
    p75: null,
    p90: null,
    activeProbability: null,
    confidence: value === null ? 'none' : 'benchmark',
    sampleSize: games,
    factors: null,
  };
}

/**
 * `naive-recency`: the recency-weighted mean of prior league-scored points.
 *
 * This is the estimator the engine has to beat to have earned anything.
 */
function naiveRecency({ playerId, priorGames, season, week, ...options }) {
  // `filter` is stripped, not forwarded. `naive-recency` is DEFINED as the mean
  // over every prior game in the window; a caller who could pass a filter could
  // quietly turn the benchmark into a filtered estimator and publish it under
  // the benchmark's name. Refusing loudly beats ignoring silently, because a
  // caller passing one plainly believes it does something.
  if ('filter' in options) {
    throw new Error(
      'naiveRecency does not accept a filter: it is defined over EVERY prior game in the window. ' +
      'A filtered variant is a different estimator - `usageSignal` is the preregistered one.'
    );
  }
  const { value, games } = recencyWeightedMean({ priorGames, season, week, ...options });
  return projectionShape({ playerId, value, games, benchmark: BENCHMARKS.NAIVE_RECENCY });
}

/**
 * `usage-signal`: the same estimator over USAGE-BEARING games only.
 *
 * The contrast between the two is what isolates "does knowing his opportunity
 * counts help" from "does knowing his recent scoring help". Reported as an
 * estimate with a CI and NO verdict label (prereg 10.6) - it is a diagnostic,
 * not a gate.
 */
function usageSignal({ playerId, priorGames, season, week, ...options }) {
  if ('filter' in options) {
    throw new Error('usageSignal\'s filter is fixed to usage-bearing games and cannot be overridden');
  }
  const { value, games } = recencyWeightedMean({
    // `filter` last, so it cannot be displaced by a caller's spread.
    priorGames, season, week, ...options, filter: isUsageBearing,
  });
  return projectionShape({ playerId, value, games, benchmark: BENCHMARKS.USAGE_SIGNAL });
}

/** Both benchmarks for one player-week, in the fixed report order. */
function benchmarksFor(args) {
  return {
    [BENCHMARKS.NAIVE_RECENCY]: naiveRecency(args),
    [BENCHMARKS.USAGE_SIGNAL]: usageSignal(args),
  };
}

module.exports = {
  BENCHMARKS,
  USAGE_KEYS,
  isUsageBearing,
  recencyWeightedMean,
  projectionShape,
  naiveRecency,
  usageSignal,
  benchmarksFor,
};
