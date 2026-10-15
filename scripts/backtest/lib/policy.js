'use strict';

/**
 * The two regret estimands.
 *
 * **Primary: deployed-policy regret.** A deterministic reconstruction of what
 * production would actually start - the `buildSuggestions` availability wrapper
 * (`decision.service.js:105-139`) plus the production optimizer
 * (`lineupOptimizer.js`), with candidates in the reconstructed production order
 * (`lib/ordering`). Explicitly NOT claimed to be exact production semantics;
 * see `lib/ordering`'s docblock for why that claim is unavailable.
 *
 * **Sensitivity: force-fill regret.** A "legal nine-slot lineup" estimand:
 * `null` ranks strictly below every finite projection and no slot is left empty
 * while an eligible player remains. Explicitly NOT production regret - the real
 * optimizer will leave a slot empty rather than start a negative projection,
 * and force-fill will not.
 *
 * **If the two disagree on a winner, NO SELECTION OCCURS** (prereg 5.3). That
 * halt is implemented here, not left to a reader of the report.
 *
 * The three optimizer behaviours the preregistration pins, each reproduced
 * exactly and each with a fixture:
 *   - the empty-slot dummy has cost 0 and a real player costs `-points`, so the
 *     dummy BEATS a strictly negative projection (cost 0 < +5 for a -5 player);
 *   - a zero projection and a null-coerced-to-zero projection TIE with the
 *     dummy, so a real player may start;
 *   - equal costs resolve by CANDIDATE COLUMN ORDER, which is why ordering is
 *     load-bearing.
 *
 * Pure: the optimizer and the availability rule are injected, because nothing
 * in `scripts/backtest` may require `server/services`. The sweep passes the
 * real ones; tests pass the real ones too, so this is reproduction rather than
 * re-implementation.
 */

const { ORDERINGS, orderCandidates } = require('./ordering');
const { isFiniteNumber } = require('./numbers');
const { assertNotQuarantined } = require('./cohort');

/** Slot keys that are not starting slots. Mirrors decision.service. */
const BENCH = 'BENCH';
const IR = 'IR';

const ESTIMANDS = Object.freeze({
  DEPLOYED_POLICY: 'deployed-policy',
  FORCE_FILL: 'force-fill',
});

/**
 * Pure: what a player is WORTH to a lineup this week.
 *
 * Mirrors `lineupOptimizer.pointsValue` (:110-114) exactly: anything
 * non-finite - including `null` and `undefined` - is 0. This is not a rounding
 * convenience. It is why a null projection is NOT excluded from regret
 * (prereg 6.6): production coerces it to zero and starts the player if nothing
 * beats zero, so the wrapper has to do the same or it would be measuring a
 * policy nobody runs.
 */
function pointsValue(projection) {
  const raw = projection && typeof projection === 'object' ? projection.median : projection;
  return Number.isFinite(Number(raw)) ? Number(raw) : 0;
}

/**
 * Pure: the availability wrapper's candidate filter, reproducing
 * `buildSuggestions` (:117-134).
 *
 * Production's `unavailableFor` applies five exclusions, in this order:
 *   1. bye;
 *   2. No NFL team;
 *   3. Practice squad;
 *   4. Out / IR designation;
 *   5. the autoRecommend branch: a Doubtful player, or a Position-baseline
 *      player (reason `no_history`, ADR 0053), is available but not
 *      auto-recommended.
 * Exclusions 1, 4 and 5 are reconstructed here. 2 and 3 are deliberately not:
 *   - `noTeam` reads today's `players.nfl_team`, which would leak present
 *     roster status into a historical week (the cohort's `roster_weekly` team
 *     is the fact used instead);
 *   - `nflRosterStatus` has no history before 2026-09, and DEVIATIONS.md entry
 *     4 records that replays pass no Map.
 *
 * On top of that, the wrapper's own candidate filter, in production's order:
 *   - an IR-slot player is never a candidate;
 *   - a locked starter is PINNED to his slot; a locked bench player can never
 *     be started;
 *   - an unavailable player (bye / Out / IR designation) is removed AND worth
 *     zero;
 *   - a Doubtful or Position-baseline player ON THE BENCH is never
 *     auto-promoted (`doubtful-on-bench`, `no-history-on-bench`), while one
 *     already STARTING keeps his slot and his number. That asymmetry is
 *     production's, and it is the one the preregistration names as a required
 *     fixture.
 *
 * The two autoRecommend causes differ in where the fact lives. Doubtful is an
 * ENTRY fact (his injury designation), so it applies to every lineup built from
 * the entries. The Position-baseline marker is a property of the PROJECTION
 * ROW (`factors.dataQuality.reasons`, read through the injected
 * `positionBaselineFor(projectionEntry)`), so it applies only to a lineup built
 * from projection rows. The started lineup is, and never auto-promotes the
 * player; the hindsight-best lineup is built from ACTUAL points (bare numbers,
 * no rows), reads the marker false, and keeps him as a candidate, because under
 * hindsight he is a legal start (ADR 0053 item 3). Regret stays non-negative.
 */
