/* eslint-disable no-console */
'use strict';

/**
 * The GENERATION SEAM the producer's remaining increments share: walk the
 * sealed section-9 grid and write the raw generation records
 * `inputsAssembly.assembleSweepInputs` consumes.
 *
 * WHY THIS LANDS BEFORE INCREMENT 4, NOT AFTER IT
 *
 * Increment 3's handoff scheduled this wiring last, as increment 5, on the
 * reading that it is thin and that nothing needs it until the `--inputs`
 * document can be assembled. That ordering does not survive
 * `lib/permutationControl.js`: `canonicalObservations` requires every
 * observation row to carry a finite `projected` (`:209`), complete across
 * 2025's 17 weeks x 24 salts x 6 macro positions x every cohort member in
 * each cell, with fail-closed coverage assertions behind it (`:222-232`).
 *
 * That field is a GENERATED projection, and it is needed PER SALT. Nothing
 * existing produces it: `run-backtest-mde.js` generates the control cell
 * against a reconstructed snapshot but UNSALTED (one
 * `model.scoringHash(SCORING_RULES)`, because the MDE is blinded and
 * control-only), and increment 3's handoff explicitly declines to reuse the
 * sweep's own runs ("NO reuse of the permutation control's artifact is taken,
 * so the grid stays 14,688 rather than 13,872, and increment 4 is free to
 * generate its own").
 *
 * So increment 4 must run its own 24-salt control generation against a
 * reconstructed snapshot client - which is exactly `makeGenerate`, the
 * per-season reconstruction, and the snapshot-client wiring below. This file
 * is therefore a PREREQUISITE for increment 4 and increment 5 alike, not a
 * successor to either. It is deliberately scoped to the seam both need and
 * carries no assembly of its own.
 *
 * WHY THIS FILE LIVES UNDER server/scripts/, NOT scripts/backtest/
 *
 * Identical reasoning to `run-backtest-mde.js`: `lib/inputsGeneration.js` is
 * pure and takes `generate`/`seedFor`/`benchmarkProjectionsFor` as ARGUMENTS;
 * something has to be those functions, and that something is
 * `projection.service.generateProjections` against a reconstructed snapshot
 * client, `projectionModel.seedFrom`, and `lib/naive` over a rescored
 * prior-game history - all of which reach `server/services/*`, which
 * `scripts/backtest/**` may not require. This file is that wiring and nothing
 * more: every decision worth reviewing (the grid, the captures, the identity
 * assertions, the per-arm-week scoring) lives in the pure, tested modules
 * this file calls.
 *
 * WHAT IT WRITES: the COMPLETE `--inputs` DOCUMENT (since increment 5)
 *
 * Since increment 4 this script captures the permutation control too
 * (`lib/inputsPermutationCapture` - 408 further control-cell generations,
 * additional to the 14,688 grid, no reuse in either direction). Increment 5
 * closed the remaining gap: the sensitivity comparison passes
 * (`lib/inputsSensitivity` - prereg 5.2's two ordering variants and prereg
 * 5.3's force-fill estimand, each a variant document evaluated through the
 * REDUCER'S OWN exported claim assembly) now produce
 * `orderingSensitivityByCell` and the two disagreement booleans;
 * `canariesPassed` comes from the real canary probes run IN THIS PROCESS
 * before anything is generated (see THE CANARIES below); `studyId` is the
 * sealed study id. `--out` therefore receives the complete, validated
 * `--inputs` document - the interface the sealed schema actually names.
 *
 * `--records-out`, OPTIONAL, additionally writes the intermediate
 * generation-records checkpoint (the artifact increments 3-4 wrote as
 * `--out`). Whether that checkpoint should exist AT ALL is producer-side
 * DETERMINATION 7 and rides with the B3 deferral batch - NOT settled here:
 * the flag is optional precisely so both answers remain available. The case
 * for it is run economics - generation is 14,688 real projection runs plus
 * the permutation control, and increment 3's own risk A expects the first
 * authoritative run to die on baseline coverage, so a checkpoint between
 * generation and assembly makes that failure cost one assembly pass instead
 * of a full regeneration. The case against is that an intermediate artifact
 * is an interface appearing nowhere in the sealed spec. Stated honestly
 * (adversarial QA on increment 5): NO resume path consumes the checkpoint
 * yet - there is no `--records-in` - so its economics are aspirational until
 * determination 7 is ruled; today it is evidence for the post-mortem, not a
 * restart point.
 *
 * THE CANARIES (prereg 17; spec 8.6.0's pinned order puts them FIRST)
 *
 * `canariesPassed` is deliberately NOT a CLI flag: an operator-supplied
 * pass/fail boolean is exactly the class of assertion the reducer's own
 * preflight refuses for the identity records, and the same reasoning holds
 * one document key over. The only source of `canariesPassed: true` is
 * `runCanaries` below - the SAME four real probes
 * `run-backtest-canaries.js` wires (raw TCP, HTTPS, the global pool, a
 * fresh pg client), through the same `guards.assertOffline` decision logic,
 * run in this process before any generation. If any route out is open the
 * producer throws and no document exists; there is no code path that writes
 * `canariesPassed: false`, because a run that fails its canaries has no
 * business generating 15,096 projections first - the entrypoint's abort is
 * the disposition, and the reducer's void reporting covers documents whose
 * booleans a FUTURE producer might legitimately set false.
 *
 * RUNNING THIS IS STILL BARRED. Gate 0 holds candidate-cell execution against
 * real data; this file is the wiring, tested against synthetic fixtures by
 * `server/test/backtestInputsWiring.test.js`. Nothing here may be pointed at
 * `backtest-data/snapshot/` - see the `--rehydrated-snapshot` discipline below.
 *
 * `--rehydrated-snapshot`, `--rehydrated-sources`, `--rosters`, `--cohort` and
 * `--out` ARE ALL REQUIRED, WITH NO DEFAULTS - the same discipline
 * `run-backtest-mde.js` documents at length: the container entrypoint points
 * `--out` at a dedicated writable bind-mount, and a defaulted output path is a
 * path that can silently land in a read-only mount or somewhere the copy-out
 * step never looks. The inputs come from rehydration OUTPUT, never from the
 * uncommitted local sealed snapshot, so the run is reproducible from committed
 * bytes alone.
 *
 * THE FOUR WIRING OBLIGATIONS `lib/inputsGeneration.js` CANNOT CHECK
 *
 * Its docblock names the first two; the second two are this file's own traps,
 * each of which produces a document that still validates:
 *
 *   1. `generate` MUST pass `weatherService: false`. It is the exactness
 *      precondition for component (f) (weather is applied AFTER homeAway), and
 *      the pure layer cannot see it: weather changes the numbers, not their
 *      shape. Passed as a literal below, never plumbed from an argument.
 *   2. `generate` MUST forward `onPreHomeAwayBaseline` unchanged. It is the
 *      only source of the pre-homeAway baseline `b` (spec 6.5).
 *   3. `generate` MUST return the WHOLE run object, not the projections Map.
 *      `run-backtest-mde.js`'s `projectPoints` returns the Map because
 *      `controlCellEvaluator` wants exactly that; `inputsGeneration` calls
 *      `projectionsMapOf(run)` and wants the wrapper. Returning the wrong one
 *      here is the same class of defect as the wrapper bug that script's
 *      comment records, which surfaced three steps downstream.
 *   4. The benchmark prior-game history MUST carry `usage`. `lib/naive`'s
 *      `usage-signal` is defined over usage-bearing games, and a history built
 *      without the usage counts makes it return `null` for EVERY player -
 *      published as a benchmark with no interval rather than as a wiring
 *      failure. `run-backtest-rosters.js`'s own `buildPriorGamesIndex` does
 *      not carry usage (its consumer, the candidate ranking, does not read
 *      it), which is exactly why this file builds its own index rather than
 *      reusing that export. See `buildBenchmarkPriorGamesIndex` below.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const snapshotClientLib = require('../../scripts/backtest/lib/snapshotClient');
const inputsAssembly = require('../../scripts/backtest/lib/inputsAssembly');
const inputsGeneration = require('../../scripts/backtest/lib/inputsGeneration');
const inputsPermutationCapture = require('../../scripts/backtest/lib/inputsPermutationCapture');
const inputsSensitivity = require('../../scripts/backtest/lib/inputsSensitivity');
const sweepPreflightLib = require('../../scripts/backtest/lib/sweepPreflight');
const metrics = require('../../scripts/backtest/lib/metrics');
const ordering = require('../../scripts/backtest/lib/ordering');
const rostersLib = require('../../scripts/backtest/lib/rosters');
const naive = require('../../scripts/backtest/lib/naive');
const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');
const { PRIMARY_SCORING_PROFILE } = require('../../scripts/backtest/lib/freezeManifest');
const { assertOffline, CANARY_NAMES } = require('../../scripts/backtest/lib/guards');
const { makeSourceReader } = require('../../scripts/backtest/snapshot-checks');

// Reused verbatim rather than re-derived: the two scripts must load the SAME
// Commit-A artifacts the same way and reconstruct the SAME weeks the same way.
// A second, independently-written copy of either is precisely how the MDE's
// control cell and the sweep's control cell would end up computed against
// subtly different reconstructions.
const mdeScript = require('./run-backtest-mde');
const rostersScript = require('./run-backtest-rosters');
// The REDUCER's exported claim assembly, injected into the sensitivity
// comparison passes, and its validateInputs run over the finished document -
// so the document this script writes is one the sweep will actually accept,
// checked at write time rather than discovered at Gate 4.
const sweepScript = require('./run-backtest-sweep');
// The four real canary probes (raw TCP, HTTPS, the global pool, a fresh pg
// client), reused - never re-implemented - for the in-process canary run
// that is `canariesPassed`'s only source (see the module docblock).
const canariesScript = require('./run-backtest-canaries');

const { generateProjections } = require('../services/projection.service');
const { availabilityFor } = require('../services/projectionModel');
const { optimalAssignment } = require('../services/lineupOptimizer');
const model = require('../services/projectionModel');
const { SCORING_PRESETS, calculateFantasyPoints } = require('../services/scoring.service');
const { usageFromStats } = require('../services/projectionFeatures');

/**
 * The sealed study id - the opening of both sealed texts
 * (`PREREGISTRATION.md`/`PHASE5_EXECUTION_SPEC.md`, each line 3: "Study id:
 * `pit-sweep-2024-2025`") and the committed artifact directory's own name.
 * A literal here, pinned by test against the artifact path, because the
 * document's `studyId` names which sealed study its verdicts answer to and
 * must never be derivable from anything an operator can vary.
 */
