'use strict';

/**
 * The v3.2 successor evaluation script's pure core (#1439, ADR 0044, and the
 * issue's ruling - https://github.com/andydarknessb/Endzone-Empire/issues/1439).
 *
 * Re-projects a captured ledger week's `scheduled` arm from the SAME frozen
 * pre-kickoff context the capture recorded, through today's projection
 * engine, and reports MAE, Spearman rho, pairwise accuracy and 80%/50%
 * interval coverage against player_stats, per scoring profile, alongside the
 * ledger's own captured v3.1 numbers and a rebuilt-v3.1 column that serves as
 * the rebuild's error bar (ruling points 3-4).
 *
 * NOT pure in the strict "no I/O" sense `scripts/holdout/lib/evaluate.js`
 * is: re-projecting IS the whole point, so `generateProjections` is an
 * injected async function rather than a database this module reaches for
 * itself. The runner (`server/scripts/run-successor-eval.js`) is the I/O
 * shell that reads the ledger and player_stats and supplies the real
 * `projection.service.generateProjections`; `server/test/successorEval.test.js`
 * injects a mock, which is the ruling's stated acceptance seam (point 6) and
 * why this module never touches the shared database.
 */

const model = require('../../../server/services/projectionModel');
const metrics = require('../../backtest/lib/metrics');
const coverage = require('./coverage');

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * MODEL_VERSION -> the MODEL_CONSTANTS this checkout can run it with. Today
 * that is v3.1 alone: no v3.2 sub-issue (#1440-#1443) has landed its
 * constants yet, and each one is expected to register its own entry here
 * when it does. Deliberately NOT auto-populated from `model.MODEL_CONSTANTS`
 * under an assumed future name - a MODEL_VERSION this table does not name is
 * refused, never silently run under HEAD's constants (ruling point 1).
 */
const CONSTANTS_BY_MODEL_VERSION = Object.freeze({
  [model.MODEL_VERSION]: model.MODEL_CONSTANTS,
});

/** The constants for `modelVersion`, or a loud refusal - never a HEAD fallback. */
function constantsFor(modelVersion) {
  const constants = CONSTANTS_BY_MODEL_VERSION[modelVersion];
  if (!constants) {
    throw new Error(
      `successorEval: no constants registered for MODEL_VERSION "${modelVersion}" - refusing to run `
      + 'the current engine under another name. Register that version\'s MODEL_CONSTANTS in '
      + 'CONSTANTS_BY_MODEL_VERSION before evaluating it.'
    );
  }
  return constants;
}

/**
 * Pure: the ruling's three substitutions (point 2), read off one captured
 * `scheduled`-arm ledger row (the shape the runner's `loadCapturedWeeks`
 * loads and `server/test/successorEval.test.js`'s fixtures build directly).
 * `playerContext` freezes position/nfl_team/injury_status; `expert` freezes
 * the captured `factors.expertConsensus` quote, or `null` when no provider
 * ran at capture - both replayed through the LIVE code paths
 * (`generateProjections`'s override seams), never computed here.
 */
function overridesForRow(row) {
  const playerContext = {
    position: row.position ?? null,
    nfl_team: row.nflTeam ?? null,
    injury_status: row.injuryStatus ?? null,
  };
  const captured = row.factors && row.factors.expertConsensus;
  let expert = null;
  if (captured) {
    if (captured.available && isNum(captured.expertPoints)) {
      // Scored or covered-but-unscored (blendWeight 0): either way the
      // capture stored a real quote, so replay names it exactly.
      expert = { points: captured.expertPoints, source: captured.source || null };
    } else {
      // "no expert coverage" or "expert quote out of range": the capture
      // never stored a numeric points value for either, so there is nothing
      // to replay but the source. `{ source }` (no `points`) reproduces the
      // SAME non-scoring outcome through `expertConsensusBlend` - it never
      // scores a non-numeric `points` - without inventing a number the
      // capture does not have.
      expert = { source: captured.source || null };
    }
  }
  // `captured` null/undefined (no provider ran at capture at all) leaves
  // `expert` null, exactly reproducing "no expert input" on replay.
  return { playerContext, expert };
}

/**
 * Pure: the two override Maps `generateProjections`'s seams take, one entry
 * PER ROW - so the live expert provider is never consulted for a player the
 * capture already answered (ruling point 2; see projection.service.js's
 * `expertOverrideByPlayerId` doc for why a partial map would be unsafe).
 */
function buildOverrideMaps(rows) {
  const playerContextOverrideById = new Map();
  const expertOverrideByPlayerId = new Map();
  for (const row of rows) {
    const { playerContext, expert } = overridesForRow(row);
    playerContextOverrideById.set(row.playerId, playerContext);
    expertOverrideByPlayerId.set(row.playerId, expert);
  }
  return { playerContextOverrideById, expertOverrideByPlayerId };
}

/**
 * Re-project one captured week's `scheduled` arm cohort through the injected
 * `generateProjections`, with the ledger row's frozen context and expert
 * quote substituted in (ruling point 2), `oddsObservedAtOrBefore` bound to
 * the capture's own `capture_not_after` (never `input_cutoff`, same
 * reasoning as `holdout.service.js`'s capture, ADR 0039), and the
 * MODEL_VERSION's own constants (ruling point 1). Returns one row per
 * requested player in the same shape the ledger rows carry, so captured and
 * rebuilt rows can be scored by the same metric functions.
 */
async function reprojectWeek({
  header, rows, rules, modelVersion, generateProjections,
}) {
  const constants = constantsFor(modelVersion);
  const { playerContextOverrideById, expertOverrideByPlayerId } = buildOverrideMaps(rows);
  const playerIds = rows.map((r) => r.playerId);
  const result = await generateProjections({
    season: header.season,
    week: header.week,
    rules,
    playerIds,
    hashValue: header.scoringHash,
    weatherService: false,
    modelConstants: constants,
    oddsObservedAtOrBefore: header.captureNotAfter,
    playerContextOverrideById,
    expertOverrideByPlayerId,
  });
  return playerIds.map((playerId) => {
    const p = result.projections.get(playerId) || {};
    return {
      playerId,
      position: p.position ?? null,
      mean: p.mean ?? null,
      median: p.median ?? null,
      p10: p.p10 ?? null,
      p25: p.p25 ?? null,
      p75: p.p75 ?? null,
      p90: p.p90 ?? null,
      activeProbability: p.activeProbability ?? null,
      sampleSize: p.sampleSize || 0,
      factors: p.factors || {},
    };
  });
}

/**
 * Ruling point 3: run with MODEL_VERSION=free_baseline_v3.1, the share of
 * cohort rows whose rebuilt mean lands within 0.01 of the captured mean, and
 * the count whose rebuilt history length (`sampleSize`) differs from the
 * captured one. This number, recorded on #1438, is the rebuild's error bar -
 * it is reported for every run, not only a v3.1 one, so a MODEL_VERSION run
 * always carries its own rebuild-fidelity context alongside it.
 */
function calibrateAgainstCaptured({ capturedRows, rebuiltRows }) {
  const rebuiltById = new Map(rebuiltRows.map((r) => [r.playerId, r]));
  let checked = 0;
  let withinTolerance = 0;
  let sampleSizeDiffers = 0;
  for (const row of capturedRows) {
    const rebuilt = rebuiltById.get(row.playerId);
    if (!rebuilt) continue;
    checked += 1;
    const capturedMean = isNum(row.mean) ? Number(row.mean) : null;
    const rebuiltMean = isNum(rebuilt.mean) ? Number(rebuilt.mean) : null;
    if (capturedMean !== null && rebuiltMean !== null && Math.abs(capturedMean - rebuiltMean) <= 0.01) {
      withinTolerance += 1;
    }
    if (Number(row.sampleSize || 0) !== Number(rebuilt.sampleSize || 0)) sampleSizeDiffers += 1;
  }
  return {
    checked,
    withinTolerance,
    share: checked > 0 ? withinTolerance / checked : null,
    sampleSizeDiffers,
  };
}

/**
 * One arm's (captured or rebuilt) MAE, Spearman rho, pairwise accuracy and
 * 80%/50% coverage for one week, against `actuals` (a
 * `'season:week:playerId' -> points` map, PROFILE-scored - see the runner's
 * `loadActuals`). Reuses `scripts/backtest/lib/metrics.js` (weekPointMetrics,
 * weekPairwise, spearman inside it) and `coverage.armWeekMetrics` verbatim -
 * ruling point 5, no new metric code.
 */
function metricsForArm({ rows, actuals, season, week }) {
  const rowsByPosition = {};
  for (const position of metrics.MACRO_POSITIONS) rowsByPosition[position] = [];
  const scored = [];
  for (const row of rows) {
    const actualRaw = actuals.get(`${season}:${week}:${row.playerId}`);
    const actual = actualRaw === undefined ? 0 : Number(actualRaw);
    const projected = isNum(row.mean) ? Number(row.mean) : null;
    const scoredRow = { playerId: row.playerId, projected, actual };
    scored.push(scoredRow);
    const bucket = String(row.position || '').toUpperCase();
    if (rowsByPosition[bucket]) rowsByPosition[bucket].push(scoredRow);
  }
  const point = metrics.weekPointMetrics(scored);
  const pairwise = metrics.weekPairwise(rowsByPosition);
  const cov = coverage.armWeekMetrics({ rows, actuals, season, week });
  return {
    mae: point.mae,
    spearman: point.spearman,
    pairwise: pairwise.score,
    cov80: cov.cov80,
    cov50: cov.cov50,
    n: point.n,
  };
}

function meanOf(values) {
  const usable = values.filter(isNum);
  return usable.length > 0 ? usable.reduce((a, b) => a + b, 0) / usable.length : null;
}

/** Season-level aggregate of a profile's per-week metric objects: the mean over the weeks scored for each metric, nulls skipped. */
function aggregateWeekly(weekly) {
  return {
    mae: meanOf(weekly.map((w) => w.mae)),
    spearman: meanOf(weekly.map((w) => w.spearman)),
    pairwise: meanOf(weekly.map((w) => w.pairwise)),
    cov80: meanOf(weekly.map((w) => w.cov80)),
    cov50: meanOf(weekly.map((w) => w.cov50)),
    weeksScored: weekly.length,
  };
}

/**
 * One scoring profile's full report (ruling point 4): three columns -
 * captured v3.1 (the ledger's own numbers, scored against `actuals`),
 * rebuilt v3.1 (this checkout's engine at v3.1 constants, the calibration's
 * own numbers) and rebuilt MODEL_VERSION (the #1438 gate's own column, read
 * with rebuilt v3.1 as its error bar) - plus the v3.1 rebuild's calibration.
 *
 * `weeks` is this profile's captured `scheduled`-arm weeks, each
 * `{ header, rows }`; `actuals` is THIS PROFILE's player_stats-scored map
 * (scoring differs by profile, so a shared map would be wrong for two of the
 * three columns on every profile but one).
 */
async function evaluateProfile({
  weeks, actuals, rules, modelVersion, generateProjections,
}) {
  const isBaselineRun = modelVersion === model.MODEL_VERSION;
  const capturedWeekly = [];
  const rebuiltV31Weekly = [];
  const rebuiltTargetWeekly = [];
  const calibrationByWeek = [];

  for (const { header, rows } of weeks) {
    capturedWeekly.push({
      week: header.week,
      ...metricsForArm({ rows, actuals, season: header.season, week: header.week }),
    });

    const rebuiltV31Rows = await reprojectWeek({
      header, rows, rules, modelVersion: model.MODEL_VERSION, generateProjections,
    });
    rebuiltV31Weekly.push({
      week: header.week,
      ...metricsForArm({ rows: rebuiltV31Rows, actuals, season: header.season, week: header.week }),
    });
    calibrationByWeek.push({
      week: header.week,
      ...calibrateAgainstCaptured({ capturedRows: rows, rebuiltRows: rebuiltV31Rows }),
    });

    // The baseline run's target column IS the v3.1 rebuild - recomputing it
    // would call generateProjections twice for identical inputs.
    const rebuiltTargetRows = isBaselineRun
      ? rebuiltV31Rows
      : await reprojectWeek({
        header, rows, rules, modelVersion, generateProjections,
      });
    rebuiltTargetWeekly.push({
      week: header.week,
      ...metricsForArm({ rows: rebuiltTargetRows, actuals, season: header.season, week: header.week }),
    });
  }

  const calibrationChecked = calibrationByWeek.reduce((s, c) => s + c.checked, 0);
  const calibrationWithin = calibrationByWeek.reduce((s, c) => s + c.withinTolerance, 0);
  const calibrationSampleSizeDiffers = calibrationByWeek.reduce((s, c) => s + c.sampleSizeDiffers, 0);

  return {
    weeksScored: weeks.length,
    columns: {
      capturedV31: aggregateWeekly(capturedWeekly),
      rebuiltV31: aggregateWeekly(rebuiltV31Weekly),
      rebuiltTarget: { modelVersion, ...aggregateWeekly(rebuiltTargetWeekly) },
    },
    calibration: {
      modelVersion: model.MODEL_VERSION,
      checked: calibrationChecked,
      withinTolerance: calibrationWithin,
      share: calibrationChecked > 0 ? calibrationWithin / calibrationChecked : null,
      sampleSizeDiffers: calibrationSampleSizeDiffers,
      byWeek: calibrationByWeek,
    },
    weekly: { captured: capturedWeekly, rebuiltV31: rebuiltV31Weekly, rebuiltTarget: rebuiltTargetWeekly },
  };
}

/**
 * The whole gate run: every profile's report, side by side, under one
 * MODEL_VERSION. `profiles` is `[{ name, rules, weeks, actuals }, ...]`, one
 * entry per captured scoring profile (the runner supplies standard, half_ppr
 * and ppr). Fails BEFORE any reprojection when `modelVersion` has no
 * registered constants (ruling point 1) - a wasted network round trip is
 * cheap; a report claiming to have run a version it did not is not.
 */
async function evaluate({ profiles, modelVersion, generateProjections }) {
  constantsFor(modelVersion);
  const result = { modelVersion, profiles: {} };
  for (const profile of profiles) {
    result.profiles[profile.name] = await evaluateProfile({
      weeks: profile.weeks,
      actuals: profile.actuals,
      rules: profile.rules,
      modelVersion,
      generateProjections,
    });
  }
  return result;
}

function fmt(value, digits = 4) {
  return isNum(value) ? value.toFixed(digits) : 'n/a';
}

/** Markdown report: three metric columns per profile (ruling point 4), plus the v3.1 calibration line. */
function renderReport(result) {
  const lines = [];
  lines.push(`# v3.2 successor evaluation: ${result.modelVersion}`);
  lines.push('');
  for (const [profileName, profile] of Object.entries(result.profiles)) {
    lines.push(`## ${profileName}`);
    lines.push('');
    lines.push(`weeks scored: ${profile.weeksScored}`);
    lines.push('');
    lines.push(`| metric | captured v3.1 | rebuilt v3.1 | rebuilt ${result.modelVersion} |`);
    lines.push('| --- | --- | --- | --- |');
    const metricRows = [
      ['MAE', 'mae', 4],
      ['Spearman rho', 'spearman', 4],
      ['Pairwise accuracy', 'pairwise', 4],
      ['80% coverage', 'cov80', 4],
      ['50% coverage', 'cov50', 4],
    ];
    for (const [label, key, digits] of metricRows) {
      lines.push(
        `| ${label} | ${fmt(profile.columns.capturedV31[key], digits)} `
        + `| ${fmt(profile.columns.rebuiltV31[key], digits)} `
        + `| ${fmt(profile.columns.rebuiltTarget[key], digits)} |`
      );
    }
    lines.push('');
    lines.push(
      `v3.1 rebuild calibration: ${fmt(profile.calibration.share, 4)} of ${profile.calibration.checked} `
      + `rows within 0.01 mean of the captured value; ${profile.calibration.sampleSizeDiffers} rows with `
      + 'a rebuilt history length different from the captured sample_size.'
    );
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = {
  CONSTANTS_BY_MODEL_VERSION,
  constantsFor,
  overridesForRow,
  buildOverrideMaps,
  reprojectWeek,
  calibrateAgainstCaptured,
  metricsForArm,
  aggregateWeekly,
  evaluateProfile,
  evaluate,
  renderReport,
};
