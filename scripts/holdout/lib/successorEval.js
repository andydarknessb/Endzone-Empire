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
 * A ledger row's decimal column, coerced to a number or null - never a bare
 * `typeof v === 'number'` check. `projection_snapshot_players`' mean/median/
 * p10-p90/active_probability columns are `t.decimal` (migration
 * 20260730000001), pool.js registers no NUMERIC type parser, and node-pg
 * therefore returns them as STRINGS (the same reason
 * `scripts/holdout/lib/evaluate.js` and `coverage.js`'s own `num()` coerce
 * with `Number()` at their read paths). Adversarial review finding (f2): the
 * bare `isNum` this module used before dropped every string-shaped captured
 * value as `null`, so a real-ledger run would report an empty captured
 * column and a calibration of 0 - not because the rebuild was wrong, but
 * because the type check was. Rebuilt rows are always genuine JS numbers
 * (computed by `projectPlayer`), so this is a safe no-op for them.
 */
function numOrNull(v) {
  if (v === null || v === undefined) return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * v3.1's own MODEL_VERSION string, spelled literally rather than read off
 * `model.MODEL_VERSION`. The Ruling's rebuilt-v3.1 column and its
 * calibration (points 3-4) name v3.1 SPECIFICALLY, as the #1438 gate's
 * permanent error bar, and must keep meaning v3.1 even after a successor
 * (#1440-#1443) bumps `model.MODEL_VERSION` past it. Adversarial review
 * finding (f1): keying the v3.1 rebuild off `model.MODEL_VERSION` let a
 * future bump silently relabel THAT VERSION's own rebuild as "rebuilt v3.1"
 * with no error bar computed at all - the report still printed
 * "rebuilt v3.1" / "calibration: 1.0000" for what was actually the v3.2
 * rebuild run twice.
 */
const MODEL_VERSION_V3_1 = 'free_baseline_v3.1';

/**
 * MODEL_VERSION -> the MODEL_CONSTANTS this checkout can run it with.
 * `model.MODEL_VERSION`'s own constants are always registered - that is how
 * a landed successor (#1440-#1443) becomes runnable without editing this
 * file. `MODEL_VERSION_V3_1` is ALSO registered, but ONLY from
 * `model.MODEL_CONSTANTS` while this checkout's HEAD still IS v3.1: the
 * instant a successor bumps `model.MODEL_VERSION` past it,
 * `model.MODEL_CONSTANTS` stops being v3.1's constants, and this module has
 * no other source for them - refusing the v3.1 columns loudly then is the
 * correct behaviour (ruling point 1), not a bug to route around. A landing
 * that wants v3.1 to remain the PERMANENT error bar past its own bump must
 * add v3.1's own preserved constants under `MODEL_VERSION_V3_1` here
 * explicitly; nothing here may invent a stand-in under the v3.1 name.
 */
const CONSTANTS_BY_MODEL_VERSION = Object.freeze({
  // Every version the engine registers (#1442 ruling (4): successor constants
  // live in projectionModel's version-keyed MODEL_CONSTANTS_BY_VERSION, so a
  // v3.2 child becomes evaluable here the moment it lands, with HEAD still
  // v3.1). `model.MODEL_VERSION`'s own constants are always in that map.
  ...(model.MODEL_CONSTANTS_BY_VERSION || {}),
  [model.MODEL_VERSION]: model.MODEL_CONSTANTS,
  ...(model.MODEL_VERSION === MODEL_VERSION_V3_1 ? { [MODEL_VERSION_V3_1]: model.MODEL_CONSTANTS } : {}),
});

/**
 * The constants for `modelVersion`, or a loud refusal - never a HEAD
 * fallback. `registry` defaults to the real `CONSTANTS_BY_MODEL_VERSION`;
 * callers pass their own ONLY in tests, to prove the v3.1 and target columns
 * are wired to genuinely distinct constant sets without needing to stub
 * `model.MODEL_VERSION` at require time.
 */
function constantsFor(modelVersion, registry = CONSTANTS_BY_MODEL_VERSION) {
  const constants = registry[modelVersion];
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
 *
 * A reading note on the Ruling's wording (point 2, nit f3): it describes
 * this substitution as replaying the captured entry's "effect". The captured
 * factor carries no `effect` field - `expertConsensusBlend`
 * (projectionModel.js) stores `expertPoints`, `blendWeight` and
 * `pointsContribution`, because expert consensus BLENDS into the projection
 * rather than multiplying it like the other factors `effect` describes. What
 * this function replays is therefore the captured QUOTE (`expertPoints` /
 * `source`) through the engine's own live blend, not a stored effect value -
 * the only reading available given the shape the capture actually stores.
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
  header, rows, rules, modelVersion, generateProjections, constantsByModelVersion = CONSTANTS_BY_MODEL_VERSION,
}) {
  const constants = constantsFor(modelVersion, constantsByModelVersion);
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
    // Stamped on every rebuilt row so a display read (`pointEstimateFor`)
    // follows the constants that produced it, and so the draw seed is the
    // version's own.
    modelVersion,
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
    const capturedMean = numOrNull(row.mean);
    const rebuiltMean = numOrNull(rebuilt.mean);
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
    const projected = numOrNull(row.mean);
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
  weeks, actuals, rules, modelVersion, generateProjections, constantsByModelVersion = CONSTANTS_BY_MODEL_VERSION,
}) {
  // Compared against the LITERAL v3.1 name (never `model.MODEL_VERSION`,
  // adversarial review finding f1): the target run reuses the v3.1 rebuild
  // only when IT IS the v3.1 run, regardless of what this checkout's HEAD
  // currently ships.
  const isBaselineRun = modelVersion === MODEL_VERSION_V3_1;
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
      header, rows, rules, modelVersion: MODEL_VERSION_V3_1, generateProjections, constantsByModelVersion,
    });
    rebuiltV31Weekly.push({
      week: header.week,
      ...metricsForArm({ rows: rebuiltV31Rows, actuals, season: header.season, week: header.week }),
    });
    calibrationByWeek.push({
      week: header.week,
      ...calibrateAgainstCaptured({ capturedRows: rows, rebuiltRows: rebuiltV31Rows }),
    });

    // The v3.1 run's target column IS the v3.1 rebuild - recomputing it
    // would call generateProjections twice for identical inputs.
    const rebuiltTargetRows = isBaselineRun
      ? rebuiltV31Rows
      : await reprojectWeek({
        header, rows, rules, modelVersion, generateProjections, constantsByModelVersion,
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
      modelVersion: MODEL_VERSION_V3_1,
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
 * and ppr). Fails BEFORE any reprojection when EITHER `modelVersion` or
 * `MODEL_VERSION_V3_1` has no registered constants (ruling point 1) - every
 * report carries the v3.1 rebuild as its error bar, so a run that cannot
 * produce that column is refused wholesale rather than shipping the target
 * column alone with a calibration nobody can trust. A wasted network round
 * trip is cheap; a report claiming to have run a version it did not is not.
 * `constantsByModelVersion` defaults to the real registry; see
 * `constantsFor` for why a test would ever pass its own.
 */
async function evaluate({
  profiles, modelVersion, generateProjections, constantsByModelVersion = CONSTANTS_BY_MODEL_VERSION,
}) {
  constantsFor(modelVersion, constantsByModelVersion);
  constantsFor(MODEL_VERSION_V3_1, constantsByModelVersion);
  const result = { modelVersion, profiles: {} };
  for (const profile of profiles) {
    result.profiles[profile.name] = await evaluateProfile({
      weeks: profile.weeks,
      actuals: profile.actuals,
      rules: profile.rules,
      modelVersion,
      generateProjections,
      constantsByModelVersion,
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
  MODEL_VERSION_V3_1,
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
