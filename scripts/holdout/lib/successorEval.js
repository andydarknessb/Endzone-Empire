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
const inference = require('./inference');
const { SEALED, survivingWeeks } = require('./evaluate');

/** The one profile whose verdict is the gate (decision rule of 2026-10-02, #1438); the others are reported, selecting nothing. */
const GATE_PROFILE = 'half_ppr';

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
 * The calibration run's profile report (`free_baseline_v3.1`): captured v3.1
 * and rebuilt v3.1 on each column's own rows, plus the v3.1 rebuild's
 * calibration. It computes NO v3.2 column and no verdict - the rebuild error
 * bar is what this run exists to record, and it may run at any time (rule 1),
 * so it takes every captured `scheduled` week rather than the gate's survivors.
 *
 * `weeks` is this profile's captured `scheduled`-arm weeks, each
 * `{ header, rows }`; `actuals` is THIS PROFILE's player_stats-scored map.
 */
async function evaluateCalibrationProfile({
  weeks, actuals, rules, generateProjections, constantsByModelVersion = CONSTANTS_BY_MODEL_VERSION,
}) {
  const capturedWeekly = [];
  const rebuiltV31Weekly = [];
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
  }
  return {
    weeksScored: weeks.length,
    columns: { capturedV31: aggregateWeekly(capturedWeekly), rebuiltV31: aggregateWeekly(rebuiltV31Weekly) },
    calibration: summariseCalibration(calibrationByWeek),
    weekly: { captured: capturedWeekly, rebuiltV31: rebuiltV31Weekly },
  };
}

function summariseCalibration(calibrationByWeek) {
  const checked = calibrationByWeek.reduce((s, c) => s + c.checked, 0);
  const withinTolerance = calibrationByWeek.reduce((s, c) => s + c.withinTolerance, 0);
  return {
    modelVersion: MODEL_VERSION_V3_1,
    checked,
    withinTolerance,
    share: checked > 0 ? withinTolerance / checked : null,
    sampleSizeDiffers: calibrationByWeek.reduce((s, c) => s + c.sampleSizeDiffers, 0),
    byWeek: calibrationByWeek,
  };
}

// ---------------------------------------------------------------------------
// The gate (decision rule of 2026-10-02 on #1438)
// ---------------------------------------------------------------------------

/**
 * How a column served one cohort row: `activeZero` (active probability 0,
 * wins over a mean the row may still carry), `nullMean`, or `served`.
 */
function servedState(row) {
  if (!row) return 'nullMean';
  if (numOrNull(row.activeProbability) === 0) return 'activeZero';
  return numOrNull(row.mean) === null ? 'nullMean' : 'served';
}

/**
 * Rule 4, as-served scoring of one column for one week: every COHORT row is
 * scored, and a row the column does not serve scores as a projection of 0.
 * Position comes from the cohort (the frozen context), so a rebuilt row with
 * no projection still lands in its position's pairwise cell. This is a new
 * path: `metricsForArm` keeps scoring a column on its own non-null rows for
 * `compare-market-factor.js`.
 */
function asServedWeek({ cohort, rows, actuals, season, week }) {
  const rowById = new Map(rows.map((r) => [r.playerId, r]));
  const byPosition = {};
  for (const position of metrics.MACRO_POSITIONS) byPosition[position] = [];
  const counts = { served: 0, nullMean: 0, activeZero: 0 };
  const scored = [];
  for (const c of cohort) {
    const row = rowById.get(c.playerId);
    const state = servedState(row);
    counts[state] += 1;
    const actualRaw = actuals.get(`${season}:${week}:${c.playerId}`);
    const entry = {
      playerId: c.playerId,
      projected: state === 'served' ? numOrNull(row.mean) : 0,
      actual: actualRaw === undefined ? 0 : Number(actualRaw),
    };
    scored.push(entry);
    const bucket = String(c.position || '').toUpperCase();
    if (byPosition[bucket]) byPosition[bucket].push(entry);
  }
  const point = metrics.weekPointMetrics(scored);
  const pairwise = metrics.weekPairwise(byPosition);
  return {
    mae: point.mae,
    spearman: point.spearman,
    pairwise: pairwise.score,
    perPosition: Object.fromEntries(metrics.MACRO_POSITIONS.map((p) => [p, pairwise.perPosition[p].score])),
    counts,
  };
}

