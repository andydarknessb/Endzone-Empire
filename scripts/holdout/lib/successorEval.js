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
 *
 * #1938: `evaluate` applies `backtest-artifacts/v3.2-successor-gate/DECISION_RULE.md`
 * (weeks, rows and projections, the four checks, the reported items) and
 * returns a verdict; the section comments below name the rule's sections.
 */

const crypto = require('crypto');
const model = require('../../../server/services/projectionModel');
const metrics = require('../../backtest/lib/metrics');
const coverage = require('./coverage');
const evaluator = require('./evaluate');
const inference = require('./inference');

const { SEALED } = evaluator;

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

// ---------------------------------------------------------------------------
// The ruled decision rule (backtest-artifacts/v3.2-successor-gate/DECISION_RULE.md,
// #1938). Section numbers below are that file's. `metricsForArm` and
// `aggregateWeekly` above are NOT used by it: they stay as they were for
// `marketFactorReplay`, whose output must not change.
// ---------------------------------------------------------------------------

const GATE_PROFILE = 'half_ppr';
const GATE_ALPHA = 0.0125; // section 6, check 2
const COVERAGE_TOLERANCE_FLOOR = 0.02; // section 6, check 4
const METRIC_KEYS = ['mae', 'spearman', 'pairwise', 'cov80', 'cov50'];

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** Section 3: the weeks the sealed `survivingWeeks` keeps under `SEALED`, from `[{ week, arms }]` as the runner loads them. */
function selectSurvivors(armWeeks) {
  const { survivors, dropped } = evaluator.survivingWeeks({ weeks: armWeeks, config: SEALED });
  return { weeks: survivors.map((s) => s.week), dropped };
}

// Section 4. `isPositionBaselineEntry` lives in the projection service (one
// definition, ADR 0053), which pulls the pool in, so it is required on use.
function isPositionBaseline(row) {
  // eslint-disable-next-line global-require
  return require('../../../server/services/projection.service').isPositionBaselineEntry(row);
}
/** A mean and an active probability that is not 0 (the "Position-baseline counted as served" variant). */
function hasMeanAndIsActive(row) {
  return numOrNull(row.mean) !== null && numOrNull(row.activeProbability) !== 0;
}
function isServed(row) {
  return hasMeanAndIsActive(row) && !isPositionBaseline(row);
}
/** Mean times active probability where that is a number, the mean where it is null, 0 where unserved. */
function projectionOf(row, served = isServed) {
  if (!served(row)) return 0;
  const activeProbability = numOrNull(row.activeProbability);
  const mean = numOrNull(row.mean);
  return activeProbability === null ? mean : mean * activeProbability;
}

/**
 * Section 4's three classes of row scored in no column, counted. `entries` is
 * `[{ playerId, position, rows: { capturedV31, rebuiltV31, rebuiltTarget? } }]`.
 */
function classifyWeek(entries, cols, served = isServed) {
  const scored = [];
  const counts = { unavailable: 0, servedStateDiffers: 0, servedByNoColumn: 0 };
  for (const entry of entries) {
    if (numOrNull(entry.rows.capturedV31.activeProbability) === 0) counts.unavailable += 1;
    else if (served(entry.rows.capturedV31) !== served(entry.rows.rebuiltV31)) counts.servedStateDiffers += 1;
    else if (!cols.some((col) => served(entry.rows[col]))) counts.servedByNoColumn += 1;
    else scored.push(entry);
  }
  return { scored, counts };
}

function hasCompleteInterval(row) {
  const [p10, p25, p75, p90] = [row.p10, row.p25, row.p75, row.p90].map(numOrNull);
  return [p10, p25, p75, p90].every((v) => v !== null) && p10 <= p90 && p25 <= p75;
}

