'use strict';

/**
 * Gate 2, the `--inputs` PRODUCER's generation driver (increment 3).
 *
 * Increment 1 (`inputsAssembly.js`) turns raw generation records into the
 * closed-schema `--inputs` document; increment 2 (`armWeekEvaluator.js`)
 * scores one arm-week. This module is the loop BETWEEN them: it walks the
 * sealed generation grid (PHASE5_EXECUTION_SPEC.md section 9 - 14,688 salted
 * arm-week generations), calls an INJECTED generator once per coordinate,
 * captures everything the reducer's preflight and component (f) need at the
 * only moment those values exist, and returns the raw record arrays
 * `assembleSweepInputs` consumes.
 *
 * WHY THIS IS PURE, AND WHAT THE WIRING STILL OWES IT
 *
 * `generate` is a parameter, not a require. Nothing here computes a
 * projection, opens a snapshot, reads a database, or reaches
 * `server/services/**` - so this module is Gate-0-clean by construction and
 * every test below runs on synthetic fixtures, exactly like the two
 * increments before it. The real seam (`generateProjections` against a
 * reconstructed snapshot client, `model.seedFrom`, `model.scoringHash`,
 * `SCORING_PRESETS`) is thin wiring that belongs in `server/scripts/`, next
 * to `run-backtest-mde.js`'s identical arrangement, and RUNNING it stays
 * barred until Gate 4/Gate 3. The injected contract is stated on
 * `generateSweepInputRecords` below; two obligations are worth naming here
 * because a wiring that gets them wrong produces a document that still
 * validates:
 *
 *   1. The driver itself now passes `weatherService: false` on every
 *      `generate` call (QA finding A5: `runInputsByArm` records the flag as
 *      a generation input, so the record must be of an input that was
 *      actually sent, not a fabricated provenance line). The wiring MUST
 *      STILL pin its own literal `false` into `generateProjections`
 *      regardless of what arrives - weather off is the exactness
 *      precondition for component (f) (`median_on - median_off = b * e`
 *      holds only because weather is applied AFTER homeAway,
 *      `projectionModel.js:1107`), and this module cannot verify the flag
 *      survived the seam: weather changes the numbers, not their shape.
 *   2. `generate` MUST forward `onPreHomeAwayBaseline` unchanged into
 *      `generateProjections`. The callback is the ONLY source of the
 *      pre-homeAway baseline `b` (section 6.5); a wiring that drops it
 *      produces zero baseline rows, which this module rejects by name rather
 *      than letting the empty subgroup look like a small one.
 *   3. `generate` MUST genuinely generate on EVERY call - no results cache,
 *      no memoization keyed on the arguments. The 8.6.0 control receives
 *      arguments identical to the `usage-25 x off` cell's BY DESIGN, so a
 *      cache collapses exactly that pair and the 816 "independent
 *      regeneration" records would compare an object against itself
 *      (section 9's forbidden reuse). `assertRunsNotAliased` below rejects
 *      every non-cloning cache at generation time; a cache that CLONES its
 *      hits is invisible to this module by construction, which is why
 *      genuine regeneration is stated here as a wiring obligation rather
 *      than only enforced.
 *
 * WHAT IS CAPTURED, AND WHY EACH MUST BE CAPTURED HERE
 *
 *   - `matchedOffBaselineRows` (spec 6.5/6.1a): `b` is a value INSIDE one
 *     projection's arithmetic, gone the instant the projection returns. It
 *     is captured from the MATCHED OFF CELL's generation - "which is where
 *     subgroup membership is assigned (prereg 9.8)" - and labelled with the
 *     ON cell it serves. This is the invariant only the producer can
 *     establish: the schema can check that a baseline row is well-formed,
 *     never that it came from the off cell.
 *   - `saltSeedRecords` (spec 3.4 test 5): the 24 final seeds one
 *     player-week actually used, per cell, checked pairwise-distinct at
 *     runtime by the reducer's preflight.
 *   - `controlUsage25Records` / `homeAwayStoredRecords` (spec 8.6.0/8.6.1):
 *     the FULL run objects of both sides of each sealed identity assertion,
 *     which is why this module generates two arms the primary grid does not
 *     contain (see the plan below).
 *   - `activationRecords` (prereg 11): the on-cells' projection objects
 *     themselves, since `factors.homeAway.available`/`effect` exist nowhere
 *     else.
 *   - `subgroupErrorRows` (spec 6.1/6.4): the round2-median errors of an on
 *     cell and its matched off cell for the SAME salt - a pairing that can
 *     only be formed while both runs are in hand.
 *
 * THE TWO ARMS THAT ARE GENERATED BUT NEVER SCORED
 *
 * Section 9 is explicit that reusing the `usage-25 x off` cell's own output
 * as "the control" would compare an object against itself and prove nothing,
 * so the control for assertion 8.6.0 is generated INDEPENDENTLY - 816 runs
 * the primary grid does not already contain. The `homeaway-on-stored` twin
 * (8.6.1) is another 816. Neither is an `armWeekMetrics` arm: they exist
 * only as the left/right sides of the identity records, and this module
 * never scores them, never selects on them, and never lets their names into
 * the document's arm vocabulary. (Section 9 permits ONE reuse - the
 * permutation control's own control artifact - and requires that reuse to be
 * "explicitly stated and justified in Gate 2's code and in the published
 * report". This module takes NO such reuse: the independent control arm is
 * generated here in full, so the grid total stays 14,688 rather than 13,872,
 * and increment 4's permutation control is free to generate its own.)
 *
 * SCOPE OF THIS INCREMENT, stated so the gap is visible rather than assumed
 *
 * `generateSweepInputRecords` returns everything `assembleSweepInputs` needs
 * EXCEPT `permutationControl` (increment 4) and `orderingSensitivityByCell`
 * (prereg 5.2/16's ordering-variant verdict comparison, which is a SECOND
 * full pass through the reducer and therefore belongs to the entrypoint that
 * owns both passes, increment 5). Those two are the caller's to supply, and
 * `assembleSweepInputs` already fails closed if they are absent or malformed.
 *
 * SINCE INCREMENT 5 this module also emits the RAW MATERIAL that second pass
 * consumes: `armWeekMetricsBySensitivity`, one full `armWeekMetrics` array
 * per sensitivity configuration (`inputsSensitivity.SENSITIVITY_PASSES` -
 * prereg 5.2's two ordering variants and prereg 5.3's force-fill estimand).
 * Each scored arm-week is re-evaluated over the SAME generated projections
 * with only the evaluation knob changed - an evaluation-time re-scoring,
 * never a regeneration, so the sealed grid arithmetic (section 9's 14,688)
 * is untouched and `counts.generations` cannot move. Only `regret` is
 * lineup-dependent; every other endpoint of a variant evaluation is asserted
 * bit-identical to the primary's, so a sensitivity knob that leaks past the
 * lineup solve fails HERE by name rather than surfacing as a mysteriously
 * moved pairwise series three layers downstream. The verdict COMPARISON
 * itself stays with `inputsSensitivity`/the wiring, which own the reducer
 * passes this module's outputs feed.
 *
 * FAIL-CLOSED POSTURE (round 4 BLOCKER A's lesson, at the generation layer)
 *
 * Every capture is checked at the coordinate that produced it: a baseline
 * whose reported `blendWeight` does not match the cell being generated, a
 * baseline that moves between salts, an activation verdict that moves
 * between salts, a cohort player-week with no captured baseline, a subgroup
 * member with no finite median or no resolved outcome, a duplicate cohort
 * playerId, a missing week artifact. Each throws by NAME, because each is a
 * defect of the RUN that the reducer would otherwise reject three layers
 * downstream as a coverage-arithmetic mismatch with no cause attached.
 *
 * Producer-side determinations this module PINS because the sealed text does
 * not (deferral-batch candidates for the B3 re-cut, continuing the numbering
 * of `inputsAssembly.js`'s docblock, which pins 1-3):
 *
 *  4. The two BENCHMARK arms carry no salt dimension in generation - they
 *     are deterministic functions of prior games (`lib/naive.js`), with no
 *     simulation draw for a seed to vary. The document's arm-week universe
 *     nevertheless requires all 24 salts for every generated arm-week
 *     (`indexArmWeekMetrics`: "a partial salt set is a malformed universe"),
 *     so each benchmark arm-week is evaluated ONCE and published under all
 *     24 salts. The salt-paired contrast (d) of prereg 6.7 is therefore a
 *     paired delta against a constant comparator, which is what a
 *     salt-invariant benchmark means and not a defect of the pairing.
 *  5. Activation (prereg 11) is scored from ONE reference salt's
 *     projections - `SALTS[0]` - because `factors.homeAway` is resolved
 *     BEFORE the seeded simulation (`projectionModel.js`: `applyFactor
 *     ('homeAway', ...)` precedes `simulateDistribution`), so activation is
 *     salt-invariant. Publishing all 24 salts' projections would multiply
 *     prereg 11's eligible/activated COUNTS by 24 while leaving the rates
 *     unchanged, and the counts are published. The invariance is not
 *     assumed: every salt's (eligible, activated) pair is checked against
 *     the reference salt's, per player, and a divergence throws.
 *  6. WITHDRAWN AS A DETERMINATION (QA finding S4; the number is retained
 *     so the register stays dense and no later determination renumbers).
 *     The subgroup error pair's rounding is PINNED BY THE SEALED TEXT, not
 *     by this module: section 6.1 defines `error_on = round2(median_on_raw)
 *     - actual` and `error_off = round2(median_off_raw) - actual`, each
 *     side independently rounded at the error boundary. The earlier filing
 *     here claimed the sealed text did not pin this and cited 6.1 with a
 *     paraphrase presented as a quotation ("round2 on medians before error
 *     computation" - a string that appears in neither sealed document).
 *     The CODE was and is conformant; only the filing was wrong, and a
 *     reviewer must not be invited to rule on something already ruled.
 *     Production already publishes a round2-rounded median, so the boundary
 *     application is idempotent today; it is applied explicitly anyway so
 *     the document's arithmetic does not silently depend on production's
 *     rounding staying where it is (the test below pins this module's
 *     `round2` to production's byte-for-byte).
 * 12. (7-11 are pinned in `run-backtest-inputs.js`'s and
 *     `inputsSensitivity.js`'s registers; this module continues at 12.)
 *     The two sealed identity assertions (8.6.0/8.6.1) also run AT
 *     GENERATION TIME, once per (season, week) the moment all 24 salts'
 *     operands exist, via the reducer's own exported
 *     `sweepPreflight.assertIdentityCoverage` - never a re-implementation
 *     (QA finding S2). The sealed invocation point ("BEFORE any candidate
 *     cell's metrics are computed, and before the permutation control
 *     runs") is a PREFLIGHT-block ordering the reducer still owns and
 *     re-runs from the document; at generation time a strictly-before
 *     ordering is impossible, because the assertions' own operands include
 *     the week's generated cell runs. What the per-week invocation
 *     preserves is the clause's stated rationale - "running them after
 *     computing candidate metrics would burn the full sweep's runtime
 *     discovering the harness was broken all along" - by aborting at the
 *     first week whose identities fail rather than after the full grid.
 *
 * KNOWN REAL-DATA RISKS, named because the first authoritative run is where
 * they will surface and neither is this module's to decide:
 *
 *   A. **Baseline coverage is total.** The reducer's preflight
 *      (`assertComponentFVetoCoverage`) requires a matched-off baseline row
 *      for EVERY cohort player-week x every on cell, but
 *      `onPreHomeAwayBaseline` fires only for player-weeks whose projection
 *      REACHES the homeAway step - a player absent from the feature bundle
 *      short-circuits earlier and produces no `b` at all. Under real data a
 *      single such player-week voids the run by coverage arithmetic rather
 *      than by evidence. This module surfaces it here, with the count and
 *      the first offending coordinates named, instead of at the preflight.
 *   B. **The identity arrays are the document's bulk.** Sections 8.6.0/8.6.1
 *      are asserted over the full 34-week x 24-salt domain, and the reducer
 *      re-runs those assertions from the DOCUMENT, so both sides' complete
 *      run objects have to be carried in it: 816 records x 2 sides x the
 *      week's whole cohort. That is the approved reducer contract, not a
 *      choice available here, but it makes the `--inputs` document very
 *      large and this driver's peak memory proportional to the entire grid.
 *      Recorded for the B3 batch; nothing about it is worked around
 *      silently.
 *   C. **The sensitivity profiles are scored against the PRIMARY profile's
 *      outcome truth**, and the sealed text (sections 8.7 rule 4 / 9) does
 *      not appear to settle whether they should be. Section 9 makes the
 *      profile a generation coordinate on the FEATURE side - "`standard` and
 *      `ppr` cannot be produced by re-scoring a `half_ppr` generation" - but
 *      the OUTCOME side is a frozen Commit-A artifact: `run-backtest-
 *      rosters.js` prices `actualPointsByPlayerId` once, through
 *      `SCORING_RULES`, and the cohort artifacts carry exactly one such map.
 *      So a `standard` arm-week's regret is a lineup chosen on
 *      standard-priced projections, measured in half-PPR points. This module
 *      has NO other behaviour available to it - re-pricing would need the raw
 *      stat lines, which the artifact does not carry, and regenerating the
 *      artifacts per profile is a Commit-A change - so the choice is
 *      RECORDED here rather than made here. 8.7 rule 4 already requires the
 *      report to disclose that these rows sit on a half-PPR-selected cohort;
 *      whether the same disclosure covers half-PPR-priced OUTCOMES is a B3
 *      deferral-batch question, and the test suite pins the current
 *      behaviour so a future answer changes a test rather than a silence.
 *
 * Pure: no database, no filesystem, no clock, no RNG of its own. Given the
 * same artifacts and the same injected generator, the same records - in the
 * same pinned order.
 */