function partitionCandidates({
  entries, projections, availabilityFor, positionBaselineFor, label = 'wrapper',
}) {
  if (typeof availabilityFor !== 'function') {
    throw new Error(`${label}: the production availabilityFor must be injected`);
  }
  if (typeof positionBaselineFor !== 'function') {
    throw new Error(`${label}: the production positionBaselineFor must be injected`);
  }
  const isStarter = (e) => e.slot !== BENCH && e.slot !== IR;
  const availabilityById = new Map();
  const pinned = new Map();
  const candidates = [];
  const removed = [];

  for (const entry of entries) {
    const projectionEntry = projections instanceof Map
      ? projections.get(entry.playerId)
      : (projections || {})[entry.playerId];
    const availability = availabilityFor({
      injuryStatus: entry.injuryStatus ?? null,
      onBye: Boolean(entry.onBye),
      positionBaseline: positionBaselineFor(projectionEntry ?? null),
    });
    availabilityById.set(entry.playerId, availability);
    if (entry.slot === IR) { removed.push({ playerId: entry.playerId, reason: 'ir-slot' }); continue; }
    if (entry.locked) {
      if (isStarter(entry)) pinned.set(entry.playerId, entry.slot);
      else removed.push({ playerId: entry.playerId, reason: 'locked-bench' });
      continue;
    }
    if (!availability.available) {
      removed.push({ playerId: entry.playerId, reason: availability.reason || 'unavailable' });
      continue;
    }
    if (availability.autoRecommend === false && !isStarter(entry)) {
      removed.push({
        playerId: entry.playerId,
        reason: availability.reason === 'no_history' ? 'no-history-on-bench' : 'doubtful-on-bench',
      });
      continue;
    }
    candidates.push({
      playerId: entry.playerId,
      position: entry.position,
      teamKey: entry.teamKey ?? null,
      name: entry.name ?? null,
    });
  }
  return { candidates, pinned, removed, availabilityById, isStarter };
}

/**
 * Pure: the effective projection map the optimizer sees.
 *
 * An unavailable player is worth exactly 0 - not his projection - which is what
 * stops a bye starter "outprojecting" the healthy bench and blocking every
 * replacement (`decision.service.js`'s `effectiveProjection`).
 */
function effectiveProjections({ entries, projections, availabilityById }) {
  const effective = new Map();
  for (const entry of entries) {
    const availability = availabilityById.get(entry.playerId);
    const raw = projections instanceof Map
      ? projections.get(entry.playerId)
      : (projections || {})[entry.playerId];
    effective.set(entry.playerId, (availability && !availability.available) ? 0 : pointsValue(raw));
  }
  return effective;
}

/**
 * The DEPLOYED-POLICY lineup: what production would start.
 *
 * `optimize` is the real `lineupOptimizer.optimizeLineup`, injected. Candidates
 * reach it in the reconstructed production order, because equal costs resolve
 * by column order and the order therefore decides the lineup.
 */
function deployedPolicyLineup({
  entries,
  projections,
  ranks,
  rosterSlots,
  availabilityFor,
  positionBaselineFor,
  optimize,
  ordering = ORDERINGS.PRIMARY,
  shuffleSeed = 1,
  label = 'deployed policy',
}) {
  if (typeof optimize !== 'function') {
    throw new Error(`${label}: the production optimizer must be injected`);
  }
  const { candidates, pinned, removed, availabilityById } = partitionCandidates({
    entries, projections, availabilityFor, positionBaselineFor, label,
  });
  const ordered = orderCandidates({ candidates, ranks, ordering, shuffleSeed, label });
  const effective = effectiveProjections({ entries, projections, availabilityById });
  const result = optimize({
    rosterSlots,
    candidates: ordered,
    pointsFor: effective,
    pinned,
  });
  return {
    estimand: ESTIMANDS.DEPLOYED_POLICY,
    ordering,
    assignments: result.assignments,
    total: result.total,
    started: result.assignments.filter((a) => a.playerId !== null).map((a) => a.playerId),
    removed,
    candidateCount: ordered.length,
  };
}