/** One week's metrics per column, on the scored entries; coverage on `covEntries` only. */
function weekMetrics({
  scored, covEntries, cols, served, actuals, season, week,
}) {
  const byCol = {};
  for (const col of cols) {
    const byPosition = {};
    for (const position of metrics.MACRO_POSITIONS) byPosition[position] = [];
    const scoredRows = scored.map((entry) => {
      const raw = actuals.get(`${season}:${week}:${entry.playerId}`);
      const row = {
        playerId: entry.playerId, projected: projectionOf(entry.rows[col], served), actual: raw === undefined ? 0 : Number(raw),
      };
      const bucket = String(entry.position || '').toUpperCase();
      if (byPosition[bucket]) byPosition[bucket].push(row);
      return row;
    });
    const point = metrics.weekPointMetrics(scoredRows);
    const pairwise = metrics.weekPairwise(byPosition);
    const cov = coverage.armWeekMetrics({ rows: covEntries.map((e) => e.rows[col]), actuals, season, week });
    byCol[col] = {
      mae: point.mae,
      spearman: point.spearman,
      pairwise: pairwise.score,
      cov80: cov.cov80,
      cov50: cov.cov50,
      byPosition: Object.fromEntries(metrics.MACRO_POSITIONS.map((p) => [p, pairwise.perPosition[p].score])),
    };
  }
  return byCol;
}

/**
 * Sections 4 and 5 over a profile's weeks: classify, then score every column on
 * the scored rows. `everyColumnServes` and `skipWeek18` are section 7's
 * variants; `served` is the Position-baseline-as-served variant.
 */
function scoreWeeks({
  cohortWeeks, cols, actuals, served = isServed, everyColumnServes = false, skipWeek18 = false,
}) {
  const weekly = [];
  const rowCounts = [];
  for (const cohortWeek of cohortWeeks) {
    if (skipWeek18 && cohortWeek.week === 18) continue;
    const { scored: classified, counts } = classifyWeek(cohortWeek.entries, cols, served);
    const scored = everyColumnServes ? classified.filter((e) => cols.every((c) => served(e.rows[c]))) : classified;
    // Coverage: rows served in every column that carry a complete interval in every column (section 6, check 4).
    const covEntries = scored.filter((e) => cols.every((c) => served(e.rows[c]) && hasCompleteInterval(e.rows[c])));
    weekly.push({
      week: cohortWeek.week,
      byCol: weekMetrics({
        scored, covEntries, cols, served, actuals, season: cohortWeek.season, week: cohortWeek.week,
      }),
    });
    rowCounts.push({ week: cohortWeek.week, scored: scored.length, ...counts });
  }
  return { weekly, rowCounts };
}

/**
 * Section 3's drop rule and the season values (section 5): a week null for a
 * metric in any column drops from that metric in every column; a season value
 * is the mean over the weeks left for that metric.
 */
function seasonize(weekly, cols) {
  const season = Object.fromEntries(cols.map((c) => [c, {}]));
  const weeksUsed = {};
  const series = {};
  for (const key of METRIC_KEYS) {
    const kept = weekly.filter((w) => cols.every((c) => isNum(w.byCol[c][key])));
    weeksUsed[key] = kept.map((w) => w.week);
    series[key] = {};
    for (const col of cols) {
      series[key][col] = kept.map((w) => w.byCol[col][key]);
      season[col][key] = meanOf(series[key][col]);
    }
  }
  return { season, weeksUsed, series };
}

