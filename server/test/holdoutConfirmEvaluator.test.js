const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const inference = require('../../scripts/holdout/lib/inference');
const rosters = require('../../scripts/holdout/lib/rosters');
const regret = require('../../scripts/holdout/lib/regret');
const coverage = require('../../scripts/holdout/lib/coverage');
const evaluator = require('../../scripts/holdout/lib/evaluate');
const { renderReport } = require('../../scripts/holdout/lib/report');
const runner = require('../scripts/run-holdout-confirm');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------------------
// Inference (§10)
// ---------------------------------------------------------------------------

test('resamples are deterministic for a seed and sized to the survivor set', () => {
  const a = inference.buildResamples({ n: 5, draws: 50, seed: 42 });
  const b = inference.buildResamples({ n: 5, draws: 50, seed: 42 });
  assert.deepEqual(a, b);
  assert.equal(a.length, 50);
  assert.ok(a.every((row) => row.length === 5 && row.every((i) => i >= 0 && i < 5)));
  assert.notDeepEqual(a, inference.buildResamples({ n: 5, draws: 50, seed: 43 }));
});

test('bootstrapBound refuses a matrix built for a different survivor count', () => {
  const resamples = inference.buildResamples({ n: 4, draws: 100, seed: 1 });
  assert.throws(
    () => inference.bootstrapBound({ weeklyValues: [1, 2, 3], resamples, alpha: 0.05, side: 'upper' }),
    /built for a different survivor set/
  );
});

test('the percentile bound follows the fixed order-statistic rule', () => {
  // A constant series makes every resampled mean identical, so both bounds
  // must equal that constant whatever the index arithmetic does.
  const resamples = inference.buildResamples({ n: 6, draws: 1000, seed: 7 });
  const flat = inference.bootstrapBound({
    weeklyValues: [2, 2, 2, 2, 2, 2], resamples, alpha: 0.05, side: 'upper',
  });
  assert.equal(flat.bound, 2);
  assert.equal(flat.index, Math.ceil(0.95 * 1000));
  assert.equal(flat.distinctValues, 1);
  assert.ok(flat.degenerate, 'one distinct value is the degenerate trigger');

  const lower = inference.bootstrapBound({
    weeklyValues: [1, 2, 3, 4, 5, 6], resamples, alpha: 0.025, side: 'lower',
  });
  assert.equal(lower.quantile, 0.025);
  assert.ok(lower.bound < 3.5, 'the lower bound sits below the mean');
});

test('binomialUpperTail matches the sealed worked examples', () => {
  // Pit-sweep §9.8's documented discreteness: n=8, k=8 -> 1/256; k=7 -> 9/256.
  assert.equal(inference.binomialUpperTail(8, 8), 1 / 256);
  assert.equal(inference.binomialUpperTail(8, 7), 9 / 256);
  assert.equal(inference.binomialUpperTail(4, 0), 1);
  assert.equal(inference.binomialUpperTail(4, 5), 0);
});

test('exactSignTest drops exact-zero shifts on the 10-decimal rule', () => {
  const out = inference.exactSignTest({
    weeklyValues: [-1, -1, -1, 0.05, 0.05 + 1e-12], boundary: 0.05, alpha: 0.05, direction: 'below',
  });
  // 0.05 shifts to exactly 0 and drops; the 1e-12 rounds to 0 and drops too.
  assert.equal(out.n, 3);
  assert.equal(out.favorable, 3);
  assert.equal(out.p, 1 / 8);
});

test('decideComponent switches to the exact test below the cluster trigger', () => {
  const resamples = inference.buildResamples({ n: 8, draws: 500, seed: 3 });
  const out = inference.decideComponent({
    label: 't', weeklyValues: [-1, -2, -1, -2, -1, -2, -1, -2], resamples,
    alpha: 0.05, boundary: 0, side: 'upper', exactTriggerClusters: 12,
  });
  assert.equal(out.method, 'exact-sign-test');
  assert.match(out.triggerReason, /fewer than 12 clusters/);
  assert.equal(out.passes, true, 'eight of eight favorable at alpha 0.05: p = 1/256');
});

test('decideComponent bootstrap direction: upper bound below, lower bound above', () => {
  const n = 14;
  const resamples = inference.buildResamples({ n, draws: 4000, seed: 11 });
  const negatives = Array.from({ length: n }, (_, i) => -2 + 0.01 * i);
  const upper = inference.decideComponent({
    label: 'u', weeklyValues: negatives, resamples, alpha: 0.05, boundary: 0, side: 'upper',
  });
  assert.equal(upper.method, 'percentile-cluster-bootstrap');
  assert.equal(upper.passes, true);
  const lower = inference.decideComponent({
    label: 'l', weeklyValues: negatives, resamples, alpha: 0.05, boundary: 0, side: 'lower',
  });
  assert.equal(lower.passes, false, 'the same series cannot also clear a lower-above-zero gate');
});

test('permutationP is plus-one Monte Carlo', () => {
  assert.equal(inference.permutationP({ observed: 5, permStats: [6, 7, 8, 9] }), 1 / 5);
  assert.equal(inference.permutationP({ observed: 5, permStats: [4, 6, 7, 8] }), 2 / 5);
});

// ---------------------------------------------------------------------------
// Rosters (§6)
// ---------------------------------------------------------------------------

