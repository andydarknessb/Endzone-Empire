const test = require('node:test');
const assert = require('node:assert/strict');
const reading = require('../services/intervalReading');

const { CONSTANTS } = reading;

// A row shaped like one cached `player_week_projections` row (camelCased by
// projectionFromCachedRow) plus the run's Point estimate. Width is set through
// `p10`/`p90` so each test controls Floor and Ceiling directly.
function row(playerId, { position = 'WR', point = 12, floor = 6, ceiling = 20, ...over } = {}) {
  return {
    playerId,
    position,
    pointEstimate: point,
    mean: point,
    median: point,
    p10: floor,
    p25: floor + (point - floor) / 2,
    p75: point + (ceiling - point) / 2,
    p90: ceiling,
    sampleSize: 12,
    factors: {
      availability: { available: true },
      dataQuality: { residualSource: 'player', reasons: [] },
    },
    ...over,
  };
}

// n eligible WRs on the exact line width = 2 * point, except that player i
// sits `offsets[i]` above it. Point estimates climb so the fit is well posed.
function lineRun(offsets, position = 'WR') {
  return offsets.map((offset, i) => {
    const point = 8 + i;
    const width = 2 * point + offset;
    return row(i + 1, { position, point, floor: point - width / 2, ceiling: point + width / 2 });
  });
}

const tagsOf = (rows) => {
  const tags = reading.volatilityTags(rows);
  return rows.map((r) => tags.get(r.playerId));
};

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

test('a clean QB/RB/WR/TE row is eligible', () => {
  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    assert.equal(reading.isEligible(row(1, { position })), true, position);
  }
});

test('ineligible rows: other positions, unavailable, position residuals, thin sample, baseline', () => {
  assert.equal(reading.isEligible(row(1, { position: 'K' })), false);
  assert.equal(reading.isEligible(row(1, { position: 'DEF' })), false);
  assert.equal(
    reading.isEligible(row(1, { factors: { availability: { available: false }, dataQuality: { residualSource: 'player', reasons: [] } } })),
    false
  );
  assert.equal(
    reading.isEligible(row(1, { factors: { availability: { available: true }, dataQuality: { residualSource: 'position', reasons: [] } } })),
    false
  );
  assert.equal(reading.isEligible(row(1, { sampleSize: 7 })), false);
  assert.equal(
    reading.isEligible(row(1, { factors: { availability: { available: true }, dataQuality: { residualSource: 'player', reasons: ['position baseline'] } } })),
    false
  );
});

test('the 8-game minimum is inclusive', () => {
  assert.equal(CONSTANTS.minSampleSize, 8);
  assert.equal(reading.isEligible(row(1, { sampleSize: 8 })), true);
});

test('missing factors or a missing quantile is ineligible, never a throw', () => {
  assert.equal(reading.isEligible(row(1, { factors: null })), false);
  assert.equal(reading.isEligible(row(1, { factors: {} })), false);
  assert.equal(reading.isEligible(row(1, { p25: null })), false);
  assert.equal(reading.isEligible(row(1, { pointEstimate: null })), false);
  assert.equal(reading.isEligible(null), false);
});

test('a zero-width Interval is ineligible', () => {
  const flat = row(1, { floor: 5.2, point: 5.2, ceiling: 5.2 }); // Floor = Point = Ceiling
  const inverted = row(1, { floor: 10, point: 8, ceiling: 6 }); // p90 below p10
  for (const degenerate of [flat, inverted]) {
    assert.equal(reading.isEligible(degenerate), false);
    assert.equal(reading.thresholdProbabilities(degenerate), null);
    assert.equal(reading.thresholdProbability(degenerate, 10), null);
    // Inside an otherwise full reference set he reads null and moves no tag.
    const ten = lineRun([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]);
    const without = reading.volatilityTags(ten);
    const withHim = reading.volatilityTags([...ten, { ...degenerate, playerId: 99, pointEstimate: 12 }]);
    assert.equal(withHim.get(99), null);
    for (const r of ten) assert.equal(withHim.get(r.playerId), without.get(r.playerId));
  }
});

test('an ineligible row reads null on every reading', () => {
  const ineligible = row(1, { sampleSize: 3 });
  assert.equal(reading.volatilityTags([ineligible]).get(1), null);
  assert.equal(reading.thresholdProbabilities(ineligible), null);
  assert.equal(reading.thresholdProbability(ineligible, 10), null);
});

// ---------------------------------------------------------------------------
// Volatility tag
// ---------------------------------------------------------------------------