/**
 * Rule 5 (fourth check), one week: 80% and 50% coverage of every column on
 * the rows eligible in EVERY column - active probability not 0 and the
 * interval being scored complete, in all of them. Reuses
 * `coverage.armWeekMetrics` on the common rows.
 */
function commonCoverageWeek({ columns, actuals, season, week }) {
  const out = {};
  for (const [key, lo, hi] of [['cov80', 'p10', 'p90'], ['cov50', 'p25', 'p75']]) {
    const eligible = (row) => {
      const a = numOrNull(row[lo]);
      const b = numOrNull(row[hi]);
      return numOrNull(row.activeProbability) !== 0 && a !== null && b !== null && a <= b;
    };
    const byColumn = Object.values(columns).map((rows) => new Map(rows.map((r) => [r.playerId, r])));
    const common = [...byColumn[0].keys()].filter((id) => byColumn.every((m) => m.has(id) && eligible(m.get(id))));
    const commonSet = new Set(common);
    out[key] = { n: common.length };
    for (const [name, rows] of Object.entries(columns)) {
      out[key][name] = coverage.armWeekMetrics({
        rows: rows.filter((r) => commonSet.has(r.playerId)), actuals, season, week,
      })[key];
    }
  }
  return out;
}

function sumCounts(weekly) {
  const total = { served: 0, nullMean: 0, activeZero: 0 };
  for (const w of weekly) for (const k of Object.keys(total)) total[k] += w.counts[k];
  return total;
}

/** Season-level aggregate of one as-served column: the mean over weeks, per-position cells, row counts by served state. */
function aggregateServed(weekly) {
  return {
    ...aggregateWeekly(weekly),
    perPosition: Object.fromEntries(metrics.MACRO_POSITIONS.map((p) => [p, meanOf(weekly.map((w) => w.perPosition[p]))])),
    counts: sumCounts(weekly),
  };
}

/** Rule 5, second check: the lower one-sided bound on the weekly mean of rebuilt target minus rebuilt v3.1, through the sealed inference. */
function noiseCheck(weeklyDeltas, config = SEALED) {
  const resamples = inference.buildResamples({ n: weeklyDeltas.length, draws: config.draws, seed: config.bootstrapSeed });
  return inference.decideComponent({
    label: 'pairwise beyond noise',
    weeklyValues: weeklyDeltas,
    resamples,
    alpha: config.alphaATest,
    boundary: 0,
    side: 'lower',
    exactTriggerClusters: config.exactTriggerClusters,
  });
}

/**
 * The four checks of rule 5 over aligned per-week scores
 * (`weekly.captured|rebuiltV31|rebuiltTarget`, each `{ week, mae, pairwise, cov80, cov50 }`).
 * Each check carries its inputs; a check whose input is missing fails rather
 * than passes. The season value of a metric is the mean over its weeks;
 * coverage distance is that season coverage's distance from nominal.
 */