/** A cohort exactly matching the quotas: 160 players, ids 1..160. */
function quotaCohort() {
  const rows = [];
  let id = 1;
  for (const [position, quota] of Object.entries(rosters.ROSTER_QUOTAS)) {
    for (let i = 0; i < quota; i++) rows.push({ playerId: id++, position });
  }
  return rows;
}

/** Actuals giving every player one prior-season game worth id-scaled points. */
function rankingActuals(cohort, { season = 2026, priorSeason = 2025 } = {}) {
  const actuals = new Map();
  for (const row of cohort) actuals.set(`${priorSeason}:18:${row.playerId}`, row.playerId * 0.1);
  return actuals;
}

test('preWeekRanking weights recency and staleness across the season boundary', () => {
  const actuals = new Map([
    ['2026:1:7', 10],
    ['2025:18:7', 20],
  ]);
  const values = rosters.preWeekRanking({
    playerIds: [7], season: 2026, week: 2, actuals, priorSeason: 2025,
  });
  // Week 2 of 2026: the 2026 week-1 game is 1 week old (weight 0.5^(1/8));
  // 2025 week 18 is 2 + 26 - 18 = 10 weeks old (weight 0.5^(10/8)).
  const w1 = 0.5 ** (1 / 8);
  const w18 = 0.5 ** (10 / 8);
  const expected = (w1 * 10 + w18 * 20) / (w1 + w18);
  assert.ok(Math.abs(values.get(7) - expected) < 1e-12);
  // No prior game at all -> unrankable, absent from the map.
  assert.equal(rosters.preWeekRanking({
    playerIds: [8], season: 2026, week: 2, actuals, priorSeason: 2025,
  }).has(8), false);
});

test('buildWeekRosters drafts 50 legal rosters that exactly exhaust the pool', () => {
  const cohort = quotaCohort();
  const actuals = rankingActuals(cohort);
  const built = rosters.buildWeekRosters({
    cohortRows: cohort, season: 2026, week: 1, actuals, rosterSeed: 375445932, priorSeason: 2025,
  });
  assert.equal(built.poolSize, 160);
  assert.equal(built.rosters.length, 50);
  for (let replicate = 0; replicate < rosters.REPLICATES; replicate++) {
    const replicateRosters = built.rosters.filter((r) => r.replicate === replicate);
    assert.equal(replicateRosters.length, 10);
    const used = replicateRosters.flatMap((r) => r.players.map((p) => p.playerId));
    assert.equal(used.length, 160, 'every roster holds 16');
    assert.equal(new Set(used).size, 160, 'no player drafted twice, pool exactly exhausted');
    for (const roster of replicateRosters) {
      const counts = {};
      for (const p of roster.players) counts[p.position] = (counts[p.position] || 0) + 1;
      assert.deepEqual(counts, rosters.TEAM_CAPS, 'caps exactly met - legal by construction');
    }
  }
  // Determinism, and replicate variation.
  const again = rosters.buildWeekRosters({
    cohortRows: cohort, season: 2026, week: 1, actuals, rosterSeed: 375445932, priorSeason: 2025,
  });
  assert.deepEqual(again.rosters, built.rosters);
  const r0 = built.rosters.filter((r) => r.replicate === 0).map((r) => r.players.map((p) => p.playerId));
  const r1 = built.rosters.filter((r) => r.replicate === 1).map((r) => r.players.map((p) => p.playerId));
  assert.notDeepEqual(r0, r1, 'replicates draft in different seeded orders');
});

test('a position short of its quota fails loud instead of reshaping the pool', () => {
  const cohort = quotaCohort().filter((r) => !(r.position === 'K' && r.playerId % 2 === 0));
  const actuals = rankingActuals(quotaCohort());
  assert.throws(
    () => rosters.buildWeekRosters({
      cohortRows: cohort, season: 2026, week: 1, actuals, rosterSeed: 375445932, priorSeason: 2025,
    }),
    /position K has 5 rankable players against a quota of 10/
  );
});

// ---------------------------------------------------------------------------
// Regret (§2, §6, §9.3)
// ---------------------------------------------------------------------------

test('rankingValue follows each arm\'s fallback rule and zeroes the unavailable', () => {
  const row = { median: 8, mean: 10, activeProbability: 1 };
  assert.equal(regret.rankingValue(row, 'median'), 8);
  assert.equal(regret.rankingValue(row, 'mean'), 10);
  assert.equal(regret.rankingValue({ median: null, mean: 10, activeProbability: 1 }, 'median'), 10);
  assert.equal(regret.rankingValue({ median: 8, mean: null, activeProbability: 1 }, 'mean'), 8);
  assert.equal(regret.rankingValue({ median: 8, mean: 10, activeProbability: 0 }, 'mean'), 0);
  assert.equal(regret.rankingValue({ median: null, mean: null, activeProbability: 1 }, 'mean'), 0);
  assert.equal(regret.rankingValue(null, 'mean'), 0);
});

