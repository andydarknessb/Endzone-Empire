'use strict';

/**
 * The CONTROL-CELL-ONLY evaluator: drives the real deployed-policy machinery
 * (`lib/policy.deployedPolicyLineup`, `lib/policy.regretFor`) and the real
 * metric collapse (`lib/metrics.weekRegret`, `lib/metrics.weekPairwise`) across
 * the 17 primary 2025 weeks, for the shipped control cell (`usage-25 x off`)
 * and NOTHING else, and hands the result to `lib/mde.runMde`.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE, NOT INLINE IN THE MDE CLI
 *
 * `lib/mde.js` is deliberately incapable of loading anything: it takes a
 * per-week series of numbers and simulates on them, and a mutation test in
 * `backtestMde.test.js` proves its require graph cannot reach a candidate
 * artifact. That guarantee is worth nothing if the code that PRODUCES the
 * per-week series is free to compute a candidate cell's numbers and hand them
 * to `runMde` labelled "control" - the blinding has to hold one step earlier
 * than `mde.js`'s own boundary, and this module is where it holds.
 *
 * **STRUCTURALLY, NOT BY CONVENTION.** `evaluateControlCell` takes no `cell`
 * parameter and no constants override: the ONLY constants it will ever resolve
 * are the shipped control cell's, built internally from `arms.CONTROL_BLEND_
 * WEIGHT` / `arms.CONTROL_HOME_AWAY`, and it INDEPENDENTLY re-derives those same
 * constants a second way (through `arms.buildFamily`'s own control entry) and
 * asserts the two are bit-identical (`assertControlConstantsBitIdentity`,
 * mirroring `arms.js:213`'s `assertControlBitIdentity`) before ever calling the
 * injected projection function. A caller cannot pass a candidate cell in even
 * by mistake, because there is no parameter through which one could arrive.
 *
 * WHAT "CONTROL-CELL-ONLY" MEANS HERE, CONCRETELY
 *
 *   - the resolved `modelConstants` handed to the injected `projectPoints`
 *     function are always the control cell's, never caller-suppliable;
 *   - the per-week series returned are tagged `cell: arms.CONTROL_CELL`, the
 *     exact string `mde.assertControlOnly` checks for;
 *   - nothing here reads a path, a snapshot, or a candidate artifact - every
 *     input is data the caller already has in memory (roster/cohort artifacts,
 *     ordering artifacts) or a function the caller supplies (`projectPoints`).
 *
 * WHAT IT COMPUTES, PER WEEK
 *
 *   1. **Pairwise accuracy** (prereg 6.2) over the FULL reconstructed cohort for
 *      that week, not just the 160-candidate roster pool: for every
 *      `(position)` cell, `{projected, actual}` pairs from every cohort member
 *      the caller supplies actual points and a projection for.
 *   2. **Regret** (prereg 5.2, the primary deployed-policy estimand) over each
 *      of the week's 50 roster-weeks: the arm's started lineup (production
 *      availability wrapper + optimizer, run on the CONTROL cell's projections)
 *      against the best legal lineup under ACTUAL points (the same wrapper and
 *      optimizer, run with actual points standing in for "projections" - i.e.
 *      the assignment a perfectly-informed manager would have made). Both are
 *      injected (`availabilityFor`, `optimize`), because nothing in
 *      `scripts/backtest` may require `server/services`; the real production
 *      wrapper is what the caller supplies.
 *
 * Pure: no database, no filesystem, no clock. `projectPoints` is the one
 * injected function that may itself be impure (it calls the real production
 * `generateProjections` against a snapshot client, in the real wiring at
 * `server/scripts/run-backtest-mde.js`) - everything else here is deterministic
 * given its inputs.
 */

const arms = require('./arms');
const cohort = require('./cohort');
const policy = require('./policy');
const metrics = require('./metrics');
const rosters = require('./rosters');
const { ORDERINGS } = require('./ordering');
const { isFiniteNumber } = require('./numbers');