test('fitWidthLine recovers an exact line', () => {
  const fit = reading.fitWidthLine([{ x: 8, y: 16 }, { x: 10, y: 20 }, { x: 14, y: 28 }]);
  assert.ok(Math.abs(fit.slope - 2) < 1e-9);
  assert.ok(Math.abs(fit.intercept) < 1e-9);
});

test('fitWidthLine with no spread in Point estimate falls back to the mean width', () => {
  const fit = reading.fitWidthLine([{ x: 10, y: 4 }, { x: 10, y: 6 }]);
  assert.equal(fit.slope, 0);
  assert.equal(fit.intercept, 5);
});

test('tags the widest fifth boom_or_bust and the narrowest fifth steady', () => {
  // 10 eligible players: one fifth is 2 players each way.
  const offsets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  offsets[2] = -4; // narrowest
  offsets[6] = -3;
  offsets[4] = 3;
  offsets[8] = 5; // widest
  const tags = tagsOf(lineRun(offsets));
  assert.deepEqual(
    tags.map((t, i) => [i, t]).filter(([, t]) => t),
    [[2, 'steady'], [4, 'boom_or_bust'], [6, 'steady'], [8, 'boom_or_bust']]
  );
});

test('a fifth of 15 eligible players is 3 each way', () => {
  const offsets = Array.from({ length: 15 }, (_, i) => ((i * 7) % 15 - 7) * 0.5); // a permutation of -7..7: not linear in i, so the fit cannot absorb it
  const tags = tagsOf(lineRun(offsets));
  assert.equal(tags.filter((t) => t === 'boom_or_bust').length, 3);
  assert.equal(tags.filter((t) => t === 'steady').length, 3);
  assert.equal(tags.filter((t) => t === null).length, 9);
});

test('fewer than ten eligible players at a position yields no tags', () => {
  const tags = tagsOf(lineRun([-3, -2, -1, 0, 1, 2, 3, 4, 5]));
  assert.deepEqual(tags, Array(9).fill(null));
  assert.equal(CONSTANTS.minReferenceSetSize, 10);
});

test('exactly ten eligible players is enough', () => {
  const tags = tagsOf(lineRun([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]));
  assert.equal(tags.filter(Boolean).length, 4);
});

test('players below the minimum Point estimate stay out of the reference set and read null', () => {
  const rows = lineRun([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]);
  const low = row(99, { point: CONSTANTS.minPointEstimate.WR - 0.5, floor: 0, ceiling: 40 });
  const tags = reading.volatilityTags([...rows, low]);
  assert.equal(tags.get(99), null);
  // The far-out low player did not move the fit: the tagged set is unchanged.
  assert.equal([...tags.values()].filter(Boolean).length, 4);
});

test('minPointEstimate is per position and frozen', () => {
  assert.deepEqual(CONSTANTS.minPointEstimate, { QB: 10, RB: 5, WR: 5, TE: 5 });
  assert.ok(Object.isFrozen(CONSTANTS.minPointEstimate));
});

test('the minimum Point estimate is per position', () => {
  // Ten QBs at 10 or more points on the line width = 2 * point.
  const ten = Array.from({ length: 10 }, (_, i) => {
    const point = 10 + i;
    const width = 2 * point + [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5][i];
    return row(i + 1, { position: 'QB', point, floor: point - width / 2, ceiling: point + width / 2 });
  });
  const backup = { position: 'QB', point: 9.9, floor: 0, ceiling: 60 }; // 0.1 under the QB minimum, extreme width
  const without = reading.volatilityTags(ten);
  const withBackup = reading.volatilityTags([...ten, row(99, backup)]);
  assert.equal(withBackup.get(99), null);
  assert.equal(reading.referenceSet([...ten, row(99, backup)]).length, 10);
  for (const r of ten) assert.equal(withBackup.get(r.playerId), without.get(r.playerId));
  assert.ok([...without.values()].some(Boolean), 'the ten do tag');
  // The same 9.9 row as a WR clears the WR minimum of 5.
  const wr = row(99, { ...backup, position: 'WR' });
  assert.ok(reading.referenceSet([wr]).includes(wr));
  assert.ok(!reading.referenceSet([row(98, { ...backup, point: 4.9, position: 'WR' })]).length);
  // Each position's minimum is inclusive.
  assert.equal(reading.referenceSet([row(1, { position: 'QB', point: 10 })]).length, 1);
  assert.equal(reading.referenceSet([row(1, { position: 'TE', point: 5 })]).length, 1);
});