const arms = require('./arms');
const metrics = require('./metrics');
const armWeekEvaluator = require('./armWeekEvaluator');
const inputsAssembly = require('./inputsAssembly');
const inputsSensitivity = require('./inputsSensitivity');
const sweepPreflight = require('./sweepPreflight');
const { PRIMARY_SCORING_PROFILE, SCORING_PROFILE_NAMES } = require('./freezeManifest');
const { isFiniteNumber, roundToTie } = require('./numbers');

const { SALTS, EVALUATED_WEEKS, MACRO_POSITIONS } = metrics;

// ---------------------------------------------------------------------------
// The sealed grid (section 9)
// ---------------------------------------------------------------------------

const PRIMARY_SEASON = 2025;
const SAFETY_SEASON = 2024;

/** The primary profile is generated over both preregistered seasons; the sensitivity profiles are 2025-only (section 8.7 rule 4, prereg 9.7). */
const PRIMARY_SEASONS = Object.freeze([PRIMARY_SEASON, SAFETY_SEASON]);
const SENSITIVITY_SEASONS = Object.freeze([PRIMARY_SEASON]);

/**
 * Generation order over profiles: the formal primary first, then the two
 * sensitivity profiles in the freeze manifest's own order. Taken from the
 * sealed manifest rather than written as literals, so this and
 * `sweepEvidence.SENSITIVITY_PROFILES` cannot drift.
 */
const GENERATION_PROFILES = Object.freeze([
  PRIMARY_SCORING_PROFILE,
  ...SCORING_PROFILE_NAMES.filter((name) => name !== PRIMARY_SCORING_PROFILE),
]);

/**
 * The two generated-but-never-scored arms. Deliberately NOT members of
 * `inputsAssembly.BENCHMARK_ARMS` or of the 8 cells: `toArmWeekMetricsRecord`
 * rejects both names, which is the structural reason neither can reach the
 * document's arm vocabulary even by a caller's mistake.
 */
const STORED_TWIN_ARM = 'homeaway-on-stored';
const INDEPENDENT_CONTROL_ARM = 'control-independent';

/** The one pair section 8.6.1 seals: the shipped-usage (usage-25) `on` cell and its stored-history twin. */
const STORED_TWIN_CELL = arms.cellName({ blendWeight: arms.CONTROL_BLEND_WEIGHT, homeAway: 'on' });
/** Section 8.6.0's right-hand side: the `usage-25 x off` cell, which IS the control cell's coordinate. */
const USAGE25_OFF_CELL = arms.cellName({ blendWeight: arms.CONTROL_BLEND_WEIGHT, homeAway: 'off' });