/** The 17 primary 2025 weeks the MDE's control-only series are built over (prereg 13.1). */
const PRIMARY_SEASON = 2025;
const PRIMARY_WEEKS = Object.freeze(metrics.EVALUATED_WEEKS);

/**
 * Resolve the control cell's constants TWO independent ways and refuse to
 * proceed unless they are bit-identical.
 *
 * This is the "usage-25 x off is bit-identical to the shipped control"
 * assertion (`arms.js:213`, `assertControlBitIdentity`), applied inline to the
 * two ways of NAMING the control cell rather than to two separately-computed
 * RUNS of it: `arms.resolveConstants` called directly against the frozen
 * `CONTROL_BLEND_WEIGHT`/`CONTROL_HOME_AWAY` constants, versus the control
 * entry `arms.buildFamily` derives while building the whole 4x2 family. Both
 * paths are supposed to be the same computation reached two different ways; a
 * future edit that let them drift (a hardcoded literal creeping into one path,
 * say) is exactly the kind of silent divergence this guards against, and it is
 * checked EVERY call rather than trusted from a one-time review.
 */
function resolveControlConstants({ baseConstants, label = 'control evaluator' }) {
  if (!baseConstants || typeof baseConstants !== 'object') {
    throw new Error(`${label}: the production MODEL_CONSTANTS must be injected`);
  }
  const direct = arms.resolveConstants({
    cell: { name: arms.CONTROL_CELL, blendWeight: arms.CONTROL_BLEND_WEIGHT, homeAway: arms.CONTROL_HOME_AWAY },
    baseConstants,
    label,
  });
  const family = arms.buildFamily({ baseConstants, label });
  const viaFamily = family.control.resolvedConstants;
  if (family.control.name !== arms.CONTROL_CELL || !family.control.isControl) {
    throw new Error(`${label}: arms.buildFamily's control entry is not ${arms.CONTROL_CELL}`);
  }
  arms.assertControlBitIdentity({
    controlRun: direct, usage25OffRun: viaFamily, label: `${label}: control constants`,
  });
  return direct;
}

/**
 * Pure: is this projections/actuals row eligible for pairwise, and what does
 * it contribute?
 *
 * Mirrors `cellPairwise`'s own input contract - `{projected, actual}` - so this
 * module never re-implements pairwise eligibility; it only assembles the rows.
 */
function pairwiseRowsByPosition({ cohortMembers, actualPointsByPlayerId, projectionsByPlayerId, label }) {
  const byPosition = {};
  for (const position of metrics.MACRO_POSITIONS) byPosition[position] = [];
  for (const member of cohortMembers) {
    if (!metrics.MACRO_POSITIONS.includes(member.position)) continue;
    if (member.onBye) continue; // excluded from point-accuracy scoring, prereg 4.1
    const actual = actualPointsByPlayerId instanceof Map
      ? actualPointsByPlayerId.get(member.playerId)
      : (actualPointsByPlayerId || {})[member.playerId];
    const projection = projectionsByPlayerId instanceof Map
      ? projectionsByPlayerId.get(member.playerId)
      : (projectionsByPlayerId || {})[member.playerId];
    const projected = projection && typeof projection === 'object' ? projection.median : projection;
    byPosition[member.position].push({
      playerId: member.playerId,
      actual: isFiniteNumber(actual) ? Number(actual) : null,
      projected: isFiniteNumber(projected) ? Number(projected) : null,
    });
  }
  return byPosition;
}

