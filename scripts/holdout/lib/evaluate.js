'use strict';

/**
 * The `holdout-confirm-2026` evaluator (PREREGISTRATION.md §4, §8, §9, §10).
 *
 * Pure and deterministic: ledger rows and pinned actuals in, the study's
 * verdicts out. No database, no filesystem, no clock. The runner
 * (`server/scripts/run-holdout-confirm.js`) does the I/O; everything that
 * decides anything lives here, testable.
 */

const crypto = require('crypto');
const inference = require('./inference');
const rosters = require('./rosters');
const regret = require('./regret');
const coverage = require('./coverage');

const CONTROL_KIND = 'scheduled';
const CELL_KINDS = Object.freeze(['candidate:bw-20', 'candidate:bw-15']);

/**
 * The sealed §8/§10 values. `evaluate` accepts overrides FOR TESTS ONLY -
 * a real run takes these verbatim, and the report records which were used so
 * a run under overridden values can never pass silently as the sealed study.
 */
const SEALED = Object.freeze({
  draws: 100000,
  bootstrapSeed: 2579717975,
  permutationSeed: 3479054401,
  rosterSeed: 375445932,
  permutations: 10000,
  permutationFloorP: 0.001,
  alphaA: 0.05,
  cellAlpha: 0.025,
  wisMargin: 0.05,
  cov80Target: 0.8,
  cov50Target: 0.5,
  cov80Band: Object.freeze([0.75, 0.85]),
  cov50Band: Object.freeze([0.45, 0.55]),
  medianShiftBound: 0.05,
  minWeeks: 14,
  exactTriggerClusters: 12,
  firstWeek: 1,
  lastWeek: 18,
});

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** The §9.4 checks for one arm of one week. Returns null when clean, else the defect. */
function armDefect(arm, kind) {
  if (!arm) return `${kind}: missing`;
  if (arm.isLate) return `${kind}: captured late`;
  if (new Date(arm.capturedAt) >= new Date(arm.captureNotAfter)) return `${kind}: captured_at at or past capture_not_after`;
  if (arm.rows.length !== Number(arm.cohortSize)) {
    return `${kind}: ${arm.rows.length} rows against cohort_size ${arm.cohortSize}`;
  }
  const digest = sha256(arm.rows.map((r) => r.playerId).slice().sort((a, b) => a - b).join(','));
  if (digest !== arm.cohortHash) return `${kind}: child rows do not reproduce the header cohort digest`;
  return null;
}