/**
 * The FORCE-FILL lineup: the sensitivity estimand.
 *
 * Two differences from production, both deliberate and both disqualifying it as
 * a production estimand:
 *   - `null` ranks strictly BELOW every finite projection, rather than being
 *     coerced to zero and tying with the empty dummy;
 *   - no slot is left empty while an eligible player remains, so a negative
 *     projection still starts.
 *
 * Implemented by shifting every value above the dummy's zero rather than by
 * writing a second optimizer: the real optimizer still does the assignment, so
 * the two estimands differ only in what they are asked, not in how it is
 * solved.
 */
function forceFillLineup({
  entries,
  projections,
  ranks,
  rosterSlots,
  availabilityFor,
  positionBaselineFor,
  optimize,
  ordering = ORDERINGS.PRIMARY,
  shuffleSeed = 1,
  label = 'force fill',
}) {
  if (typeof optimize !== 'function') {
    throw new Error(`${label}: the production optimizer must be injected`);
  }
  const { candidates, pinned, removed, availabilityById } = partitionCandidates({
    entries, projections, availabilityFor, positionBaselineFor, label,
  });
  const ordered = orderCandidates({ candidates, ranks, ordering, shuffleSeed, label });

  // Every finite projection, and how far the whole scale must move so that the
  // WORST real player still beats the empty dummy.
  const rawByPlayer = new Map();
  let lowest = 0;
  for (const entry of entries) {
    const availability = availabilityById.get(entry.playerId);
    const raw = projections instanceof Map
      ? projections.get(entry.playerId)
      : (projections || {})[entry.playerId];
    const value = raw && typeof raw === 'object' ? raw.median : raw;
    // `Number(null)` is 0, so a bare finite check would turn the very thing
    // this estimand is defined by - a NULL projection, which must rank strictly
    // below every finite value - into a zero that outranks every negative one.
    // `isFiniteNumber` rejects missing explicitly before any coercion.
    const finite = isFiniteNumber(value) ? Number(value) : null;
    const unavailable = !!(availability && !availability.available);
    rawByPlayer.set(entry.playerId, unavailable ? 0 : finite);
    if (finite !== null && finite < lowest) lowest = finite;
  }
  // `null` sits strictly below every finite projection, so it gets the lowest
  // rung of all; the shift then lifts even that above the dummy's zero.
  const NULL_RUNG = lowest - 1;
  const shift = Math.abs(NULL_RUNG) + 1;
  const effective = new Map();
  for (const [playerId, value] of rawByPlayer) {
    effective.set(playerId, (value === null ? NULL_RUNG : value) + shift);
  }

  const result = optimize({ rosterSlots, candidates: ordered, pointsFor: effective, pinned });
  // Report the lineup's total in REAL points, not shifted ones: the shift is a
  // solver device and must never reach a published number.
  const started = result.assignments.filter((a) => a.playerId !== null).map((a) => a.playerId);
  const total = started.reduce((sum, playerId) => {
    const value = rawByPlayer.get(playerId);
    return sum + (value === null ? 0 : value);
  }, 0);
  return {
    estimand: ESTIMANDS.FORCE_FILL,
    ordering,
    assignments: result.assignments,
    total: Math.round(total * 100) / 100,
    started,
    removed,
    candidateCount: ordered.length,
  };
}

/**
 * Pure: regret for one roster-week.
 *
 * `(points of the best legal lineup under ACTUAL points) - (points of the
 * lineup the arm's wrapper started, scored under ACTUAL points)`. Non-negative
 * by construction (prereg 5.2), and asserted to be: a negative regret would
 * mean the "best" lineup was not best, which is a solver bug rather than a
 * finding.
 *
 * Both lineups are scored under the SAME actual points. The arm only chooses
 * WHO to start; it never gets to score its own choice.
 */