/** Sections 5 and 6: the four checks over `weekly` (three columns), or UNEVALUABLE with the reason. */
function gateChecks(weekly) {
  const cols = ['capturedV31', 'rebuiltV31', 'rebuiltTarget'];
  const { season, weeksUsed, series } = seasonize(weekly, cols);
  const base = { season, weeksUsed };
  if (weeksUsed.pairwise.length < SEALED.minWeeks) {
    return {
      ...base,
      verdict: 'UNEVALUABLE',
      reason: `${weeksUsed.pairwise.length} weeks left for pairwise accuracy against a minimum of ${SEALED.minWeeks}`,
      checks: null,
    };
  }
  const needed = ['mae', 'cov80', 'cov50'].flatMap((key) => cols.map((c) => season[c][key]));
  if (needed.some((v) => !isNum(v))) {
    return {
      ...base, verdict: 'UNEVALUABLE', reason: 'a check input (MAE or coverage) has no week to be computed from', checks: null,
    };
  }
  const errorBar = (key) => meanOf(series[key].rebuiltV31.map((v, i) => Math.abs(v - series[key].capturedV31[i])));
  const pairwiseBar = errorBar('pairwise');
  const maeBar = errorBar('mae');
  const pairwiseDelta = series.pairwise.rebuiltTarget.map((v, i) => v - series.pairwise.rebuiltV31[i]);
  const noise = inference.decideComponent({
    label: 'pairwise-noise',
    weeklyValues: pairwiseDelta,
    resamples: inference.buildResamples({ n: pairwiseDelta.length, draws: SEALED.draws, seed: SEALED.bootstrapSeed }),
    alpha: GATE_ALPHA,
    boundary: 0,
    side: 'lower',
    exactTriggerClusters: SEALED.exactTriggerClusters,
  });
  const pairwiseDifference = season.rebuiltTarget.pairwise - season.rebuiltV31.pairwise;
  const maeDifference = season.rebuiltV31.mae - season.rebuiltTarget.mae;
  const coverageCheck = (key, nominal, band) => {
    const distance = (col) => Math.abs(season[col][key] - nominal);
    const tolerance = Math.max(COVERAGE_TOLERANCE_FLOOR, Math.abs(distance('rebuiltV31') - distance('capturedV31')));
    const value = season.rebuiltTarget[key];
    const inBand = value >= band[0] && value <= band[1];
    const excess = distance('rebuiltTarget') - distance('rebuiltV31');
    return {
      key, nominal, band, value, inBand, excess, tolerance, passes: inBand || excess <= tolerance,
    };
  };
  const cov80 = coverageCheck('cov80', SEALED.cov80Target, SEALED.cov80Band);
  const cov50 = coverageCheck('cov50', SEALED.cov50Target, SEALED.cov50Band);
  const checks = [
    {
      name: 'pairwise-size', rebuiltTarget: season.rebuiltTarget.pairwise, rebuiltV31: season.rebuiltV31.pairwise,
      difference: pairwiseDifference, errorBar: pairwiseBar, passes: pairwiseDifference > pairwiseBar,
    },
    { name: 'pairwise-noise', alpha: GATE_ALPHA, ...noise },
    {
      name: 'mae-size', rebuiltTarget: season.rebuiltTarget.mae, rebuiltV31: season.rebuiltV31.mae,
      difference: maeDifference, errorBar: maeBar, passes: maeDifference > maeBar,
    },
    { name: 'coverage-no-harm', cov80, cov50, passes: cov80.passes && cov50.passes },
  ];
  return { ...base, verdict: checks.every((c) => c.passes) ? 'PASS' : 'FAIL', checks };
}

/** Section 2: SHA-256 of rebuilt v3.1 rows (week, player id, mean, median, p10, p25, p75, p90, active probability), ordered by week and player id. */
function digestRebuiltRows(weeks) {
  const lines = [];
  for (const { week, rows } of [...weeks].sort((a, b) => a.week - b.week)) {
    for (const r of [...rows].sort((a, b) => a.playerId - b.playerId)) {
      lines.push([week, r.playerId, r.mean, r.median, r.p10, r.p25, r.p75, r.p90, r.activeProbability].map((v) => v ?? '').join('|'));
    }
  }
  return sha256(lines.join('\n'));
}

/** Section 2: SHA-256 of a profile's actuals (season, week, player id, points), ordered by week and player id. */
function actualsDigest(actuals) {
  const lines = [...actuals].map(([key, points]) => key.split(':').map(Number).concat(points))
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .map(([season, week, playerId, points]) => [season, week, playerId, points].join('|'));
  return sha256(lines.join('\n'));
}

/** The per-child comparison mode: rebuild v3.1 over `weeks` and return its digest alone. */
async function rebuildV31Digest({
  weeks, rules, generateProjections, constantsByModelVersion = CONSTANTS_BY_MODEL_VERSION,
}) {
  constantsFor(MODEL_VERSION_V3_1, constantsByModelVersion);
  const rebuilt = [];
  for (const { header, rows } of weeks) {
    rebuilt.push({
      week: header.week,
      rows: await reprojectWeek({
        header, rows, rules, modelVersion: MODEL_VERSION_V3_1, generateProjections, constantsByModelVersion,
      }),
    });
  }
  return digestRebuiltRows(rebuilt);
}