const STUDY_ID = 'pit-sweep-2024-2025';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function requireFlagValue(argv, index, flagName) {
  const value = argv[index];
  if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
    throw new Error(`run-backtest-inputs: ${flagName} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    rehydratedSnapshot: null, rehydratedSources: null, rosters: null, cohort: null, out: null, recordsOut: null, recordsIn: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--rehydrated-snapshot') args.rehydratedSnapshot = requireFlagValue(argv, ++i, token);
    else if (token === '--rehydrated-sources') args.rehydratedSources = requireFlagValue(argv, ++i, token);
    else if (token === '--rosters') args.rosters = requireFlagValue(argv, ++i, token);
    else if (token === '--cohort') args.cohort = requireFlagValue(argv, ++i, token);
    else if (token === '--out') args.out = requireFlagValue(argv, ++i, token);
    // OPTIONAL, the one deliberate exception to the all-required rule: it
    // names an ADDITIONAL output (the determination-7 interim checkpoint),
    // never a defaulted one - omitted means "do not write it", not "write it
    // somewhere I did not say".
    else if (token === '--records-out') args.recordsOut = requireFlagValue(argv, ++i, token);
    // Decision D3 (ruled 2026-08-08): resume assembly from a checkpoint this
    // script wrote. The resume path reads NO Commit-A artifacts, so the four
    // input directories are FORBIDDEN beside it, not merely unused - allowing
    // both would leave "which path ran?" ambiguous, the masquerade shape
    // wiring obligation 3 exists to prevent.
    else if (token === '--records-in') args.recordsIn = requireFlagValue(argv, ++i, token);
    else throw new Error(`run-backtest-inputs: unknown argument ${token}`);
  }
  if (args.recordsIn) {
    if (args.recordsOut) {
      throw new Error('run-backtest-inputs: --records-in cannot be combined with --records-out - a resume either reads the checkpoint or a generation writes one, and writing back what was just read is either a no-op or a laundering rewrite');
    }
    for (const [flag, value] of [
      ['--rehydrated-snapshot', args.rehydratedSnapshot],
      ['--rehydrated-sources', args.rehydratedSources],
      ['--rosters', args.rosters],
      ['--cohort', args.cohort],
    ]) {
      if (value) {
        throw new Error(`run-backtest-inputs: ${flag} cannot be combined with --records-in - the resume path reads no Commit-A artifacts (the embedded week artifacts are hash-bound to the checkpoint), and a flag no path reads is a flag that silently does nothing`);
      }
    }
    if (!args.out) {
      throw new Error(
        'run-backtest-inputs: --out is required, with no default. A defaulted output path is a path '
        + 'that can silently land outside the container\'s dedicated writable output mount.'
      );
    }
    return args;
  }
  for (const [flag, value] of [
    ['--rehydrated-snapshot', args.rehydratedSnapshot],
    ['--rehydrated-sources', args.rehydratedSources],
    ['--rosters', args.rosters],
    ['--cohort', args.cohort],
    ['--out', args.out],
  ]) {
    if (!value) {
      throw new Error(
        `run-backtest-inputs: ${flag} is required, with no default. A defaulted output path is a path `
        + 'that can silently land outside the container\'s dedicated writable output mount.'
      );
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Commit-A artifact freeze-hash verifiers
// ---------------------------------------------------------------------------

/**
 * Mirrors `run-backtest-mde.js`'s two private verifiers exactly (that file
 * exports `loadWeekArtifactsFromDir` but not these). Duplicated rather than
 * exported-and-shared because adding exports to an approved script to serve a
 * new consumer is a change to a reviewed file for this file's convenience;
 * six lines that mirror `lib/rosters.freezeHash` and
 * `run-backtest-rosters.cohortFreezeHash` are the cheaper drift risk, and both
 * are pinned by a test below.
 */
function verifyRosterFreezeHash(parsed) {
  return rostersLib.freezeHash(parsed);
}

function verifyCohortFreezeHash(parsed) {
  const { freezeHash: _stored, ...rest } = parsed;
  return crypto.createHash('sha256').update(canonicalJson(rest), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// The in-process canary run (`canariesPassed`'s only source)
// ---------------------------------------------------------------------------

/**
 * Run the four real canary probes through the same `guards.assertOffline`
 * decision logic `run-backtest-canaries.js` wires, and return `true` - the
 * one value `canariesPassed` can ever take in a document this script writes.
 * Any open route THROWS before a single projection is generated (prereg 17;
 * spec 8.6.0 pins canaries FIRST in the preflight order, and the producer
 * puts them first at generation time too - first only: the rest of that
 * pinned order is the REDUCER's preflight block, and the generation-time
 * identity assertions remain the increment-3 backlog's open item S2, not a
 * thing this function discharges).
 *
 * `probes` is a test seam: the real probes reach for the network by design
 * (proving it absent), which a unit test can neither rely on nor safely
 * exercise. Production callers pass nothing.
 */
async function runCanaries({ probes = canariesScript.PROBES } = {}) {
  await assertOffline({ probes, names: CANARY_NAMES, label: 'run-backtest-inputs canaries' });
  return true;
}

// ---------------------------------------------------------------------------
// The benchmark prior-game history (wiring obligation 4)
// ---------------------------------------------------------------------------

/**
 * Every prior game for one gsisId, rescored under the PRIMARY profile's rules
 * and annotated with the usage counts `lib/naive.isUsageBearing` reads.
 *
 * Deliberately NOT `run-backtest-rosters.buildPriorGamesIndex`, which emits
 * `{season, week, points}` with no `usage`: its consumer is the
 * model-independent candidate ranking, which never asks whether a game was
 * usage-bearing. Handing that index to `usage-signal` yields `null` for every
 * player-week - a benchmark that scores nothing, published under a benchmark's
 * name. The rescoring itself is identical, so the two indexes agree on
 * `points` by construction.
 *
 * The PRIMARY profile's rules are the only ones needed: `inputsGeneration`
 * calls `benchmarkProjectionsFor` under `isPrimary` alone (prereg 7.2's
 * benchmarks have no sensitivity-profile generation, which
 * `inputsAssembly.indexArmWeekMetrics` independently rejects).
 */
function buildBenchmarkPriorGamesIndex({ snapshot, gsisByPlayerId, rules }) {
  const byGsis = new Map();
  for (const row of snapshot.playerStats) {
    const playerId = Number(row.player_id);
    const gsisId = gsisByPlayerId.get(playerId);
    if (!gsisId) continue; // no crosswalk link -> cannot be scored into a history
    if (!byGsis.has(gsisId)) byGsis.set(gsisId, []);
    byGsis.get(gsisId).push({
      season: Number(row.season),
      week: Number(row.week),
      points: calculateFantasyPoints(row.stats, rules),
      usage: usageFromStats(row.stats),
    });
  }
  return byGsis;
}

/**
 * The projections Map for one benchmark arm over one season-week's cohort.
 *
 * A DEF's history comes from the pinned team-week sources
 * (`buildDefensePriorGamesIndex`), keyed by team rather than by gsisId,
 * because a synthesized DEF has no gsisId and no database `player_stats` row
 * at all. Those rows carry no usage counts, so `usage-signal` returns `null`
 * for every DEF - which is correct rather than a gap: a defence has no pass
 * attempts, carries or targets, so no DEF game is usage-bearing under
 * `lib/naive`'s own definition. `naive-recency` DOES score them, which is the
 * part that would have been silently missing had the DEF index been skipped.
 */
function benchmarkProjectionsForWeek({
  season, week, playerIds, memberById, priorGamesByGsis, priorGamesByTeamKey,
}) {
  const byArm = {
    [naive.BENCHMARKS.NAIVE_RECENCY]: new Map(),
    [naive.BENCHMARKS.USAGE_SIGNAL]: new Map(),
  };
  for (const playerId of playerIds) {
    const member = memberById.get(playerId);
    if (!member) {
      throw new Error(
        `run-backtest-inputs benchmarks ${season}w${week}: no cohort member for playerId ${playerId} - `
        + 'the benchmark history is looked up by the member\'s own identity, never guessed'
      );
    }
    const priorGames = member.isDefense
      ? (priorGamesByTeamKey.get(member.teamKey) || [])
      : (priorGamesByGsis.get(member.gsisId) || []);
    const both = naive.benchmarksFor({ playerId, priorGames, season, week });
    for (const arm of Object.keys(byArm)) byArm[arm].set(playerId, both[arm]);
  }
  return byArm;
}

// ---------------------------------------------------------------------------
// The playerId key-type boundary
// ---------------------------------------------------------------------------

/**
 * Fail closed if any artifact `playerId` is not ALREADY a finite number.
 *
 * This layer is the only one that reads JSON, so it is the only one that can
 * hold this line. The hazard, found by an adversarial QA pass on `7411d28`:
 * `inputsGeneration.cohortPlayerIds` COERCES with `Number(member.playerId)`,
 * so the ids handed to `generate` are always numeric and the projections Map
 * always satisfies `armWeekEvaluator`'s `numericKeyed` guard - the guard
 * written to catch exactly this class. But `evaluateArmWeek` is handed the RAW
 * cohort and looks players up by the raw `member.playerId`. String ids
 * therefore pass every existing check while scoring nothing: a demonstrated
 * all-string cohort published `regret: 0` for all 14,688 arm-weeks with the
 * other six endpoints null, and the reducer called that run `valid` with zero
 * reasons - canaries, both identity assertions and the salt-collision guard
 * all "held". A partial string cohort is worse, because the counts, baseline
 * rows and subgroup rows stay byte-identical to the honest run (they all
 * travel on the coerced ids) while the scored endpoints quietly move.
 *
 * ASSERTED, never coerced. Coercing here would make the two layers agree by
 * hiding a real type defect in a frozen Commit-A artifact; the whole point is
 * that a cohort whose ids are not what the contract says must stop the run
 * before 14,688 generations pay for it. Verified against the committed
 * artifacts: 562/562 cohort members and 800/800 roster players in 2025w2 are
 * already `number`, so this is a latent contract hazard being pinned, not a
 * live defect being repaired.
 *
 * `actualPointsByPlayerId` is deliberately NOT covered: JSON object keys are
 * always strings, so that map is legitimately string-keyed on disk and is
 * converted at the call site below - by `numericOutcomeTruthMap`, which is
 * strict about both key form and value type. That asymmetry is the tell that
 * made this defect invisible - one map was known to need conversion and the
 * other was assumed not to.
 */
function assertNumericPlayerIds({ rosterWeek, cohortWeek, label }) {
  const bad = (what, index, value) => new Error(
    `${label}: ${what}[${index}].playerId is ${JSON.stringify(value)} (${typeof value}), not a finite number. `
    + 'Cohort and roster ids must already be numeric: the generation path coerces them and the scoring path '
    + 'does not, so a string id scores nothing while every count, baseline and subgroup row stays identical '
    + 'to an honest run.'
  );
  (cohortWeek.members || []).forEach((member, index) => {
    const id = member && member.playerId;
    if (typeof id !== 'number' || !Number.isFinite(id)) throw bad('cohortWeek.members', index, id);
  });
  (rosterWeek.rosters || []).forEach((roster, rosterIndex) => {
    (roster.players || []).forEach((player, index) => {
      const id = player && player.playerId;
      if (typeof id !== 'number' || !Number.isFinite(id)) {
        throw bad(`rosterWeek.rosters[${rosterIndex}].players`, index, id);
      }
    });
  });
  return true;
}

// ---------------------------------------------------------------------------
// The generation seam (wiring obligations 1-3)
// ---------------------------------------------------------------------------

/**
 * Build the `generate` injection.
 *
 * Extracted from `main` and exported ONLY so the three obligations it carries
 * can be pinned by a test that injects a fake generator, rather than being
 * sealed inside a function no test can reach without a real snapshot and a
 * real database. All three are the kind of defect that produces a document
 * which still validates, so "reviewed carefully" is not the standard.
 *
 * `generateProjectionsImpl` / `createClient` are seams for that test alone;
 * production callers pass neither.
 */
function makeGenerate({
  snapshot,
  reconstructionFor,
  generateProjectionsImpl = generateProjections,
  createClient = snapshotClientLib.createSnapshotClient,
}) {
  return async ({
    scoringProfile, season, week, playerIds, hashValue, modelConstants, onPreHomeAwayBaseline,
  }) => {
    const rules = SCORING_PRESETS[scoringProfile];
    if (!rules) throw new Error(`run-backtest-inputs: no scoring preset for profile ${JSON.stringify(scoringProfile)}`);
    // Returned WHOLE (obligation 3): `{ projections, inputCutoff,
    // sourceCoverage }`. Destructuring `projections` here is the defect
    // run-backtest-mde.js's comment records from the other direction.
    return generateProjectionsImpl({
      season,
      week,
      rules,
      playerIds,
      hashValue,
      client: createClient({
        snapshot,
        season,
        week,
        mode: snapshotClientLib.MODES.RECONSTRUCTED,
        reconstruction: reconstructionFor(season),
      }),
      // A LITERAL, never an argument (obligation 1). Weather is applied after
      // homeAway, so any weather at all breaks component (f)'s exactness.
      weatherService: false,
      modelConstants,
      // Forwarded unchanged (obligation 2): the only source of the
      // pre-homeAway baseline `b`.
      onPreHomeAwayBaseline,
    });
  };
}

/**
 * The final unsigned 32-bit seed one generation actually used. Top-level and
 * exported (rather than a closure in `main`) because the reducer's preflight
 * checks these pairwise-distinct across the 24 salts, so a wiring that fed
 * `seedFrom` the wrong parts, or the wrong order of parts, would be caught
 * only as a runtime collision inside someone else's module.
 */
function seedFor({ hashValue, season, week, playerId }) {
  return model.seedFrom(model.MODEL_VERSION, hashValue, season, week, playerId);
}

/**
 * The frozen cohort's outcome truth, converted to the numeric-keyed Map the
 * pure layer reads - STRICTLY. The previous form was bare
 * `[Number(id), points]`, and `Number` accepts aliases: `"1.0"`, `" 1"` and
 * `"0x1"` all coerce to `1`, so a cohort artifact carrying both `"1"` and
 * `"1.0"` as keys silently published the LAST one's value as player 1's
 * actual, with zero errors anywhere downstream (the reducer derives actuals
 * only from observation rows, so nothing ever re-reads the raw map). A key
 * must be the canonical decimal rendering of a non-negative integer, and a
 * value must already be a finite number - asserted, never coerced, the same
 * line `assertNumericPlayerIds` holds for the ids (adversarial QA finding F1
 * on increment 4).
 */
function numericOutcomeTruthMap(source, label) {
  const map = new Map();
  for (const [key, points] of Object.entries(source || {})) {
    if (!/^(0|[1-9][0-9]*)$/.test(key)) {
      throw new Error(
        `${label}: actualPointsByPlayerId key ${JSON.stringify(key)} is not a canonical non-negative integer playerId. `
        + 'Bare Number() would accept "1.0", " 1" and "0x1" as aliases of player 1, silently overwriting an honest '
        + 'actual last-wins.'
      );
    }
    const playerId = Number(key);
    if (typeof points !== 'number' || !Number.isFinite(points)) {
      throw new Error(`${label}: actualPointsByPlayerId[${key}] is ${JSON.stringify(points)} (${typeof points}), not a finite number - outcome truth is asserted, never coerced`);
    }
    // Unreachable while the key form is canonical (distinct canonical strings
    // are distinct numbers); kept so a future loosening of the key rule fails
    // here instead of last-winning.
    if (map.has(playerId)) throw new Error(`${label}: duplicate actualPointsByPlayerId key for player ${playerId}`);
    map.set(playerId, points);
  }
  return map;
}

// ---------------------------------------------------------------------------
// The permutation-control document block (increment 4's wiring half)
// ---------------------------------------------------------------------------

/**
 * Assemble the `--inputs` document's `permutationControl` block: the captured
 * observations and roster rows, the 2025 week artifacts, and the two
 * DB-produced rank artifacts (`assembleSweepInputs` closes the block to
 * exactly these six keys).
 *
 * Two traps this function exists to hold, each producing a document that
 * still validates:
 *
 *   1. The embedded roster/cohort artifacts must be the RAW PARSED JSON, not
 *      the Map-converted copies `main` builds for the pure layer.
 *      `canonicalJson` serializes a `Map` as `{}` silently (its own docblock
 *      says so - it is why the Map-safe wrapper exists elsewhere), so an
 *      embedded Map-converted cohort week would write
 *      `actualPointsByPlayerId: {}` into the document without an error
 *      anywhere. Asserted here, fail-closed.
 *   2. The rank indexes are Maps in memory (`ordering.buildRankIndex`) and
 *      must become plain objects to survive serialization at all - the same
 *      `Map -> '{}'` collapse, on the two artifacts whose whole job is to
 *      pin candidate order. The reducer converts them back
 *      (`buildPolicyContext` re-Maps with `Number(id)` on the name ranks).
 */
function buildPermutationControlBlock({ capture, rosterIndexByWeek, cohortIndexByWeek, ranks, label = 'run-backtest-inputs permutationControl' }) {
  const rosterWeeks = {};
  const cohortWeeks = {};
  for (const week of metrics.EVALUATED_WEEKS) {
    const key = `${inputsPermutationCapture.PERMUTATION_SEASON}:${week}`;
    const rosterWeek = rosterIndexByWeek[key];
    const cohortWeek = cohortIndexByWeek[key];
    if (!rosterWeek || !cohortWeek) {
      throw new Error(`${label}: no frozen artifacts for ${key} - the block must carry every 2025 evaluated week`);
    }
    if (cohortWeek.actualPointsByPlayerId instanceof Map) {
      throw new Error(
        `${label}: ${key}'s cohort artifact carries actualPointsByPlayerId as a Map. The block must embed the RAW `
        + 'parsed artifact: canonicalJson serializes a Map as {} silently, so the document would validate while '
        + 'carrying no outcome truth at all'
      );
    }
    rosterWeeks[week] = rosterWeek;
    cohortWeeks[week] = cohortWeek;
  }
  // The capture and the embedded artifacts must describe the SAME cohort. In
  // main they are the same objects by construction; this holds the line for
  // every other caller, because the reducer's own cross-checks are
  // one-directional (rostered subset-of observed/cohort) and would accept a
  // phantom observation member that participates in every permutation cell.
  // rosterRows suffices as the checked side: the capture already proved the
  // observations' per-cell ids equal the rosterRows cells elementwise.
  const memberIdsByWeek = new Map(Object.entries(cohortWeeks).map(([week, cohortWeek]) => [
    Number(week), new Set((cohortWeek.members || []).map((member) => member.playerId)),
  ]));
  for (const row of capture.rosterRows) {
    const memberIds = memberIdsByWeek.get(row.week);
    if (!memberIds || !memberIds.has(row.playerId)) {
      throw new Error(
        `${label}: captured roster row ${row.week}:${row.position}:${row.playerId} names a player the embedded `
        + 'cohort artifact does not carry - the capture and the embedded artifacts were built from different inputs'
      );
    }
  }
  return {
    observations: capture.observations,
    rosterRows: capture.rosterRows,
    rosterWeeks,
    cohortWeeks,
    positionRank: Object.fromEntries(ranks.positionRank),
    nameRankById: Object.fromEntries([...ranks.nameRankById].map(([id, rank]) => [String(id), rank])),
  };
}

// ---------------------------------------------------------------------------
// The written artifact
// ---------------------------------------------------------------------------

/**
 * The generation-records bundle. Environment-free on the same terms as the MDE
 * artifact (`assertEnvironmentFree` is reused, not re-implemented): no Node
 * version, no absolute path, no timestamp - runtime identity belongs only to
 * freeze Commit B's manifest.
 *
 * Since increment 4 the bundle also carries the assembled `permutationControl`
 * block and its capture counts - REQUIRED, not optional: a records artifact
 * without the block would look one-increment-from-assemblable while silently
 * missing a piece the sealed schema demands, which is exactly the
 * half-populated-document shape the module docblock forswears.
 */
function buildArtifact(records, { permutationControl, permutationCounts } = {}) {
  if (!permutationControl || typeof permutationControl !== 'object') {
    throw new Error('run-backtest-inputs: buildArtifact requires the permutationControl block - a records artifact without it looks assemblable and is not');
  }
  if (!permutationCounts || typeof permutationCounts !== 'object') {
    throw new Error('run-backtest-inputs: buildArtifact requires the permutation capture counts');
  }
  // Every member is required BY NAME: a records artifact silently missing one
  // (a refactor that stops threading armWeekMetrics, say) would serialize,
  // pass assertEnvironmentFree, and read as a checkpoint while carrying
  // nothing to assemble (mutation-QA finding wir-01/02 on increment 4).
  for (const key of ['armWeekMetrics', 'subgroupErrorRows', 'activationRecords']) {
    if (!Array.isArray(records[key])) throw new Error(`run-backtest-inputs: buildArtifact requires records.${key} as an array`);
  }
  for (const key of ['preflight', 'counts']) {
    if (!records[key] || typeof records[key] !== 'object') throw new Error(`run-backtest-inputs: buildArtifact requires records.${key}`);
  }
  // The sensitivity re-evaluations are checkpoint members on the same terms
  // (increment 5): a checkpoint without them cannot feed the comparison
  // passes, so resuming from it would silently regenerate what it was
  // supposed to have saved.
  if (!records.armWeekMetricsBySensitivity || typeof records.armWeekMetricsBySensitivity !== 'object') {
    throw new Error('run-backtest-inputs: buildArtifact requires records.armWeekMetricsBySensitivity');
  }
  for (const key of inputsSensitivity.SENSITIVITY_PASS_KEYS) {
    if (!Array.isArray(records.armWeekMetricsBySensitivity[key])) {
      throw new Error(`run-backtest-inputs: buildArtifact requires records.armWeekMetricsBySensitivity[${JSON.stringify(key)}] as an array`);
    }
  }
  const artifact = {
    // Decision D3 (ruled 2026-08-08): the checkpoint names which sealed study
    // it belongs to and carries its own digest, so `--records-in` can prove
    // the file is the one a generation run wrote before trusting a byte of it.
    studyId: STUDY_ID,
    armWeekMetrics: records.armWeekMetrics,
    armWeekMetricsBySensitivity: records.armWeekMetricsBySensitivity,
    subgroupErrorRows: records.subgroupErrorRows,
    activationRecords: records.activationRecords,
    preflight: records.preflight,
    permutationControl,
    counts: { ...records.counts, permutationControl: permutationCounts },
  };
  // The writer holds itself to the loader's shape contract, so the two can
  // never drift: a checkpoint buildArtifact would write that
  // loadRecordsArtifact would refuse is a bug caught at write time.
  assertRecordsArtifactShape(artifact, { label: 'run-backtest-inputs: buildArtifact' });
  return { ...artifact, recordsHash: sha256Hex(canonicalJson(artifact)) };
}

/** SHA-256 hex over canonical text - the same digest form the freeze-hash verifiers above use. */
function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Every member of the records checkpoint required BY NAME, shared by the
 * writer (`buildArtifact` self-checks its output) and the loader
 * (`loadRecordsArtifact`) so the two cannot drift (decision D3). Validates
 * the artifact WITHOUT its `recordsHash` key - the hash covers exactly this
 * shape.
 */
function assertRecordsArtifactShape(artifact, { label = 'run-backtest-inputs records artifact' } = {}) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) throw new Error(`${label}: must be an object`);
  if (artifact.studyId !== STUDY_ID) {
    throw new Error(`${label}: studyId must be the sealed ${JSON.stringify(STUDY_ID)}, got ${JSON.stringify(artifact.studyId)} - a checkpoint answering to a different study must never assemble this one's document`);
  }
  for (const key of ['armWeekMetrics', 'subgroupErrorRows', 'activationRecords']) {
    if (!Array.isArray(artifact[key])) throw new Error(`${label}: requires ${key} as an array`);
  }
  if (!artifact.armWeekMetricsBySensitivity || typeof artifact.armWeekMetricsBySensitivity !== 'object') {
    throw new Error(`${label}: requires armWeekMetricsBySensitivity`);
  }
  for (const key of inputsSensitivity.SENSITIVITY_PASS_KEYS) {
    if (!Array.isArray(artifact.armWeekMetricsBySensitivity[key])) {
      throw new Error(`${label}: requires armWeekMetricsBySensitivity[${JSON.stringify(key)}] as an array`);
    }
  }
  if (!artifact.preflight || typeof artifact.preflight !== 'object') throw new Error(`${label}: requires preflight`);
  for (const key of ['cohortRosterRows', 'controlUsage25Records', 'homeAwayStoredRecords', 'saltSeedRecords', 'matchedOffBaselineRows']) {
    if (!Array.isArray(artifact.preflight[key])) throw new Error(`${label}: requires preflight.${key} as an array`);
  }
  if (!artifact.permutationControl || typeof artifact.permutationControl !== 'object') throw new Error(`${label}: requires the permutationControl block`);
  for (const key of ['observations', 'rosterRows', 'rosterWeeks', 'cohortWeeks', 'positionRank', 'nameRankById']) {
    if (!(key in artifact.permutationControl)) throw new Error(`${label}: requires permutationControl.${key}`);
  }
  if (!artifact.counts || typeof artifact.counts !== 'object') throw new Error(`${label}: requires counts`);
  if (!artifact.counts.permutationControl || typeof artifact.counts.permutationControl !== 'object') {
    throw new Error(`${label}: requires counts.permutationControl`);
  }
  return true;
}