/** The per-arm majority value of a header field across weeks (ties break to the earliest week's value). */
function majorityValue(weeks, kind, field) {
  const counts = new Map();
  for (const entry of weeks) {
    const value = entry.arms[kind] && entry.arms[kind][field];
    if (value === undefined) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let best = null; let bestCount = -1;
  for (const entry of weeks) {
    const value = entry.arms[kind] && entry.arms[kind][field];
    if (value === undefined) continue;
    if (counts.get(value) > bestCount) { best = value; bestCount = counts.get(value); }
  }
  return best;
}

/**
 * Week survival (§4, §9.4): a week survives iff every arm is present, on
 * time, complete, digest-true, all arms share one cohort hash, and every
 * arm's constants_hash and model_version match its arm's season majority -
 * a mid-season constants or model change makes the affected weeks a
 * different experiment, and they drop symmetrically rather than blend.
 */
function survivingWeeks({ weeks, config }) {
  const kinds = [CONTROL_KIND, ...CELL_KINDS];
  const majority = {};
  for (const kind of kinds) {
    majority[kind] = {
      constantsHash: majorityValue(weeks, kind, 'constantsHash'),
      modelVersion: majorityValue(weeks, kind, 'modelVersion'),
    };
  }
  const survivors = [];
  const dropped = [];
  for (const entry of weeks) {
    if (entry.week < config.firstWeek || entry.week > config.lastWeek) {
      dropped.push({ week: entry.week, reason: 'outside the evaluated window' });
      continue;
    }
    const defects = [];
    for (const kind of kinds) {
      const defect = armDefect(entry.arms[kind], kind);
      if (defect) { defects.push(defect); continue; }
      const arm = entry.arms[kind];
      if (arm.constantsHash !== majority[kind].constantsHash) {
        defects.push(`${kind}: constants_hash differs from the arm's season majority (constants drift)`);
      }
      if (arm.modelVersion !== majority[kind].modelVersion) {
        defects.push(`${kind}: model_version differs from the arm's season majority`);
      }
    }
    if (defects.length === 0) {
      const hashes = new Set(kinds.map((kind) => entry.arms[kind].cohortHash));
      if (hashes.size !== 1) defects.push('arms disagree on the cohort hash - not one feature snapshot');
    }
    if (defects.length > 0) dropped.push({ week: entry.week, reason: defects.join('; ') });
    else survivors.push(entry);
  }
  survivors.sort((a, b) => a.week - b.week);
  return { survivors, dropped, majority };
}

/** §9.1: candidate means must equal control means exactly, row for row. */
function meanEquality({ survivors, kind }) {
  let mismatches = 0;
  let checked = 0;
  const examples = [];
  for (const entry of survivors) {
    const controlById = new Map(entry.arms[CONTROL_KIND].rows.map((r) => [r.playerId, r]));
    for (const row of entry.arms[kind].rows) {
      const control = controlById.get(row.playerId);
      if (!control) continue;
      checked += 1;
      const a = row.mean === null || row.mean === undefined ? null : Number(row.mean);
      const b = control.mean === null || control.mean === undefined ? null : Number(control.mean);
      if (a !== b) {
        mismatches += 1;
        if (examples.length < 5) examples.push({ week: entry.week, playerId: row.playerId, candidate: a, control: b });
      }
    }
  }
  return { checked, mismatches, examples, ok: mismatches === 0 };
}

/** Candidate B for one cell: components, bands, voids, verdict (§8.2, §9.1-9.2). */
function evaluateCell({ cellKind, survivors, actuals, season, resamples, config }) {
  const voids = [];
  const equality = meanEquality({ survivors, kind: cellKind });
  if (!equality.ok) {
    voids.push(`mean bit-equality violated on ${equality.mismatches} of ${equality.checked} rows`);
  }

  let shiftSigned = 0; let shiftAbs = 0; let shiftN = 0;
  const weekly = [];
  for (const entry of survivors) {
    const ctrl = coverage.armWeekMetrics({ rows: entry.arms[CONTROL_KIND].rows, actuals, season, week: entry.week });
    const cell = coverage.armWeekMetrics({ rows: entry.arms[cellKind].rows, actuals, season, week: entry.week });
    const shift = coverage.medianShift({
      controlRows: entry.arms[CONTROL_KIND].rows, candidateRows: entry.arms[cellKind].rows,
    });
    shiftSigned += shift.signedSum; shiftAbs += shift.absSum; shiftN += shift.n;
    weekly.push({ week: entry.week, ctrl, cell });
  }
  const signedMeanShift = shiftN > 0 ? shiftSigned / shiftN : null;
  if (signedMeanShift !== null && Math.abs(signedMeanShift) > config.medianShiftBound) {
    voids.push(`signed mean median shift ${signedMeanShift.toFixed(4)} outside +/-${config.medianShiftBound}`);
  }

  // Component series over weeks where both sides have the metric; a week
  // missing either side drops from that component symmetrically and is
  // counted. (With a ~550-player cohort a null weekly metric means an empty
  // eligibility set - a structural event the counts must surface.)
  const series = (pick) => {
    const values = []; let droppedWeeks = 0;
    for (const w of weekly) {
      const value = pick(w);
      if (value === null) droppedWeeks += 1;
      else values.push(value);
    }
    return { values, droppedWeeks };
  };
  const t80 = series((w) => (w.ctrl.cov80 === null || w.cell.cov80 === null ? null
    : Math.abs(w.ctrl.cov80 - config.cov80Target) - Math.abs(w.cell.cov80 - config.cov80Target)));
  const t50 = series((w) => (w.ctrl.cov50 === null || w.cell.cov50 === null ? null
    : Math.abs(w.ctrl.cov50 - config.cov50Target) - Math.abs(w.cell.cov50 - config.cov50Target)));
  const wisDelta = series((w) => (w.ctrl.wis === null || w.cell.wis === null ? null : w.cell.wis - w.ctrl.wis));

  // The §10 contract wants one resample matrix per survivor count; component
  // series can be shorter than the survivor set only via null-metric drops.
  const boundFor = (label, s, side, boundary) => {
    const matrix = s.values.length === survivors.length
      ? resamples
      : inference.buildResamples({ n: s.values.length, draws: config.draws, seed: config.bootstrapSeed });
    return inference.decideComponent({
      label, weeklyValues: s.values, resamples: matrix,
      alpha: config.cellAlpha, boundary, side,
      exactTriggerClusters: config.exactTriggerClusters,
    });
  };
  const components = [
    boundFor('cov80-distance-improvement', t80, 'lower', 0),
    boundFor('cov50-distance-improvement', t50, 'lower', 0),
    boundFor('wis-no-harm', wisDelta, 'upper', config.wisMargin),
  ];

  const meanOf = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const cov80Point = meanOf(weekly.map((w) => w.cell.cov80).filter((v) => v !== null));
  const cov50Point = meanOf(weekly.map((w) => w.cell.cov50).filter((v) => v !== null));
  const bands = [
    {
      label: 'cov80-point-band', value: cov80Point, band: config.cov80Band,
      passes: cov80Point !== null && cov80Point >= config.cov80Band[0] && cov80Point <= config.cov80Band[1],
    },
    {
      label: 'cov50-point-band', value: cov50Point, band: config.cov50Band,
      passes: cov50Point !== null && cov50Point >= config.cov50Band[0] && cov50Point <= config.cov50Band[1],
    },
  ];

  const verdict = voids.length > 0 ? 'void'
    : components.every((c) => c.passes) && bands.every((b) => b.passes) ? 'pass' : 'fail';
  return {
    cellKind, verdict, voids, meanEquality: equality,
    medianShift: { signedMean: signedMeanShift, absMean: shiftN > 0 ? shiftAbs / shiftN : null, rows: shiftN },
    components, bands, weekly,
    seriesDrops: { t80: t80.droppedWeeks, t50: t50.droppedWeeks, wis: wisDelta.droppedWeeks },
  };
}

/** Candidate A: rosters, paired weekly regret deltas, the §8.1 bound, the §9.3 floor. */
function evaluateDecisionRule({ survivors, actuals, season, priorSeason, resamples, config }) {
  const weeks = survivors.map((entry) => entry.week);
  const rostersByWeek = new Map();
  const scheduledRowsByWeek = new Map();
  for (const entry of survivors) {
    const built = rosters.buildWeekRosters({
      cohortRows: entry.arms[CONTROL_KIND].rows,
      season, week: entry.week, actuals,
      rosterSeed: config.rosterSeed, priorSeason,
    });
    rostersByWeek.set(entry.week, built.rosters);
    scheduledRowsByWeek.set(entry.week, entry.arms[CONTROL_KIND].rows);
  }

  const weeklyControl = []; const weeklyCandidate = [];
  for (const entry of survivors) {
    const rows = scheduledRowsByWeek.get(entry.week);
    const weekRosters = rostersByWeek.get(entry.week);
    // Hindsight is arm-invariant: computed once, shared by both arms (and
    // recomputed independently inside the permutation floor, which owns its
    // own cache for the same reason).
    const ideals = regret.weekIdeals({ rosters: weekRosters, actuals, season, week: entry.week });
    weeklyControl.push(regret.weekRegret({
      rosters: weekRosters, rankingFor: regret.armRankingMap(rows, 'median'),
      actuals, season, week: entry.week, ideals,
    }));
    weeklyCandidate.push(regret.weekRegret({
      rosters: weekRosters, rankingFor: regret.armRankingMap(rows, 'mean'),
      actuals, season, week: entry.week, ideals,
    }));
  }
  const deltas = weeklyCandidate.map((v, i) => v - weeklyControl[i]);
  const controlMean = weeklyControl.reduce((a, b) => a + b, 0) / (weeklyControl.length || 1);

  const floor = regret.permutationFloor({
    weeks, rostersByWeek, scheduledRowsByWeek, actuals, season,
    permutations: config.permutations, seed: config.permutationSeed,
    controlMeanRegret: controlMean,
  });
  const voids = [];
  if (floor.p > config.permutationFloorP) {
    voids.push(`permutation floor failed: p ${floor.p.toFixed(6)} > ${config.permutationFloorP} - the pipeline cannot distinguish the control from a shuffle`);
  }

  const component = inference.decideComponent({
    label: 'regret-superiority', weeklyValues: deltas, resamples,
    alpha: config.alphaA, boundary: 0, side: 'upper',
    exactTriggerClusters: config.exactTriggerClusters,
  });
  return {
    verdict: voids.length > 0 ? 'void' : component.passes ? 'pass' : 'fail',
    voids, component,
    weekly: weeks.map((week, i) => ({
      week, control: weeklyControl[i], candidate: weeklyCandidate[i], delta: deltas[i],
    })),
    controlMeanRegret: controlMean,
    permutationFloor: { p: floor.p, permutations: floor.permutations, threshold: config.permutationFloorP },
  };
}

/**
 * The whole study. `weeks` is every captured week's arm data for the primary
 * profile; `actuals` maps 'season:week:playerId' -> pinned points for the
 * study season AND the prior season (roster ranking reads both).
 */
function evaluate({ season, priorSeason, weeks, actuals, config: overrides }) {
  const config = { ...SEALED, ...(overrides || {}) };
  const overriddenKeys = Object.keys(overrides || {}).filter((k) => {
    const sealedValue = SEALED[k];
    const given = (overrides || {})[k];
    return JSON.stringify(sealedValue) !== JSON.stringify(given);
  });

  const { survivors, dropped, majority } = survivingWeeks({ weeks, config });
  const base = {
    studyId: 'holdout-confirm-2026',
    season,
    config: { ...config, overriddenKeys },
    weeks: { provided: weeks.length, surviving: survivors.length, dropped },
    armProvenance: majority,
  };
  if (survivors.length < config.minWeeks) {
    return {
      ...base,
      evaluable: false,
      reason: `${survivors.length} surviving weeks against a minimum of ${config.minWeeks} - every claim is UNEVALUABLE and nothing flips`,
      candidateA: null,
      candidateB: { cells: [], selected: null },
    };
  }

  const resamples = inference.buildResamples({
    n: survivors.length, draws: config.draws, seed: config.bootstrapSeed,
  });

  const cells = CELL_KINDS.map((cellKind) => evaluateCell({
    cellKind, survivors, actuals, season, resamples, config,
  }));
  // §8.2: fixed selection order among passers; nothing about the data reorders it.
  const selected = (cells.find((c) => c.verdict === 'pass') || { cellKind: null }).cellKind;

  const candidateA = evaluateDecisionRule({ survivors, actuals, season, priorSeason, resamples, config });

  return {
    ...base,
    evaluable: true,
    candidateA,
    candidateB: { cells, selected },
    flips: {
      lineupRanking: candidateA.verdict === 'pass' ? 'mean' : null,
      calibration: selected,
      modelVersionBump: candidateA.verdict === 'pass' || selected !== null,
    },
  };
}

module.exports = {
  SEALED,
  CONTROL_KIND,
  CELL_KINDS,
  armDefect,
  survivingWeeks,
  meanEquality,
  evaluateCell,
  evaluateDecisionRule,
  evaluate,
};
