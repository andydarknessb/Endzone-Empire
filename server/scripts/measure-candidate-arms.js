/* eslint-disable no-console */
'use strict';

/**
 * REBUILT MEASUREMENT HARNESS for Candidate A (holdout-confirm-2026): the
 * lineup-regret difference between ranking by the distribution MEDIAN (what
 * production ships) and ranking by its MEAN.
 *
 * WHY THIS FILE EXISTS
 *
 * The figures that motivate Candidate A - control regret 25.915, candidate
 * 24.016, a -1.90 per-roster-week difference - were produced by an exploratory
 * harness that lived in an ephemeral scratchpad and no longer exists. They
 * survive only as prose in `ac4c1b6`'s commit message and in the
 * preregistration's motivation section. The preregistration is about to be
 * SEALED, and sealing a document whose motivating record cannot be recomputed
 * is the failure this file exists to prevent. The INPUTS survived - 34
 * cohort-week and 34 roster-week artifacts, committed, each carrying its own
 * freezeHash - so the measurement is recoverable even though the harness is not.
 *
 * WHAT AN "ARM" IS HERE, AND WHY NO MODEL CHANGE IS NEEDED
 *
 * Both arms read the SAME generated distributions. They differ only in which
 * statistic the lineup optimizer is allowed to see, and `lib/policy.pointsValue`
 * already makes that a one-line choice at the call site:
 *
 *     pointsValue(projection) =
 *       projection is an OBJECT -> projection.median
 *       projection is a NUMBER  -> the number itself
 *
 * So passing the projection objects ranks by median, and passing a number ranks
 * by that number. Nothing in the model, the optimizer or the policy wrapper is
 * modified or re-implemented: both arms go through the real
 * `policy.deployedPolicyLineup` -> `lineupOptimizer.optimalAssignment` path and
 * are scored by the real `policy.regretFor` / `metrics.weekRegret`. Generation
 * runs ONCE per week for both arms - a ranking rule cannot change a projection,
 * and generating twice would invite a difference that is not the one measured.
 *
 * "MEAN" HERE IS PRODUCTION'S RANKING RULE, NOT A DISTRIBUTIONAL ARGUMENT
 *
 * `projection.mean` is the model's PRE-SIMULATION point estimate
 * (`projectionModel.js:1212` returns `mean: round2(mean)`), not the arithmetic
 * mean of the 400 simulated draws; only `median` is a statistic OF the draws.
 * So this arm is defined as "what production does at
 * `MODEL_CONSTANTS.decision.lineupRanking = 'mean'`", and its fallback mirrors
 * `decision.service.js:177-184` exactly: a non-finite mean falls back to the
 * DISPLAYED points (the median), not to zero. One consequence is worth stating
 * because it is evidence in its own right: the mean arm is invariant to the
 * draw seed, while the median arm is not.
 *
 * SINGLE REALIZATION - READ BEFORE COMPARING TO ANY PUBLISHED NUMBER
 *
 * This harness reports ONE draw realization at the shipped `scoringHash`. The
 * sealed pit-sweep publishes BOTH bases for the same cell, and they differ by
 * about a point: for 2025 / `usage-25-off` / half_ppr,
 * `freeze/mde-artifact.json`'s `controlRegretWeeks` mean is 28.2238 (one
 * realization) while `report.json`'s `evidence.cells[2].absoluteMetrics[0].point`
 * is 27.1876 (realization-averaged) - a gap of 1.036. This harness's 2025
 * control arm reproduces the FREEZE series exactly, week for week, which is the
 * affirmative check that it measures the right estimand. A level difference of
 * roughly a point against a realization-averaged figure is therefore expected
 * and is NOT evidence of a defect.
 *
 * WHY IT REUSES `evaluateControlWeek` RATHER THAN COPYING THE ROSTER LOOP
 *
 * `controlCellEvaluator.evaluateControlWeek` takes `projectionsByPlayerId` as a
 * parameter and resolves no constants and no cell of its own. The blinding that
 * module documents - "takes no `cell` parameter and no constants override" -
 * lives in its OUTER function, `evaluateControlCell`, which is what feeds
 * `lib/mde.js`. This harness never calls `evaluateControlCell` and never calls
 * `runMde`, so it neither uses nor weakens that boundary; it reuses the
 * per-week roster loop precisely so a hand-copied version cannot drift from the
 * one the sealed study runs.
 *
 * SCOPE LIMIT, STATED PLAINLY
 *
 * On the frozen pit-sweep corpus the availability wrapper is effectively inert:
 * across all 34 cohort artifacts there are 17,946 members with ZERO non-null
 * `injuryStatus` and 64 bye rows. IR removal, locked-starter pinning and the
 * doubtful-on-bench asymmetry never bind here, so this figure is a
 * distributions-and-optimizer comparison rather than a full deployed-policy
 * reconstruction.
 *
 * WHY IT LIVES UNDER server/scripts/, NOT scripts/backtest/
 *
 * Same reason `run-backtest-mde.js` gives: the generation seam has to BE
 * `projection.service.generateProjections` against a reconstructed snapshot
 * client, and `scripts/backtest/lib/*` is deliberately kept unable to reach it.
 *
 * INPUTS
 *
 * `--snapshot` / `--sources` are the REHYDRATED outputs of
 * `scripts/backtest/rehydrate.js` over the committed, hash-verified corpus in
 * `backtest-data/publish/`. Do NOT point them at `backtest-data/snapshot/`:
 * that is the packager's local dry-run output, an input to packaging rather
 * than to measurement, and it is not the sealed corpus.
 *
 * WHAT THIS IS NOT
 *
 * Not the study, and not evidence for it. This recomputes a MOTIVATING figure
 * so the preregistration's rationale can be checked before sealing. The study
 * itself is prospective and runs on the 2026 holdout ledger.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const snapshotClientLib = require('../../scripts/backtest/lib/snapshotClient');
const controlCellEvaluator = require('../../scripts/backtest/lib/controlCellEvaluator');
const ordering = require('../../scripts/backtest/lib/ordering');
const rostersLib = require('../../scripts/backtest/lib/rosters');
const metrics = require('../../scripts/backtest/lib/metrics');
const rootSafety = require('../../scripts/backtest/lib/rootSafety');
const { isFiniteNumber } = require('../../scripts/backtest/lib/numbers');
const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');
const { makeSourceReader } = require('../../scripts/backtest/snapshot-checks');
// `loadWeekArtifactsFromDir` and `buildReconstruction` are exported by the MDE
// runner and reused verbatim, so the artifacts are loaded and the as-of view is
// reconstructed EXACTLY as the sealed pipeline does. Requiring it is safe: its
// CLI entry is behind `require.main === module`.
const mdeRunner = require('./run-backtest-mde');

const { generateProjections } = require('../services/projection.service');
const { availabilityFor } = require('../services/projectionModel');
const { optimalAssignment } = require('../services/lineupOptimizer');
const model = require('../services/projectionModel');
const { SCORING_RULES } = require('../services/scoring.service');
// The holdout ledger's own provenance fingerprint, not a second definition of
// one: recording it ties a measurement to the exact constants that produced it.
const { constantsHash } = require('../services/holdout.service');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** The measurement's definition. A corpus that is not exactly this is refused. */
const EXPECTED_SEASONS = Object.freeze([2024, 2025]);
const EXPECTED_WEEKS = metrics.EVALUATED_WEEKS;
const OUTPUT_BASENAME = 'candidate-arms.json';