/** Pure: build the deployed-policy `entries` for one roster-week from a cohort index. */
function rosterEntries({ roster, cohortByPlayerId, label }) {
  const identify = (p, slot) => {
    const member = cohortByPlayerId.get(p.playerId);
    if (!member) {
      throw new Error(
        `${label}: roster player ${p.playerId} (${p.teamKey || ''}) has no cohort entry for this week - `
        + 'the roster and cohort artifacts must be built from the SAME week'
      );
    }
    return {
      playerId: p.playerId,
      position: member.position,
      teamKey: member.teamKey,
      injuryStatus: member.injuryStatus,
      onBye: member.onBye,
      locked: false,
      slot,
    };
  };
  return [
    ...roster.starters.map((s) => identify(s, s.slot)),
    ...roster.bench.map((b) => identify(b, policy.BENCH)),
  ];
}

/**
 * Evaluate the control cell for ONE season-week: pairwise accuracy over the
 * full cohort, and regret over every roster in the week's roster artifact.
 *
 * `projections` and `actualPointsByPlayerId` cover the WHOLE cohort - pairwise
 * needs the full week, not just the 160-player roster pool - and regret reuses
 * the same maps for the (smaller) set of roster players.
 */
function evaluateControlWeek({
  season,
  week,
  rosterWeek,
  cohortWeek,
  projectionsByPlayerId,
  positionRank,
  nameRankById,
  rosterSlots = rosters.DEFAULT_ROSTER_SLOTS,
  availabilityFor,
  optimize,
  ordering = ORDERINGS.PRIMARY,
  label = 'control evaluator',
}) {
  const where = `${label} ${season}w${week}`;
  if (typeof availabilityFor !== 'function') throw new Error(`${where}: availabilityFor must be injected`);
  if (typeof optimize !== 'function') throw new Error(`${where}: optimize must be injected`);
  cohort.assertNotQuarantined(season, { label: where });
  if (Number(rosterWeek.season) !== Number(season) || Number(rosterWeek.week) !== Number(week)) {
    throw new Error(`${where}: rosterWeek is for ${rosterWeek.season}w${rosterWeek.week}, not this week`);
  }
  if (Number(cohortWeek.season) !== Number(season) || Number(cohortWeek.week) !== Number(week)) {
    throw new Error(`${where}: cohortWeek is for ${cohortWeek.season}w${cohortWeek.week}, not this week`);
  }
  const actualPointsByPlayerId = cohortWeek.actualPointsByPlayerId;
  // typeof null === 'object', so a bare `typeof x !== 'object'` guard does not
  // catch a null value - check for null explicitly rather than let it pass
  // through as if it were valid outcome-truth data.
  if (!(actualPointsByPlayerId instanceof Map)
    && (actualPointsByPlayerId === null || typeof actualPointsByPlayerId !== 'object')) {
    throw new Error(`${where}: cohortWeek.actualPointsByPlayerId (resolved outcome truth) is required`);
  }
  const ranks = { positionRank, nameRankById };

  const pairwiseRows = pairwiseRowsByPosition({
    cohortMembers: cohortWeek.members, actualPointsByPlayerId, projectionsByPlayerId, label: where,
  });
  const pairwise = metrics.weekPairwise(pairwiseRows, { label: `${where} pairwise` });

  const cohortByPlayerId = new Map(cohortWeek.members.map((m) => [m.playerId, m]));
  const actualsMap = actualPointsByPlayerId instanceof Map
    ? actualPointsByPlayerId
    : new Map(Object.entries(actualPointsByPlayerId).map(([k, v]) => [Number(k), v]));
  const projectionsMap = projectionsByPlayerId instanceof Map
    ? projectionsByPlayerId
    : new Map(Object.entries(projectionsByPlayerId || {}).map(([k, v]) => [Number(k), v]));

  const rosterRegrets = [];
  const perRosterDetail = [];
  for (const roster of rosterWeek.rosters) {
    const entries = rosterEntries({ roster, cohortByPlayerId, label: where });
    const started = policy.deployedPolicyLineup({
      entries, projections: projectionsMap, ranks, rosterSlots, availabilityFor, optimize, ordering, label: where,
    });
    // The best legal lineup under ACTUAL points: the SAME wrapper and optimizer,
    // fed actual points where they would otherwise read a projection. This is
    // "what a perfectly-informed manager would have started" - not a different
    // solver, the same one asked a different question (prereg 5.2).
    const best = policy.deployedPolicyLineup({
      entries, projections: actualsMap, ranks, rosterSlots, availabilityFor, optimize, ordering, label: where,
    });
    const regret = policy.regretFor({
      startedPlayerIds: started.started, bestPlayerIds: best.started, actualPoints: actualsMap, label: where,
    });
    rosterRegrets.push(regret);
    perRosterDetail.push({
      replicate: roster.replicate, teamIndex: roster.teamIndex, regret, started: started.started, best: best.started,
    });
  }
  const weekRegretValue = metrics.weekRegret(rosterRegrets, { label: `${where} regret` });

  return {
    season: Number(season),
    week: Number(week),
    regret: weekRegretValue,
    pairwise: pairwise.score,
    pairwiseDetail: pairwise,
    rosterCount: rosterWeek.rosters.length,
    cohortSize: cohortWeek.members.length,
    perRosterDetail,
  };
}

