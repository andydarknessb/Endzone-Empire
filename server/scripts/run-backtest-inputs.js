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
 * WHAT IT WRITES, AND WHY NOT THE `--inputs` DOCUMENT ITSELF
 *
 * `assembleSweepInputs` additionally requires `permutationControl`
 * (increment 4), `orderingSensitivityByCell` (a SECOND full reducer pass
 * under the ordering variant, so it belongs to whatever owns both passes),
 * `studyId` and the three canary booleans. This script therefore stops one
 * step short by design: it writes the GENERATION RECORDS (`armWeekMetrics`,
 * `subgroupErrorRows`, `activationRecords`, `preflight`) plus their counts,
 * and assembly happens once those inputs exist. Writing a half-populated
 * document here would produce something that looks assemblable and is not.
 *
 * Whether that intermediate records artifact should exist AT ALL, rather than
 * only ever writing the complete `--inputs` document, is producer-side
 * DETERMINATION 7 and rides with the B3 deferral batch. It is not settled
 * here. The case for it is run economics - generation is 14,688 real
 * projection runs plus the permutation control, and increment 3's own risk A
 * expects the first authoritative run to die on baseline coverage, so a
 * checkpoint between generation and assembly makes that failure cost one
 * assembly pass instead of a full regeneration. The case against is that an
 * intermediate artifact is an interface appearing nowhere in the sealed spec.
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
const inputsGeneration = require('../../scripts/backtest/lib/inputsGeneration');
const ordering = require('../../scripts/backtest/lib/ordering');
const rostersLib = require('../../scripts/backtest/lib/rosters');
const naive = require('../../scripts/backtest/lib/naive');
const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');
const { PRIMARY_SCORING_PROFILE } = require('../../scripts/backtest/lib/freezeManifest');
const { makeSourceReader } = require('../../scripts/backtest/snapshot-checks');

// Reused verbatim rather than re-derived: the two scripts must load the SAME
// Commit-A artifacts the same way and reconstruct the SAME weeks the same way.
// A second, independently-written copy of either is precisely how the MDE's
// control cell and the sweep's control cell would end up computed against
// subtly different reconstructions.
const mdeScript = require('./run-backtest-mde');
const rostersScript = require('./run-backtest-rosters');

const { generateProjections } = require('../services/projection.service');
const { availabilityFor } = require('../services/projectionModel');
const { optimalAssignment } = require('../services/lineupOptimizer');
const model = require('../services/projectionModel');
const { SCORING_PRESETS, calculateFantasyPoints } = require('../services/scoring.service');
const { usageFromStats } = require('../services/projectionFeatures');

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
    rehydratedSnapshot: null, rehydratedSources: null, rosters: null, cohort: null, out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--rehydrated-snapshot') args.rehydratedSnapshot = requireFlagValue(argv, ++i, token);
    else if (token === '--rehydrated-sources') args.rehydratedSources = requireFlagValue(argv, ++i, token);
    else if (token === '--rosters') args.rosters = requireFlagValue(argv, ++i, token);
    else if (token === '--cohort') args.cohort = requireFlagValue(argv, ++i, token);
    else if (token === '--out') args.out = requireFlagValue(argv, ++i, token);
    else throw new Error(`run-backtest-inputs: unknown argument ${token}`);
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
 * converted at the call site below. That asymmetry is the tell that made this
 * defect invisible - one map was known to need conversion and the other was
 * assumed not to.
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

// ---------------------------------------------------------------------------
// The written artifact
// ---------------------------------------------------------------------------

/**
 * The generation-records bundle. Environment-free on the same terms as the MDE
 * artifact (`assertEnvironmentFree` is reused, not re-implemented): no Node
 * version, no absolute path, no timestamp - runtime identity belongs only to
 * freeze Commit B's manifest.
 */
function buildArtifact(records) {
  return {
    armWeekMetrics: records.armWeekMetrics,
    subgroupErrorRows: records.subgroupErrorRows,
    activationRecords: records.activationRecords,
    preflight: records.preflight,
    counts: records.counts,
  };
}

function serializeArtifact(artifact) {
  const serialized = `${canonicalJson(artifact)}\n`;
  mdeScript.assertEnvironmentFree(serialized, { label: 'inputs-generation-records' });
  return serialized;
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

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(argv) {
  const args = parseArgs(argv);

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
        actualPointsByPlayerId: new Map(Object.entries(cohortWeek.actualPointsByPlayerId || {}).map(
          ([id, points]) => [Number(id), points]
        )),
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

  const serialized = serializeArtifact(buildArtifact(records));
  // args.out is the operator's own CLI argument to this locally-invoked tool.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  fs.mkdirSync(path.dirname(path.resolve(String(args.out))), { recursive: true });
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  fs.writeFileSync(path.resolve(String(args.out)), serialized, 'utf8');
  console.log(`wrote inputs generation records to ${args.out} (${records.counts.generations} generations)`);
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
  parseArgs,
  verifyRosterFreezeHash,
  verifyCohortFreezeHash,
  buildBenchmarkPriorGamesIndex,
  benchmarkProjectionsForWeek,
  assertNumericPlayerIds,
  makeGenerate,
  seedFor,
  buildArtifact,
  serializeArtifact,
  assertGridComplete,
  main,
};