test('weekRegret is zero for a ranking that matches actuals and positive for one that inverts them', () => {
  const cohort = quotaCohort();
  const actuals = rankingActuals(cohort);
  const built = rosters.buildWeekRosters({
    cohortRows: cohort, season: 2026, week: 1, actuals, rosterSeed: 375445932, priorSeason: 2025,
  });
  // Give every player actual points equal to his id this week.
  for (const row of cohort) actuals.set(`2026:1:${row.playerId}`, row.playerId);
  const perfect = new Map(cohort.map((r) => [r.playerId, r.playerId]));
  const inverted = new Map(cohort.map((r) => [r.playerId, -r.playerId]));
  const zero = regret.weekRegret({
    rosters: built.rosters, rankingFor: perfect, actuals, season: 2026, week: 1,
  });
  assert.equal(zero, 0, 'ranking by the actual outcome starts the hindsight lineup');
  const bad = regret.weekRegret({
    rosters: built.rosters, rankingFor: inverted, actuals, season: 2026, week: 1,
  });
  assert.ok(bad > 0, 'an inverted ranking leaves points on the bench');
});

// ---------------------------------------------------------------------------
// Coverage (§5, §7)
// ---------------------------------------------------------------------------

test('armWeekMetrics computes coverage, WIS and exclusions on a hand-checked fixture', () => {
  const rows = [
    // Hit both intervals: actual 10 in [8,12] and [9,11].
    { playerId: 1, median: 10, p10: 8, p25: 9, p75: 11, p90: 12, activeProbability: 1 },
    // Miss the 80 (actual 0 below p10 3), miss the 50.
    { playerId: 2, median: 5, p10: 3, p25: 4, p75: 6, p90: 7, activeProbability: 1 },
    // Bye at capture: excluded entirely.
    { playerId: 3, median: 9, p10: 7, p25: 8, p75: 10, p90: 11, activeProbability: 0 },
    // No intervals at all: excluded and counted.
    { playerId: 4, median: null, p10: null, p25: null, p75: null, p90: null, activeProbability: 1 },
  ];
  const actuals = new Map([['2026:3:1', 10]]); // player 2 absent -> 0
  const out = coverage.armWeekMetrics({ rows, actuals, season: 2026, week: 3 });
  assert.equal(out.cov80, 0.5);
  assert.equal(out.cov50, 0.5);
  assert.equal(out.counts.excludedUnavailable, 1);
  assert.equal(out.counts.excludedNullInterval, 1);
  assert.equal(out.width, 4);
  // WIS by hand. Row 1 (y=10, m=10): (0.5*0 + 0.25*IS_.5(9,11) + 0.1*IS_.2(8,12))/2.5
  //   = (0.25*2 + 0.1*4)/2.5 = 0.9/2.5 = 0.36.
  // Row 2 (y=0, m=5): IS_.5(4,6) = 2 + 4*(4-0) = 18; IS_.2(3,7) = 4 + 10*3 = 34;
  //   (0.5*5 + 0.25*18 + 0.1*34)/2.5 = (2.5 + 4.5 + 3.4)/2.5 = 10.4/2.5 = 4.16.
  assert.ok(Math.abs(out.wis - (0.36 + 4.16) / 2) < 1e-12);
});

test('medianShift aggregates signed and absolute sums by row', () => {
  const out = coverage.medianShift({
    controlRows: [
      { playerId: 1, median: 10 }, { playerId: 2, median: 5 }, { playerId: 3, median: null },
    ],
    candidateRows: [
      { playerId: 1, median: 10.4 }, { playerId: 2, median: 4.8 }, { playerId: 3, median: 7 },
    ],
  });
  assert.equal(out.n, 2, 'a null median on either side drops the pair');
  assert.ok(Math.abs(out.signedSum - 0.2) < 1e-12);
  assert.ok(Math.abs(out.absSum - 0.6) < 1e-12);
});

// ---------------------------------------------------------------------------
// The whole study, end to end on a constructed season
// ---------------------------------------------------------------------------

const SEASON = 2026;
const PRIOR = 2025;
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

/**
 * A synthetic season built so the sealed machinery must reach known verdicts:
 * boom players make mean-ranking beat median-ranking every week; the bw-20
 * cell's intervals cover at exactly 0.80/0.50; the bw-15 cell over-covers at
 * 0.90 and must FAIL its band, pinning fixed-order selection.
 */
function syntheticSeason() {
  const cohort = quotaCohort();
  const actuals = rankingActuals(cohort);
  const weeks = [];
  for (const week of WEEKS) {
    const build = (kind) => {
      const rows = cohort.map(({ playerId, position }) => {
        const base = 5 + ((playerId * 7) % 23);
        const boom = playerId % 4 === 0;
        const median = boom ? base - 3 : base;
        const mean = boom ? base + 1 : base;
        const wiggle = ((playerId * 7 + week * 13) % 7) - 3; // symmetric in [-3, 3]
        const actual = mean + wiggle;
        actuals.set(`${SEASON}:${week}:${playerId}`, actual);
        let p10; let p90; let p25; let p75;
        if (kind === 'scheduled') {
          // Deliberately narrow and centred on the median: boom players
          // always miss, steady ones miss on big wiggles.
          p10 = median - 1; p90 = median + 1; p25 = median - 0.5; p75 = median + 0.5;
        } else {
          const rate = kind === 'candidate:bw-20' ? 5 : 10; // miss 1-in-5 vs 1-in-10
          const hit80 = (playerId + week) % rate !== 0;
          const hit50 = (playerId + week) % 2 === 0;
          p10 = hit80 ? actual - 1 : actual + 1;
          p90 = hit80 ? actual + 1 : actual + 3;
          p25 = hit50 ? actual - 0.5 : actual + 0.5;
          p75 = hit50 ? actual + 0.5 : actual + 1.5;
        }
        return { playerId, position, mean, median, p10, p25, p75, p90, activeProbability: 1 };
      });
      return {
        isLate: false,
        capturedAt: `2026-09-0${(week % 7) + 1}T12:00:00Z`,
        captureNotAfter: '2027-01-01T00:00:00Z',
        constantsHash: `hash-${kind}`,
        modelVersion: 'free_baseline_v3.1',
        cohortHash: sha256(cohort.map((r) => r.playerId).sort((a, b) => a - b).join(',')),
        cohortSize: cohort.length,
        rows,
      };
    };
    weeks.push({
      week,
      arms: {
        scheduled: build('scheduled'),
        'candidate:bw-20': build('candidate:bw-20'),
        'candidate:bw-15': build('candidate:bw-15'),
      },
    });
  }
  return { weeks, actuals };
}