test('the minimum Point estimate is inclusive', () => {
  const rows = lineRun([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]).map((r, i) =>
    i === 0 ? row(1, { point: CONSTANTS.minPointEstimate.WR, floor: 0, ceiling: 40 }) : r
  );
  // Nine others plus the boundary player make ten; dropping the boundary
  // player would leave nine and no tags at all.
  const tags = reading.volatilityTags(rows);
  assert.ok([...tags.values()].some(Boolean));
});

test('ineligible players do not count toward the ten or the fit', () => {
  const rows = [
    ...lineRun([-3, -2, -1, 0, 1, 2, 3, 4, 5]), // nine eligible
    row(50, { sampleSize: 2 }), // tenth is ineligible
  ];
  const tags = reading.volatilityTags(rows);
  assert.deepEqual([...tags.values()].filter(Boolean), []);
});

test('each position is its own reference set', () => {
  const wrs = lineRun([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5], 'WR');
  const tes = lineRun([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].slice(0, 6), 'TE').map((r) => ({ ...r, playerId: r.playerId + 100 }));
  const tags = reading.volatilityTags([...wrs, ...tes]);
  assert.equal([...tags.entries()].filter(([id, t]) => id <= 10 && t).length, 4);
  assert.equal([...tags.entries()].filter(([id, t]) => id > 100 && t).length, 0, 'six TEs are too few');
});

test('exact ties: everyone on the line is untagged, not tagged by arbitrary order', () => {
  assert.deepEqual(tagsOf(lineRun(Array(10).fill(0))), Array(10).fill(null));
});

// Exact ties need identical (point, width) pairs: a tie in distance from a
// fitted line is only exact when the two players are the same point.
function pairRun(pairs) {
  return pairs.map(([point, width], i) => row(i + 1, { point, floor: point - width / 2, ceiling: point + width / 2 }));
}
const ON_LINE = [[8, 16], [10, 20], [11, 22], [13, 26], [14, 28], [15, 30]];
const STEADY = [9, 2]; // (point, width): far below any line through the others
const WIDE = [12, 40]; // far above it

test('exact ties straddling the cut tag none of the tied group', () => {
  // A fifth of ten is 2. Three players share the widest distance, so the group
  // straddles the cut and none is tagged; the two narrowest are clear.
  const rows = pairRun([STEADY, [10, 2], ...ON_LINE.slice(0, 5), WIDE, WIDE, WIDE]);
  const tags = tagsOf(rows);
  assert.deepEqual(tags.slice(7), [null, null, null]);
  assert.deepEqual(tags.slice(0, 2), ['steady', 'steady']);
});

test('exact ties wholly inside the fifth are all tagged', () => {
  const rows = pairRun([STEADY, STEADY, ...ON_LINE, WIDE, WIDE]);
  const tags = tagsOf(rows);
  assert.deepEqual([tags[0], tags[1], tags[8], tags[9]], ['steady', 'steady', 'boom_or_bust', 'boom_or_bust']);
  assert.deepEqual(tags.slice(2, 8), Array(6).fill(null));
});

test('distance is from the fitted line, not raw width', () => {
  // Width grows with Point estimate, so the two highest-point players are the
  // widest in raw terms; on the line they are exactly as wide as expected and
  // must not be tagged boom_or_bust.
  const offsets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  offsets[0] = 8; // the lowest-point players are the widest for their points
  offsets[5] = 7;
  offsets[1] = -8;
  offsets[6] = -7;
  const tags = tagsOf(lineRun(offsets));
  assert.equal(tags[0], 'boom_or_bust');
  assert.equal(tags[1], 'steady');
  assert.equal(tags[9], null);
});

test('the same inputs tag the same way regardless of row order', () => {
  const rows = lineRun([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]);
  const forward = reading.volatilityTags(rows);
  const backward = reading.volatilityTags([...rows].reverse());
  for (const r of rows) assert.equal(forward.get(r.playerId), backward.get(r.playerId));
});

// ---------------------------------------------------------------------------
// Threshold probability
// ---------------------------------------------------------------------------

const DIST = { p10: 4, p25: 8, median: 12, p75: 16, p90: 24 };
const dist = (over = {}) => row(1, { ...DIST, point: 12, ...over });