/**
 * One scoring profile's report. `weeks` is this profile's surviving
 * `{ header, rows }` weeks; `actuals` is THIS PROFILE's player_stats-scored
 * map. `gateWeeks` is the half_ppr survivor count when this profile carries
 * the verdict, else null (no check is evaluated).
 */
async function evaluateProfile({
  weeks, actuals, rules, modelVersion, generateProjections, gateWeeks = null, constantsByModelVersion = CONSTANTS_BY_MODEL_VERSION,
}) {
  // The LITERAL v3.1 name, never `model.MODEL_VERSION` (formal-001-f1).
  const isBaselineRun = modelVersion === MODEL_VERSION_V3_1;
  const cols = isBaselineRun ? ['capturedV31', 'rebuiltV31'] : ['capturedV31', 'rebuiltV31', 'rebuiltTarget'];
  const cohortWeeks = [];
  const rebuiltV31Weeks = [];
  const calibrationByWeek = [];

  for (const { header, rows } of weeks) {
    const rebuiltV31Rows = await reprojectWeek({
      header, rows, rules, modelVersion: MODEL_VERSION_V3_1, generateProjections, constantsByModelVersion,
    });
    const rebuiltTargetRows = isBaselineRun ? null : await reprojectWeek({
      header, rows, rules, modelVersion, generateProjections, constantsByModelVersion,
    });
    rebuiltV31Weeks.push({ week: header.week, rows: rebuiltV31Rows });
    calibrationByWeek.push({
      week: header.week, ...calibrateAgainstCaptured({ capturedRows: rows, rebuiltRows: rebuiltV31Rows }),
    });
    cohortWeeks.push({
      week: header.week,
      season: header.season,
      entries: rows.map((row, i) => ({
        playerId: row.playerId,
        position: row.position,
        rows: { capturedV31: row, rebuiltV31: rebuiltV31Rows[i], ...(isBaselineRun ? {} : { rebuiltTarget: rebuiltTargetRows[i] }) },
      })),
    });
  }

  const primary = scoreWeeks({ cohortWeeks, cols, actuals });
  const { season, weeksUsed } = seasonize(primary.weekly, cols);
  const calibrationChecked = calibrationByWeek.reduce((s, c) => s + c.checked, 0);
  const calibrationWithin = calibrationByWeek.reduce((s, c) => s + c.withinTolerance, 0);
  const perPosition = Object.fromEntries(cols.map((col) => [col, Object.fromEntries(metrics.MACRO_POSITIONS.map(
    (p) => [p, meanOf(primary.weekly.map((w) => w.byCol[col].byPosition[p]))]
  ))]));

  const result = {
    weeksScored: weeks.length,
    columns: {
      capturedV31: season.capturedV31,
      rebuiltV31: season.rebuiltV31,
      ...(isBaselineRun ? {} : { rebuiltTarget: { modelVersion, ...season.rebuiltTarget } }),
    },
    weeksUsed,
    perPosition,
    rowCounts: primary.rowCounts,
    calibration: {
      modelVersion: MODEL_VERSION_V3_1,
      checked: calibrationChecked,
      withinTolerance: calibrationWithin,
      share: calibrationChecked > 0 ? calibrationWithin / calibrationChecked : null,
      sampleSizeDiffers: calibrationByWeek.reduce((s, c) => s + c.sampleSizeDiffers, 0),
      byWeek: calibrationByWeek,
    },
    rebuiltV31Sha256: digestRebuiltRows(rebuiltV31Weeks),
  };
  if (isBaselineRun || gateWeeks === null) return result;

  // The verdict profile (half_ppr) of a deciding run only. The variants are
  // section 7: reported, selecting nothing.
  result.gate = gateWeeks < SEALED.minWeeks
    ? {
      verdict: 'UNEVALUABLE',
      reason: `${gateWeeks} surviving weeks against a minimum of ${SEALED.minWeeks}`,
      checks: null,
    }
    : gateChecks(primary.weekly);
  const variant = (options) => gateChecks(scoreWeeks({ cohortWeeks, cols, actuals, ...options }).weekly);
  const onlyV32 = cohortWeeks.map((cohortWeek) => {
    const { scored } = classifyWeek(cohortWeek.entries, cols);
    const entries = scored.filter((e) => isServed(e.rows.rebuiltTarget) && !isServed(e.rows.rebuiltV31)
      && hasCompleteInterval(e.rows.rebuiltTarget));
    const cov = coverage.armWeekMetrics({
      rows: entries.map((e) => e.rows.rebuiltTarget), actuals, season: cohortWeek.season, week: cohortWeek.week,
    });
    return { week: cohortWeek.week, rows: entries.length, ...cov };
  });
  result.variants = {
    everyColumnServes: variant({ everyColumnServes: true }),
    positionBaselineAsServed: variant({ served: hasMeanAndIsActive }),
    withoutWeek18: variant({ skipWeek18: true }),
    coverageOnRowsOnlyV32Serves: {
      rows: onlyV32.reduce((s, w) => s + w.rows, 0),
      cov80: meanOf(onlyV32.map((w) => w.cov80)),
      cov50: meanOf(onlyV32.map((w) => w.cov50)),
    },
  };
  return result;
}