// Test-speed overrides, every one reported by the result itself. The
// permutation floor threshold moves because 12 shuffles bound p at 1/13.
const FAST = {
  draws: 2000, permutations: 12, permutationFloorP: 0.2, minWeeks: 14,
};

test('the constructed season reaches the constructed verdicts end to end', () => {
  const { weeks, actuals } = syntheticSeason();
  const result = evaluator.evaluate({
    season: SEASON, priorSeason: PRIOR, weeks, actuals, config: FAST,
  });

  assert.equal(result.evaluable, true);
  assert.equal(result.weeks.surviving, 18);
  assert.deepEqual([...result.config.overriddenKeys].sort(),
    ['draws', 'permutationFloorP', 'permutations'],
    'every test override is disclosed; minWeeks matches the sealed value and is not');

  // Candidate A: boom players are under-ranked by the median every week.
  assert.equal(result.candidateA.verdict, 'pass');
  assert.ok(result.candidateA.weekly.every((w) => w.delta < 0),
    'mean-ranking must beat median-ranking in every constructed week');
  assert.ok(result.candidateA.permutationFloor.p <= 0.2);

  // Candidate B: bw-20 passes everything; bw-15 over-covers and fails its band.
  const [bw20, bw15] = result.candidateB.cells;
  assert.equal(bw20.cellKind, 'candidate:bw-20');
  assert.equal(bw20.verdict, 'pass');
  const band80 = bw20.bands.find((b) => b.label === 'cov80-point-band');
  assert.ok(Math.abs(band80.value - 0.8) < 1e-9, 'constructed to cover at exactly 0.80');
  assert.equal(bw15.verdict, 'fail');
  assert.equal(bw15.bands.find((b) => b.label === 'cov80-point-band').passes, false);
  assert.equal(result.candidateB.verdict, 'pass');
  assert.deepEqual(result.candidateB.voids, []);
  assert.equal(result.candidateB.selected, 'candidate:bw-20');

  // The weeks-1-17 sensitivity: computed (week 18 survived), non-selecting,
  // built from the primary's own weekly series at n = 17.
  const sens = result.sensitivityWeeks1to17;
  assert.equal(sens.nonSelecting, true);
  assert.equal(sens.candidateA.n, 17);
  assert.equal(sens.cells.length, 2);
  assert.ok(Math.abs(sens.cells[0].cov80Point - 0.8) < 1e-9, 'bw-20 covers 0.80 in the sub-window too');

  assert.deepEqual(result.flips, {
    lineupRanking: 'mean', calibration: 'candidate:bw-20', modelVersionBump: true,
  });

  // Determinism: the whole result object reproduces bit for bit.
  const again = evaluator.evaluate({
    season: SEASON, priorSeason: PRIOR, weeks, actuals, config: FAST,
  });
  assert.deepEqual(again, result);

  // And the report renders every verdict without recomputing anything.
  // (`view`: eslint's testing-library plugin misreads any variable assigned
  // from a `render*` function as a component render and dictates the name.)
  const view = renderReport(result);
  assert.match(view, /NOT THE SEALED STUDY: config overrides in effect/);
  assert.match(view, /Candidate A - lineup decision rule[\s\S]*Verdict: \*\*PASS\*\*/);
  assert.match(view, /Selected cell: \*\*candidate:bw-20\*\*/);
  assert.match(view, /MODEL_VERSION bump \(free_baseline_v3\.2\): YES/);
});