/**
 * Evaluate the control cell across all 17 primary 2025 weeks and return the
 * per-week series `lib/mde.runMde` needs.
 *
 * `weekArtifacts` maps `"season:week"` -> `{ rosterWeek, cohortWeek,
 * positionRank, nameRankById }` for every one of the 17 primary weeks. There is
 * no `cell` parameter anywhere in this function's signature - see the module
 * docblock's "STRUCTURALLY, NOT BY CONVENTION" section.
 */
async function evaluateControlCell({
  weekArtifacts,
  baseConstants,
  projectPoints,
  availabilityFor,
  optimize,
  rosterSlots = rosters.DEFAULT_ROSTER_SLOTS,
  ordering = ORDERINGS.PRIMARY,
  label = 'control evaluator',
}) {
  if (typeof projectPoints !== 'function') throw new Error(`${label}: projectPoints must be injected`);
  const modelConstants = resolveControlConstants({ baseConstants, label });

  const controlRegretWeeks = [];
  const controlPairwiseWeeks = [];
  const perWeekDetail = [];

  for (const week of PRIMARY_WEEKS) {
    const key = `${PRIMARY_SEASON}:${week}`;
    const inputs = weekArtifacts instanceof Map ? weekArtifacts.get(key) : (weekArtifacts || {})[key];
    if (!inputs) {
      throw new Error(`${label}: no roster/cohort artifacts supplied for ${key} - all 17 primary weeks are required`);
    }
    const { rosterWeek, cohortWeek, positionRank, nameRankById } = inputs;
    const cohortPlayerIds = [...new Set(cohortWeek.members.map((m) => m.playerId))];
    // eslint-disable-next-line no-await-in-loop
    const projectionsByPlayerId = await projectPoints({
      season: PRIMARY_SEASON, week, playerIds: cohortPlayerIds, modelConstants,
    });
    const weekResult = evaluateControlWeek({
      season: PRIMARY_SEASON,
      week,
      rosterWeek,
      cohortWeek,
      projectionsByPlayerId,
      positionRank,
      nameRankById,
      rosterSlots,
      availabilityFor,
      optimize,
      ordering,
      label,
    });
    controlRegretWeeks.push(weekResult.regret);
    controlPairwiseWeeks.push(weekResult.pairwise);
    perWeekDetail.push(weekResult);
  }

  return {
    cell: arms.CONTROL_CELL,
    season: PRIMARY_SEASON,
    weeks: [...PRIMARY_WEEKS],
    controlRegretWeeks,
    controlPairwiseWeeks,
    perWeekDetail,
    modelConstants,
  };
}

module.exports = {
  PRIMARY_SEASON,
  PRIMARY_WEEKS,
  resolveControlConstants,
  pairwiseRowsByPosition,
  rosterEntries,
  evaluateControlWeek,
  evaluateControlCell,
};
