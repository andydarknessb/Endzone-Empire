/* eslint-disable no-console */
'use strict';

/**
 * REBUILT MEASUREMENT HARNESS for Candidate B (holdout-confirm-2026): whether
 * the smoothed bootstrap's calibration gate is PASSABLE, and at what power.
 *
 * WHY THIS FILE EXISTS
 *
 * The preregistration states Candidate A's power and states NO power for
 * Candidate B, whose gate is strictly harsher: an intersection-union test
 * requiring three components to pass simultaneously at alpha 1/120, plus two
 * hard point-estimate bands. The document is about to be sealed. Sealing a
 * gate whose power nobody has computed - and which section 1 already concedes
 * may not transfer, because the shipped model measures 0.745/0.692 coverage
 * against the 0.647 the bandwidth was fit on - is the failure this file exists
 * to prevent.
 *
 * WHAT IT MEASURES
 *
 * Per week, the same cohort is generated THREE times: control at the shipped
 * `MODEL_CONSTANTS`, and each sealed candidate cell at its own resolved
 * constants, taken from `holdout.service.CANDIDATE_ARMS` and
 * `resolveCandidateConstants` rather than restated here, so a change to the
 * sealed arms cannot silently diverge from what this measures. Unlike
 * Candidate A - where one generation serves both arms because only the ranking
 * rule differs - Candidate B changes the DISTRIBUTION, so each cell needs its
 * own generation.
 *
 * Each arm-week goes through the real `scripts/holdout/lib/coverage.js`
 * (`armWeekMetrics`), and the contrast is section 7's calibration distance:
 *
 *     D80_X(w) = |cov80_X(w) - 0.80|      T80(w) = D80_ctrl(w) - D80_cand(w)
 *     D50_X(w) = |cov50_X(w) - 0.50|      T50(w) = D50_ctrl(w) - D50_cand(w)
 *
 * positive favourable, with the WIS no-harm component as `wis_cand - wis_ctrl`
 * bounded above by +0.05. Bounds come from the real
 * `scripts/holdout/lib/inference.js` at the sealed draws and seed.
 *
 * WHAT THIS IS NOT
 *
 * Not the study, and not evidence for it. The study is prospective and runs on
 * the 2026 holdout ledger. This recomputes an exploratory figure so the gate's
 * passability can be judged BEFORE the document is sealed, on the same frozen
 * artifacts the preregistration's own motivation cites.
 *
 * A single draw realization, at the shipped `scoringHash`. See
 * `measure-candidate-arms.js`'s docblock: the sealed study publishes both a
 * single-realization and a realization-averaged figure for the same cell, and
 * they differ by about a point. Levels here are realization-dependent; the
 * PAIRED contrasts are the evidence.
 */

const fs = require('fs');
const path = require('path');

const snapshotClientLib = require('../../scripts/backtest/lib/snapshotClient');
const { makeSourceReader } = require('../../scripts/backtest/snapshot-checks');
const coverage = require('../../scripts/holdout/lib/coverage');
const inference = require('../../scripts/holdout/lib/inference');
const mdeRunner = require('./run-backtest-mde');
const shared = require('./measure-candidate-arms');

const { generateProjections } = require('../services/projection.service');
const model = require('../services/projectionModel');
const { SCORING_RULES } = require('../services/scoring.service');
const holdout = require('../services/holdout.service');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_BASENAME = 'candidate-b.json';

/** The sealed inference constants, quoted from PREREGISTRATION.md section 10. */
const BOOTSTRAP_DRAWS = 100000;
const BOOTSTRAP_SEED = 2579717975;
/** Section 8.2: per-cell alpha 0.025, three components, divisor 3. */
const COMPONENT_ALPHA = 0.025 / 3;
/** Section 8.2's WIS no-harm margin. */
const WIS_MARGIN = 0.05;
/** Section 8.2's hard point-estimate bands. */
const BANDS = Object.freeze({ cov80: [0.75, 0.85], cov50: [0.45, 0.55] });

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const take = (flag) => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`measure-candidate-b: ${flag} requires a value`);
      return v;
    };
    if (token === '--snapshot') args.snapshot = take('--snapshot');
    else if (token === '--sources') args.sources = take('--sources');
    else if (token === '--cohort') args.cohort = take('--cohort');
    else if (token === '--rosters') args.rosters = take('--rosters');
    else if (token === '--out') args.out = take('--out');
    else throw new Error(`measure-candidate-b: unknown argument ${token}`);
  }
  for (const key of ['snapshot', 'sources', 'cohort', 'rosters']) {
    if (!args[key]) throw new Error(`measure-candidate-b: --${key} is required`);
  }
  return args;
}