const GENERATION_KINDS = Object.freeze({
  CELL: 'cell',
  STORED_TWIN: 'stored-twin',
  INDEPENDENT_CONTROL: 'independent-control',
});

/** Section 9's own arithmetic, pinned so a plan that drifts from the sealed table fails a test rather than a review. */
const GRID_TOTAL = 14688;

/** Seasons generated for one scoring profile. */
function seasonsFor(scoringProfile) {
  return scoringProfile === PRIMARY_SCORING_PROFILE ? PRIMARY_SEASONS : SENSITIVITY_SEASONS;
}

/**
 * The complete generation plan, in the pinned order this module executes it:
 * profile, season, week, salt, then `arms.ALL_CELLS` order followed by the
 * primary profile's two identity-assertion arms.
 *
 * Exported for auditing and for the count assertion; the driver walks the
 * same nesting inline rather than iterating this array, because a
 * materialized 14,688-element plan carrying week artifacts would be a second
 * source of truth for the loop it describes.
 */
function buildGenerationPlan({ profiles = GENERATION_PROFILES } = {}) {
  const plan = [];
  for (const scoringProfile of profiles) {
    const isPrimary = scoringProfile === PRIMARY_SCORING_PROFILE;
    for (const season of seasonsFor(scoringProfile)) {
      for (const week of EVALUATED_WEEKS) {
        for (const salt of SALTS) {
          for (const cell of arms.ALL_CELLS) {
            plan.push({
              scoringProfile, arm: cell.name, cell: cell.name, kind: GENERATION_KINDS.CELL, season, week, salt, useStoredHistory: false,
            });
          }
          if (isPrimary) {
            plan.push({
              scoringProfile, arm: STORED_TWIN_ARM, cell: STORED_TWIN_CELL, kind: GENERATION_KINDS.STORED_TWIN, season, week, salt, useStoredHistory: true,
            });
            plan.push({
              scoringProfile, arm: INDEPENDENT_CONTROL_ARM, cell: arms.CONTROL_CELL, kind: GENERATION_KINDS.INDEPENDENT_CONTROL, season, week, salt, useStoredHistory: false,
            });
          }
        }
      }
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Small pinned helpers
// ---------------------------------------------------------------------------

/**
 * Production's rounding, replicated rather than imported: `scripts/backtest/
 * lib/**` may not require `server/services/**` (the same boundary that puts
 * `run-backtest-mde.js` under `server/scripts/`). The test pins this against
 * `projectionModel.round2` over a shared vector, so the replication cannot
 * drift silently.
 */
function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

/** The cohort's player ids for one week, in member order, with duplicates rejected rather than deduped. */
function cohortPlayerIds(cohortWeek, label) {
  const ids = [];
  const seen = new Set();
  for (const [index, member] of (cohortWeek.members || []).entries()) {
    // Asserted, never coerced (QA finding A1): `evaluateArmWeek` scores by
    // the RAW member.playerId, so a layer that coerces here while the
    // evaluator reads raw can hold two key types at once - a demonstrated
    // all-string cohort published regret 0 for every arm-week and the
    // reducer called that run valid with zero reasons. The JSON boundary
    // already asserts (`run-backtest-inputs.assertNumericPlayerIds`); with
    // this layer asserting too, the two cannot disagree by construction.
    const id = member && member.playerId;
    if (typeof id !== 'number' || !Number.isFinite(id)) {
      throw new Error(`${label}: cohort member[${index}] playerId must be a finite number, got ${JSON.stringify(id)} - ids are asserted, never coerced`);
    }
    if (seen.has(id)) {
      // The control evaluator deduplicates with a Set because it only needs a
      // projection domain. The producer must not: section 8.6.4 requires the
      // duplicate scan on the RAW playerIds array of every fresh arm BEFORE a
      // Map is built, and a silent dedupe here would hand the preflight a
      // clean array while the cohort artifact it was derived from still
      // double-counts that player in every week-level mean.
      throw new Error(`${label}: cohort carries playerId ${id} twice - a duplicate raw id must be rejected before any run is generated (section 8.6.4), never deduplicated`);
    }
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) throw new Error(`${label}: cohort week has no members`);
  return ids;
}

/** The projection object one run holds for a player, or null. Accepts either shape a run's `projections` may take. */
function projectionFor(run, playerId) {
  const map = run && run.projections;
  if (map instanceof Map) {
    const found = map.get(playerId);
    return found === undefined ? null : found;
  }
  if (map && typeof map === 'object') {
    const found = map[playerId];
    return found === undefined ? null : found;
  }
  return null;
}

/**
 * A run's projections as a numeric-keyed Map, for `armWeekEvaluator` (which
 * requires numeric keys and rejects string ones).
 *
 * When `playerIds` is supplied (every SCORED collection - the 8 cells under
 * every profile, and both benchmark arms - passes it), two further checks
 * close the two ways QA showed A2's emptiness rejection alone is satisfiable
 * by a defective run:
 *
 *   - EXACT key-set coverage, via the reducer's own exported
 *     `sweepPreflight.assertMapMatchesRawIds` (determination 12's rule:
 *     never a re-implementation). A projection dropped AFTER its baseline
 *     was captured otherwise publishes a silently moved regret - the
 *     coverage posture (risk A, `emitBaselineRows`) already holds that every
 *     cohort player-week reaches the homeAway step, so a scored collection
 *     missing one is incoherent, not sparse.
 *   - a finite median PER ENTRY (`medianOf`'s own tolerance: an object with
 *     a finite `median`, or a bare finite number). A "shell" run - full
 *     numeric key coverage, substance-free values - otherwise passes both
 *     the emptiness and the coverage checks and is scored as the same
 *     all-empty lineup A2 exists to block, indistinguishable in the
 *     document from the legitimate interval-free benchmark shape.
 */
function projectionsMapOf(run, label, { playerIds } = {}) {
  const map = run && run.projections;
  const asMap = (() => {
    if (map instanceof Map) return map;
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      return new Map(Object.entries(map).map(([key, value]) => [Number(key), value]));
    }
    return null;
  })();
  if (!asMap) {
    throw new Error(`${label}: generate() must return a run carrying a projections Map keyed by numeric playerId`);
  }
  // QA finding A2: an empty Map is truthy, and an arm-week evaluated over
  // zero projections publishes an all-empty-lineup regret - on the fixture a
  // ~7x inflation of the prereg 7.2 comparator, in the flattering direction,
  // reading as sparse evidence rather than as absence. Zero projections is a
  // defect of the run, whatever the profile, and it fails here by name.
  if (asMap.size === 0) {
    throw new Error(`${label}: the projections collection is EMPTY - an arm-week that generated nothing must fail by name rather than be scored as an all-empty lineup`);
  }
  if (playerIds) {
    sweepPreflight.assertMapMatchesRawIds({ run: { projections: asMap }, playerIds, label });
    for (const [playerId, projection] of asMap) {
      if (medianOf(projection) === null) {
        throw new Error(
          `${label}: playerId ${playerId}'s projection carries no finite median (${JSON.stringify(projection)}). `
          + 'A projection that reached publication carries a finite round2 median; a substance-free entry would be '
          + 'scored as an empty lineup slot and read as sparse evidence rather than as the broken run it is'
        );
      }
    }
  }
  return asMap;
}

/** The projection's median as a finite number, or null. Mirrors `armWeekEvaluator.intervalRows`' bare-number tolerance. */
function medianOf(projection) {
  if (projection === null || projection === undefined) return null;
  if (typeof projection !== 'object') return isFiniteNumber(projection) ? Number(projection) : null;
  return isFiniteNumber(projection.median) ? Number(projection.median) : null;
}

/** One week's resolved outcome truth, as a lookup that accepts either artifact shape. */
function actualFor(cohortWeek, playerId) {
  const source = cohortWeek.actualPointsByPlayerId;
  return source instanceof Map ? source.get(playerId) : (source || {})[playerId];
}

/**
 * The two sides of a sealed identity record must be DIFFERENT objects (QA:
 * a results-cache keyed on generation inputs returns ONE object for both
 * sides of 8.6.0 - the control and the `usage-25 x off` cell receive
 * identical arguments by design - so all 816 "independent regeneration"
 * records would compare an object against itself and prove nothing, which
 * is verbatim the reuse section 9 forbids). Checked at three depths: the
 * run, its projections collection, and every per-player projection object.
 * A cache that CLONES its hits is undetectable here by construction -
 * genuine regeneration is therefore also a wiring obligation (see the
 * module docblock), and this guard closes the whole non-cloning class.
 */
function assertRunsNotAliased({ leftRun, rightRun, label }) {
  if (leftRun === rightRun) {
    throw new Error(`${label}: the two sides are the SAME run object - one generation reused as its own control is the reuse section 9 forbids, and the identity assertion over it proves nothing`);
  }
  const entriesOf = (run) => {
    const map = run && run.projections;
    if (map instanceof Map) return [...map.entries()];
    if (map && typeof map === 'object' && !Array.isArray(map)) return Object.entries(map);
    return [];
  };
  if (leftRun && rightRun && leftRun.projections && leftRun.projections === rightRun.projections) {
    throw new Error(`${label}: the two sides share one projections collection - one generation reused as its own control is the reuse section 9 forbids`);
  }
  const right = new Map(entriesOf(rightRun));
  for (const [playerId, projection] of entriesOf(leftRun)) {
    if (projection !== null && typeof projection === 'object' && projection === right.get(playerId)) {
      throw new Error(`${label}: playerId ${playerId}'s projection object is SHARED between the two sides - a memoizing harness returned one generation for both, which is the reuse section 9 forbids`);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Captures - each validated at the coordinate that produced it
// ---------------------------------------------------------------------------

/**
 * Record one off-cell generation's `onPreHomeAwayBaseline` callbacks.
 *
 * Three checks that can only be made here, while the cell whose generation
 * produced the callback is still known:
 *
 *   - the callback's own `blendWeight` must be the cell's. The callback
 *     reports the usage blend weight the MODEL actually applied
 *     (`projectionModel.js`'s `usageBlendWeight`), so a mismatch means the
 *     resolved constants never reached the model and this `b` belongs to a
 *     different cell than the row it is about to be filed under. Nothing
 *     downstream can detect that: a well-formed baseline from the wrong cell
 *     is indistinguishable from a right one.
 *   - one call per player-week (section 6.5's contract), so a doubled call
 *     cannot last-wins its way into a different membership.
 *   - `b` must not move between salts. Section 6.3 computes membership once
 *     per `(season, week, blendWeight, playerId)` and reuses it across all
 *     24 salts; the baseline is resolved before the seeded simulation, so a
 *     `b` that varies with the salt means the salt reached the model rather
 *     than only the seed - the same defect `assertSaltAffectsOnlyHashValue`
 *     guards on the input side, caught here on the output side.
 */
function recordBaselines({ captured, cellMeta, season, week, baselineByOffCell, where }) {
  const observed = new Map();
  for (const [index, row] of captured.entries()) {
    const rowLabel = `${where}: onPreHomeAwayBaseline[${index}]`;
    if (!row || typeof row !== 'object') throw new Error(`${rowLabel}: must be a capture object`);
    // ASSERTED, never coerced - the same rule A1 pinned for cohort ids. A
    // bare `Number()` here launders a corrupted row onto a DIFFERENT real
    // player (`Number(true) === 1`, `Number([5]) === 5`), which both
    // fabricates that player's subgroup membership and masks the run-voiding
    // coverage gap left by the player whose own row went missing.
    const playerId = row.playerId;
    if (typeof playerId !== 'number' || !Number.isFinite(playerId)) {
      throw new Error(`${rowLabel}: playerId must be a number, got ${JSON.stringify(row.playerId)} - a coerced id could land on a different real player, fabricating its membership while masking a coverage gap`);
    }
    if (Number(row.season) !== Number(season) || Number(row.week) !== Number(week)) {
      throw new Error(`${rowLabel}: reports ${row.season}w${row.week}, not the week being generated`);
    }
    if (!isFiniteNumber(row.baseline)) {
      throw new Error(`${rowLabel}: baseline must be a finite number, got ${JSON.stringify(row.baseline)} - section 6.5 captures the raw pre-homeAway value b, and a non-finite b has no subgroup membership`);
    }
    // QA finding A3: this comparison is the one guard whose own error text
    // says a well-formed baseline from the wrong cell is undetectable
    // downstream - and a bare Number() here coerces every missing shape to
    // 0, which IS a sealed cell's blend weight (usage-00), and is also
    // production's own fallback when resolved constants fail to reach the
    // model. The coercion would satisfy the guard with exactly the failure
    // it exists to catch, so missing is rejected by name first.
    if (!isFiniteNumber(row.blendWeight)) {
      throw new Error(`${rowLabel}: blendWeight must be a finite number, got ${JSON.stringify(row.blendWeight)} - a missing value would coerce to 0, which is the usage-00 cells' blend weight, so it must never reach the provenance comparison`);
    }
    if (roundToTie(Number(row.blendWeight)) !== roundToTie(cellMeta.blendWeight)) {
      throw new Error(
        `${rowLabel}: reports blendWeight ${JSON.stringify(row.blendWeight)} while the cell being generated is `
        + `${cellMeta.name} (${cellMeta.blendWeight}) - the resolved constants did not reach the model, so this baseline belongs to a different cell`
      );
    }
    if (observed.has(playerId)) {
      throw new Error(`${rowLabel}: onPreHomeAwayBaseline fired twice for playerId ${playerId} - section 6.5 pins exactly one call per player-week`);
    }
    observed.set(playerId, Number(row.baseline));
  }

  const prior = baselineByOffCell.get(cellMeta.name);
  if (!prior) {
    baselineByOffCell.set(cellMeta.name, observed);
    return;
  }
  if (prior.size !== observed.size) {
    throw new Error(`${where}: captured ${observed.size} baselines where an earlier salt captured ${prior.size} - the subgroup domain must not depend on the salt`);
  }
  for (const [playerId, baseline] of observed) {
    if (!prior.has(playerId)) {
      throw new Error(`${where}: playerId ${playerId} has a baseline under this salt but none under ${SALTS[0]} - the subgroup domain must not depend on the salt`);
    }
    if (!Object.is(prior.get(playerId), baseline)) {
      throw new Error(
        `${where}: playerId ${playerId}'s pre-homeAway baseline moved between salts (${prior.get(playerId)} -> ${baseline}). `
        + 'Section 6.3 assigns membership once per (season, week, blendWeight, playerId) and reuses it across all 24 salts; '
        + 'a b that varies with the salt means the salt reached the model, not only the seed'
      );
    }
  }
}

/**
 * `preflight.matchedOffBaselineRows`: one row per (on cell, cohort
 * player-week), carrying the `b` captured in the MATCHED OFF cell.
 *
 * Coverage is total by the reducer's own rule
 * (`assertComponentFVetoCoverage` requires a baseline for every cohort
 * player-week of every on cell), and the callback only fires for
 * player-weeks whose projection reaches the homeAway step - so a
 * short-circuited projection is a run-voiding gap. It is reported HERE, by
 * count and by coordinate, rather than downstream as a coverage-arithmetic
 * mismatch with no cause attached (module docblock, risk A).
 */
function emitBaselineRows({ onCells, matchedOffNameFor, baselineByOffCell, playerIds, season, week, matchedOffBaselineRows, where }) {
  for (const cellMeta of onCells) {
    const offName = matchedOffNameFor(cellMeta);
    const baselines = baselineByOffCell.get(offName);
    // Empty and partial are separated deliberately: a generator that never
    // forwards the callback produces the SAME arithmetic shortfall as one
    // whose players short-circuit, and only the first has a cause the
    // operator can act on. Reporting both as "n of n missing" would send a
    // wiring bug looking for a data explanation.
    if (!baselines || baselines.size === 0) {
      throw new Error(`${where}: no pre-homeAway baselines were captured in ${offName}, the cell matched to ${cellMeta.name} - the generator did not forward onPreHomeAwayBaseline into generateProjections`);
    }
    const missing = playerIds.filter((playerId) => !baselines.has(playerId));
    if (missing.length > 0) {
      throw new Error(
        `${where}: ${missing.length} of ${playerIds.length} cohort player-weeks produced no pre-homeAway baseline in ${offName} `
        + `(first: ${missing.slice(0, 5).join(', ')}). onPreHomeAwayBaseline fires only for a projection that REACHES the homeAway step, `
        + 'and the preflight requires a baseline for every cohort player-week of every on cell, so this week cannot produce a valid document'
      );
    }
    for (const playerId of playerIds) {
      matchedOffBaselineRows.push({
        cellName: cellMeta.name, season, week, playerId, baseline: baselines.get(playerId),
      });
    }
  }
}

/**
 * `subgroupErrorRows`: the section 6.1 error pair for every subgroup
 * player-week x salt. `errorOn`/`errorOff` are `round2(median) - actual` for
 * the on cell and its matched off cell at the SAME salt (sealed section
 * 6.1's own definition - see the withdrawn determination 6 above);
 * membership is `b <= 0` in the matched off cell AND prereg-4.1 eligibility
 * (`sweepPreflight.componentFSubgroupEligible` - the A4 membership ruling,
 * 2026-08-08: a bye or non-macro member has no scored endpoint row, so its
 * exactly-zero error pair leaves the subgroup instead of diluting D_w), the
 * exact conjunction `inputsAssembly.deriveSubgroupDomain` re-derives from
 * the same baseline and roster rows - so the layers cannot disagree about
 * who is in the subgroup. Baseline COVERAGE stays total over the whole
 * cohort (`emitBaselineRows` above, risk A), and the permutation domain
 * keeps its byes (determination 8): only the subgroup narrows.
 *
 * Emitted in ascending-playerId then `SALTS` order. The assembly layer pins
 * the document's own realization order, so this is determinism for its own
 * sake rather than a load-bearing contract.
 */
function emitSubgroupErrorRows({
  onCells, matchedOffNameFor, baselineByOffCell, mediansByCellSalt, keyOf, cohortWeek, playerIds, season, week, subgroupErrorRows, where,
}) {
  const eligibleById = new Map();
  for (const [index, member] of (cohortWeek.members || []).entries()) {
    if (!member || member.playerId !== playerIds[index]) {
      throw new Error(`${where}: cohort member[${index}] does not align with the week's playerIds - subgroup eligibility must be read off the same members the ids came from`);
    }
    eligibleById.set(playerIds[index], sweepPreflight.componentFSubgroupEligible(member, `${where}: cohort member[${index}]`));
  }
  for (const cellMeta of onCells) {
    const offName = matchedOffNameFor(cellMeta);
    const baselines = baselineByOffCell.get(offName);
    const domain = playerIds.filter((playerId) => baselines.get(playerId) <= 0 && eligibleById.get(playerId) === true).sort((a, b) => a - b);
    for (const playerId of domain) {
      const actual = actualFor(cohortWeek, playerId);
      if (!isFiniteNumber(actual)) {
        throw new Error(`${where}: subgroup member ${playerId} has no finite resolved outcome (${JSON.stringify(actual)}); section 6.1's error is projected - actual, so a missing actual has no error rather than a zero one`);
      }
      for (const salt of SALTS) {
        const onMedian = mediansByCellSalt.get(keyOf(cellMeta.name, salt)).get(playerId);
        const offMedian = mediansByCellSalt.get(keyOf(offName, salt)).get(playerId);
        for (const [side, value] of [['on', onMedian], ['off', offMedian]]) {
          if (!isFiniteNumber(value)) {
            throw new Error(
              `${where}: subgroup member ${playerId} has no finite ${side}-cell median under salt ${salt} (${JSON.stringify(value)}). `
              + 'It has a pre-homeAway baseline, so its projection reached the homeAway step; a median that is missing anyway is a defect of the run, not a sparse week'
            );
          }
        }
        subgroupErrorRows.push({
          cellName: cellMeta.name,
          season,
          week,
          playerId,
          salt,
          errorOn: round2(onMedian) - Number(actual),
          errorOff: round2(offMedian) - Number(actual),
        });
      }
    }
  }
}

/**
 * `activationRecords`: the on-cells' own projection objects, grouped by
 * macro position, from the reference salt (determination 5). Every other
 * salt's (eligible, activated) verdict is checked against the reference's
 * per player: the determination rests on activation being resolved before
 * the seeded simulation, and that is a property of the model this module can
 * actually observe rather than one it has to assume.
 */
function emitActivationRecords({ onCells, activationByCellSalt, keyOf, cohortWeek, season, week, activationRecords, where }) {
  const referenceSalt = SALTS[0];
  for (const cellMeta of onCells) {
    const reference = activationByCellSalt.get(keyOf(cellMeta.name, referenceSalt));
    for (const salt of SALTS) {
      if (salt === referenceSalt) continue;
      const other = activationByCellSalt.get(keyOf(cellMeta.name, salt));
      for (const [playerId, projection] of reference) {
        const alternative = other.get(playerId);
        const same = arms.isActivated(projection) === arms.isActivated(alternative)
          && arms.isEligibleForActivation(projection) === arms.isEligibleForActivation(alternative);
        if (!same) {
          throw new Error(
            `${where}: ${cellMeta.name}'s activation verdict for playerId ${playerId} differs between salts ${referenceSalt} and ${salt}. `
            + 'Activation is resolved before the seeded simulation, so it must be salt-invariant; publishing one salt\'s projections '
            + '(the counts prereg 11 requires would otherwise be multiplied by 24) is only sound while that holds'
          );
        }
      }
    }
    for (const position of MACRO_POSITIONS) {
      const projections = cohortWeek.members
        .filter((member) => member.position === position)
        .map((member) => {
          const found = reference.get(Number(member.playerId));
          return found === undefined ? null : found;
        });
      activationRecords.push({
        cell: cellMeta.name, season, week, position, projections,
      });
    }
  }
}

/**
 * Re-evaluate one scored arm-week under every sensitivity configuration
 * (increment 5): the SAME projections, roster and cohort artifacts, with only
 * the evaluation knob changed - prereg 5.2's two ordering variants move the
 * candidate order the optimizer resolves ties by, prereg 5.3's force-fill
 * estimand changes what a legal lineup is. Only `regret` may move: every
 * other endpoint is computed from projections and actuals with no lineup in
 * between, and that invariant is ASSERTED per endpoint (`Object.is`, so
 * null/NaN states compare honestly) rather than assumed - a sensitivity knob
 * that reaches pairwise or the point metrics has leaked past the lineup
 * solve, which is a defect of the evaluator, not a sensitivity finding.
 */
function evaluateSensitivityVariants({ evaluateArgs, primaryEvaluation, where }) {
  const byKey = {};
  for (const pass of inputsSensitivity.SENSITIVITY_PASSES) {
    const evaluation = armWeekEvaluator.evaluateArmWeek({
      ...evaluateArgs, ordering: pass.ordering, estimand: pass.estimand, label: `${where} ${pass.key}`,
    });
    for (const endpoint of Object.keys(primaryEvaluation.values)) {
      if (endpoint === 'regret') continue;
      if (!Object.is(primaryEvaluation.values[endpoint], evaluation.values[endpoint])) {
        throw new Error(
          `${where}: sensitivity configuration ${pass.key} moved endpoint '${endpoint}' `
          + `(${JSON.stringify(primaryEvaluation.values[endpoint])} -> ${JSON.stringify(evaluation.values[endpoint])}). `
          + 'Only regret is lineup-dependent; every other endpoint must be bit-identical across the sensitivity passes'
        );
      }
    }
    byKey[pass.key] = evaluation;
  }
  return byKey;
}

/**
 * `preflight.saltSeedRecords`: the 24 final seeds each cohort player-week
 * actually used, per cell, with the section 3.4.5 collision check run HERE
 * as well as in the reducer's preflight - "aborting the sweep the instant a
 * real collision is detected" is a runtime requirement, and the reducer runs
 * hours later on a document that would by then be complete.
 *
 * The check runs for EVERY generated profile (QA finding S1): the sealed
 * runtime guard is mandatory "for EVERY evaluated player-week it actually
 * computes" (section 3.4's runtime level), and each sensitivity profile
 * derives its own seed stream from its own scoring hash, so a primary-only
 * check would leave 6,528 generations' seeds unexamined on streams the
 * primary's pass never touches. RECORDS are emitted for the primary profile
 * only (`saltSeedRecords` is null otherwise): the closed document schema
 * carries no `scoringProfile` field on a salt-seed row and so cannot express
 * the sensitivity streams - their check is generation-time-only, which is
 * the only place it can happen.
 *
 * `seedFrom(modelVersion, hashValue, season, week, playerId)` takes no cell
 * argument, so the eight per-cell records of one player-week are the SAME
 * map by construction rather than eight computations; one object is built
 * and shared across the eight records. The preflight's cell x player-week
 * coverage requirement is therefore satisfied structurally - worth stating
 * plainly, because a reader could otherwise take that coverage check to be
 * evidence the seeds were confirmed to differ per cell, which they are not
 * and are not supposed to.
 */
function emitSaltSeedRecords({ scoringHash, seedFor, playerIds, season, week, saltSeedRecords, where }) {
  // The salted hashValue depends on the salt and the profile only, never on
  // the player - composed once per salt so the whole cohort's seeds are
  // derived from the identical strings the generations used.
  const hashBySalt = Object.fromEntries(SALTS.map((salt) => [salt, arms.composeSaltedHashValue({ scoringHash, salt, label: `${where} seed ${salt}` })]));
  for (const playerId of playerIds) {
    const seedsBySalt = {};
    for (const salt of SALTS) {
      const seed = seedFor({ hashValue: hashBySalt[salt], season, week, playerId });
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
        throw new Error(`${where}: seedFor returned ${JSON.stringify(seed)} for playerId ${playerId} under ${salt}; a final seed must be an unsigned 32-bit integer`);
      }
      seedsBySalt[salt] = seed;
    }
    arms.assertSaltsProduceDistinctSeeds({ seedsBySalt, label: `${where}: playerId ${playerId} salt seeds` });
    if (saltSeedRecords) {
      for (const cell of arms.ALL_CELLS) {
        saltSeedRecords.push({
          cellName: cell.name, season, week, playerId, seedsBySalt,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * Walk the sealed grid and return the raw records `assembleSweepInputs`
 * consumes.
 *
 * Injected seam - every one of these is the caller's, and none of them is
 * required from this file:
 *
 *   - `weekArtifacts`: `Map`/object keyed `"<season>:<week>"` holding
 *     `{ rosterWeek, cohortWeek, positionRank, nameRankById }`, exactly the
 *     shape `run-backtest-mde.js` builds from the frozen Commit-A artifacts.
 *     Every `(season, week)` the plan reaches must be present.
 *   - `baseConstants`: `model.MODEL_CONSTANTS`. Per-arm constants are
 *     resolved HERE, by `arms.resolveConstants` /
 *     `arms.resolveConstantsWithStoredHistory`, so no caller can hand a cell
 *     the wrong ones.
 *   - `scoringHashFor(scoringProfile)`: the profile's scoring hash
 *     (`model.scoringHash(SCORING_PRESETS[profile])`). Salting is done here
 *     by `arms.composeSaltedHashValue`.
 *   - `generate({ scoringProfile, season, week, playerIds, hashValue,
 *     modelConstants, weatherService, onPreHomeAwayBaseline })` -> the
 *     `generateProjections` return object `{ projections: Map, inputCutoff,
 *     sourceCoverage }`. `weatherService` arrives as the literal `false` on
 *     every call (QA finding A5); the wiring must still pin its own literal
 *     rather than trust the argument. See the module docblock's two
 *     obligations.
 *   - `seedFor({ hashValue, season, week, playerId })` -> the final unsigned
 *     32-bit seed that generation used (`model.seedFrom(MODEL_VERSION,
 *     hashValue, season, week, playerId)`).
 *   - `benchmarkProjectionsFor({ season, week, playerIds })` -> an object
 *     keyed by the two `inputsAssembly.BENCHMARK_ARMS` names, each a
 *     projections Map (`lib/naive.benchmarksFor`, gathered per player).
 *   - `availabilityFor` / `optimize`: production's wrapper and optimizer,
 *     forwarded to `armWeekEvaluator` unchanged.
 */
async function generateSweepInputRecords({
  weekArtifacts,
  baseConstants,
  scoringHashFor,
  generate,
  seedFor,
  benchmarkProjectionsFor,
  availabilityFor,
  optimize,
  profiles = GENERATION_PROFILES,
  label = 'inputs generation',
}) {
  for (const [name, fn] of [
    ['scoringHashFor', scoringHashFor], ['generate', generate], ['seedFor', seedFor],
    ['benchmarkProjectionsFor', benchmarkProjectionsFor], ['availabilityFor', availabilityFor], ['optimize', optimize],
  ]) {
    if (typeof fn !== 'function') throw new Error(`${label}: ${name} must be injected`);
  }
  if (!baseConstants || typeof baseConstants !== 'object') throw new Error(`${label}: baseConstants must be injected`);
  for (const profile of profiles) {
    if (!SCORING_PROFILE_NAMES.includes(profile)) {
      throw new Error(`${label}: ${JSON.stringify(profile)} is not a sealed scoring profile (${SCORING_PROFILE_NAMES.join(', ')})`);
    }
  }

  // QA finding A6: the profiles' scoring hashes ARE their seed streams -
  // every final seed derives from the salted hash - so a constant-returning
  // `scoringHashFor` would run the whole grid on ONE stream while publishing
  // three profiles' results. Computed and checked pairwise-distinct up
  // front, before any generation is paid for.
  const scoringHashByProfile = new Map();
  for (const scoringProfile of profiles) {
    const scoringHash = scoringHashFor(scoringProfile);
    if (typeof scoringHash !== 'string' || !/^[0-9a-f]+$/.test(scoringHash)) {
      throw new Error(`${label}: scoringHashFor(${JSON.stringify(scoringProfile)}) must return a lowercase hexadecimal scoring hash`);
    }
    for (const [other, otherHash] of scoringHashByProfile) {
      if (otherHash === scoringHash) {
        throw new Error(`${label}: scoringHashFor returned the identical hash for ${JSON.stringify(other)} and ${JSON.stringify(scoringProfile)} - the profiles' seed streams must be distinct, or the whole grid runs on one stream while publishing three`);
      }
    }
    scoringHashByProfile.set(scoringProfile, scoringHash);
  }

  const armWeekMetrics = [];
  // One full armWeekMetrics array per sensitivity configuration (increment
  // 5) - same universe, same record shape, only the evaluation knob moved.
  const armWeekMetricsBySensitivity = Object.fromEntries(
    inputsSensitivity.SENSITIVITY_PASSES.map((pass) => [pass.key, []])
  );
  const subgroupErrorRows = [];
  const activationRecords = [];
  const cohortRosterRows = [];
  const controlUsage25Records = [];
  const homeAwayStoredRecords = [];
  const saltSeedRecords = [];
  const matchedOffBaselineRows = [];
  // A const holder rather than a `let` counter: `runFor` below is declared
  // inside the salt loop, and a loop-scoped closure over a REASSIGNED outer
  // binding is exactly the shape `no-loop-func` exists to flag.
  const runCounter = { generations: 0 };

  const onCells = arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on');
  const matchedOffNameFor = (cell) => arms.cellName({ blendWeight: cell.blendWeight, homeAway: 'off' });
  const artifactFor = (season, week, where) => {
    const key = `${season}:${week}`;
    const found = weekArtifacts instanceof Map ? weekArtifacts.get(key) : (weekArtifacts || {})[key];
    if (!found) throw new Error(`${where}: no roster/cohort artifacts supplied for ${key} - every evaluated season-week is required`);
    return found;
  };

  for (const scoringProfile of profiles) {
    const isPrimary = scoringProfile === PRIMARY_SCORING_PROFILE;
    const scoringHash = scoringHashByProfile.get(scoringProfile);

    for (const season of seasonsFor(scoringProfile)) {
      for (const week of EVALUATED_WEEKS) {
        const where = `${label} ${scoringProfile} ${season}w${week}`;
        const { rosterWeek, cohortWeek, positionRank, nameRankById } = artifactFor(season, week, where);
        const playerIds = cohortPlayerIds(cohortWeek, where);

        // The cohort domain is a property of the SEASON-WEEK, not of a
        // scoring profile: the sensitivity profiles revisit 2025's weeks and
        // must not re-append them (a duplicate player-week is exactly what
        // `deriveCohortPlayerWeeks` rejects).
        if (isPrimary) {
          // Rows carry the two prereg-4.1 eligibility facts alongside the
          // identity, because section 6.3's subgroup membership (the A4
          // ruling) is derived from these rows at every later layer - the
          // assembly, the reducer's operands, and the preflight's veto
          // coverage - and a row without them fails those layers by name.
          // Both fields are copied raw off the frozen artifact's member and
          // validated where membership is decided, never coerced here.
          for (const [index, member] of (cohortWeek.members || []).entries()) {
            if (!member || member.playerId !== playerIds[index]) {
              throw new Error(`${where}: cohort member[${index}] does not align with the week's playerIds - roster rows must carry the same members the ids came from`);
            }
            cohortRosterRows.push({
              season, week, playerId: playerIds[index], position: member.position, onBye: member.onBye,
            });
          }
        }

        // Per-week buffers, released when the week ends. Medians are kept for
        // every cell so the on/off subgroup pairing below is formed from
        // stored evidence rather than from an assumption about which cell the
        // loop visited first.
        const mediansByCellSalt = new Map();
        const baselineByOffCell = new Map();
        const activationByCellSalt = new Map();
        const runInputsByArm = new Map();
        const keyOf = (name, salt) => `${name}|${salt}`;
        // Slice boundaries for THIS week's identity records, so the
        // generation-time identity assertions below (determination 12)
        // run over exactly the 24 salts this week produced.
        const identityRecordStart = {
          controlUsage25: controlUsage25Records.length,
          homeAwayStored: homeAwayStoredRecords.length,
        };

        for (const salt of SALTS) {
          const hashValue = arms.composeSaltedHashValue({ scoringHash, salt, label: `${where} ${salt}` });
          // The two primary-grid runs each sealed identity assertion compares
          // AGAINST, held only for this salt's iteration. Declared per salt so
          // a record can never be paired with a previous salt's run: the
          // assertion is defined per (season, week, salt), and a cross-salt
          // pairing would compare two different seeds' output and read as a
          // harness failure.
          const identityHold = { onRun: null, usage25OffRun: null };

          const runFor = async ({ arm, cellMeta, useStoredHistory, captureBaseline }) => {
            const modelConstants = useStoredHistory
              ? arms.resolveConstantsWithStoredHistory({ cell: cellMeta, baseConstants, label: `${where} ${arm}` })
              : arms.resolveConstants({ cell: cellMeta, baseConstants, label: `${where} ${arm}` });

            // Section 3.4 item 6's operand: the generation INPUTS, recorded
            // per salt, so `assertSaltAffectsOnlyHashValue` at the end of the
            // week checks what the runs were actually asked for rather than
            // re-deriving it from one of them.
            if (!runInputsByArm.has(arm)) runInputsByArm.set(arm, {});
            runInputsByArm.get(arm)[salt] = {
              scoringProfile, season, week, playerIds, modelConstants, weatherService: false, hashValue,
            };

            const captured = captureBaseline ? [] : null;
            const onPreHomeAwayBaseline = captureBaseline
              ? (row) => { captured.push(row); }
              : undefined;
            const run = await generate({
              // `weatherService: false` is passed for real (QA finding A5),
              // so the `runInputsByArm` record above describes an input that
              // was actually sent; the wiring still pins its own literal.
              scoringProfile, season, week, playerIds, hashValue, modelConstants, weatherService: false, onPreHomeAwayBaseline,
            });
            runCounter.generations += 1;
            if (!run || typeof run !== 'object') throw new Error(`${where} ${arm} ${salt}: generate() must return a run object`);
            if (captured) recordBaselines({ captured, cellMeta, season, week, baselineByOffCell, where: `${where} ${arm} ${salt}` });
            return { run, modelConstants };
          };

          for (const cellMeta of arms.ALL_CELLS) {
            const isOff = cellMeta.homeAway === 'off';
            // eslint-disable-next-line no-await-in-loop
            const { run, modelConstants } = await runFor({
              arm: cellMeta.name,
              cellMeta,
              useStoredHistory: false,
              // The baseline is captured in the MATCHED OFF CELL and only
              // under the primary profile: the (f) veto is a half_ppr
              // estimand, and a sensitivity profile's baselines would be a
              // second, differently-priced membership rule for one subgroup.
              captureBaseline: isOff && isPrimary,
            });
            const projections = projectionsMapOf(run, `${where} ${cellMeta.name} ${salt}`, { playerIds });

            const evaluateArgs = {
              season,
              week,
              rosterWeek,
              cohortWeek,
              projectionsByPlayerId: projections,
              positionRank,
              nameRankById,
              availabilityFor,
              optimize,
            };
            const evaluation = armWeekEvaluator.evaluateArmWeek({
              ...evaluateArgs, label: `${where} ${cellMeta.name} ${salt}`,
            });
            armWeekMetrics.push(armWeekEvaluator.toArmWeekMetricsRecord({
              scoringProfile, arm: cellMeta.name, salt, evaluation, label: `${where} ${cellMeta.name} ${salt}`,
            }));
            const variantEvaluations = evaluateSensitivityVariants({
              evaluateArgs, primaryEvaluation: evaluation, where: `${where} ${cellMeta.name} ${salt}`,
            });
            for (const pass of inputsSensitivity.SENSITIVITY_PASSES) {
              armWeekMetricsBySensitivity[pass.key].push(armWeekEvaluator.toArmWeekMetricsRecord({
                scoringProfile, arm: cellMeta.name, salt, evaluation: variantEvaluations[pass.key], label: `${where} ${cellMeta.name} ${salt} ${pass.key}`,
              }));
            }

            if (isPrimary) {
              // Medians for the (f) subgroup pairing, and the on-cells'
              // projection objects for activation - both extracted now, so
              // the run itself can be released with the loop iteration.
              mediansByCellSalt.set(keyOf(cellMeta.name, salt), new Map(playerIds.map(
                (playerId) => [playerId, medianOf(projectionFor(run, playerId))]
              )));
              if (cellMeta.homeAway === 'on') {
                activationByCellSalt.set(keyOf(cellMeta.name, salt), new Map(playerIds.map(
                  (playerId) => [playerId, projectionFor(run, playerId)]
                )));
              }
              if (cellMeta.name === STORED_TWIN_CELL) {
                identityHold.onRun = run;
                identityHold.onConstants = modelConstants;
              }
              if (cellMeta.name === USAGE25_OFF_CELL) identityHold.usage25OffRun = run;
            }
          }

          if (isPrimary) {
            // eslint-disable-next-line no-await-in-loop
            const twin = await runFor({
              arm: STORED_TWIN_ARM,
              cellMeta: arms.ALL_CELLS.find((cell) => cell.name === STORED_TWIN_CELL),
              useStoredHistory: true,
              captureBaseline: false,
            });
            // eslint-disable-next-line no-await-in-loop
            const independentControl = await runFor({
              arm: INDEPENDENT_CONTROL_ARM,
              cellMeta: arms.ALL_CELLS.find((cell) => cell.name === arms.CONTROL_CELL),
              useStoredHistory: false,
              captureBaseline: false,
            });

            // Both sides of both assertions must be THIS salt's runs. The
            // holds are filled by the `arms.ALL_CELLS` pass immediately
            // above, so an empty one means that pass no longer generates a
            // cell the assertions are defined over - which would otherwise
            // surface as an identity record carrying `leftRun: null` and a
            // preflight failure blaming the harness.
            if (!identityHold.usage25OffRun || !identityHold.onRun) {
              throw new Error(`${where} ${salt}: the primary grid did not produce ${USAGE25_OFF_CELL} and ${STORED_TWIN_CELL}, the two runs the sealed identity assertions compare against`);
            }
            // Section 8.6.0: LEFT is the independently generated control,
            // RIGHT is the primary grid's own `usage-25 x off` cell. The two
            // must never be the same object - that is the whole point of the
            // 816 extra runs. The injected `generate` IS a path by which they
            // could become one (a results-cache keyed on generation inputs
            // collapses exactly this pair, since both sides receive identical
            // arguments), so aliasing is REJECTED here rather than assumed
            // away.
            assertRunsNotAliased({
              leftRun: independentControl.run,
              rightRun: identityHold.usage25OffRun,
              label: `${where} ${salt}: 8.6.0 sides`,
            });
            assertRunsNotAliased({
              leftRun: identityHold.onRun,
              rightRun: twin.run,
              label: `${where} ${salt}: 8.6.1 sides`,
            });
            // Records are pushed in the SERIALIZATION-SAFE form (projections
            // as a raw array, `sweepPreflight.serializableProjectionRun`):
            // a production run carries a Map, and `canonicalJson` writes any
            // Map as `{}` SILENTLY - so Map-carrying records would reach the
            // `--records-out` checkpoint and the final document as 1,632
            // empty run sides the reducer's preflight then voids. The
            // aliasing guard above ran on the ORIGINAL objects, before this
            // conversion mints copies.
            controlUsage25Records.push({
              season,
              week,
              salt,
              leftRun: sweepPreflight.serializableProjectionRun(independentControl.run, `${where} ${salt}: 8.6.0 left`),
              rightRun: sweepPreflight.serializableProjectionRun(identityHold.usage25OffRun, `${where} ${salt}: 8.6.0 right`),
              leftPlayerIds: playerIds,
              rightPlayerIds: playerIds,
            });
            // Section 8.6.1: LEFT is `homeaway-on` (the shipped-usage on
            // cell from the primary grid), RIGHT is its stored-history twin.
            // The constants each was ACTUALLY built with travel with the
            // record, because the single-leaf guard must run on the evidence
            // rather than on a re-derivation of itself.
            homeAwayStoredRecords.push({
              season,
              week,
              salt,
              leftRun: sweepPreflight.serializableProjectionRun(identityHold.onRun, `${where} ${salt}: 8.6.1 left`),
              rightRun: sweepPreflight.serializableProjectionRun(twin.run, `${where} ${salt}: 8.6.1 right`),
              leftPlayerIds: playerIds,
              rightPlayerIds: playerIds,
              leftConstants: identityHold.onConstants,
              rightConstants: twin.modelConstants,
            });
          }
        }

        // --- end-of-week reductions -------------------------------------

        if (isPrimary) {
          // The two sealed identity assertions (8.6.0/8.6.1), run AT
          // GENERATION TIME over this week's full 24-salt domain via the
          // reducer's own exported preflight assertions - never a
          // re-implementation (determination 12; QA finding S2). The
          // reducer still re-runs them from the document; this is the
          // early abort the sealed rationale asks for, so a broken harness
          // is discovered at the first week rather than after the grid.
          sweepPreflight.assertIdentityCoverage({
            cohortRosterRows: playerIds.map((playerId) => ({ season, week, playerId })),
            controlUsage25Records: controlUsage25Records.slice(identityRecordStart.controlUsage25),
            homeAwayStoredRecords: homeAwayStoredRecords.slice(identityRecordStart.homeAwayStored),
            label: `${where} generation-time identity`,
          });
        }

        for (const [arm, runsBySalt] of runInputsByArm.entries()) {
          arms.assertSaltAffectsOnlyHashValue({ runsBySalt, label: `${where} ${arm} salt inputs` });
        }

        // The runtime salt-seed guard runs for EVERY profile (QA finding
        // S1) - each profile's stream derives from its own scoring hash -
        // while records are emitted for the primary alone, the only stream
        // the closed schema can express.
        emitSaltSeedRecords({
          scoringHash, seedFor, playerIds, season, week,
          saltSeedRecords: isPrimary ? saltSeedRecords : null,
          where,
        });

        if (isPrimary) {
          // Benchmarks (prereg 7.2): salt-free generation, published under
          // all 24 salts (determination 4).
          // eslint-disable-next-line no-await-in-loop
          const benchmarks = await benchmarkProjectionsFor({ season, week, playerIds });
          for (const arm of inputsAssembly.BENCHMARK_ARMS) {
            const projections = benchmarks && benchmarks[arm];
            if (!projections) throw new Error(`${where}: benchmarkProjectionsFor returned no ${arm} projections`);
            const evaluateArgs = {
              season,
              week,
              rosterWeek,
              cohortWeek,
              projectionsByPlayerId: projectionsMapOf({ projections }, `${where} ${arm}`, { playerIds }),
              positionRank,
              nameRankById,
              availabilityFor,
              optimize,
            };
            const evaluation = armWeekEvaluator.evaluateArmWeek({
              ...evaluateArgs, label: `${where} ${arm}`,
            });
            // The benchmarks participate in the sensitivity passes on the
            // same terms as the cells: component (d) contrasts every
            // candidate against naive-recency's regret, so a variant
            // document with primary-ordering benchmark rows would compare a
            // variant lineup against a primary one and call the difference
            // evidence. Evaluated once (determination 4's salt-free rule),
            // published under all 24 salts, per pass.
            const variantEvaluations = evaluateSensitivityVariants({
              evaluateArgs, primaryEvaluation: evaluation, where: `${where} ${arm}`,
            });
            for (const salt of SALTS) {
              armWeekMetrics.push(armWeekEvaluator.toArmWeekMetricsRecord({
                scoringProfile, arm, salt, evaluation, label: `${where} ${arm} ${salt}`,
              }));
              for (const pass of inputsSensitivity.SENSITIVITY_PASSES) {
                armWeekMetricsBySensitivity[pass.key].push(armWeekEvaluator.toArmWeekMetricsRecord({
                  scoringProfile, arm, salt, evaluation: variantEvaluations[pass.key], label: `${where} ${arm} ${salt} ${pass.key}`,
                }));
              }
            }
          }

          emitBaselineRows({
            onCells, matchedOffNameFor, baselineByOffCell, playerIds, season, week, matchedOffBaselineRows, where,
          });
          emitSubgroupErrorRows({
            onCells, matchedOffNameFor, baselineByOffCell, mediansByCellSalt, keyOf,
            cohortWeek, playerIds, season, week, subgroupErrorRows, where,
          });
          emitActivationRecords({
            onCells, activationByCellSalt, keyOf, cohortWeek, season, week, activationRecords, where,
          });
        }
      }
    }
  }

  // Every sensitivity configuration must carry the identical record universe
  // - a pass that silently skipped an arm-week would assemble into a variant
  // document `indexArmWeekMetrics` rejects hours later, with no cause
  // attached to the coordinate that skipped.
  for (const pass of inputsSensitivity.SENSITIVITY_PASSES) {
    if (armWeekMetricsBySensitivity[pass.key].length !== armWeekMetrics.length) {
      throw new Error(
        `${label}: sensitivity pass ${pass.key} produced ${armWeekMetricsBySensitivity[pass.key].length} records `
        + `against the primary's ${armWeekMetrics.length} - the variant universes must be identical`
      );
    }
  }

  return {
    armWeekMetrics,
    armWeekMetricsBySensitivity,
    subgroupErrorRows,
    activationRecords,
    preflight: {
      cohortRosterRows,
      controlUsage25Records,
      homeAwayStoredRecords,
      saltSeedRecords,
      matchedOffBaselineRows,
    },
    counts: {
      generations: runCounter.generations,
      armWeekMetrics: armWeekMetrics.length,
      armWeekMetricsBySensitivity: Object.fromEntries(
        inputsSensitivity.SENSITIVITY_PASSES.map((pass) => [pass.key, armWeekMetricsBySensitivity[pass.key].length])
      ),
      subgroupErrorRows: subgroupErrorRows.length,
      activationRecords: activationRecords.length,
      cohortRosterRows: cohortRosterRows.length,
      controlUsage25Records: controlUsage25Records.length,
      homeAwayStoredRecords: homeAwayStoredRecords.length,
      saltSeedRecords: saltSeedRecords.length,
      matchedOffBaselineRows: matchedOffBaselineRows.length,
    },
  };
}

module.exports = {
  PRIMARY_SEASON,
  SAFETY_SEASON,
  PRIMARY_SEASONS,
  SENSITIVITY_SEASONS,
  GENERATION_PROFILES,
  GENERATION_KINDS,
  GRID_TOTAL,
  STORED_TWIN_ARM,
  INDEPENDENT_CONTROL_ARM,
  STORED_TWIN_CELL,
  USAGE25_OFF_CELL,
  seasonsFor,
  buildGenerationPlan,
  round2,
  cohortPlayerIds,
  evaluateSensitivityVariants,
  generateSweepInputRecords,
};