function gateChecks({ weekly, config = SEALED }) {
  const season = (column, key) => meanOf(weekly[column].map((w) => w[key]));
  const dist = (column, key, target) => {
    const v = season(column, key);
    return v === null ? null : Math.abs(v - target);
  };
  const bar = (a, b) => (isNum(a) && isNum(b) ? Math.abs(a - b) : null);

  const pw = { captured: season('captured', 'pairwise'), rebuiltV31: season('rebuiltV31', 'pairwise'), rebuiltTarget: season('rebuiltTarget', 'pairwise') };
  const pwBar = bar(pw.rebuiltV31, pw.captured);
  const mae = { captured: season('captured', 'mae'), rebuiltV31: season('rebuiltV31', 'mae'), rebuiltTarget: season('rebuiltTarget', 'mae') };
  const maeBar = bar(mae.rebuiltV31, mae.captured);

  const deltas = [];
  weekly.rebuiltTarget.forEach((w, i) => {
    const v31 = weekly.rebuiltV31[i].pairwise;
    if (isNum(w.pairwise) && isNum(v31)) deltas.push({ week: w.week, value: w.pairwise - v31 });
  });
  const noise = deltas.length > 0 ? noiseCheck(deltas.map((d) => d.value), config) : null;

  const cov = {};
  for (const [key, target] of [['cov80', config.cov80Target], ['cov50', config.cov50Target]]) {
    const d = {
      captured: dist('captured', key, target),
      rebuiltV31: dist('rebuiltV31', key, target),
      rebuiltTarget: dist('rebuiltTarget', key, target),
    };
    const errorBar = bar(d.rebuiltV31, d.captured);
    cov[key] = {
      nominal: target,
      distance: d,
      errorBar,
      passes: isNum(errorBar) && isNum(d.rebuiltTarget) && d.rebuiltTarget <= d.captured + errorBar,
    };
  }

  return {
    pairwiseVsCapture: {
      inputs: pw, errorBar: pwBar, margin: isNum(pw.rebuiltTarget) && isNum(pw.captured) ? pw.rebuiltTarget - pw.captured : null,
      passes: isNum(pwBar) && isNum(pw.rebuiltTarget) && isNum(pw.captured) && pw.rebuiltTarget - pw.captured > pwBar,
    },
    pairwiseBeyondNoise: noise
      ? {
        weeks: deltas.length, weeklyMean: noise.mean, method: noise.method, bound: noise.bound ?? null,
        alpha: config.alphaATest, boundary: 0, draws: config.draws, seed: config.bootstrapSeed,
        exactTriggerClusters: config.exactTriggerClusters, detail: noise, passes: noise.passes,
      }
      : { weeks: 0, method: null, passes: false },
    maeVsCapture: {
      inputs: mae, errorBar: maeBar, margin: isNum(mae.rebuiltTarget) && isNum(mae.captured) ? mae.captured - mae.rebuiltTarget : null,
      passes: isNum(maeBar) && isNum(mae.rebuiltTarget) && isNum(mae.captured) && mae.captured - mae.rebuiltTarget > maeBar,
    },
    coverageNoHarm: { cov80: cov.cov80, cov50: cov.cov50, passes: cov.cov80.passes && cov.cov50.passes },
  };
}

const CHECK_KEYS = ['pairwiseVsCapture', 'pairwiseBeyondNoise', 'maeVsCapture', 'coverageNoHarm'];

/** The ruling's per-profile read: PASS only when all four checks pass. */
function verdictOf(checks) {
  return CHECK_KEYS.every((k) => checks[k].passes) ? 'PASS' : 'FAIL';
}

/** The gate's per-week table: the three columns, as-served, with common-row coverage. */
function weeklyRows({ weeks, actuals, rebuilt }) {
  const weekly = { captured: [], rebuiltV31: [], rebuiltTarget: [] };
  const eligibleRows = { cov80: 0, cov50: 0 };
  weeks.forEach(({ header, rows }, i) => {
    const { season, week } = header;
    const columns = { captured: rows, rebuiltV31: rebuilt[i].v31, rebuiltTarget: rebuilt[i].target };
    const common = commonCoverageWeek({ columns, actuals, season, week });
    eligibleRows.cov80 += common.cov80.n;
    eligibleRows.cov50 += common.cov50.n;
    for (const name of Object.keys(columns)) {
      weekly[name].push({
        week,
        ...asServedWeek({ cohort: rows, rows: columns[name], actuals, season, week }),
        cov80: common.cov80[name],
        cov50: common.cov50[name],
      });
    }
  });
  return { weekly, eligibleRows };
}