/**
 * The two arms. `rank` maps a generated projection to whatever the optimizer
 * should rank on, exploiting `policy.pointsValue`'s object-vs-number rule.
 */
const ARMS = Object.freeze([
  { key: 'median', label: 'control (rank by median)', rank: (p) => p },
  {
    key: 'mean',
    label: 'candidate A (rank by mean)',
    // Mirrors `decision.service.js:177-184`, the production behaviour at
    // `lineupRanking: 'mean'`: rank on the mean when it is finite, and fall back
    // to the DISPLAYED points (the median) when the projection has no usable
    // mean. Returning a non-finite mean unchanged would coerce to 0 through
    // `pointsValue` and bench a player production would still start, which is a
    // different policy from the one under measurement.
    rank: (p) => {
      if (!p || typeof p !== 'object') return p;
      return isFiniteNumber(p.mean) ? p.mean : p.median;
    },
  },
]);

/**
 * The figures this harness exists to check, quoted from `ac4c1b6`'s commit
 * message. REFERENCE ONLY, never asserted: a mismatch is a finding to
 * investigate, not a failure to suppress. Their draw-realization basis is
 * NOT established equal to this harness's, so they are printed apart from the
 * measured values rather than beside them.
 */
const REPORTED = Object.freeze({
  medianRegret: 25.915,
  meanRegret: 24.016,
  delta: -1.899,
  bySeason: { 2024: -1.74, 2025: -2.06 },
  basis: 'lost exploratory harness (ac4c1b6 commit message, PREREGISTRATION.md:54); '
    + 'draw-realization basis unknown and not established equal to this harness',
});

