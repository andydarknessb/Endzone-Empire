'use strict';

/**
 * Gate 2, the `--inputs` PRODUCER's per-arm-week scorer (increment 2).
 *
 * Scores ONE arm's already-computed projections for ONE season-week across
 * all seven preregistered endpoints - `regret`, `pairwise`, `mae`, `rmse`,
 * `rho`, `wis`, `coverage` - returning exactly the `values` object one
 * `armWeekMetrics` record of `lib/inputsAssembly.js` carries. The driver
 * (a later increment) calls this once per (arm, scoring profile, season,
 * week, salt); this module holds the SCORING, the assembly layer holds the
 * CONTRASTS, and generation belongs to neither.
 *
 * RELATION TO `controlCellEvaluator.js`'s CONTROL-ONLY LOCK, stated head-on
 * because this module is exactly the generalization that lock forbids THERE:
 *
 *   - The lock protects the MDE blinding boundary: `evaluateControlCell`'s
 *     output feeds `lib/mde.runMde` tagged `cell: arms.CONTROL_CELL`, and
 *     the blinding must hold one step earlier than `mde.js`'s own require-
 *     graph proof - so THAT module takes no cell parameter, structurally.
 *     This module has NO path into mde: it produces `armWeekMetrics`-shaped
 *     values for the sweep's `--inputs` document, where all EIGHT cells and
 *     both benchmark arms are SUPPOSED to be scored (prereg 12.1's factorial
 *     family, 7.2's benchmarks). `runMde`'s series still come only from
 *     `controlCellEvaluator`, which is unchanged.
 *   - This module CANNOT CAUSE GENERATION: it takes a projections MAP, not
 *     a `projectPoints` function; it resolves no constants and knows no
 *     blend weights. Like `sweepPreflight.js`, it never generates a
 *     projection, opens a snapshot, or reads a database - which is what
 *     keeps building and testing it on synthetic fixtures inside Gate 0's
 *     hold. The arm's IDENTITY appears only as a label on the output
 *     record, attached by `toArmWeekMetricsRecord`.
 *
 * WHAT IT COMPUTES, PER WEEK (prereg 6.1-6.5, all via `lib/metrics.js`'s
 * collapsers - never re-implemented here):
 *
 *   1. **Regret** (6.1, prereg 5.2): the deployed-policy machinery of
 *      `controlCellEvaluator.evaluateControlWeek`, byte-for-byte - the
 *      arm's started lineup vs the perfectly-informed lineup, both through
 *      the injected production wrapper (`availabilityFor`, `optimize`),
 *      mean over the week's rosters.
 *   2. **Pairwise** (6.2): `controlCellEvaluator.pairwiseRowsByPosition`
 *      (REUSED, so the eligibility rule cannot diverge from the approved
 *      control path) collapsed by `metrics.weekPairwise`. A >1-position
 *      drop yields `pairwise: null` - the week-level undefined the
 *      assembly layer expresses as a uniform null.
 *   3. **MAE / RMSE / rho** (6.3): `metrics.weekPointMetrics` over the
 *      FLATTENED pairwise rows, positions in `MACRO_POSITIONS` order - one
 *      membership rule (macro position, not on bye, prereg 4.1) shared with
 *      pairwise BY CONSTRUCTION, since the rows are the same objects.
 *      `rho` is `weekPointMetrics`' `spearman`, renamed to the endpoint
 *      vocabulary at the boundary.
 *   4. **Coverage / WIS** (6.4/6.5): `metrics.weekCoverage` /
 *      `metrics.weekWis` over interval rows built from the SAME membership
 *      pass. A projection with no interval fields (the benchmarks'
 *      `p10/p25/p75/p90 = null` shape, `lib/naive.js`) is excluded AND
 *      COUNTED by those collapsers' own stated rules - so an interval-free
 *      arm scores `coverage: null` / `wis: null` with the exclusion counts
 *      published in the detail, never a fabricated band.
 *
 * Pure: no database, no filesystem, no clock, no RNG. Deterministic given
 * its inputs: iteration is pinned to `MACRO_POSITIONS` order and the cohort
 * artifact's own member order (frozen by the artifact's `freezeHash`), and
 * the roster loop follows the roster artifact's order, exactly as the
 * control evaluator's does.
 *
 * ONE DELIBERATE ASYMMETRY in the null contract: six endpoints go `null`
 * when a week leaves them undefined, but a week with NO rosters (or an
 * empty cohort) THROWS via `metrics.weekRegret` rather than scoring
 * `regret: null`. That is the right fail mode for the producer: every
 * frozen roster artifact carries exactly the pinned 50 rosters, so an
 * empty artifact is a defect of the inputs, and prereg 10.4 expresses a
 * genuinely row-less week by the driver emitting NO record for it under
 * any salt - never by calling this function on broken artifacts.
 */

const cohort = require('./cohort');
const policy = require('./policy');
const metrics = require('./metrics');
const rosters = require('./rosters');
const arms = require('./arms');
const controlCellEvaluator = require('./controlCellEvaluator');
const inputsAssembly = require('./inputsAssembly');
const sweepEvidence = require('./sweepEvidence');
const { ORDERINGS } = require('./ordering');
const { isFiniteNumber } = require('./numbers');