test('interpolates linearly through the five stored quantiles', () => {
  // x at each knot reads the knot's exceedance.
  assert.ok(Math.abs(reading.thresholdProbability(dist(), 8) - 0.75) < 1e-12);
  assert.ok(Math.abs(reading.thresholdProbability(dist(), 12) - 0.5) < 1e-12);
  assert.ok(Math.abs(reading.thresholdProbability(dist(), 16) - 0.25) < 1e-12);
  // Midpoints: between p10 (4) and p25 (8) at 6 -> cdf 0.175.
  assert.ok(Math.abs(reading.thresholdProbability(dist(), 6) - (1 - 0.175)) < 1e-12);
  // Between p75 (16) and p90 (24) at 20 -> cdf 0.825.
  assert.ok(Math.abs(reading.thresholdProbability(dist(), 20) - (1 - 0.825)) < 1e-12);
});

test('a threshold at or below the Floor reads 0.90; at or above the Ceiling reads 0.10', () => {
  assert.equal(reading.thresholdProbability(dist(), 4), 0.9);
  assert.equal(reading.thresholdProbability(dist(), 0), 0.9);
  assert.equal(reading.thresholdProbability(dist(), -50), 0.9);
  assert.equal(reading.thresholdProbability(dist(), 24), 0.1);
  assert.equal(reading.thresholdProbability(dist(), 40), 0.1);
});

test('a flat stretch between quantiles does not divide by zero', () => {
  const flat = dist({ p10: 5, p25: 5, median: 9, p75: 9, p90: 15 });
  for (const x of [5, 6, 9, 10, 15]) {
    const p = reading.thresholdProbability(flat, x);
    assert.ok(Number.isFinite(p), `x=${x}`);
    assert.ok(p >= 0.1 && p <= 0.9, `x=${x}`);
  }
  // On the plateau itself the reading is the exceedance at its start.
  assert.ok(Math.abs(reading.thresholdProbability(flat, 9) - 0.5) < 1e-12);
});

test('the probability never rises as the threshold rises', () => {
  let last = 1;
  for (let x = 0; x <= 30; x += 0.5) {
    const p = reading.thresholdProbability(dist(), x);
    assert.ok(p <= last + 1e-12, `x=${x}`);
    last = p;
  }
});

test('thresholds are 10 and 20 for RB, WR and TE and 15 and 25 for QB', () => {
  assert.deepEqual(CONSTANTS.thresholds, { QB: [15, 25], RB: [10, 20], WR: [10, 20], TE: [10, 20] });
  for (const position of ['RB', 'WR', 'TE']) {
    const out = reading.thresholdProbabilities(dist({ position }));
    assert.deepEqual(out.map((t) => t.threshold), [10, 20], position);
  }
  assert.deepEqual(reading.thresholdProbabilities(dist({ position: 'QB' })).map((t) => t.threshold), [15, 25]);
});

test('thresholdProbabilities carries the interpolated probability per threshold', () => {
  const out = reading.thresholdProbabilities(dist({ position: 'RB' }));
  assert.ok(Math.abs(out[0].probability - reading.thresholdProbability(dist(), 10)) < 1e-12);
  assert.ok(Math.abs(out[1].probability - reading.thresholdProbability(dist(), 20)) < 1e-12);
});

// ---------------------------------------------------------------------------
// Verdict band
// ---------------------------------------------------------------------------

test('verdict band: tossup at or below 0.6, start above it, strong at or above 0.8', () => {
  assert.equal(reading.verdictBand(0.5), 'tossup');
  assert.equal(reading.verdictBand(0.6), 'tossup');
  assert.equal(reading.verdictBand(0.6000001), 'start');
  assert.equal(reading.verdictBand(0.79), 'start');
  assert.equal(reading.verdictBand(0.8), 'strong');
  assert.equal(reading.verdictBand(0.97), 'strong');
});

test('a null (or non-finite) probability yields start', () => {
  assert.equal(reading.verdictBand(null), 'start');
  assert.equal(reading.verdictBand(undefined), 'start');
  assert.equal(reading.verdictBand(NaN), 'start');
});

test('every constant lives in CONSTANTS', () => {
  assert.equal(CONSTANTS.tossupMax, 0.6);
  assert.equal(CONSTANTS.strongMin, 0.8);
  assert.equal(CONSTANTS.taggedFractionDenominator, 5);
  for (const position of CONSTANTS.positions) assert.ok(Number.isFinite(CONSTANTS.minPointEstimate[position]), position);
  assert.ok(Object.isFrozen(CONSTANTS.minPointEstimate));
  assert.ok(Object.isFrozen(CONSTANTS));
});