/**
 * One scoring profile under the gate. `ledger` is `[{ week, arms: { scheduled,
 * 'candidate:bw-20', 'candidate:bw-15' } }]` (the sealed evaluator's own
 * shape; each arm carries its header fields and `rows`, and the scheduled
 * arm also `scoringHash` and the rows' frozen context). Weeks are the sealed
 * evaluator's `survivingWeeks` under `config`. The `half_ppr` profile gets a
 * verdict - UNEVALUABLE below `config.minWeeks` surviving weeks, with nothing
 * re-projected and no check evaluated; the others are reported only.
 */
async function evaluateGateProfile({
  name, season, ledger, actuals, rules, modelVersion, generateProjections,
  constantsByModelVersion = CONSTANTS_BY_MODEL_VERSION, config = SEALED,
}) {
  const { survivors, dropped } = survivingWeeks({ weeks: ledger, config });
  const gated = name === GATE_PROFILE;
  const base = { weeksScored: survivors.length, droppedWeeks: dropped, scoring: 'as-served' };
  if (gated && survivors.length < config.minWeeks) {
    return {
      ...base,
      gate: {
        verdict: 'UNEVALUABLE',
        reason: `${survivors.length} surviving weeks, fewer than the ${config.minWeeks} required; no check evaluated`,
        checks: null,
      },
    };
  }
  const weeks = survivors.map((entry) => {
    const arm = entry.arms.scheduled;
    return {
      header: { season, week: entry.week, scoringHash: arm.scoringHash, captureNotAfter: arm.captureNotAfter },
      rows: arm.rows,
    };
  });
  const rebuilt = [];
  const calibrationByWeek = [];
  for (const { header, rows } of weeks) {
    const v31 = await reprojectWeek({
      header, rows, rules, modelVersion: MODEL_VERSION_V3_1, generateProjections, constantsByModelVersion,
    });
    const target = await reprojectWeek({
      header, rows, rules, modelVersion, generateProjections, constantsByModelVersion,
    });
    rebuilt.push({ v31, target });
    calibrationByWeek.push({ week: header.week, ...calibrateAgainstCaptured({ capturedRows: rows, rebuiltRows: v31 }) });
  }
  const { weekly, eligibleRows } = weeklyRows({ weeks, actuals, rebuilt });
  const result = {
    ...base,
    columns: {
      capturedV31: aggregateServed(weekly.captured),
      rebuiltV31: aggregateServed(weekly.rebuiltV31),
      rebuiltTarget: { modelVersion, ...aggregateServed(weekly.rebuiltTarget) },
    },
    coverageEligibleRows: eligibleRows,
    calibration: summariseCalibration(calibrationByWeek),
    weekly,
    gate: null,
  };
  if (gated) {
    const checks = gateChecks({ weekly, config });
    // Reported, selecting nothing: the same four checks over weeks 1 to 17.
    const keep = (rowsOfColumn) => rowsOfColumn.filter((w) => w.week <= 17);
    const sensitivity = weekly.captured.some((w) => w.week <= 17)
      ? gateChecks({
        weekly: { captured: keep(weekly.captured), rebuiltV31: keep(weekly.rebuiltV31), rebuiltTarget: keep(weekly.rebuiltTarget) },
        config,
      })
      : null;
    result.gate = { verdict: verdictOf(checks), checks, sensitivityWeeks1to17: sensitivity };
  }
  return result;
}

/**
 * The whole run, every profile under one MODEL_VERSION. `profiles` is
 * `[{ name, rules, season, ledger, actuals }, ...]`. Fails BEFORE any
 * reprojection when either `modelVersion` or `MODEL_VERSION_V3_1` has no
 * registered constants (every report carries the v3.1 rebuild as its error
 * bar). A `free_baseline_v3.1` run is the calibration run: no v3.2 column,
 * no verdict, no survival filter.
 */