function requireFlagValue(argv, index, flagName) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`measure-candidate-arms: ${flagName} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--snapshot') args.snapshot = requireFlagValue(argv, ++i, '--snapshot');
    else if (token === '--sources') args.sources = requireFlagValue(argv, ++i, '--sources');
    else if (token === '--cohort') args.cohort = requireFlagValue(argv, ++i, '--cohort');
    else if (token === '--rosters') args.rosters = requireFlagValue(argv, ++i, '--rosters');
    else if (token === '--out') args.out = requireFlagValue(argv, ++i, '--out');
    else throw new Error(`measure-candidate-arms: unknown argument ${token}`);
  }
  for (const key of ['snapshot', 'sources', 'cohort', 'rosters']) {
    if (!args[key]) throw new Error(`measure-candidate-arms: --${key} is required`);
  }
  return args;
}

/**
 * Resolve ANY input path the way `--out` is resolved: against REPO_ROOT, never
 * `process.cwd()`. A relative `--cohort`/`--rosters` decides the ANSWER, so it
 * must mean the same directory from every working directory. Leaving these
 * cwd-relative while anchoring only the output made a documented command line
 * silently measure a different corpus when run from elsewhere.
 */
function resolveInputPath(value, flagName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`measure-candidate-arms: ${flagName} must be a non-empty path`);
  }
  rootSafety.assertNotUncFormPath(value, `measure-candidate-arms: ${flagName}`);
  // The suppression must stay on the line DIRECTLY above the call: Semgrep
  // honours `nosemgrep` only on the finding's own line or the one immediately
  // preceding it, so a comment inserted between the two un-suppresses the rule.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return path.resolve(REPO_ROOT, value);
}

/**
 * The ONE place `--out` becomes a path on disk, and it takes a DIRECTORY.
 *
 * Containment inside the repository is proven here rather than argued from the
 * value's provenance. But containment alone is not write safety - the
 * repository is exactly where the valuable files are - so the filename is a
 * module constant and never operator input, matching
 * `run-holdout-confirm.js:192-197`. Taking a full file path would have let
 * `--out server/services/projectionModel.js` overwrite tracked source.
 */
function resolveOutFile(outDirArg) {
  if (typeof outDirArg !== 'string' || outDirArg.trim() === '') {
    throw new Error('measure-candidate-arms: --out must be a non-empty directory path');
  }
  rootSafety.assertNotUncFormPath(outDirArg, 'measure-candidate-arms: --out');
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolved = path.resolve(REPO_ROOT, outDirArg);
  const rootCmp = rootSafety.normalizeForCompare(rootSafety.canonicalizeForCompare(REPO_ROOT));
  const outCmp = rootSafety.normalizeForCompare(rootSafety.canonicalizeForCompare(resolved));
  if (!rootSafety.isContainedIn(rootCmp, outCmp)) {
    throw new Error(
      `measure-candidate-arms: --out (${outDirArg}) resolves to ${resolved}, which is not a `
      + 'directory inside this repository'
    );
  }
  return {
    dir: resolved,
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    file: path.join(resolved, OUTPUT_BASENAME),
  };
}

/** Mirrors `run-backtest-mde.js`'s `verifyCohortFreezeHash`, which it does not export. */
function verifyCohortFreezeHash(parsed) {
  if (!Array.isArray(parsed.members)) {
    throw new Error(
      `measure-candidate-arms: --cohort artifact for ${parsed.season}w${parsed.week} has no members[] `
      + '- is --cohort pointed at the roster-weeks directory?'
    );
  }
  const { freezeHash: _stored, ...rest } = parsed;
  return crypto.createHash('sha256').update(canonicalJson(rest), 'utf8').digest('hex');
}

/** Mirrors `run-backtest-mde.js`'s `verifyRosterFreezeHash`. */
function verifyRosterFreezeHash(parsed) {
  if (!Array.isArray(parsed.rosters)) {
    throw new Error(
      `measure-candidate-arms: --rosters artifact for ${parsed.season}w${parsed.week} has no rosters[] `
      + '- is --rosters pointed at the cohort-weeks directory?'
    );
  }
  return rostersLib.freezeHash(parsed);
}

/**
 * Refuse a corpus that is not exactly the measurement's definition.
 *
 * The sealed module this file reuses does the same thing
 * (`evaluateControlCell` throws "all 17 primary weeks are required"), and the
 * reason is sharp here: a 2024-only 17-week corpus produces a control level of
 * 25.861, which is 0.054 from the very figure under audit. Silently averaging
 * whatever .json files happen to be in a directory would let a truncated corpus
 * read as a near-confirmation of the hypothesis being tested.
 */
function assertExpectedCoverage(keys, label) {
  const expected = new Set();
  for (const season of EXPECTED_SEASONS) for (const week of EXPECTED_WEEKS) expected.add(`${season}:${week}`);
  const got = new Set(keys);
  const missing = [...expected].filter((k) => !got.has(k));
  const extra = [...got].filter((k) => !expected.has(k));
  if (missing.length || extra.length) {
    throw new Error(
      `measure-candidate-arms: ${label} is not the measurement's corpus. Expected ${expected.size} `
      + `season-weeks (seasons ${EXPECTED_SEASONS.join(', ')}, weeks ${EXPECTED_WEEKS[0]}-`
      + `${EXPECTED_WEEKS[EXPECTED_WEEKS.length - 1]}), got ${got.size}.`
      + (missing.length ? ` Missing: ${missing.join(', ')}.` : '')
      + (extra.length ? ` Unexpected: ${extra.join(', ')}.` : '')
    );
  }
}