/**
 * The whole gate run under one MODEL_VERSION. `profiles` is
 * `[{ name, rules, weeks, actuals }, ...]`; `survivors` is `selectSurvivors`'s
 * result for half_ppr, used for every profile. A `free_baseline_v3.1` run is
 * the calibration run: no v3.2 column, no check, no verdict. Refuses before
 * any reprojection when either version has no registered constants.
 */
async function evaluate({
  profiles, survivors, modelVersion, generateProjections, constantsByModelVersion = CONSTANTS_BY_MODEL_VERSION,
}) {
  constantsFor(modelVersion, constantsByModelVersion);
  constantsFor(MODEL_VERSION_V3_1, constantsByModelVersion);
  const isBaselineRun = modelVersion === MODEL_VERSION_V3_1;
  const result = {
    modelVersion,
    mode: isBaselineRun ? 'calibration' : 'deciding',
    survivors,
    verdict: null,
    profiles: {},
  };
  for (const profile of profiles) {
    result.profiles[profile.name] = await evaluateProfile({
      weeks: profile.weeks.filter((w) => survivors.weeks.includes(w.header.week)),
      actuals: profile.actuals,
      rules: profile.rules,
      modelVersion,
      generateProjections,
      gateWeeks: profile.name === GATE_PROFILE ? survivors.weeks.length : null,
      constantsByModelVersion,
    });
  }
  if (!isBaselineRun) {
    const gate = result.profiles[GATE_PROFILE] && result.profiles[GATE_PROFILE].gate;
    result.verdict = gate ? gate.verdict : 'UNEVALUABLE';
  }
  return result;
}

function fmt(value, digits = 4) {
  return isNum(value) ? value.toFixed(digits) : 'n/a';
}

function renderCheck(check) {
  if (check.name === 'coverage-no-harm') {
    return [check.cov80, check.cov50].map((c) => `| coverage ${c.key} | ${c.passes ? 'pass' : 'FAIL'} | season ${fmt(c.value)} `
      + `(nominal ${c.nominal}, band ${c.band.join('-')}, in band ${c.inBand}), excess distance ${fmt(c.excess)}, tolerance ${fmt(c.tolerance)} |`);
  }
  if (check.name === 'pairwise-noise') {
    return [`| ${check.name} | ${check.passes ? 'pass' : 'FAIL'} | method ${check.method}, n ${check.n}, mean ${fmt(check.mean)}, `
      + `bound ${fmt(check.bound)}, alpha ${check.alpha} |`];
  }
  return [`| ${check.name} | ${check.passes ? 'pass' : 'FAIL'} | rebuilt v3.2 ${fmt(check.rebuiltTarget)}, rebuilt v3.1 ${fmt(check.rebuiltV31)}, `
    + `difference ${fmt(check.difference)}, error bar ${fmt(check.errorBar)} |`];
}

function renderGate(title, gate, lines) {
  lines.push(`${title}: ${gate.verdict}${gate.reason ? ` (${gate.reason})` : ''}`);
  if (!gate.checks) return;
  lines.push('', '| check | result | inputs |', '| --- | --- | --- |');
  for (const check of gate.checks) lines.push(...renderCheck(check));
}