async function evaluate({
  profiles, modelVersion, generateProjections, constantsByModelVersion = CONSTANTS_BY_MODEL_VERSION, config = SEALED,
}) {
  constantsFor(modelVersion, constantsByModelVersion);
  constantsFor(MODEL_VERSION_V3_1, constantsByModelVersion);
  const result = { modelVersion, calibrationRun: modelVersion === MODEL_VERSION_V3_1, profiles: {} };
  for (const profile of profiles) {
    if (result.calibrationRun) {
      const weeks = profile.ledger.filter((e) => e.arms.scheduled).map((e) => ({
        header: {
          season: profile.season, week: e.week, scoringHash: e.arms.scheduled.scoringHash, captureNotAfter: e.arms.scheduled.captureNotAfter,
        },
        rows: e.arms.scheduled.rows,
      }));
      result.profiles[profile.name] = await evaluateCalibrationProfile({
        weeks, actuals: profile.actuals, rules: profile.rules, generateProjections, constantsByModelVersion,
      });
    } else {
      result.profiles[profile.name] = await evaluateGateProfile({
        name: profile.name,
        season: profile.season,
        ledger: profile.ledger,
        actuals: profile.actuals,
        rules: profile.rules,
        modelVersion,
        generateProjections,
        constantsByModelVersion,
        config,
      });
    }
  }
  return result;
}

function fmt(value, digits = 4) {
  return isNum(value) ? value.toFixed(digits) : 'n/a';
}

function renderCalibrationLine(calibration) {
  return `v3.1 rebuild calibration: ${fmt(calibration.share, 4)} of ${calibration.checked} `
    + `rows within 0.01 mean of the captured value; ${calibration.sampleSizeDiffers} rows with `
    + 'a rebuilt history length different from the captured sample_size.';
}

function renderChecks(lines, checks, heading) {
  lines.push(heading);
  lines.push('');
  const pc = checks.pairwiseVsCapture;
  lines.push(`- Pairwise against the capture: ${pc.passes ? 'PASS' : 'FAIL'}. captured v3.1 ${fmt(pc.inputs.captured)}, `
    + `rebuilt v3.1 ${fmt(pc.inputs.rebuiltV31)}, rebuilt target ${fmt(pc.inputs.rebuiltTarget)}; `
    + `margin ${fmt(pc.margin)} against error bar ${fmt(pc.errorBar)}.`);
  const nz = checks.pairwiseBeyondNoise;
  lines.push(`- Pairwise beyond noise: ${nz.passes ? 'PASS' : 'FAIL'}. ${nz.weeks} weeks, weekly mean of target minus rebuilt v3.1 `
    + `${fmt(nz.weeklyMean)}, ${nz.method || 'no method (no weeks)'}`
    + `${nz.bound !== undefined && nz.bound !== null ? `, lower bound ${fmt(nz.bound)}` : ''}`
    + `${nz.alpha !== undefined ? ` at alpha ${nz.alpha} (${nz.draws} draws, seed ${nz.seed}, exact test under ${nz.exactTriggerClusters} clusters)` : ''}; `
    + 'the bound must be strictly above 0.');
  const mc = checks.maeVsCapture;
  lines.push(`- MAE against the capture: ${mc.passes ? 'PASS' : 'FAIL'}. captured v3.1 ${fmt(mc.inputs.captured)}, `
    + `rebuilt v3.1 ${fmt(mc.inputs.rebuiltV31)}, rebuilt target ${fmt(mc.inputs.rebuiltTarget)}; `
    + `margin ${fmt(mc.margin)} against error bar ${fmt(mc.errorBar)}.`);
  const cv = checks.coverageNoHarm;
  lines.push(`- Coverage does no harm: ${cv.passes ? 'PASS' : 'FAIL'}.`);
  for (const key of ['cov80', 'cov50']) {
    const c = cv[key];
    lines.push(`  - ${key === 'cov80' ? '80%' : '50%'} (nominal ${c.nominal}) distance: captured ${fmt(c.distance.captured)}, `
      + `rebuilt v3.1 ${fmt(c.distance.rebuiltV31)}, rebuilt target ${fmt(c.distance.rebuiltTarget)}; error bar ${fmt(c.errorBar)}; ${c.passes ? 'no harm' : 'harm'}.`);
  }
  lines.push('');
}