/** Arithmetic mean, refusing an empty series or any non-number rather than reporting 0. */
function meanOf(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`measure-candidate-arms: ${label} has no values, and 0 would be a lie`);
  }
  let total = 0;
  for (const v of values) {
    // `isFiniteNumber`, not `Number.isFinite(Number(v))`: `Number(null)` is 0
    // and finite, so the naive guard would average a null in as a real zero -
    // precisely the lie the empty-series check above refuses.
    if (!isFiniteNumber(v)) {
      throw new Error(`measure-candidate-arms: ${label} contains a non-numeric value ${JSON.stringify(v)}`);
    }
    total += Number(v);
  }
  return total / values.length;
}

/** playerId -> ranking value for one arm, from the generated projection map. */
function armProjections(projectionsMap, arm) {
  const out = new Map();
  for (const [playerId, projection] of projectionsMap) out.set(playerId, arm.rank(projection));
  return out;
}

/**
 * How many cohort projections this week actually carry dispersion, i.e. where
 * the two arms CAN differ. Early weeks have too few residuals for
 * `simulateDistribution` to produce an interval at all, so it returns the point
 * estimate for both statistics and the arms coincide by construction. Such a
 * week contributes a real 0 to the delta and must be visible as inert rather
 * than read as "the candidate did not help here".
 */
function dispersedCount(projectionsMap) {
  let n = 0;
  for (const p of projectionsMap.values()) {
    if (p && typeof p === 'object' && isFiniteNumber(p.p10) && isFiniteNumber(p.p90) && p.mean !== p.median) n++;
  }
  return n;
}

/** sha256 over the sorted `season:week -> freezeHash` pairs of one artifact set. */
function freezeRollup(indexByWeek) {
  const pairs = Object.keys(indexByWeek).sort().map((k) => [k, indexByWeek[k].freezeHash]);
  return crypto.createHash('sha256').update(canonicalJson(pairs), 'utf8').digest('hex');
}