// ---------------------------------------------------------------------------
// The print script's pure half (no database, no pool)
// ---------------------------------------------------------------------------

const print = require('../scripts/print-interval-readings');

test('print: parseArgs requires season, current week and out', () => {
  assert.deepEqual(print.parseArgs(['--season', '2026', '--current-week', '5', '--out', 'x']), {
    season: 2026, currentWeek: 5, outDir: 'x',
  });
  assert.throws(() => print.parseArgs(['--season', '2026', '--out', 'x']), /--current-week is required/);
  assert.throws(() => print.parseArgs(['--season', '2026', '--current-week', '5']), /--out is required/);
  // A present-but-unusable number is invalid, not "required".
  assert.throws(() => print.parseArgs(['--season', 'abc', '--current-week', '5', '--out', 'x']), /--season must be a positive integer/);
  assert.throws(() => print.parseArgs(['--season', '2026', '--current-week', '2.5', '--out', 'x']), /--current-week must be a positive integer/);
  assert.throws(() => print.parseArgs(['--bogus']), /unknown argument/);
});

test('print: --out is refused when empty, UNC, or outside the repository', () => {
  assert.throws(() => print.resolveOutputDir(''), /non-empty/);
  assert.throws(() => print.resolveOutputDir('   '), /non-empty/);
  assert.throws(() => print.resolveOutputDir(String.raw`\\host\share\out`), /UNC/i);
  assert.throws(() => print.resolveOutputDir(require('node:path').resolve('/', 'elsewhere-outside-repo')), /not a directory inside this repository/);
  assert.throws(() => print.resolveOutputDir('.'), /not a directory inside this repository/, 'the repo root itself is refused');
});

test('print: a relative --out resolves inside the repository', () => {
  const path = require('node:path');
  const dir = print.resolveOutputDir('backtest-artifacts/interval-reading');
  assert.equal(dir, path.resolve(__dirname, '..', '..', 'backtest-artifacts', 'interval-reading'));
});

test('print: a position with a full reference set lists its tagged players, boom_or_bust first', () => {
  const rows = lineRun([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]).map((r) => ({ ...r, name: `Player ${r.playerId}` }));
  const md = print.renderPositionTable({ season: 2026, week: 3, source: 'ledger', profile: 'ppr', position: 'WR', rows });
  assert.match(md, /^# 2026 week 3, ledger, ppr, WR/);
  assert.match(md, /Tagged: 4/);
  assert.match(md, /\| Player \| Tag \| Point estimate \| Floor \| Ceiling \| Width \|/);
  assert.ok(md.indexOf('boom_or_bust') < md.indexOf('steady'));
  assert.equal(md.split('\n').filter((l) => /^\| Player \d/.test(l)).length, 4);
});

test('print: a too-small reference set says so and lists nobody', () => {
  const rows = lineRun([-3, -2, -1, 0, 1]).map((r) => ({ ...r, name: `P${r.playerId}` }));
  const md = print.renderPositionTable({ season: 2026, week: 3, source: 'live', profile: 'ppr', position: 'WR', rows });
  assert.match(md, /No tags: the reference set is smaller than 10/);
  assert.doesNotMatch(md, /\| P\d/);
});

test('print: pipes in a name do not break the table', () => {
  const rows = lineRun([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]).map((r) => ({ ...r, name: `A|B ${r.playerId}` }));
  const md = print.renderPositionTable({ season: 2026, week: 3, source: 'ledger', profile: 'ppr', position: 'WR', rows });
  assert.match(md, /A\\|B/);
});

test('print: renderWeekTables yields one file per position', () => {
  const tables = print.renderWeekTables({ season: 2026, week: 3, source: 'ledger', profile: 'half_ppr', modelVersion: 'free_baseline_v3.1', rows: [] });
  assert.deepEqual(
    [...tables.keys()],
    ['QB', 'RB', 'WR', 'TE'].map((p) => `2026-w3-ledger-half_ppr-free_baseline_v3.1-${p}.md`)
  );
});

test('print: two Model versions of one week do not share a file', () => {
  const a = print.slug(2026, 3, 'ledger', 'ppr', 'free_baseline_v3.1', 'WR');
  const b = print.slug(2026, 3, 'ledger', 'ppr', 'free_baseline_v3.2', 'WR');
  assert.notEqual(a, b);
  assert.doesNotMatch(print.slug(2026, 3, 'ledger', 'ppr', '../x/y', 'WR'), /[/\\]/);
});