/**
 * Decision D3: parse and validate a `--records-in` checkpoint.
 *
 * What a resume RE-RUNS from disk, so the checkpoint cannot become a
 * laundering channel: the artifact's own digest; the sealed grid counts; the
 * 8.6.0/8.6.1 identity coverage AND value bit-identity
 * (`sweepPreflight.assertIdentityCoverage` - the reducer's own, never a
 * re-implementation); salt-seed coverage; the embedded outcome-truth key
 * discipline (the laundered-baseline-id class applies to loaded JSON exactly
 * as to Commit-A artifacts).
 *
 * What it CANNOT re-run, stated honestly (riding to the revision-35 text):
 * non-aliasing is UNVERIFIABLE from disk - `assertRunsNotAliased` compares
 * references and a JSON round trip mints fresh objects, so the resume's
 * non-aliasing guarantee is INHERITED from the writer's generation-time
 * enforcement and bound to it by `recordsHash`, never re-proven.  The
 * per-generation guards' operands (the 14,688 scored runs) are not in the
 * artifact; only their derived metrics are - trusted-from-writer,
 * hash-pinned.  Observation canonicality is re-verified by the reducer's own
 * permutation gate when the assembled document is consumed.  Whether a
 * checkpoint from a COMPLETED run may be resumed is a D3 spec detail; the
 * loader validates the artifact, not the operator's reason for resuming.
 */