async function main(argv) {
  const args = parseArgs(argv);
  const out = args.out ? resolveOutFile(args.out) : null;
  const inputs = {
    snapshot: resolveInputPath(args.snapshot, '--snapshot'),
    sources: resolveInputPath(args.sources, '--sources'),
    cohort: resolveInputPath(args.cohort, '--cohort'),
    rosters: resolveInputPath(args.rosters, '--rosters'),
  };

  const snapshot = snapshotClientLib.loadSnapshot({ root: inputs.snapshot });
  const readSource = makeSourceReader({
    sourcesDir: inputs.sources,
    // `inputs.sources` is already resolved and joined only with a hardcoded
    // literal filename - not external input.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    provenancePath: path.join(inputs.sources, 'provenance.json'),
  });

  const rosterIndexByWeek = mdeRunner.loadWeekArtifactsFromDir(inputs.rosters, {
    label: 'measure-candidate-arms --rosters', verifyFreezeHash: verifyRosterFreezeHash,
  });
  const cohortIndexByWeek = mdeRunner.loadWeekArtifactsFromDir(inputs.cohort, {
    label: 'measure-candidate-arms --cohort', verifyFreezeHash: verifyCohortFreezeHash,
  });
  assertExpectedCoverage(Object.keys(rosterIndexByWeek), '--rosters');
  assertExpectedCoverage(Object.keys(cohortIndexByWeek), '--cohort');

  const provenance = {
    inputs,
    rosterFreezeRollup: freezeRollup(rosterIndexByWeek),
    cohortFreezeRollup: freezeRollup(cohortIndexByWeek),
    evaluatedWeeks: [...EXPECTED_WEEKS],
    seasons: [...EXPECTED_SEASONS],
    ordering: ordering.ORDERINGS.PRIMARY,
    rosterSlots: rostersLib.DEFAULT_ROSTER_SLOTS,
    scoringHash: model.scoringHash(SCORING_RULES),
    modelVersion: model.MODEL_VERSION,
    constantsHash: constantsHash(model.MODEL_CONSTANTS),
    realizationBasis: 'single draw realization at the shipped scoringHash',
  };
  console.log(`corpus  rosters ${provenance.rosterFreezeRollup.slice(0, 16)}  cohort ${provenance.cohortFreezeRollup.slice(0, 16)}`);
  console.log(`constants ${provenance.constantsHash.slice(0, 16)}  model ${provenance.modelVersion}  scoring ${provenance.scoringHash.slice(0, 16)}`);
  console.log(`inputs  --rosters ${path.relative(REPO_ROOT, inputs.rosters)}  --cohort ${path.relative(REPO_ROOT, inputs.cohort)}`);

  const ranks = ordering.buildRankIndex({
    positionRankRows: snapshot.positionRank,
    playerNameRankRows: snapshot.playerNameRank,
    label: 'measure-candidate-arms ranking',
  });

  const keys = Object.keys(rosterIndexByWeek).sort((a, b) => {
    const [as, aw] = a.split(':').map(Number);
    const [bs, bw] = b.split(':').map(Number);
    return as - bs || aw - bw;
  });

  // One reconstruction per season: `buildReconstruction` reads that season's
  // roster_weekly source, so a single shared bundle would silently answer every
  // week with one season's roster history.
  const reconstructionBySeason = new Map();
  for (const season of EXPECTED_SEASONS) {
    reconstructionBySeason.set(season, mdeRunner.buildReconstruction({ readSource, snapshot, season }));
  }

  const weekRows = [];
  for (const key of keys) {
    const [season, week] = key.split(':').map(Number);
    const rosterWeek = rosterIndexByWeek[key];
    const cohortWeek = cohortIndexByWeek[key];
    if (!cohortWeek) throw new Error(`measure-candidate-arms: no cohort artifact for ${key}`);

    const cohortPlayerIds = cohortWeek.members.map((m) => m.playerId);
    const { projections } = await generateProjections({
      season,
      week,
      rules: SCORING_RULES,
      playerIds: cohortPlayerIds,
      hashValue: model.scoringHash(SCORING_RULES),
      client: snapshotClientLib.createSnapshotClient({
        snapshot,
        season,
        week,
        mode: snapshotClientLib.MODES.RECONSTRUCTED,
        reconstruction: reconstructionBySeason.get(season),
      }),
      weatherService: false,
      modelConstants: model.MODEL_CONSTANTS,
    });

    const normalizedCohortWeek = {
      ...cohortWeek,
      actualPointsByPlayerId: new Map(
        Object.entries(cohortWeek.actualPointsByPlayerId || {}).map(([id, points]) => [Number(id), points])
      ),
    };

    const row = { season, week, regret: {}, dispersed: dispersedCount(projections) };
    for (const arm of ARMS) {
      const evaluation = controlCellEvaluator.evaluateControlWeek({
        season,
        week,
        rosterWeek,
        cohortWeek: normalizedCohortWeek,
        projectionsByPlayerId: armProjections(projections, arm),
        positionRank: ranks.positionRank,
        nameRankById: ranks.nameRankById,
        availabilityFor,
        optimize: optimalAssignment,
        label: `measure-candidate-arms ${arm.key}`,
      });
      row.regret[arm.key] = evaluation.regret;
      row.rosterCount = evaluation.rosterCount;
    }
    row.delta = row.regret.mean - row.regret.median;
    row.inert = row.dispersed === 0;
    weekRows.push(row);
    console.log(
      `  ${season} w${String(week).padStart(2)}  median ${row.regret.median.toFixed(3)}`
      + `  mean ${row.regret.mean.toFixed(3)}  delta ${row.delta >= 0 ? '+' : ''}${row.delta.toFixed(3)}`
      + `  dispersed ${String(row.dispersed).padStart(3)}${row.inert ? '  [inert: no dispersion]' : ''}`
    );
  }

  // The printed label and the roster-week total both assume every week carries
  // the same roster count (TEAM_COUNT * REPLICATES by construction). Assert it
  // rather than let a mean-of-week-means be reported as a per-roster-week mean.
  const uniqueRosterCounts = [...new Set(weekRows.map((r) => r.rosterCount))];
  if (uniqueRosterCounts.length !== 1) {
    throw new Error(
      `measure-candidate-arms: roster counts differ across weeks (${uniqueRosterCounts.join(', ')}), so a `
      + 'mean of week-means is not a per-roster-week mean'
    );
  }

  const overall = {};
  for (const arm of ARMS) overall[arm.key] = meanOf(weekRows.map((r) => r.regret[arm.key]), `overall ${arm.key}`);
  overall.delta = overall.mean - overall.median;

  const live = weekRows.filter((r) => !r.inert);
  overall.deltaExcludingInert = live.length
    ? meanOf(live.map((r) => r.regret.mean), 'live mean') - meanOf(live.map((r) => r.regret.median), 'live median')
    : null;

  const bySeason = {};
  for (const season of EXPECTED_SEASONS) {
    const rows = weekRows.filter((r) => r.season === season);
    const entry = {};
    for (const arm of ARMS) entry[arm.key] = meanOf(rows.map((r) => r.regret[arm.key]), `${season} ${arm.key}`);
    entry.delta = entry.mean - entry.median;
    entry.weeks = rows.length;
    entry.inertWeeks = rows.filter((r) => r.inert).length;
    bySeason[season] = entry;
  }

  const result = {
    generatedBy: 'server/scripts/measure-candidate-arms.js',
    provenance,
    weeks: weekRows.length,
    rosterWeeks: weekRows.reduce((n, r) => n + r.rosterCount, 0),
    overall,
    bySeason,
    reference: REPORTED,
    weekRows,
  };

  console.log('\n--- MEASURED (mean over weeks of per-roster-week regret, single realization) ---');
  console.log(`  control (median) : ${overall.median.toFixed(3)}`);
  console.log(`  candidate (mean) : ${overall.mean.toFixed(3)}`);
  console.log(`  delta            : ${overall.delta.toFixed(3)}`);
  if (overall.deltaExcludingInert !== null) {
    console.log(`  delta ex-inert   : ${overall.deltaExcludingInert.toFixed(3)} (${live.length} of ${weekRows.length} weeks)`);
  }
  for (const season of EXPECTED_SEASONS) {
    console.log(
      `  ${season}             : median ${bySeason[season].median.toFixed(3)}  mean ${bySeason[season].mean.toFixed(3)}`
      + `  delta ${bySeason[season].delta.toFixed(3)}  (${bySeason[season].weeks} weeks,`
      + ` ${bySeason[season].inertWeeks} inert)`
    );
  }
  console.log(`  roster-weeks     : ${result.rosterWeeks}`);

  console.log('\n--- REFERENCE (not a comparison: basis not established equal) ---');
  console.log(`  ${REPORTED.basis}`);
  console.log(`  median ${REPORTED.medianRegret}, mean ${REPORTED.meanRegret}, delta ${REPORTED.delta}`);
  console.log('  The sealed study publishes both a single-realization and a realization-averaged');
  console.log('  control regret for the same cell, differing by ~1.0 point, so a level difference of');
  console.log('  that order against a realization-averaged figure is expected, not a defect.');

  if (out) {
    fs.mkdirSync(out.dir, { recursive: true });
    fs.writeFileSync(out.file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(`\nwrote ${path.relative(REPO_ROOT, out.file)}`);
  }
  return result;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = {
  ARMS,
  REPORTED,
  EXPECTED_SEASONS,
  EXPECTED_WEEKS,
  OUTPUT_BASENAME,
  parseArgs,
  resolveInputPath,
  resolveOutFile,
  assertExpectedCoverage,
  armProjections,
  meanOf,
  dispersedCount,
  verifyCohortFreezeHash,
  verifyRosterFreezeHash,
  main,
};
