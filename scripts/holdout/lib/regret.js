'use strict';

/**
 * Candidate A's regret machinery (PREREGISTRATION.md §2, §6, §9.3).
 *
 * The two arms are two READ PATHS over the same scheduled snapshot:
 * control ranks by `median ?? mean` (production's toLegacyProjectionMap rule),
 * candidate by `mean ?? median` (buildSuggestions' 'mean' rule). Lineups come
 * from the production optimizer under the production slot shape - never a
 * reimplementation of either.
 */

const { optimalAssignment } = require('../../../server/services/lineupOptimizer');
const { DEFAULT_ROSTER_SLOTS } = require('../../../server/services/lineup.service');
const model = require('../../../server/services/projectionModel');
const { permutationP } = require('./inference');

/** A finite number or null - the ledger stores decimals as strings sometimes. */
function num(v) {
  if (v === null || v === undefined) return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * An arm's ranking value for one ledger row. `active_probability = 0` ranks 0
 * (bye/Out/IR at capture - the display rule's own zero), and a player with
 * neither statistic ranks 0 (the optimizer's null coercion).
 */
function rankingValue(row, arm) {
  if (row == null) return 0;
  if (num(row.activeProbability) === 0) return 0;
  const median = num(row.median);
  const mean = num(row.mean);
  const value = arm === 'mean' ? (mean ?? median) : (median ?? mean);
  return value ?? 0;
}

/** Actual points for a player-week: pinned actuals, absent -> 0 (§5). */
function actualPoints(actuals, season, week, playerId) {
  const pts = actuals.get(`${season}:${week}:${playerId}`);
  return pts === undefined ? 0 : Number(pts);
}

/** Total ACTUAL points of an optimizer assignment. */
function lineupActual(assignments, actuals, season, week) {
  let total = 0;
  for (const a of assignments) {
    if (a.playerId != null) total += actualPoints(actuals, season, week, a.playerId);
  }
  return total;
}

/**
 * Hindsight-optimal actual totals, one per roster. Permutation-INVARIANT -
 * the ideal lineup depends only on actuals - so the permutation floor
 * computes these once per week instead of once per week per shuffle, which
 * halves the cost of 10,000 permutations.
 */
function weekIdeals({ rosters, actuals, season, week }) {
  return rosters.map((roster) => {
    const candidates = roster.players.map((p) => ({ playerId: p.playerId, position: p.position }));
    const actualFor = new Map(candidates.map((c) => [c.playerId, actualPoints(actuals, season, week, c.playerId)]));
    return lineupActual(
      optimalAssignment({ rosterSlots: DEFAULT_ROSTER_SLOTS, candidates, pointsFor: actualFor }).assignments,
      actuals, season, week
    );
  });
}

/**
 * One week's regret per arm: mean over the week's rosters of
 * (hindsight-optimal actual total) - (arm-chosen lineup's actual total).
 *
 * `rankingFor` maps playerId -> ranking value for the arm being scored;
 * passing the map (rather than the arm name) is what lets the permutation
 * control reuse this function with shuffled values. `ideals` (from
 * `weekIdeals`, aligned with `rosters`) is computed when absent.
 */
function weekRegret({ rosters, rankingFor, actuals, season, week, ideals }) {
  const idealTotals = ideals || weekIdeals({ rosters, actuals, season, week });
  let regretSum = 0;
  rosters.forEach((roster, i) => {
    const candidates = roster.players.map((p) => ({ playerId: p.playerId, position: p.position }));
    const pointsFor = new Map(candidates.map((c) => [c.playerId, rankingFor.get(c.playerId) ?? 0]));
    const chosen = lineupActual(
      optimalAssignment({ rosterSlots: DEFAULT_ROSTER_SLOTS, candidates, pointsFor }).assignments,
      actuals, season, week
    );
    regretSum += idealTotals[i] - chosen;
  });
  return regretSum / rosters.length;
}

/** playerId -> ranking value for a whole week's scheduled rows under one arm. */
function armRankingMap(scheduledRows, arm) {
  return new Map(scheduledRows.map((row) => [row.playerId, rankingValue(row, arm)]));
}

/**
 * The §9.3 permutation floor: `permutations` seeded within-position shuffles
 * of the CONTROL ranking values across each week's scheduled rows. Every
 * permutation is scored with the same rosters and the same optimizer as the
 * real arms; the p-value is plus-one Monte Carlo against the control's own
 * mean weekly regret, lower-is-better.
 *
 * One PRNG stream, consumed permutation-by-permutation in week order, so the
 * b-th permutation is identical on every run of the evaluator.
 */
function permutationFloor({
  weeks, rostersByWeek, scheduledRowsByWeek, actuals, season, permutations, seed, controlMeanRegret,
}) {
  const rand = model.mulberry32(seed);
  const idealsByWeek = new Map(weeks.map((week) => [week, weekIdeals({
    rosters: rostersByWeek.get(week), actuals, season, week,
  })]));
  const permMeans = new Array(permutations);
  for (let b = 0; b < permutations; b++) {
    let sum = 0;
    for (const week of weeks) {
      const rows = scheduledRowsByWeek.get(week);
      const byPosition = new Map();
      for (const row of rows) {
        if (!byPosition.has(row.position)) byPosition.set(row.position, []);
        byPosition.get(row.position).push(row);
      }
      const shuffled = new Map();
      for (const group of byPosition.values()) {
        const values = group.map((row) => rankingValue(row, 'median'));
        for (let i = values.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1)) % (i + 1);
          [values[i], values[j]] = [values[j], values[i]];
        }
        group.forEach((row, i) => shuffled.set(row.playerId, values[i]));
      }
      sum += weekRegret({
        rosters: rostersByWeek.get(week), rankingFor: shuffled, actuals, season, week,
        ideals: idealsByWeek.get(week),
      });
    }
    permMeans[b] = sum / weeks.length;
  }
  const p = permutationP({ observed: controlMeanRegret, permStats: permMeans, lowerIsBetter: true });
  return { p, permutations, permMeans };
}

module.exports = {
  rankingValue,
  actualPoints,
  weekIdeals,
  weekRegret,
  armRankingMap,
  permutationFloor,
};
