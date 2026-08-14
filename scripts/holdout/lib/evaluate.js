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
  // Family levels (the CLAIMS' alphas) and the tighter TEST alphas the
  // bounds actually run at. Adversarial statistical review measured §10's
  // raw percentile bootstrap ANTICONSERVATIVE at n = 14-18: per-component
  // levels of 1.4-2.3x nominal on realistic coverage-contrast populations,
  // ~1.1-1.3x on the regret-delta shape. The divisors are the pit-sweep's
  // conservatism restored with a measured reason - the earlier Berger
  // no-divisor argument was correct as a theorem and false in its premise,
  // because the components were never level-alpha to begin with.
  alphaA: 0.05,
  alphaATest: 0.025,
  cellAlpha: 0.025,
  componentAlpha: 0.025 / 3,
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
  // Unparseable timestamps FAIL CLOSED: NaN compares false against
  // everything, so without this check a corrupted capturedAt would read as
  // "not late" (adversarial review finding).
  const capturedAt = new Date(arm.capturedAt);
  const notAfter = new Date(arm.captureNotAfter);
  if (Number.isNaN(capturedAt.getTime()) || Number.isNaN(notAfter.getTime())) {
    return `${kind}: unparseable capture timestamps`;
  }
  if (capturedAt >= notAfter) return `${kind}: captured_at at or past capture_not_after`;
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
  // Window-filter and week-sort BEFORE the majority is computed, for two
  // reasons found adversarially: an out-of-window week must never vote on
  // which in-window weeks drop, and majorityValue's documented earliest-week
  // tie-break is only true of a week-ordered array.
  const inWindow = weeks
    .filter((entry) => entry.week >= config.firstWeek && entry.week <= config.lastWeek)
    .sort((a, b) => a.week - b.week);
  const majority = {};
  for (const kind of kinds) {
    majority[kind] = {
      constantsHash: majorityValue(inWindow, kind, 'constantsHash'),
      modelVersion: majorityValue(inWindow, kind, 'modelVersion'),
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
  // counted. (A null weekly metric means no row was eligible for THAT
  // metric on some arm - §10's correction: the week's row set need not be
  // empty - a structural event the counts must surface.)
  const series = (pick) => {
    const values = []; const missingWeeks = [];
    for (const w of weekly) {
      const value = pick(w);
      if (value === null) missingWeeks.push(w.week);
      else values.push(value);
    }
    return { values, missingWeeks, droppedWeeks: missingWeeks.length };
  };
  const t80 = series((w) => (w.ctrl.cov80 === null || w.cell.cov80 === null ? null
    : Math.abs(w.ctrl.cov80 - config.cov80Target) - Math.abs(w.cell.cov80 - config.cov80Target)));
  const t50 = series((w) => (w.ctrl.cov50 === null || w.cell.cov50 === null ? null
    : Math.abs(w.ctrl.cov50 - config.cov50Target) - Math.abs(w.cell.cov50 - config.cov50Target)));
  const wisDelta = series((w) => (w.ctrl.wis === null || w.cell.wis === null ? null : w.cell.wis - w.ctrl.wis));

  // §9.5 [added pre-seal]: the component series and the survivor set are ONE
  // week set. §10 records that a drop moves the affected component's n and,
  // below the 12-cluster threshold, hands it the exact sign test. §9.4
  // cannot see this (ledger integrity never reads row content), so a defect
  // confined to the CONTROL arm's stored intervals could otherwise select
  // the test that scores the candidate. Any gap voids the candidate -
  // asymmetric single-band nulls and symmetric all-band nulls alike. The
  // components below still compute as report diagnostics, never as a
  // verdict; an EMPTY series publishes an explicit empty-series diagnostic
  // (see boundFor) rather than crashing the run out of its own report.
  const seriesGaps = [['t80', t80], ['t50', t50], ['wis', wisDelta]]
    .filter(([, s]) => s.missingWeeks.length > 0)
    .map(([label, s]) => `${label}: week${s.missingWeeks.length > 1 ? 's' : ''} ${s.missingWeeks.join(', ')}`);
  if (seriesGaps.length > 0) {
    voids.push(`component series shorter than the survivor set (${seriesGaps.join('; ')}) - a null weekly metric is a defective ledger, per section 9 item 5`);
  }

  // The §10 contract wants one resample matrix per survivor count; component
  // series can be shorter than the survivor set only via null-metric drops.
  const boundFor = (label, s, side, boundary) => {
    // An EMPTY series has nothing to resample or sign-test, and §9.5 has
    // already voided the candidate (every week is a gap). Publishing an
    // explicit no-evidence diagnostic keeps the promise that the report is
    // written either way - a throw here would kill the whole run, Candidate
    // A's verdict included, before a single byte of report exists.
    if (s.values.length === 0) {
      return { label, method: 'empty-series', passes: false, n: 0, boundary, side };
    }
    const matrix = s.values.length === survivors.length
      ? resamples
      : inference.buildResamples({ n: s.values.length, draws: config.draws, seed: config.bootstrapSeed });
    return inference.decideComponent({
      label, weeklyValues: s.values, resamples: matrix,
      alpha: config.componentAlpha, boundary, side,
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

  const weeklyControl = []; const weeklyCandidate = []; const weeklyPooled = [];
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
    // The §8.1 pooled-residual SENSITIVITY, non-selecting: `mean` plus a
    // position-constant offset, ranked over the SAME control snapshot and the
    // same rosters. The offset is estimated from a candidate cell's rows
    // because only a `bandwidth > 0` arm pins `median - mean` to the residual
    // median (see `regret.pooledOffsetsByPosition`). Nothing here reads a
    // candidate's own regret, and no gate reads this series.
    // The guard is on the OFFSETS, not on the arm's presence. No surviving week
    // can lack the candidate arm - `armDefect` drops the week for every arm on a
    // missing arm or a row-count mismatch - so an arm-presence check is
    // unreachable. What IS reachable is an arm present whose rows carry no
    // usable median/mean/position: `armDefect` never inspects those, so such a
    // week survives, `pooledOffsetsByPosition` returns an EMPTY map, and
    // `pooledRankingMap` then falls back to the control ranking for every
    // player - publishing the control series under the sensitivity's name.
    // Nulling is the honest outcome.
    const offsetSource = entry.arms[CELL_KINDS[0]];
    const offsets = offsetSource ? regret.pooledOffsetsByPosition(offsetSource.rows) : null;
    weeklyPooled.push(offsets && offsets.size > 0
      ? regret.weekRegret({
        rosters: weekRosters,
        rankingFor: regret.pooledRankingMap(rows, offsets),
        actuals, season, week: entry.week, ideals,
      })
      : null);
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
    alpha: config.alphaATest, boundary: 0, side: 'upper',
    exactTriggerClusters: config.exactTriggerClusters,
  });
  return {
    verdict: voids.length > 0 ? 'void' : component.passes ? 'pass' : 'fail',
    voids, component,
    weekly: weeks.map((week, i) => ({
      week, control: weeklyControl[i], candidate: weeklyCandidate[i], delta: deltas[i],
      pooled: weeklyPooled[i],
    })),
    controlMeanRegret: controlMean,
    // NON-SELECTING (§8.1). Published so -1.90 can be decomposed into skew
    // correction versus per-player estimation noise; read by no gate, and its
    // absence or presence changes no verdict.
    //
    // `null` when any surviving week yielded NO position offsets - which is the
    // reachable degradation, not a missing arm. A week whose candidate arm is
    // absent is dropped upstream by `armDefect`, so it never reaches here; this
    // comment previously named that unreachable branch as the rule and
    // contradicted the block comment 40 lines above.
    pooledSensitivity: weeklyPooled.some((v) => v === null) ? null : {
      meanRegret: weeklyPooled.reduce((a, b) => a + b, 0) / (weeklyPooled.length || 1),
      meanDeltaVsControl: weeklyPooled.reduce((a, b, i) => a + (b - weeklyControl[i]), 0) / (weeklyPooled.length || 1),
      meanDeltaVsCandidate: weeklyPooled.reduce((a, b, i) => a + (b - weeklyCandidate[i]), 0) / (weeklyPooled.length || 1),
      selecting: false,
    },
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
      candidateB: { verdict: null, voids: [], cells: [], selected: null },
      sensitivityWeeks1to17: null,
    };
  }

  const resamples = inference.buildResamples({
    n: survivors.length, draws: config.draws, seed: config.bootstrapSeed,
  });

  const cells = CELL_KINDS.map((cellKind) => evaluateCell({
    cellKind, survivors, actuals, season, resamples, config,
  }));
  // §9's void scope is CANDIDATE B, not the cell. A §9.1/§9.2 void on ANY
  // cell voids the whole candidate and nothing is selected: a mean
  // divergence means that arm's capture lost snapshot isolation, and the
  // sibling arm came from the SAME transaction, so there is no basis to
  // trust it either. Adversarial review finding (BLOCKER): the earlier
  // cell-scoped void quietly promoted the surviving cell to a ship - the
  // one event that means "this run cannot speak" was selecting the
  // fallback. Cells keep their own diagnostics for the report; selection
  // and verdict are candidate-level.
  const candidateBVoids = cells.flatMap((c) => c.voids.map((v) => `${c.cellKind}: ${v}`));
  const selected = candidateBVoids.length > 0
    ? null
    // §8.2: fixed selection order among passers; nothing about the data reorders it.
    : (cells.find((c) => c.verdict === 'pass') || { cellKind: null }).cellKind;
  const candidateB = {
    verdict: candidateBVoids.length > 0 ? 'void' : selected ? 'pass' : 'fail',
    voids: candidateBVoids,
    cells,
    selected,
  };

  // Candidate A is ISOLATED: a roster-construction anomaly (§6's fail-loud
  // quota rule) voids Candidate A with the anomaly named, and touches
  // nothing in Candidate B - §1 promises the claims flip independently, and
  // a thin cohort week is an estimand problem for the regret claim alone.
  // Adversarial review finding (SUBSTANTIVE): the throw previously escaped
  // evaluate() whole, discarding Candidate B's already-computed verdicts.
  let candidateA;
  try {
    candidateA = evaluateDecisionRule({ survivors, actuals, season, priorSeason, resamples, config });
  } catch (err) {
    candidateA = {
      verdict: 'void',
      voids: [`evaluation anomaly: ${err.message} - for DEVIATIONS.md adjudication`],
      component: null,
      weekly: [],
      controlMeanRegret: null,
      permutationFloor: null,
    };
  }

  return {
    ...base,
    evaluable: true,
    candidateA,
    candidateB,
    sensitivityWeeks1to17: weeks1to17Sensitivity({ survivors, candidateA, cells, config }),
    flips: {
      lineupRanking: candidateA.verdict === 'pass' ? 'mean' : null,
      calibration: selected,
      modelVersionBump: candidateA.verdict === 'pass' || selected !== null,
    },
  };
}

/**
 * The §4/§11 weeks-1-17 sensitivity, published and NON-SELECTING: the same
 * contrasts recomputed from the PRIMARY run's own weekly series with week 18
 * removed. Nothing is re-simulated - rosters, regret and coverage numbers
 * are the primary's - so this can never disagree with the primary about a
 * week's value, only about the aggregate with week 18 excluded. Each series
 * takes its own resample matrix at the same seed (the §10 exception for
 * shortened series). Skipped, with the reason stated, when week 18 did not
 * survive - the primary already IS a weeks-1-17 analysis then.
 */
function weeks1to17Sensitivity({ survivors, candidateA, cells, config }) {
  if (!survivors.some((entry) => entry.week === 18)) {
    return { skipped: 'week 18 did not survive; the primary run already covers weeks 1-17 only' };
  }
  // The same empty-series guard as evaluateCell's boundFor: a sensitivity
  // must never be able to crash a run whose primary series computed fine.
  const decide = (label, values, side, boundary, alpha) => (values.length === 0
    ? { label, method: 'empty-series', passes: false, n: 0, boundary, side }
    : inference.decideComponent({
      label,
      weeklyValues: values,
      resamples: inference.buildResamples({ n: values.length, draws: config.draws, seed: config.bootstrapSeed }),
      alpha,
      boundary,
      side,
      exactTriggerClusters: config.exactTriggerClusters,
    }));
  const meanOf = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

  const result = { nonSelecting: true, candidateA: null, cells: [] };
  if (candidateA.verdict !== 'void') {
    const deltas = candidateA.weekly.filter((w) => w.week <= 17).map((w) => w.delta);
    result.candidateA = deltas.length > 0
      ? decide('regret-superiority (weeks 1-17)', deltas, 'upper', 0, config.alphaATest)
      : null;
  }
  for (const cell of cells) {
    const weekly = cell.weekly.filter((w) => w.week <= 17);
    const series = (pick) => weekly.map(pick).filter((v) => v !== null);
    const t80 = series((w) => (w.ctrl.cov80 === null || w.cell.cov80 === null ? null
      : Math.abs(w.ctrl.cov80 - config.cov80Target) - Math.abs(w.cell.cov80 - config.cov80Target)));
    const t50 = series((w) => (w.ctrl.cov50 === null || w.cell.cov50 === null ? null
      : Math.abs(w.ctrl.cov50 - config.cov50Target) - Math.abs(w.cell.cov50 - config.cov50Target)));
    const wisDelta = series((w) => (w.ctrl.wis === null || w.cell.wis === null ? null : w.cell.wis - w.ctrl.wis));
    result.cells.push({
      cellKind: cell.cellKind,
      components: [
        decide('cov80-distance-improvement (weeks 1-17)', t80, 'lower', 0, config.componentAlpha),
        decide('cov50-distance-improvement (weeks 1-17)', t50, 'lower', 0, config.componentAlpha),
        decide('wis-no-harm (weeks 1-17)', wisDelta, 'upper', config.wisMargin, config.componentAlpha),
      ],
      cov80Point: meanOf(weekly.map((w) => w.cell.cov80).filter((v) => v !== null)),
      cov50Point: meanOf(weekly.map((w) => w.cell.cov50).filter((v) => v !== null)),
    });
  }
  return result;
}

module.exports = {
  SEALED,
  CONTROL_KIND,
  CELL_KINDS,
  weeks1to17Sensitivity,
  armDefect,
  survivingWeeks,
  meanEquality,
  evaluateCell,
  evaluateDecisionRule,
  evaluate,
};