test('integrity defects drop weeks symmetrically, and too few survivors is UNEVALUABLE', () => {
  const { weeks, actuals } = syntheticSeason();
  // Wound five weeks five different ways: 18 - 5 = 13 < minWeeks 14.
  weeks[2].arms['candidate:bw-15'] = undefined;                       // missing arm
  weeks[5].arms.scheduled = { ...weeks[5].arms.scheduled, isLate: true };
  weeks[8].arms['candidate:bw-20'] = {
    ...weeks[8].arms['candidate:bw-20'],
    rows: weeks[8].arms['candidate:bw-20'].rows.slice(1),             // incomplete
  };
  weeks[11].arms.scheduled = { ...weeks[11].arms.scheduled, cohortHash: 'not-the-digest' };
  weeks[13].arms.scheduled = { ...weeks[13].arms.scheduled, capturedAt: 'not a timestamp' }; // NaN fails CLOSED
  const result = evaluator.evaluate({
    season: SEASON, priorSeason: PRIOR, weeks, actuals, config: FAST,
  });
  assert.equal(result.weeks.surviving, 13, 'each defect drops its whole week for every arm');
  assert.equal(result.evaluable, false, '13 survivors against the sealed minimum of 14');
  assert.match(result.reason, /UNEVALUABLE/);
  assert.equal(result.candidateA, null);
  const droppedWeeks = result.weeks.dropped.map((d) => d.week).sort((a, b) => a - b);
  assert.deepEqual(droppedWeeks, [3, 6, 9, 12, 14]);
  assert.ok(result.weeks.dropped.some((d) => /unparseable capture timestamps/.test(d.reason)),
    'a corrupted timestamp fails closed with its own named reason');
  assert.match(renderReport(result), /## UNEVALUABLE/);
});

test('a mid-season constants change drops the drifted weeks as its own named reason', () => {
  const { weeks, actuals } = syntheticSeason();
  weeks[14].arms.scheduled = { ...weeks[14].arms.scheduled, constantsHash: 'hash-DRIFTED' };
  const result = evaluator.evaluate({
    season: SEASON, priorSeason: PRIOR, weeks, actuals, config: FAST,
  });
  assert.equal(result.weeks.surviving, 17);
  assert.match(result.weeks.dropped[0].reason, /constants drift/);
});

test('a candidate mean mismatch voids CANDIDATE B WHOLE - the sibling cell is never promoted', () => {
  // Adversarial review BLOCKER: the earlier cell-scoped void let a passing
  // sibling ship. Prereg section 9 names the void scope as Candidate B, and
  // the reasoning is physical: a mean divergence means that arm's capture
  // lost snapshot isolation, and the sibling came from the SAME transaction.
  const { weeks, actuals } = syntheticSeason();
  const rows = weeks[3].arms['candidate:bw-20'].rows;
  weeks[3].arms['candidate:bw-20'] = {
    ...weeks[3].arms['candidate:bw-20'],
    rows: rows.map((r, i) => (i === 0 ? { ...r, mean: Number(r.mean) + 0.01 } : r)),
  };
  const result = evaluator.evaluate({
    season: SEASON, priorSeason: PRIOR, weeks, actuals, config: FAST,
  });
  assert.equal(result.candidateB.verdict, 'void');
  assert.match(result.candidateB.voids[0], /candidate:bw-20: mean bit-equality violated on 1 of/);
  assert.equal(result.candidateB.selected, null, 'a section-9 void selects NOTHING, whatever the sibling did');
  assert.equal(result.flips.calibration, null, 'and nothing flips');
  const [bw20, bw15] = result.candidateB.cells;
  assert.equal(bw20.verdict, 'void');
  assert.ok(['pass', 'fail'].includes(bw15.verdict), 'the sibling still REPORTS its own diagnostics');
  assert.equal(result.candidateA.verdict, 'pass', 'Candidate A is untouched by a Candidate B void');
  assert.match(renderReport(result), /VOID \(candidate-wide, per prereg section 9/);
});

test('a roster anomaly voids Candidate A alone - Candidate B keeps its verdict', () => {
  // Adversarial review SUBSTANTIVE: the quota-shortfall throw previously
  // escaped evaluate() whole, discarding Candidate B. Section 1 promises the
  // claims flip independently.
  const { weeks, actuals } = syntheticSeason();
  // Starve the ranking: remove every QB's prior-season game so week 1 has
  // zero rankable QBs against a quota of 20.
  for (let id = 1; id <= 160; id++) {
    const row = weeks[0].arms.scheduled.rows.find((r) => r.playerId === id);
    if (row && row.position === 'QB') actuals.delete(`${PRIOR}:18:${id}`);
  }
  const result = evaluator.evaluate({
    season: SEASON, priorSeason: PRIOR, weeks, actuals, config: FAST,
  });
  assert.equal(result.candidateA.verdict, 'void');
  assert.match(result.candidateA.voids[0], /position QB has 0 rankable players against a quota of 20/);
  assert.match(result.candidateA.voids[0], /DEVIATIONS\.md/);
  assert.equal(result.candidateB.verdict, 'pass', 'Candidate B evaluates on its own merits');
  assert.equal(result.candidateB.selected, 'candidate:bw-20');
  assert.deepEqual(result.flips, {
    lineupRanking: null, calibration: 'candidate:bw-20', modelVersionBump: true,
  });
});

test('a systematic median shift voids the cell through the sealed bound', () => {
  const { weeks, actuals } = syntheticSeason();
  for (const entry of weeks) {
    entry.arms['candidate:bw-20'] = {
      ...entry.arms['candidate:bw-20'],
      rows: entry.arms['candidate:bw-20'].rows.map((r) => ({ ...r, median: Number(r.median) + 0.1 })),
    };
  }
  const result = evaluator.evaluate({
    season: SEASON, priorSeason: PRIOR, weeks, actuals, config: FAST,
  });
  const bw20 = result.candidateB.cells[0];
  assert.equal(bw20.verdict, 'void');
  assert.ok(bw20.voids.some((v) => /signed mean median shift 0\.1000/.test(v)));
  assert.equal(result.candidateB.verdict, 'void', 'the void is candidate-wide');
  assert.equal(result.candidateB.selected, null);
});

test('a single band nulled on the CONTROL arm voids Candidate B - the section-10 defect signature cannot reach a verdict (section 9.5)', () => {
  const { weeks, actuals } = syntheticSeason();
  // Null ONLY the 80% band on the control arm of one week: cov80 and WIS go
  // null for that arm-week while cov50 still scores the full row set, so the
  // t80 and wis series lose a week the t50 series keeps - the asymmetry that
  // previously moved a component's n and could switch the test scoring it.
  weeks[4].arms.scheduled = {
    ...weeks[4].arms.scheduled,
    rows: weeks[4].arms.scheduled.rows.map((r) => ({ ...r, p10: null, p90: null })),
  };
  const result = evaluator.evaluate({
    season: SEASON, priorSeason: PRIOR, weeks, actuals, config: FAST,
  });
  assert.equal(result.weeks.surviving, 18, 'section 9.4 never reads row content, so the week survives');
  assert.equal(result.candidateB.verdict, 'void');
  const itemFiveVoids = result.candidateB.voids.filter((v) => /section 9 item 5/.test(v));
  assert.ok(itemFiveVoids.length > 0, 'the item-5 void is present whatever else co-occurs');
  assert.match(itemFiveVoids[0], /t80: week 5/);
  assert.match(itemFiveVoids[0], /wis: week 5/);
  assert.equal(result.candidateB.selected, null, 'nothing ships off a shortened series');
  assert.equal(result.flips.calibration, null);
  const [bw20] = result.candidateB.cells;
  assert.equal(bw20.verdict, 'void');
  assert.deepEqual(bw20.seriesDrops, { t80: 1, t50: 0, wis: 1 },
    'the published drop counts carry the asymmetry');
  assert.equal(result.candidateA.verdict, 'pass',
    'Candidate A ranks on median/mean, not intervals, and is untouched');
  assert.match(renderReport(result), /Component series drops/);
});

test('symmetric all-band nulls void too - week survival cannot be steered by row content at all (section 9.5)', () => {
  const { weeks, actuals } = syntheticSeason();
  // Null BOTH bands on the control arm of one week: every component drops
  // the week together, so there is no cross-component asymmetry - and it
  // still voids, because the rule measures against the SURVIVOR set, not
  // against the sibling components. (Eleven such weeks would otherwise walk
  // every component below the 12-cluster threshold into the exact sign test
  // on a chosen week subset.)
  weeks[9].arms.scheduled = {
    ...weeks[9].arms.scheduled,
    rows: weeks[9].arms.scheduled.rows.map((r) => ({
      ...r, p10: null, p25: null, p75: null, p90: null,
    })),
  };
  const result = evaluator.evaluate({
    season: SEASON, priorSeason: PRIOR, weeks, actuals, config: FAST,
  });
  assert.equal(result.weeks.surviving, 18);
  assert.equal(result.candidateB.verdict, 'void');
  assert.ok(result.candidateB.voids.some((v) => /section 9 item 5/.test(v) && /week 10/.test(v)));
  assert.equal(result.candidateB.selected, null);
  assert.deepEqual(result.candidateB.cells[0].seriesDrops, { t80: 1, t50: 1, wis: 1 });
});

test('a whole-season band outage voids and still publishes - the evaluator never throws the run away (section 9.5)', () => {
  const { weeks, actuals } = syntheticSeason();
  // The section-9.5 defect class at its limit: the control arm's 80% band
  // nulled in EVERY week. t80 and wis are then EMPTY series - nothing to
  // resample, nothing to sign-test - and the report must still be written,
  // with the void recorded and Candidate A's independent verdict intact.
  for (const entry of weeks) {
    entry.arms.scheduled = {
      ...entry.arms.scheduled,
      rows: entry.arms.scheduled.rows.map((r) => ({ ...r, p10: null, p90: null })),
    };
  }
  const result = evaluator.evaluate({
    season: SEASON, priorSeason: PRIOR, weeks, actuals, config: FAST,
  });
  assert.equal(result.weeks.surviving, 18);
  assert.equal(result.candidateB.verdict, 'void');
  assert.equal(result.candidateB.selected, null);
  const [bw20] = result.candidateB.cells;
  assert.deepEqual(bw20.seriesDrops, { t80: 18, t50: 0, wis: 18 });
  assert.equal(bw20.components.find((c) => c.label === 'cov80-distance-improvement').method,
    'empty-series', 'an empty series is an explicit diagnostic, not a crash');
  assert.equal(bw20.components.find((c) => c.label === 'cov80-distance-improvement').passes, false);
  assert.equal(result.candidateA.verdict, 'pass',
    'Candidate A flips independently even of a season-wide Candidate B catastrophe');
  const view = renderReport(result);
  assert.match(view, /empty series/);
  assert.match(view, /no surviving week carries this metric/);
});

test('the sealed config is the preregistration, verbatim', () => {
  assert.equal(evaluator.SEALED.draws, 100000);
  assert.equal(evaluator.SEALED.bootstrapSeed, 2579717975);
  assert.equal(evaluator.SEALED.permutationSeed, 3479054401);
  assert.equal(evaluator.SEALED.rosterSeed, 375445932);
  assert.equal(evaluator.SEALED.permutations, 10000);
  assert.equal(evaluator.SEALED.permutationFloorP, 0.001);
  assert.equal(evaluator.SEALED.alphaA, 0.05);
  assert.equal(evaluator.SEALED.alphaATest, 0.025, 'the test alpha carries the measured-anticonservatism divisor');
  assert.equal(evaluator.SEALED.cellAlpha, 0.025);
  assert.equal(evaluator.SEALED.componentAlpha, 0.025 / 3, 'components at cellAlpha/3, the restored conservatism divisor');
  assert.equal(evaluator.SEALED.wisMargin, 0.05);
  assert.deepEqual([...evaluator.SEALED.cov80Band], [0.75, 0.85]);
  assert.deepEqual([...evaluator.SEALED.cov50Band], [0.45, 0.55]);
  assert.equal(evaluator.SEALED.medianShiftBound, 0.05);
  assert.equal(evaluator.SEALED.minWeeks, 14);
  assert.equal(evaluator.SEALED.exactTriggerClusters, 12);
  assert.deepEqual([...evaluator.CELL_KINDS], ['candidate:bw-20', 'candidate:bw-15']);
  assert.ok(Object.isFrozen(evaluator.SEALED));
});

// ---------------------------------------------------------------------------
// Runner argument and input validation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The pooled-residual sensitivity arm (§8.1, non-selecting)
// ---------------------------------------------------------------------------

test('pooled offsets are the per-position median of (median - mean), from candidate rows', () => {
  const offsets = regret.pooledOffsetsByPosition([
    { playerId: 1, position: 'WR', mean: 10, median: 10.5 },
    { playerId: 2, position: 'WR', mean: 8, median: 8.9 },
    { playerId: 3, position: 'WR', mean: 6, median: 6.1 },
    { playerId: 4, position: 'QB', mean: 20, median: 19.2 },
    { playerId: 5, position: 'TE', mean: 5, median: null },   // unusable, ignored
    { playerId: 6, mean: 5, median: 6 },                       // no position, ignored
  ]);
  assert.equal(offsets.get('WR'), 0.5, 'median of [0.1, 0.5, 0.9]');
  assert.ok(Math.abs(offsets.get('QB') - -0.8) < 1e-9);
  assert.equal(offsets.has('TE'), false, 'a position with no usable row gets no offset');
  assert.equal(offsets.size, 2);
  // Even count averages the two central values.
  const even = regret.pooledOffsetsByPosition([
    { playerId: 1, position: 'RB', mean: 1, median: 2 },
    { playerId: 2, position: 'RB', mean: 1, median: 3 },
  ]);
  assert.equal(even.get('RB'), 1.5);
});

test('the pooled arm ranks on mean + position offset, and keeps the control fallbacks', () => {
  const offsets = new Map([['WR', 0.5]]);
  const map = regret.pooledRankingMap([
    { playerId: 1, position: 'WR', mean: 10, median: 12, activeProbability: 1 },
    { playerId: 2, position: 'WR', mean: 8, median: 6, activeProbability: 0 },
    { playerId: 3, position: 'TE', mean: 5, median: 7, activeProbability: 1 },
    { playerId: 4, position: 'WR', mean: null, median: 9, activeProbability: 1 },
  ], offsets);
  assert.equal(map.get(1), 10.5, 'mean + the position offset, NOT the control median 12');
  assert.equal(map.get(2), 0, 'an unavailable player ranks 0, exactly as every other arm');
  assert.equal(map.get(3), 7, 'no offset for the position falls back to the control ranking, not to 0');
  assert.equal(map.get(4), 9, 'no usable mean falls back to the control ranking, not to 0');
});

test('the pooled arm discriminates per-player noise from a systematic skew', () => {
  // Both fixtures share the SAME means, so any ranking difference comes purely
  // from the offset. This is the property the arm exists for.
  const means = [12, 11, 10, 9, 8];
  const ids = [1, 2, 3, 4, 5];

  // Case 1: the control's median offset is pure per-player NOISE that reorders
  // the field. The pooled arm applies one constant, so it preserves the mean
  // ordering exactly as Candidate A does.
  const noisy = ids.map((playerId, i) => ({
    playerId, position: 'WR', mean: means[i], median: means[i] + (i % 2 ? 3 : -3), activeProbability: 1,
  }));
  const candidateRowsNoisy = ids.map((playerId, i) => ({ playerId, position: 'WR', mean: means[i], median: means[i] }));
  const pooledNoisy = regret.pooledRankingMap(noisy, regret.pooledOffsetsByPosition(candidateRowsNoisy));
  const orderOf = (map) => [...map].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  assert.deepEqual(orderOf(pooledNoisy), ids, 'a constant offset cannot reorder the mean ranking');
  assert.notDeepEqual(orderOf(new Map(noisy.map((r) => [r.playerId, regret.rankingValue(r, 'median')]))), ids,
    'while the control ordering IS reordered by the noise');

  // Case 2: a genuine systematic skew, identical for every player. The pooled
  // arm reproduces the control ordering, because the offset is the real signal.
  const skewed = ids.map((playerId, i) => ({
    playerId, position: 'WR', mean: means[i], median: means[i] + 1.5, activeProbability: 1,
  }));
  const candidateRowsSkew = ids.map((playerId, i) => ({ playerId, position: 'WR', mean: means[i], median: means[i] + 1.5 }));
  const pooledSkew = regret.pooledRankingMap(skewed, regret.pooledOffsetsByPosition(candidateRowsSkew));
  assert.deepEqual(orderOf(pooledSkew), orderOf(new Map(skewed.map((r) => [r.playerId, regret.rankingValue(r, 'median')]))));
  for (const id of ids) assert.ok(Math.abs(pooledSkew.get(id) - (means[ids.indexOf(id)] + 1.5)) < 1e-9);
});

test('the runner refuses missing or unknown arguments', () => {
  assert.throws(() => runner.parseArgs(['--season', '2026']), /--prior-season is required/);
  assert.throws(() => runner.parseArgs(['--bogus', 'x']), /unknown argument --bogus/);
  const parsed = runner.parseArgs([
    '--season', '2026', '--prior-season', '2025', '--profile', 'half_ppr',
    '--actuals', '/tmp/a.json', '--out', '/tmp/out',
  ]);
  assert.deepEqual(parsed, {
    season: 2026, priorSeason: 2025, profile: 'half_ppr',
    actualsPath: '/tmp/a.json', outDir: '/tmp/out',
  });
});

test('the runner confines --out to the repository and refuses UNC form', () => {
  const path = require('path');
  const repoRoot = path.resolve(__dirname, '..', '..');

  // The legitimate case: the study directory the January runbook actually uses.
  const ok = runner.resolveOutputPaths('backtest-artifacts/holdout-confirm-2026');
  assert.equal(ok.reportJson, path.join(repoRoot, 'backtest-artifacts', 'holdout-confirm-2026', 'report.json'));
  assert.equal(ok.reportMd, path.join(repoRoot, 'backtest-artifacts', 'holdout-confirm-2026', 'REPORT.md'));

  // A traversal segment that still lands inside the repo is allowed: the rule
  // is containment, not syntax. `path.resolve` has already collapsed it, so
  // nothing traversal-shaped survives into the join.
  assert.equal(
    runner.resolveOutputPaths('backtest-artifacts/../scripts/holdout').dir,
    path.join(repoRoot, 'scripts', 'holdout')
  );

  // Escaping the repository is the case the Semgrep finding was about.
  assert.throws(
    () => runner.resolveOutputPaths(path.join('..', '..', '..', '..', 'Windows', 'Temp')),
    /--out .* is not a directory inside this repository/s
  );
  assert.throws(
    () => runner.resolveOutputPaths(process.platform === 'win32' ? 'C:\\Windows\\Temp' : '/etc'),
    /--out .* is not a directory inside this repository/s
  );

  // THE DISCRIMINATING CASE. A SIBLING directory whose name merely EXTENDS the
  // repository's own is the one input that separates `rootSafety.isContainedIn`
  // from a naive `child.startsWith(parent)` prefix test - startsWith accepts it,
  // containment refuses it. Without this assertion every other refusal above is
  // satisfied by the broken prefix check too, so the test would pass against the
  // exact defect the guard exists to prevent. rootSafety's own docblock calls the
  // prefix bug "the exact class of bug a third-party review reproduced".
  assert.throws(
    () => runner.resolveOutputPaths(path.join('..', `${path.basename(repoRoot)}-evil`)),
    /--out .* is not a directory inside this repository/s
  );

  // The repository root itself is not a study directory.
  assert.throws(() => runner.resolveOutputPaths('.'), /is not a directory inside this repository/s);

  // An empty --out (an unset shell variable) must fail loudly, not resolve to
  // the repository root and quietly drop the report at the top of the tree.
  assert.throws(() => runner.resolveOutputPaths(''), /--out must be a non-empty path/);
  assert.throws(() => runner.resolveOutputPaths('   '), /--out must be a non-empty path/);
  assert.throws(() => runner.resolveOutputPaths(undefined), /--out must be a non-empty path/);

  // UNC form is refused BEFORE canonicalization, so it never reaches realpath.
  assert.throws(
    () => runner.resolveOutputPaths('\\\\evil-host\\share\\out'),
    /UNC-form path/
  );
  assert.throws(
    () => runner.resolveOutputPaths('//evil-host/share/out'),
    /UNC-form path/
  );
});

test('the runner validates the actuals file shape', (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdout-actuals-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const good = path.join(dir, 'good.json');
  fs.writeFileSync(good, JSON.stringify({ '2026:1:7': 9.5, '2025:18:7': 12 }), 'utf8');
  const actuals = runner.loadActuals(good);
  assert.equal(actuals.get('2026:1:7'), 9.5);

  const badKey = path.join(dir, 'bad-key.json');
  fs.writeFileSync(badKey, JSON.stringify({ 'nonsense': 1 }), 'utf8');
  assert.throws(() => runner.loadActuals(badKey), /malformed actuals key/);

  const badValue = path.join(dir, 'bad-value.json');
  fs.writeFileSync(badValue, JSON.stringify({ '2026:1:7': 'twelve' }), 'utf8');
  assert.throws(() => runner.loadActuals(badValue), /non-numeric actual/);

  // Adversarial review finding: JSON null coerced to a scored 0 through
  // Number(null). It must throw, and so must a NUMERIC STRING - the file is
  // machine-produced, so a non-number value IS the pipeline breaking.
  const nullValue = path.join(dir, 'null-value.json');
  fs.writeFileSync(nullValue, JSON.stringify({ '2026:1:7': null, '2026:1:8': 8 }), 'utf8');
  assert.throws(() => runner.loadActuals(nullValue), /non-numeric actual for "2026:1:7" \(got null\)/);

  const stringNumber = path.join(dir, 'string-number.json');
  fs.writeFileSync(stringNumber, JSON.stringify({ '2026:1:7': '12' }), 'utf8');
  assert.throws(() => runner.loadActuals(stringNumber), /non-numeric actual/);

  const empty = path.join(dir, 'empty.json');
  fs.writeFileSync(empty, JSON.stringify({}), 'utf8');
  assert.throws(() => runner.loadActuals(empty), /actuals file is empty/);
});