/** Markdown report: the verdict, each check with its inputs, then everything section 7 lists. */
function renderReport(result) {
  const lines = [`# v3.2 successor evaluation: ${result.modelVersion}`, ''];
  lines.push(`mode: ${result.mode}; verdict: ${result.verdict === null ? 'none (no check is evaluated in a calibration run)' : result.verdict}`);
  lines.push(`surviving weeks (half_ppr, every profile): ${result.survivors.weeks.length} (${result.survivors.weeks.join(', ')})`);
  for (const d of result.survivors.dropped) lines.push(`- dropped week ${d.week}: ${d.reason}`);
  if (result.ruleSha256) lines.push(`DECISION_RULE.md SHA-256: ${result.ruleSha256}`);
  lines.push('');
  for (const [profileName, profile] of Object.entries(result.profiles)) {
    lines.push(`## ${profileName}`, '', `weeks scored: ${profile.weeksScored}`);
    if (profile.actualsSha256) lines.push(`actuals SHA-256: ${profile.actualsSha256}`);
    lines.push(`rebuilt v3.1 rows SHA-256: ${profile.rebuiltV31Sha256}`, '');
    const target = profile.columns.rebuiltTarget;
    lines.push(`| metric | captured v3.1 | rebuilt v3.1 |${target ? ` rebuilt ${result.modelVersion} |` : ''}`);
    lines.push(`| --- | --- | --- |${target ? ' --- |' : ''}`);
    for (const [label, key] of [['MAE', 'mae'], ['Spearman rho', 'spearman'], ['Pairwise accuracy', 'pairwise'],
      ['80% coverage', 'cov80'], ['50% coverage', 'cov50']]) {
      lines.push(`| ${label} | ${fmt(profile.columns.capturedV31[key])} | ${fmt(profile.columns.rebuiltV31[key])} |`
        + `${target ? ` ${fmt(target[key])} |` : ''}`);
    }
    lines.push('', 'pairwise by position (season mean):');
    for (const [col, cells] of Object.entries(profile.perPosition)) {
      lines.push(`- ${col}: ${Object.entries(cells).map(([p, v]) => `${p} ${fmt(v)}`).join(', ')}`);
    }
    lines.push('', 'rows by week and reason (scored, Unavailable at capture, served state differs, served by no column):');
    for (const c of profile.rowCounts) {
      lines.push(`- week ${c.week}: ${c.scored}, ${c.unavailable}, ${c.servedStateDiffers}, ${c.servedByNoColumn}`);
    }
    lines.push('', `v3.1 rebuild calibration: ${fmt(profile.calibration.share, 4)} of ${profile.calibration.checked} `
      + `rows within 0.01 mean of the captured value; ${profile.calibration.sampleSizeDiffers} rows with `
      + 'a rebuilt history length different from the captured sample_size.', '');
    if (profile.gate) {
      renderGate('### Gate', profile.gate, lines);
      lines.push('', '### Reported, selecting nothing', '');
      renderGate('rows every column serves', profile.variants.everyColumnServes, lines);
      renderGate('Position-baseline projections counted as served', profile.variants.positionBaselineAsServed, lines);
      renderGate('without week 18', profile.variants.withoutWeek18, lines);
      const only = profile.variants.coverageOnRowsOnlyV32Serves;
      lines.push(`coverage on rows only v3.2 serves: ${only.rows} rows, 80% ${fmt(only.cov80)}, 50% ${fmt(only.cov50)}`, '');
    }
  }
  return lines.join('\n');
}

module.exports = {
  MODEL_VERSION_V3_1,
  GATE_PROFILE,
  CONSTANTS_BY_MODEL_VERSION,
  constantsFor,
  overridesForRow,
  buildOverrideMaps,
  reprojectWeek,
  calibrateAgainstCaptured,
  metricsForArm,
  aggregateWeekly,
  selectSurvivors,
  isServed,
  projectionOf,
  classifyWeek,
  seasonize,
  gateChecks,
  digestRebuiltRows,
  actualsDigest,
  rebuildV31Digest,
  evaluateProfile,
  evaluate,
  renderReport,
};
