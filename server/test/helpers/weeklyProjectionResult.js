const projectionService = require('../../services/projection.service');

/**
 * Builds the real Weekly projection result object (`toWeeklyProjectionResult`,
 * #1702/#1703) from a suite's legacy-shaped fixture map - two fixture shapes
 * (the retired legacy map's, #1704): a bare number, or
 * `{ points, projection: { mean, median, p10, p25, p75, p90 }, factors,
 * confidence, activeProbability }`. `mean`/`median` fall back to `points`
 * only when the distribution itself does not specify them, so a fixture that
 * gives only one quantile still exercises exactly the ranking statistic it
 * means to (a caller mixing the two on purpose, e.g. the #1483 pair, passes
 * both explicitly and this never overrides either).
 *
 * `buildSuggestions` (decision.service.js, #1703) takes this result object
 * directly rather than a legacy map, so every one of its tests builds its
 * fixture through this helper instead of a bare `Map`.
 */
function resultFromLegacyMap(legacyMap, { backupIds, practiceById } = {}) {
  const projections = new Map();
  for (const [id, value] of legacyMap) {
    if (value == null) continue; // no entry at all - stays absent, same as production
    if (typeof value !== 'object') {
      const n = Number(value);
      projections.set(id, { mean: n, median: n, factors: {} });
      continue;
    }
    const dist = value.projection || {};
    const mean = dist.mean !== undefined ? dist.mean : value.points;
    const median = dist.median !== undefined ? dist.median : value.points;
    projections.set(id, {
      mean: mean === undefined ? null : mean,
      median: median === undefined ? null : median,
      p10: dist.p10 ?? null,
      p25: dist.p25 ?? null,
      p75: dist.p75 ?? null,
      p90: dist.p90 ?? null,
      confidence: value.confidence ?? dist.confidence ?? null,
      activeProbability: value.activeProbability ?? dist.activeProbability ?? null,
      factors: value.factors || dist.factors || {},
    });
  }
  return projectionService.toWeeklyProjectionResult({ projections, backupIds, practiceById });
}

module.exports = { resultFromLegacyMap };