function loadRecordsArtifact(serialized, { label = 'run-backtest-inputs --records-in' } = {}) {
  if (typeof serialized !== 'string' || serialized.length === 0) {
    throw new Error(`${label}: requires the checkpoint's serialized bytes`);
  }
  // Symmetric with the writer: the same environment-free line, on the bytes
  // as read.
  mdeScript.assertEnvironmentFree(serialized, { label: 'inputs-generation-records' });
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (err) {
    throw new Error(`${label}: could not parse the checkpoint: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}: must be an object`);
  const { recordsHash, ...content } = parsed;
  if (typeof recordsHash !== 'string' || recordsHash.length !== 64) {
    throw new Error(`${label}: recordsHash is missing or malformed - a checkpoint without its own digest cannot prove it is the one a generation run wrote`);
  }
  const recomputed = sha256Hex(canonicalJson(content));
  if (recomputed !== recordsHash) {
    throw new Error(`${label}: records checkpoint hash mismatch - the file is not the one a generation run wrote (stored ${recordsHash}, recomputed ${recomputed})`);
  }
  assertRecordsArtifactShape(content, { label });
  assertGridComplete(content.counts, { label });
  const captureGenerations = content.counts.permutationControl.generations;
  if (captureGenerations !== inputsPermutationCapture.CAPTURE_TOTAL) {
    throw new Error(`${label}: the checkpoint records ${captureGenerations} permutation-control generations, but section 5's scope is ${inputsPermutationCapture.CAPTURE_TOTAL}`);
  }
  sweepPreflightLib.assertIdentityCoverage({
    cohortRosterRows: content.preflight.cohortRosterRows,
    controlUsage25Records: content.preflight.controlUsage25Records,
    homeAwayStoredRecords: content.preflight.homeAwayStoredRecords,
    label: `${label} identity`,
  });
  sweepPreflightLib.assertSaltSeedCoverage({
    cohortRosterRows: content.preflight.cohortRosterRows,
    records: content.preflight.saltSeedRecords,
    label: `${label} salt seeds`,
  });
  for (const [week, cohortWeek] of Object.entries(content.permutationControl.cohortWeeks)) {
    if (!cohortWeek || typeof cohortWeek !== 'object') throw new Error(`${label}: cohortWeeks[${week}] must be an object`);
    numericOutcomeTruthMap(cohortWeek.actualPointsByPlayerId, `${label} cohortWeeks[${week}]`);
  }
  const { permutationControl, studyId: _studyId, ...records } = content;
  return { records, permutationControl };
}

function serializeArtifact(artifact) {
  const serialized = `${canonicalJson(artifact)}\n`;
  mdeScript.assertEnvironmentFree(serialized, { label: 'inputs-generation-records' });
  return serialized;
}

/**
 * The complete `--inputs` document's bytes: canonical JSON, environment-free
 * on the same terms as every other written artifact (no Node version, no
 * absolute path, no timestamp - runtime identity belongs only to freeze
 * Commit B's manifest).
 */
function serializeInputsDocument(document) {
  const serialized = `${canonicalJson(document)}\n`;
  mdeScript.assertEnvironmentFree(serialized, { label: 'sweep-inputs-document' });
  return serialized;
}

/**
 * The sensitivity passes plus the final assembly, as ONE exported function -
 * extracted from `main`'s tail so the load-bearing wiring decisions are
 * pinned by tests rather than living in a path no test executes (mutation QA
 * on increment 5: a `main` that quietly fed the assembler placeholder
 * sensitivity inputs, or dropped the write-time validation, survived every
 * test while shipping the exact defect increment 5 exists to prevent):
 *
 *   - the document's `orderingSensitivityByCell` and the two disagreement
 *     booleans are the DERIVED values, never placeholders;
 *   - the finished document is validated with the REDUCER's own
 *     `validateInputs` before anyone serializes it.
 *
 * `deriveSensitivityInputsImpl` is a test seam (the real derivation needs a
 * full consistent record universe per pass; the seam lets a test pin that
 * whatever the derivation returns is what the document carries). Production
 * callers pass neither override.
 */
function assembleFinalDocument({
  records,
  permutationControl,
  canariesPassed,
  reducer = sweepScript,
  deriveSensitivityInputsImpl = inputsSensitivity.deriveSensitivityInputs,
  label = 'run-backtest-inputs',
}) {
  const sensitivity = deriveSensitivityInputsImpl({
    studyId: STUDY_ID,
    canariesPassed,
    records,
    permutationControl,
    reducer,
    label: `${label} sensitivity`,
  });
  const document = inputsAssembly.assembleSweepInputs({
    studyId: STUDY_ID,
    canariesPassed,
    orderingDisagreement: sensitivity.orderingDisagreement,
    deployedPolicyDisagreement: sensitivity.deployedPolicyDisagreement,
    armWeekMetrics: records.armWeekMetrics,
    subgroupErrorRows: records.subgroupErrorRows,
    activationRecords: records.activationRecords,
    orderingSensitivityByCell: sensitivity.orderingSensitivityByCell,
    // Decision D6 (ruled 2026-08-08): the DERIVED audit trail rides the final
    // document - never the placeholder the comparison documents carry - so
    // the published report can show which winner each pass produced and how
    // the estimand halt was reconciled.
    sensitivityAudit: {
      winnersByPass: sensitivity.detail.winnersByPass,
      estimandReconciliation: sensitivity.detail.estimandReconciliation,
    },
    preflight: records.preflight,
    permutationControl,
  });
  // The document this script writes must be one the sweep actually accepts -
  // checked with the reducer's own validator at write time, not at Gate 4.
  reducer.validateInputs(document, { label: `${label} --out document` });
  return { document, sensitivity };
}

/**
 * The sealed section-9 arithmetic, checked against what the run actually did.
 *
 * This is the one end-to-end assertion this wiring can make on its own: a
 * profile silently skipped, a season loop that never entered, or an identity
 * arm that never generated all show up here as a number that is not 14,688,
 * and nowhere else until the reducer's preflight rejects a document hours
 * later. `lib/inputsGeneration` pins the same constant against its own PLAN;
 * this pins it against the executed run.
 */
function assertGridComplete(counts, { label = 'run-backtest-inputs' } = {}) {
  if (counts.generations !== inputsGeneration.GRID_TOTAL) {
    throw new Error(
      `${label}: the run performed ${counts.generations} generations, but section 9's sealed grid is `
      + `${inputsGeneration.GRID_TOTAL}. A profile, season or identity arm did not generate.`
    );
  }
  return true;
}

/**
 * Serialize and write the finished `--inputs` document, with the one console
 * line both paths share. Extracted so the resume path (decision D3) and the
 * generation path cannot drift in what they write or how they validate it.
 */
function writeInputsDocument({ outPath, document, sensitivity, gridGenerations, captureGenerations, source }) {
  const serialized = serializeInputsDocument(document);
  // outPath is the operator's own CLI argument to this locally-invoked tool.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  fs.mkdirSync(path.dirname(path.resolve(String(outPath))), { recursive: true });
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  fs.writeFileSync(path.resolve(String(outPath)), serialized, 'utf8');
  const contradictedCells = Object.entries(sensitivity.orderingSensitivityByCell)
    .filter(([, value]) => value.contradicted).map(([name]) => name);
  console.log(
    `wrote the complete --inputs document to ${outPath} `
    + `(${source}: ${gridGenerations} grid generations + ${captureGenerations} permutation-control generations; `
    + `ordering-contradicted cells: ${contradictedCells.length > 0 ? contradictedCells.join(', ') : 'none'}; `
    + `orderingDisagreement=${sensitivity.orderingDisagreement}; deployedPolicyDisagreement=${sensitivity.deployedPolicyDisagreement})`
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(argv, { probes, ...unknown } = {}) {
  const unknownKeys = Object.keys(unknown);
  if (unknownKeys.length > 0) {
    throw new Error(`run-backtest-inputs: unknown override key(s): ${unknownKeys.join(', ')}`);
  }
  const args = parseArgs(argv);

  // Canaries FIRST (prereg 17): if any route out is open, this throws and
  // nothing else - not even a snapshot load - happens. The returned `true`
  // is the only value `canariesPassed` can carry in a document this script
  // writes (see the module docblock).
  const canariesPassed = await runCanaries(probes ? { probes } : {});

  // Decision D3: the checkpoint resume path. Canaries run FIRST even here -
  // `canariesPassed` has no stored spelling, and a resume that read one from
  // the checkpoint would be exactly the operator-supplied assertion the
  // module docblock forbids. Resumed records never masquerade as generation:
  // this branch builds no generate seam, runs no permutation capture, and
  // performs no grid generation - wiring obligation 3 is untouched because
  // generation and resume share no code path at all (pinned by a
  // source-structure test that scans this branch for those symbols).
  if (args.recordsIn) {
    // args.recordsIn is the operator's own CLI argument to this
    // locally-invoked tool.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const serializedRecords = fs.readFileSync(path.resolve(String(args.recordsIn)), 'utf8');
    const loaded = loadRecordsArtifact(serializedRecords);
    const assembled = assembleFinalDocument({
      records: loaded.records, permutationControl: loaded.permutationControl, canariesPassed,
    });
    writeInputsDocument({
      outPath: args.out,
      document: assembled.document,
      sensitivity: assembled.sensitivity,
      gridGenerations: loaded.records.counts.generations,
      captureGenerations: loaded.records.counts.permutationControl.generations,
      source: `resumed from the records checkpoint at ${args.recordsIn}`,
    });
    return 0;
  }

  const snapshot = snapshotClientLib.loadSnapshot({ root: args.rehydratedSnapshot });
  const readSource = makeSourceReader({
    sourcesDir: args.rehydratedSources,
    // args.rehydratedSources is the operator's own CLI argument, joined only
    // with a hardcoded literal filename - not external input.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    provenancePath: path.join(args.rehydratedSources, 'provenance.json'),
  });

  const rosterIndexByWeek = mdeScript.loadWeekArtifactsFromDir(args.rosters, {
    label: 'run-backtest-inputs --rosters', verifyFreezeHash: verifyRosterFreezeHash,
  });
  const cohortIndexByWeek = mdeScript.loadWeekArtifactsFromDir(args.cohort, {
    label: 'run-backtest-inputs --cohort', verifyFreezeHash: verifyCohortFreezeHash,
  });

  // Fails closed on a duplicate rank row, exactly as run-backtest-mde does.
  const ranks = ordering.buildRankIndex({
    positionRankRows: snapshot.positionRank,
    playerNameRankRows: snapshot.playerNameRank,
    label: 'run-backtest-inputs candidate ranking',
  });

  // Unlike the MDE, this grid spans BOTH preregistered seasons (the primary
  // profile is generated over 2025 and 2024 - `inputsGeneration.
  // PRIMARY_SEASONS`), so the reconstruction is per season and built on first
  // use. One shared reconstruction for two seasons would resolve every 2024
  // player-week against 2025's roster index.
  const reconstructionBySeason = new Map();
  const reconstructionFor = (season) => {
    const key = Number(season);
    if (!reconstructionBySeason.has(key)) {
      reconstructionBySeason.set(key, mdeScript.buildReconstruction({ readSource, snapshot, season: key }));
    }
    return reconstructionBySeason.get(key);
  };

  const weekArtifacts = new Map();
  const membersByWeek = new Map();
  for (const [key, rosterWeek] of Object.entries(rosterIndexByWeek)) {
    const cohortWeek = cohortIndexByWeek[key];
    if (!cohortWeek) throw new Error(`run-backtest-inputs: no cohort artifact for ${key}`);
    // Before anything is generated: the ids the scoring path reads raw must be
    // the same type as the ids the generation path coerces.
    assertNumericPlayerIds({ rosterWeek, cohortWeek, label: `run-backtest-inputs ${key}` });
    weekArtifacts.set(key, {
      rosterWeek,
      cohortWeek: {
        ...cohortWeek,
        actualPointsByPlayerId: numericOutcomeTruthMap(cohortWeek.actualPointsByPlayerId, `run-backtest-inputs ${key}`),
      },
      positionRank: ranks.positionRank,
      nameRankById: ranks.nameRankById,
    });
    membersByWeek.set(key, new Map((cohortWeek.members || []).map((m) => [Number(m.playerId), m])));
  }

  // --- the benchmark history (primary profile only; see obligation 4) ------
  const primaryRules = SCORING_PRESETS[PRIMARY_SCORING_PROFILE];
  const gsisByPlayerId = new Map();
  for (const week of weekArtifacts.keys()) {
    for (const [playerId, member] of membersByWeek.get(week)) {
      if (member.gsisId) gsisByPlayerId.set(playerId, member.gsisId);
    }
  }
  const priorGamesByGsis = buildBenchmarkPriorGamesIndex({
    snapshot, gsisByPlayerId, rules: primaryRules,
  });
  const outcomeSourceCache = new Map();
  const outcomeSourceContextFor = (season) => {
    const key = Number(season);
    if (!outcomeSourceCache.has(key)) {
      outcomeSourceCache.set(key, rostersScript.buildOutcomeSourceContext({ season: key, readSource }));
    }
    return outcomeSourceCache.get(key);
  };
  const priorGamesByTeamKey = rostersScript.buildDefensePriorGamesIndex({ outcomeSourceContextFor });

  // --- the injected seam ---------------------------------------------------

  const scoringHashFor = (scoringProfile) => {
    const rules = SCORING_PRESETS[scoringProfile];
    if (!rules) throw new Error(`run-backtest-inputs: no scoring preset for profile ${JSON.stringify(scoringProfile)}`);
    return model.scoringHash(rules);
  };

  const generate = makeGenerate({ snapshot, reconstructionFor });

  const benchmarkProjectionsFor = ({ season, week, playerIds }) => {
    const key = `${season}:${week}`;
    const memberById = membersByWeek.get(key);
    if (!memberById) throw new Error(`run-backtest-inputs benchmarks: no cohort members for ${key}`);
    return benchmarkProjectionsForWeek({
      season, week, playerIds, memberById, priorGamesByGsis, priorGamesByTeamKey,
    });
  };

  // The permutation-control capture runs FIRST: 408 generations against the
  // same seam, so the failure classes only generation can surface (a domain
  // member with no finite median, a rostered player outside the domain) cost
  // 408 runs to discover, not 14,688 - and the ordering matches the direction
  // section 8.6.0 pins for the preflight block (permutation control before
  // candidate cells).
  const capture = await inputsPermutationCapture.capturePermutationControlObservations({
    weekArtifacts,
    baseConstants: model.MODEL_CONSTANTS,
    scoringHashFor,
    generate,
    seedFor,
  });
  const permutationControl = buildPermutationControlBlock({
    capture, rosterIndexByWeek, cohortIndexByWeek, ranks,
  });

  const records = await inputsGeneration.generateSweepInputRecords({
    weekArtifacts,
    baseConstants: model.MODEL_CONSTANTS,
    scoringHashFor,
    generate,
    seedFor,
    benchmarkProjectionsFor,
    availabilityFor,
    optimize: optimalAssignment,
  });

  assertGridComplete(records.counts);

  // The determination-7 interim checkpoint, written BEFORE the sensitivity
  // passes when asked for: it exists so a failure downstream of generation
  // costs one assembly pass rather than a regeneration, which only works if
  // it is on disk before the passes that might fail.
  if (args.recordsOut) {
    const serializedRecords = serializeArtifact(buildArtifact(records, { permutationControl, permutationCounts: capture.counts }));
    // args.recordsOut is the operator's own CLI argument to this
    // locally-invoked tool.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    fs.mkdirSync(path.dirname(path.resolve(String(args.recordsOut))), { recursive: true });
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    fs.writeFileSync(path.resolve(String(args.recordsOut)), serializedRecords, 'utf8');
    console.log(`wrote inputs generation records checkpoint to ${args.recordsOut}`);
  }

  // --- the sensitivity comparison passes + final assembly (increment 5) ----
  // Prereg 5.2's two ordering variants and prereg 5.3's force-fill estimand,
  // each a complete variant document evaluated through the reducer's own
  // exported claim assembly, then compared against the primary and baked into
  // the validated final document. See lib/inputsSensitivity's docblock for
  // determinations 9-11.
  const { document, sensitivity } = assembleFinalDocument({
    records, permutationControl, canariesPassed,
  });

  writeInputsDocument({
    outPath: args.out,
    document,
    sensitivity,
    gridGenerations: records.counts.generations,
    captureGenerations: capture.counts.generations,
    source: 'generated',
  });
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = {
  STUDY_ID,
  parseArgs,
  runCanaries,
  verifyRosterFreezeHash,
  verifyCohortFreezeHash,
  buildBenchmarkPriorGamesIndex,
  benchmarkProjectionsForWeek,
  assertNumericPlayerIds,
  makeGenerate,
  seedFor,
  numericOutcomeTruthMap,
  buildPermutationControlBlock,
  buildArtifact,
  assertRecordsArtifactShape,
  loadRecordsArtifact,
  serializeArtifact,
  serializeInputsDocument,
  assembleFinalDocument,
  assertGridComplete,
  main,
};