const { MACRO_POSITIONS } = metrics;

/**
 * The seven endpoint keys - the SAME frozen array the assembly layer's
 * closed-key check enforces (`sweepEvidence.METRIC_KEYS`), aliased rather
 * than copied so the two can never drift.
 */
const VALUE_KEYS = sweepEvidence.METRIC_KEYS;

/**
 * Interval rows for coverage/WIS, under the SAME membership rule as
 * `pairwiseRowsByPosition` (macro position, not on bye - prereg 4.1) and in
 * the same iteration order (cohort member order). A bare-number projection
 * or an object without interval fields contributes nulls, which the
 * collapsers exclude and count - their own stated rule, not this module's.
 */
function intervalRows({ cohortMembers, actualPointsByPlayerId, projectionsByPlayerId }) {
  const rows = [];
  for (const member of cohortMembers) {
    if (!MACRO_POSITIONS.includes(member.position)) continue;
    if (member.onBye) continue; // excluded from point-accuracy scoring, prereg 4.1
    const actual = actualPointsByPlayerId instanceof Map
      ? actualPointsByPlayerId.get(member.playerId)
      : (actualPointsByPlayerId || {})[member.playerId];
    const projection = projectionsByPlayerId instanceof Map
      ? projectionsByPlayerId.get(member.playerId)
      : (projectionsByPlayerId || {})[member.playerId];
    const field = (name) => {
      if (!projection || typeof projection !== 'object') return name === 'median' && isFiniteNumber(projection) ? Number(projection) : null;
      return isFiniteNumber(projection[name]) ? Number(projection[name]) : null;
    };
    rows.push({
      playerId: member.playerId,
      actual: isFiniteNumber(actual) ? Number(actual) : null,
      median: field('median'),
      p10: field('p10'),
      p25: field('p25'),
      p75: field('p75'),
      p90: field('p90'),
    });
  }
  return rows;
}

/**
 * Score one arm-week. `projectionsByPlayerId` covers the whole cohort
 * (pairwise and the point metrics need the full week, not just the roster
 * pool); regret reuses the same maps for the roster players. The returned
 * `values` object carries exactly the seven endpoint keys, `null` where the
 * week leaves an endpoint undefined.
 */