/** Rows in the shape `coverage.armWeekMetrics` reads, from a generated map. */
function rowsFrom(projectionsMap, playerIds) {
  const rows = [];
  for (const playerId of playerIds) {
    const p = projectionsMap.get(playerId);
    if (!p || typeof p !== 'object') continue;
    rows.push({
      playerId,
      activeProbability: p.activeProbability,
      median: p.median,
      p10: p.p10,
      p25: p.p25,
      p75: p.p75,
      p90: p.p90,
    });
  }
  return rows;
}

/** Section 7's calibration distance contrast. Positive favours the candidate. */
function contrast(controlValue, candidateValue, target) {
  if (controlValue === null || candidateValue === null) return null;
  return Math.abs(controlValue - target) - Math.abs(candidateValue - target);
}

function resolveOutputPath(outDirArg) {
  const { dir } = shared.resolveOutFile(outDirArg);
  return path.format({ dir, base: OUTPUT_BASENAME });
}

async function main(argv) {
  const args = parseArgs(argv);
  const out = args.out ? resolveOutputPath(args.out) : null;
  const inputs = {
    snapshot: shared.resolveInputPath(args.snapshot, '--snapshot'),
    sources: shared.resolveInputPath(args.sources, '--sources'),
    cohort: shared.resolveInputPath(args.cohort, '--cohort'),
    rosters: shared.resolveInputPath(args.rosters, '--rosters'),
  };

  const snapshot = snapshotClientLib.loadSnapshot({ root: inputs.snapshot });
  const readSource = makeSourceReader({
    sourcesDir: inputs.sources,
    // Resolved above and joined only with a hardcoded literal filename.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    provenancePath: path.join(inputs.sources, 'provenance.json'),
  });

  const cohortIndexByWeek = mdeRunner.loadWeekArtifactsFromDir(inputs.cohort, {
    label: 'measure-candidate-b --cohort', verifyFreezeHash: shared.verifyCohortFreezeHash,
  });
  shared.assertExpectedCoverage(Object.keys(cohortIndexByWeek), '--cohort');

  // Arms come from the SEALED definitions, never restated here.
  const cells = holdout.CANDIDATE_ARMS.map((arm) => ({
    kind: arm.kind,
    overrides: arm.overrides,
    constants: holdout.resolveCandidateConstants(arm.overrides),
  }));
  console.log(`cells: ${cells.map((c) => `${c.kind} (bw ${c.overrides.smoothingBandwidth}, scale ${c.overrides.intervalScale})`).join('; ')}`);
  console.log(`corpus cohort ${shared.freezeRollup(cohortIndexByWeek).slice(0, 16)}  constants ${holdout.constantsHash(model.MODEL_CONSTANTS).slice(0, 16)}`);

  const keys = Object.keys(cohortIndexByWeek).sort((a, b) => {
    const [as, aw] = a.split(':').map(Number);
    const [bs, bw] = b.split(':').map(Number);
    return as - bs || aw - bw;
  });

  const reconstructionBySeason = new Map();
  for (const season of shared.EXPECTED_SEASONS) {
    reconstructionBySeason.set(season, mdeRunner.buildReconstruction({ readSource, snapshot, season }));
  }

  const weekRows = [];
  for (const key of keys) {
    const [season, week] = key.split(':').map(Number);
    const cohortWeek = cohortIndexByWeek[key];
    const playerIds = cohortWeek.members.map((m) => m.playerId);
    const actuals = new Map(
      Object.entries(cohortWeek.actualPointsByPlayerId || {}).map(([id, pts]) => [`${season}:${week}:${Number(id)}`, pts])
    );

    const generate = async (modelConstants) => {
      const { projections } = await generateProjections({
        season,
        week,
        rules: SCORING_RULES,
        playerIds,
        hashValue: model.scoringHash(SCORING_RULES),
        client: snapshotClientLib.createSnapshotClient({
          snapshot, season, week, mode: snapshotClientLib.MODES.RECONSTRUCTED,
          reconstruction: reconstructionBySeason.get(season),
        }),
        weatherService: false,
        modelConstants,
      });
      return projections;
    };

    const controlProjections = await generate(model.MODEL_CONSTANTS);
    const controlMetrics = coverage.armWeekMetrics({
      rows: rowsFrom(controlProjections, playerIds), actuals, season, week,
    });

    const row = { season, week, control: controlMetrics, cells: {} };
    for (const cell of cells) {
      const projections = await generate(cell.constants);
      const metrics = coverage.armWeekMetrics({ rows: rowsFrom(projections, playerIds), actuals, season, week });
      row.cells[cell.kind] = {
        metrics,
        t80: contrast(controlMetrics.cov80, metrics.cov80, 0.80),
        t50: contrast(controlMetrics.cov50, metrics.cov50, 0.50),
        wisDelta: metrics.wis === null || controlMetrics.wis === null ? null : metrics.wis - controlMetrics.wis,
      };
    }
    // A week with no interval evidence at all produces NULL metrics, never a
    // fabricated zero (`armWeekMetrics`'s own contract). Section 4's rule is
    // that a week missing any arm drops for EVERY arm, symmetrically, so
    // survival is decided across control and both cells together rather than
    // per component - otherwise the three components would be bounded on three
    // different week sets and the intersection-union test would not be one test.
    row.survives = controlMetrics.cov80 !== null && controlMetrics.cov50 !== null && controlMetrics.wis !== null
      && cells.every((c) => {
        const x = row.cells[c.kind];
        return x.t80 !== null && x.t50 !== null && x.wisDelta !== null
          && x.metrics.cov80 !== null && x.metrics.cov50 !== null;
      });
    weekRows.push(row);
    const b20 = row.cells['candidate:bw-20'];
    const f = (v) => (v === null ? '  null' : `${v >= 0 ? '+' : ''}${v.toFixed(3)}`);
    const g = (v) => (v === null ? ' null' : v.toFixed(3));
    console.log(
      `  ${season} w${String(week).padStart(2)}  ctrl cov80 ${g(controlMetrics.cov80)} cov50 ${g(controlMetrics.cov50)}`
      + `  | bw-20 cov80 ${g(b20.metrics.cov80)} cov50 ${g(b20.metrics.cov50)}`
      + `  T80 ${f(b20.t80)} T50 ${f(b20.t50)}`
      + `${row.survives ? '' : '  [DROPPED: no interval evidence]'}`
    );
  }

  const surviving = weekRows.filter((r) => r.survives);
  const dropped = weekRows.length - surviving.length;
  const n = surviving.length;
  if (n === 0) throw new Error('measure-candidate-b: no week carries interval evidence in every arm');
  console.log(`\nsurviving weeks: ${n} of ${weekRows.length}${dropped ? ` (${dropped} dropped for no interval evidence)` : ''}`);

  const resamples = inference.buildResamples({ n, draws: BOOTSTRAP_DRAWS, seed: BOOTSTRAP_SEED });
  const results = {};
  for (const cell of cells) {
    const t80 = surviving.map((r) => r.cells[cell.kind].t80);
    const t50 = surviving.map((r) => r.cells[cell.kind].t50);
    const wis = surviving.map((r) => r.cells[cell.kind].wisDelta);
    const cov80Point = shared.meanOf(surviving.map((r) => r.cells[cell.kind].metrics.cov80), `${cell.kind} cov80`);
    const cov50Point = shared.meanOf(surviving.map((r) => r.cells[cell.kind].metrics.cov50), `${cell.kind} cov50`);

    const c1 = inference.bootstrapBound({ weeklyValues: t80, resamples, alpha: COMPONENT_ALPHA, side: 'lower' });
    const c2 = inference.bootstrapBound({ weeklyValues: t50, resamples, alpha: COMPONENT_ALPHA, side: 'lower' });
    const c3 = inference.bootstrapBound({ weeklyValues: wis, resamples, alpha: COMPONENT_ALPHA, side: 'upper' });

    results[cell.kind] = {
      overrides: cell.overrides,
      pointEstimates: {
        t80Mean: shared.meanOf(t80, `${cell.kind} T80`),
        t50Mean: shared.meanOf(t50, `${cell.kind} T50`),
        wisDeltaMean: shared.meanOf(wis, `${cell.kind} WIS delta`),
        cov80: cov80Point,
        cov50: cov50Point,
      },
      components: {
        cov80: { bound: c1.bound, passes: c1.bound > 0, degenerate: c1.degenerate },
        cov50: { bound: c2.bound, passes: c2.bound > 0, degenerate: c2.degenerate },
        wisNoHarm: { bound: c3.bound, passes: c3.bound < WIS_MARGIN, degenerate: c3.degenerate },
      },
      bands: {
        cov80: { value: cov80Point, band: BANDS.cov80, inBand: cov80Point >= BANDS.cov80[0] && cov80Point <= BANDS.cov80[1] },
        cov50: { value: cov50Point, band: BANDS.cov50, inBand: cov50Point >= BANDS.cov50[0] && cov50Point <= BANDS.cov50[1] },
      },
    };
    const r = results[cell.kind];
    r.passes = r.components.cov80.passes && r.components.cov50.passes && r.components.wisNoHarm.passes
      && r.bands.cov80.inBand && r.bands.cov50.inBand;
  }

  console.log(`\n--- GATE, on the exploratory corpus (n=${n} weeks, alpha ${COMPONENT_ALPHA.toFixed(6)} = 1/120, ${BOOTSTRAP_DRAWS} draws, seed ${BOOTSTRAP_SEED}) ---`);
  for (const cell of cells) {
    const r = results[cell.kind];
    console.log(`\n  ${cell.kind}`);
    console.log(`    cov80  point ${r.pointEstimates.cov80.toFixed(4)}  band [${BANDS.cov80}]  ${r.bands.cov80.inBand ? 'IN' : 'OUT OF BAND'}`);
    console.log(`    cov50  point ${r.pointEstimates.cov50.toFixed(4)}  band [${BANDS.cov50}]  ${r.bands.cov50.inBand ? 'IN' : 'OUT OF BAND'}`);
    console.log(`    C1 cov80 improvement : mean T80 ${r.pointEstimates.t80Mean.toFixed(4)}  lower bound ${r.components.cov80.bound.toFixed(4)}  ${r.components.cov80.passes ? 'PASS' : 'FAIL'}`);
    console.log(`    C2 cov50 improvement : mean T50 ${r.pointEstimates.t50Mean.toFixed(4)}  lower bound ${r.components.cov50.bound.toFixed(4)}  ${r.components.cov50.passes ? 'PASS' : 'FAIL'}`);
    console.log(`    C3 WIS no-harm       : mean delta ${r.pointEstimates.wisDeltaMean.toFixed(4)}  upper bound ${r.components.wisNoHarm.bound.toFixed(4)} (< ${WIS_MARGIN})  ${r.components.wisNoHarm.passes ? 'PASS' : 'FAIL'}`);
    console.log(`    CELL: ${r.passes ? 'PASSES' : 'FAILS'}`);
  }
  console.log('\n  This is the EXPLORATORY corpus, not the study. A cell that cannot pass here on the');
  console.log('  data the bandwidth was fit to is unlikely to pass prospectively on production data');
  console.log('  the preregistration already notes is better calibrated to begin with.');

  const result = {
    generatedBy: 'server/scripts/measure-candidate-b.js',
    provenance: {
      inputs,
      cohortFreezeRollup: shared.freezeRollup(cohortIndexByWeek),
      constantsHash: holdout.constantsHash(model.MODEL_CONSTANTS),
      modelVersion: model.MODEL_VERSION,
      scoringHash: model.scoringHash(SCORING_RULES),
      weeks: n,
      weeksConsidered: weekRows.length,
      weeksDropped: dropped,
      componentAlpha: COMPONENT_ALPHA,
      bootstrapDraws: BOOTSTRAP_DRAWS,
      bootstrapSeed: BOOTSTRAP_SEED,
      realizationBasis: 'single draw realization at the shipped scoringHash',
    },
    results,
    weekRows,
  };
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(`\nwrote ${path.relative(REPO_ROOT, out)}`);
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
  BOOTSTRAP_DRAWS, BOOTSTRAP_SEED, COMPONENT_ALPHA, WIS_MARGIN, BANDS,
  parseArgs, rowsFrom, contrast, resolveOutputPath, main,
};