function regretFor({ startedPlayerIds, bestPlayerIds, actualPoints, label = 'regret' }) {
  const score = (ids) => ids.reduce((sum, id) => {
    const value = actualPoints instanceof Map ? actualPoints.get(id) : (actualPoints || {})[id];
    return sum + (Number.isFinite(Number(value)) ? Number(value) : 0);
  }, 0);
  const started = score(startedPlayerIds);
  const best = score(bestPlayerIds);
  const regret = best - started;
  if (regret < -1e-9) {
    throw new Error(
      `${label}: regret is ${regret}, which is negative. The "best" lineup scored less than the ` +
      'one the arm started, so it was not the best legal lineup - that is a solver defect, not a result.'
    );
  }
  return Math.max(0, regret);
}

/**
 * **If the two estimands disagree on a winner, NO SELECTION OCCURS**
 * (prereg 5.3).
 *
 * Implemented as a halt rather than a note. The two estimands answer different
 * questions, and when they disagree the study has not established which cell is
 * better under any policy anyone would run - reporting the primary's winner
 * anyway would be choosing the estimand after seeing the answer.
 */
function reconcileEstimands({ deployedPolicy, forceFill, label = 'estimand reconciliation' }) {
  for (const [name, result] of [['deployedPolicy', deployedPolicy], ['forceFill', forceFill]]) {
    if (!result || typeof result !== 'object' || !('winner' in result)) {
      throw new Error(
        `${label}: ${name} produced no winner. A missing estimand cannot agree with anything, and ` +
        'the preregistration treats missing as a failure rather than a pass.'
      );
    }
  }
  if (deployedPolicy.winner !== forceFill.winner) {
    return {
      selection: null,
      halted: true,
      reason: 'estimand-disagreement',
      detail:
        `the deployed-policy estimand selects ${JSON.stringify(deployedPolicy.winner)} and the `
        + `force-fill sensitivity selects ${JSON.stringify(forceFill.winner)}. The preregistration `
        + 'requires that NO SELECTION OCCUR when they disagree: the study has not shown a cell is '
        + 'better under any policy anyone would actually run.',
      winners: { deployedPolicy: deployedPolicy.winner, forceFill: forceFill.winner },
    };
  }
  return {
    selection: deployedPolicy.winner,
    halted: false,
    reason: null,
    detail: 'both estimands select the same cell',
    winners: { deployedPolicy: deployedPolicy.winner, forceFill: forceFill.winner },
  };
}

/**
 * The evaluation artifact for one roster-week, carrying the EXCLUSION COUNTERS
 * the published report needs (prereg 4.1).
 *
 * The counters travel with the result rather than being recomputed later,
 * because a report that cannot see them should not be constructible: "how many
 * player-weeks were excluded, and why" is part of the finding, not an optional
 * appendix.
 */
function evaluationArtifact({
  season, week, replicate, teamIndex, estimand, regret, started, removed, counters = {},
  label = 'evaluation artifact',
}) {
  // THE QUARANTINE, on the persisted-evaluation-row path.
  //
  // The plan and preregistration 17 enumerate "every persisted evaluation row"
  // as a quarantine site, and this function IS that row. `buildCohort` throwing
  // on 2026 upstream is not the same guard: this is exported, Phase 5 calls it
  // directly, and a row assembled from anywhere else would otherwise carry a
  // 2026 season into a metric with nothing to stop it. 2026 is an untouched
  // prospective holdout, and spending it is silent.
  assertNotQuarantined(season, { label });
  return {
    season: Number(season),
    week: Number(week),
    replicate,
    teamIndex,
    estimand,
    regret,
    started: [...started],
    removedFromCandidates: removed.length,
    removedByReason: removed.reduce((acc, r) => {
      acc[r.reason] = (acc[r.reason] || 0) + 1;
      return acc;
    }, {}),
    // Carried through from the cohort and the snapshot client so the Phase-5
    // report can state them per preregistration 4.1.
    exclusions: {
      playersOmittedByReason: { ...(counters.playersOmittedByReason || {}) },
      contradictions: counters.contradictions || 0,
      scanRowsUnattributed: counters.scanRowsUnattributed || 0,
      cohortExcludedByReason: { ...(counters.cohortExcludedByReason || {}) },
      outcomeExcludedByReason: { ...(counters.outcomeExcludedByReason || {}) },
    },
  };
}

module.exports = {
  BENCH,
  IR,
  ESTIMANDS,
  pointsValue,
  partitionCandidates,
  effectiveProjections,
  deployedPolicyLineup,
  forceFillLineup,
  regretFor,
  reconcileEstimands,
  evaluationArtifact,
};