function evaluateArmWeek({
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
  label = 'arm evaluator',
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
  // typeof null === 'object' - the explicit null check mirrors the control
  // evaluator's, for the same reason.
  if (!(actualPointsByPlayerId instanceof Map)
    && (actualPointsByPlayerId === null || typeof actualPointsByPlayerId !== 'object')) {
    throw new Error(`${where}: cohortWeek.actualPointsByPlayerId (resolved outcome truth) is required`);
  }
  // The projections map must be PRESENT (a sparse map is legal - a player
  // with no projection scores null and regret coerces to zero per prereg
  // 6.6 - but an absent ARGUMENT is a driver defect, not sparse evidence:
  // without this, a dropped argument published a plausible-looking record
  // with finite all-zero-lineup regret beside uniform nulls, which the
  // assembly layer cannot distinguish from a legitimate interval-free week).
  if (!(projectionsByPlayerId instanceof Map)
    && (projectionsByPlayerId === null || projectionsByPlayerId === undefined || typeof projectionsByPlayerId !== 'object')) {
    throw new Error(`${where}: projectionsByPlayerId is required - a sparse map expresses missing projections; an absent argument is a caller defect`);
  }
  const ranks = { positionRank, nameRankById };

  // KEY-TYPE guard (QA on this increment), applied BEFORE any row building
  // so every scoring path reads the same normalized maps: lookups everywhere
  // are by NUMERIC playerId, so a Map keyed by strings - or an object whose
  // keys do not coerce to finite numbers - misses EVERY lookup. In the
  // regret path that wholesale miss still publishes a FINITE number (the
  // lineup is chosen on all-zero projections, prereg 6.6's null->0 rule
  // applied to a defect instead of to sparse evidence), indistinguishable
  // downstream from a legitimately projection-free week - so it throws
  // here. (The object branch's Number(k) normalization mirrors the approved
  // control path; normalizing FIRST also removes that path's own asymmetry,
  // where a non-numeric object key was readable by pairwise but never by
  // regret.)
  const numericKeyed = (map, name) => {
    for (const key of map.keys()) {
      if (typeof key !== 'number' || !Number.isFinite(key)) {
        throw new Error(`${where}: ${name} carries a non-numeric key ${JSON.stringify(key)} - lookups are by numeric playerId, so this key can never be read and its row silently vanishes`);
      }
    }
    return map;
  };
  const asNumericMap = (source, name) => {
    if (source instanceof Map) return numericKeyed(source, name);
    return numericKeyed(new Map(Object.entries(source).map(([k, v]) => [Number(k), v])), name);
  };
  const actualsMap = asNumericMap(actualPointsByPlayerId, 'actualPointsByPlayerId');
  const projectionsMap = asNumericMap(projectionsByPlayerId, 'projectionsByPlayerId');

  // Pairwise, and the point metrics OVER THE SAME ROWS: the by-position map
  // is flattened in MACRO_POSITIONS order, so mae/rmse/rho share pairwise's
  // membership and its normalization (`{projected, actual}` with non-finite
  // -> null) because they read the identical row objects.
  const pairwiseRows = controlCellEvaluator.pairwiseRowsByPosition({
    cohortMembers: cohortWeek.members, actualPointsByPlayerId: actualsMap, projectionsByPlayerId: projectionsMap, label: where,
  });
  const pairwise = metrics.weekPairwise(pairwiseRows, { label: `${where} pairwise` });
  const flatRows = MACRO_POSITIONS.flatMap((position) => pairwiseRows[position]);
  const points = metrics.weekPointMetrics(flatRows, { label: `${where} points` });

  const bandRows = intervalRows({
    cohortMembers: cohortWeek.members, actualPointsByPlayerId: actualsMap, projectionsByPlayerId: projectionsMap,
  });
  const coverage = metrics.weekCoverage(bandRows, { label: `${where} coverage` });
  const wis = metrics.weekWis(bandRows, { label: `${where} wis` });

  const cohortByPlayerId = new Map(cohortWeek.members.map((m) => [m.playerId, m]));

  const rosterRegrets = [];
  const perRosterDetail = [];
  for (const roster of rosterWeek.rosters) {
    const entries = controlCellEvaluator.rosterEntries({ roster, cohortByPlayerId, label: where });
    const started = policy.deployedPolicyLineup({
      entries, projections: projectionsMap, ranks, rosterSlots, availabilityFor, optimize, ordering, label: where,
    });
    // The perfectly-informed lineup: the SAME wrapper and optimizer, fed
    // actual points where they would otherwise read a projection (prereg 5.2).
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
    values: {
      regret: weekRegretValue,
      pairwise: pairwise.score,
      mae: points.mae,
      rmse: points.rmse,
      rho: points.spearman,
      wis: wis.wis,
      coverage: coverage.coverage,
    },
    detail: {
      pairwise,
      points,
      coverage,
      wis,
      rosterCount: rosterWeek.rosters.length,
      cohortSize: cohortWeek.members.length,
      perRosterDetail,
    },
  };
}

/**
 * Compose one `armWeekMetrics` record for `inputsAssembly.assembleSweepInputs`
 * from an `evaluateArmWeek` result. The arm name is validated against the 8
 * cells and the 2 benchmark arms - the same closed vocabulary
 * `indexArmWeekMetrics` enforces - so a typo'd arm fails HERE, at the layer
 * that knows which evaluation it just labelled, rather than at assembly time
 * where the label's provenance is gone.
 */
function toArmWeekMetricsRecord({ scoringProfile, arm, salt, evaluation, label = 'arm record' }) {
  // The profile label gets the same here-not-later treatment as the arm and
  // the salt: it is a caller-attached label with the same provenance
  // problem. (The profile-ARM cross rules - benchmarks have no sensitivity
  // generation, sensitivity profiles are 2025-only - stay at the assembly
  // layer, which owns the whole-universe view they need.)
  const profileNames = [sweepEvidence.PRIMARY_PROFILE, ...sweepEvidence.SENSITIVITY_PROFILES];
  if (!profileNames.includes(scoringProfile)) {
    throw new Error(`${label}: scoringProfile ${JSON.stringify(scoringProfile)} is not a sealed profile identifier (${profileNames.join(', ')})`);
  }
  const armNames = [...arms.ALL_CELLS.map((cell) => cell.name), ...inputsAssembly.BENCHMARK_ARMS];
  if (!armNames.includes(arm)) {
    throw new Error(`${label}: arm ${JSON.stringify(arm)} is not one of the 8 cells or the 2 benchmark arms`);
  }
  if (!metrics.SALTS.includes(salt)) {
    throw new Error(`${label}: salt ${JSON.stringify(salt)} is not one of the 24 preregistered salts`);
  }
  if (!evaluation || typeof evaluation !== 'object' || !evaluation.values || typeof evaluation.values !== 'object') {
    throw new Error(`${label}: evaluation must be an evaluateArmWeek result carrying a values object`);
  }
  const extra = Object.keys(evaluation.values).filter((key) => !VALUE_KEYS.includes(key));
  const missing = VALUE_KEYS.filter((key) => !(key in evaluation.values));
  if (extra.length > 0 || missing.length > 0) {
    throw new Error(`${label}: values must carry exactly the seven endpoint keys; missing [${missing.join(', ')}], extra [${extra.join(', ')}]`);
  }
  return {
    scoringProfile,
    arm,
    season: evaluation.season,
    week: evaluation.week,
    salt,
    values: Object.fromEntries(VALUE_KEYS.map((key) => [key, evaluation.values[key]])),
  };
}

module.exports = {
  VALUE_KEYS,
  intervalRows,
  evaluateArmWeek,
  toArmWeekMetricsRecord,
};