/** Markdown report. A gate run prints the verdict and the four checks for `half_ppr`; everything else is labelled non-selecting. */
function renderReport(result) {
  const lines = [];
  lines.push(`# v3.2 successor evaluation: ${result.modelVersion}`);
  lines.push('');
  for (const [profileName, profile] of Object.entries(result.profiles)) {
    lines.push(`## ${profileName}`);
    lines.push('');
    lines.push(`weeks scored: ${profile.weeksScored}`);
    lines.push('');
    if (profile.gate) {
      lines.push(`### Verdict: ${profile.gate.verdict}`);
      lines.push('');
      if (profile.gate.reason) { lines.push(profile.gate.reason); lines.push(''); }
      if (profile.gate.checks) renderChecks(lines, profile.gate.checks, '### The four checks');
    }
    if (profile.droppedWeeks && profile.droppedWeeks.length > 0) {
      lines.push('Dropped weeks:');
      for (const d of profile.droppedWeeks) lines.push(`- week ${d.week}: ${d.reason}`);
      lines.push('');
    }
    if (!profile.columns) continue;
    const target = profile.columns.rebuiltTarget;
    const header = ['captured v3.1', 'rebuilt v3.1', ...(target ? [`rebuilt ${result.modelVersion}`] : [])];
    const cols = [profile.columns.capturedV31, profile.columns.rebuiltV31, ...(target ? [target] : [])];
    lines.push(`### Metrics${profile.scoring ? ` (${profile.scoring}; reported, selecting nothing beyond the checks above)` : ''}`);
    lines.push('');
    lines.push(`| metric | ${header.join(' | ')} |`);
    lines.push(`| --- | ${header.map(() => '---').join(' | ')} |`);
    for (const [label, key] of [['MAE', 'mae'], ['Spearman rho', 'spearman'], ['Pairwise accuracy', 'pairwise'], ['80% coverage', 'cov80'], ['50% coverage', 'cov50']]) {
      lines.push(`| ${label} | ${cols.map((c) => fmt(c[key])).join(' | ')} |`);
    }
    if (target) {
      for (const position of metrics.MACRO_POSITIONS) {
        lines.push(`| pairwise ${position} | ${cols.map((c) => fmt(c.perPosition[position])).join(' | ')} |`);
      }
      for (const state of ['served', 'nullMean', 'activeZero']) {
        lines.push(`| rows ${state} | ${cols.map((c) => c.counts[state]).join(' | ')} |`);
      }
    }
    lines.push('');
    if (profile.coverageEligibleRows) {
      lines.push(`Coverage rows eligible in every column: ${profile.coverageEligibleRows.cov80} (80%), ${profile.coverageEligibleRows.cov50} (50%).`);
      lines.push('');
    }
    if (profile.gate && profile.gate.sensitivityWeeks1to17) {
      renderChecks(lines, profile.gate.sensitivityWeeks1to17, '### Weeks 1 to 17 sensitivity (selecting nothing)');
    }
    lines.push(renderCalibrationLine(profile.calibration));
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = {
  GATE_PROFILE,
  MODEL_VERSION_V3_1,
  CONSTANTS_BY_MODEL_VERSION,
  constantsFor,
  overridesForRow,
  buildOverrideMaps,
  reprojectWeek,
  calibrateAgainstCaptured,
  metricsForArm,
  aggregateWeekly,
  servedState,
  asServedWeek,
  commonCoverageWeek,
  noiseCheck,
  gateChecks,
  verdictOf,
  evaluateCalibrationProfile,
  evaluateGateProfile,
  evaluate,
  renderReport,
};
