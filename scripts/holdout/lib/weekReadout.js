'use strict';

/**
 * Pure assembly for scripts/holdout/week-readout.js (#2080): one preset Scoring
 * profile's Holdout ledger snapshot rows, the week's priced actuals and the
 * earlier weeks' priced points in, the per-profile report object out. No DB, no
 * clock; the runner does the I/O.
 *
 * Two bases are reported side by side, because they answer different questions:
 *  - `overall` / `perPosition` use the Appearance basis the calibration readout
 *    uses: a player-week counts when a stat row exists (the ledger records no
 *    Appearance) and `activeProbability === 0` rows are left out.
 *  - `sealedBasis` is `coverage.armWeekMetrics` verbatim: an absent actual
 *    scores 0, the rule the sealed holdout gate applies.
 */

const { pointEstimateFor } = require('../../../server/services/projection.service');
const metrics = require('../../backtest/lib/metrics');
const coverage = require('./coverage');

const r3 = (v) => (v === null || v === undefined ? null : Math.round(v * 1000) / 1000);

// Naive baseline: the player's mean priced points over the season's earlier weeks.
function naiveFor(priorByPlayer, playerId) {
  const prior = priorByPlayer.get(playerId);
  return prior && prior.length ? prior.reduce((x, y) => x + y, 0) / prior.length : null;
}

const naivePairs = (rows) => rows
  .filter((r) => r.naive !== null)
  .map((r) => ({ projected: r.naive, actual: r.actual }));

const meanBias = (rows) => rows.reduce((s, r) => s + (r.projected - r.actual), 0) / (rows.length || 1);

function buildWeekReadout({ season, week, profile, modelVersion, snapshotId, rows: ledgerRows, actuals, priorByPlayer, players }) {
  const rows = ledgerRows.map((c) => {
    const row = { ...c, modelVersion: c.modelVersion || modelVersion };
    row.projected = pointEstimateFor(row);
    row.actual = actuals.has(c.playerId) ? actuals.get(c.playerId) : null;
    row.naive = naiveFor(priorByPlayer, c.playerId);
    row.name = (players.get(c.playerId) || {}).name;
    return row;
  });

  const scored = rows.filter((r) => r.actual !== null && r.activeProbability !== 0);
  const byPos = {};
  for (const r of scored) (byPos[r.position] = byPos[r.position] || []).push(r);

  const perPosition = {};
  for (const [pos, prs] of Object.entries(byPos)) {
    const m = metrics.weekPointMetrics(prs);
    const naive = metrics.weekPointMetrics(naivePairs(prs));
    const cv = metrics.weekCoverage(prs);
    const pw = metrics.cellPairwise(prs);
    perPosition[pos] = {
      n: m.n, mae: r3(m.mae), rmse: r3(m.rmse), bias: r3(meanBias(prs)), spearman: r3(m.spearman),
      pairwise: r3(pw.score), cov80: r3(cv.coverage), covN: cv.scored,
      naive: { n: naive.n, mae: r3(naive.mae), spearman: r3(naive.spearman) },
    };
  }

  const all = metrics.weekPointMetrics(scored);
  const allNaive = metrics.weekPointMetrics(naivePairs(scored));
  const sealed = coverage.armWeekMetrics({
    rows,
    actuals: new Map([...actuals].map(([id, pts]) => [`${season}:${week}:${id}`, pts])),
    season,
    week,
  });

  const brief = (r) => ({
    id: r.playerId, name: r.name, pos: r.position, team: r.team, inj: r.injury, proj: r3(r.projected),
    p10: r3(r.p10), p90: r3(r.p90), actual: r3(r.actual), ap: r.activeProbability, n: r.sampleSize,
  });
  const starters = rows.filter((r) => r.activeProbability !== 0 && r.projected >= 8);
  const projectedNoStat = starters.filter((r) => r.actual === null);
  const unavailableScored = rows.filter((r) => r.activeProbability === 0 && (r.actual || 0) > 0);
  const misses = [...scored].sort((a, b) => Math.abs(b.projected - b.actual) - Math.abs(a.projected - a.actual));
  const factorKeys = {};
  for (const r of rows) for (const k of Object.keys(r.factors || {})) factorKeys[k] = (factorKeys[k] || 0) + 1;

  return {
    profile,
    snapshotId,
    modelVersion,
    cohort: rows.length,
    unavailable: rows.filter((r) => r.activeProbability === 0).length,
    noHistory: rows.filter((r) => !r.sampleSize).length,
    withStatRow: rows.filter((r) => r.actual !== null).length,
    overall: {
      n: all.n, mae: r3(all.mae), rmse: r3(all.rmse), spearman: r3(all.spearman), bias: r3(meanBias(scored)),
      naive: { n: allNaive.n, mae: r3(allNaive.mae), rmse: r3(allNaive.rmse), spearman: r3(allNaive.spearman) },
    },
    perPosition,
    sealedBasis: { cov80: r3(sealed.cov80), cov50: r3(sealed.cov50), wis: r3(sealed.wis), width: r3(sealed.width), counts: sealed.counts },
    flags: {
      projectedGe8NoStatRow: {
        count: projectedNoStat.length,
        of: starters.length,
        top: projectedNoStat.sort((a, b) => b.projected - a.projected).slice(0, 15).map(brief),
      },
      unavailableButScored: { count: unavailableScored.length, top: unavailableScored.sort((a, b) => b.actual - a.actual).slice(0, 10).map(brief) },
      biggestMisses: misses.slice(0, 12).map(brief),
      factorKeys,
    },
  };
}

module.exports = { buildWeekReadout };
