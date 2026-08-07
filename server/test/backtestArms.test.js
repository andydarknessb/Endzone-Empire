const test = require('node:test');
const assert = require('node:assert/strict');

const arms = require('../../scripts/backtest/lib/arms');
const metrics = require('../../scripts/backtest/lib/metrics');

// The REAL shipped constants, so the factorial is resolved against what
// production actually runs rather than a stand-in.
const model = require('../services/projectionModel');

const BASE = model.MODEL_CONSTANTS;

// ---------------------------------------------------------------------------
// The factorial
// ---------------------------------------------------------------------------

test('the factorial is 4 blend weights x 2 homeAway states, control = usage-25 x off', () => {
  assert.deepEqual([...arms.BLEND_WEIGHTS], [0, 0.25, 0.40, 0.60]);
  assert.deepEqual([...arms.HOME_AWAY_STATES], ['off', 'on']);
  assert.equal(arms.ALL_CELLS.length, 8);
  assert.equal(arms.CONTROL_CELL, 'usage-25-off');
  assert.equal(arms.SELECTION_FAMILY.length, 7, 'the selection family is the 7 NON-control cells');
  assert.equal(arms.SELECTION_FAMILY.some((c) => c.name === arms.CONTROL_CELL), false);
  // The preregistered fixed cell order covers exactly the selection family.
  assert.deepEqual([...arms.FIXED_CELL_ORDER].sort(),
    arms.SELECTION_FAMILY.map((c) => c.name).sort());
  assert.deepEqual([...arms.FIXED_CELL_ORDER], [
    'usage-40-off', 'usage-00-off', 'usage-60-off',
    'usage-25-on', 'usage-40-on', 'usage-00-on', 'usage-60-on',
  ]);
});

test('each cell resolves the shipped constants, changing exactly two leaves', () => {
  const family = arms.buildFamily({ baseConstants: BASE });
  assert.equal(family.cells.length, 8);
  assert.equal(family.control.name, 'usage-25-off');
  assert.equal(family.control.isControl, true);
  assert.equal(family.control.selectable, false);

  for (const cell of family.cells) {
    assert.equal(cell.resolvedConstants.usage.blendWeight, cell.blendWeight);
    assert.equal(cell.resolvedConstants.homeAway.enabled, cell.homeAway === 'on');
    assert.match(cell.constantsHash, /^[0-9a-f]{64}$/);
    // Nothing else moves: every other top-level key is untouched.
    for (const key of Object.keys(BASE)) {
      if (key === 'usage' || key === 'homeAway') continue;
      assert.deepEqual(cell.resolvedConstants[key], BASE[key], `${cell.name} left ${key} alone`);
    }
  }
  // Eight distinct configurations means eight distinct hashes.
  assert.equal(new Set(family.cells.map((c) => c.constantsHash)).size, 8);
  // The control's resolved constants equal the shipped ones on both leaves.
  assert.equal(family.control.resolvedConstants.usage.blendWeight, 0.25);
  assert.equal(family.control.resolvedConstants.homeAway.enabled, false);
});

test('two cells resolving to identical constants would not be two arms', () => {
  // Unreachable while resolveConstants works - eight distinct
  // (blendWeight, enabled) pairs cannot serialize alike - so the guard is
  // exercised directly rather than waiting for an already-broken codebase.
  const cells = [
    { name: 'usage-40-off', constantsHash: 'aaa' },
    { name: 'usage-60-off', constantsHash: 'bbb' },
  ];
  assert.equal(arms.assertDistinctConstants({ cells }), true);
  assert.throws(() => arms.assertDistinctConstants({
    cells: [...cells, { name: 'usage-00-off', constantsHash: 'aaa' }],
  }), /usage-00-off and usage-40-off resolve to identical constants.*every contrast between them would be zero/s);
  // And the real family genuinely has eight distinct hashes.
  const family = arms.buildFamily({ baseConstants: BASE });
  assert.equal(new Set(family.cells.map((c) => c.constantsHash)).size, 8);
});

test('NO cell may open versusOpponent.crossSeason', () => {
  // Opening it would widen the factor's pool and invalidate the
  // buildPriorGames fail gate, whose conclusion rests on that factor never
  // activating.
  assert.equal(arms.assertNoCrossSeason({ cells: arms.ALL_CELLS, baseConstants: BASE }), true);
  for (const cell of arms.ALL_CELLS) {
    const resolved = arms.resolveConstants({ cell, baseConstants: BASE });
    assert.equal(!!(resolved.versusOpponent && resolved.versusOpponent.crossSeason), false,
      `${cell.name} keeps crossSeason closed`);
  }
  // A base that had it open is refused for every cell.
  const opened = { ...BASE, versusOpponent: { ...BASE.versusOpponent, crossSeason: true } };
  assert.throws(() => arms.assertNoCrossSeason({ cells: arms.ALL_CELLS, baseConstants: opened }),
    /opens versusOpponent.crossSeason.*invalidate the buildPriorGames fail gate/s);
  assert.throws(() => arms.buildFamily({ baseConstants: opened }), /crossSeason/);
  assert.throws(() => arms.resolveConstants({ cell: arms.ALL_CELLS[0] }),
    /the production MODEL_CONSTANTS must be injected/);
});

// ---------------------------------------------------------------------------
// Salts
// ---------------------------------------------------------------------------

test('a salt may change the hashValue and NOTHING else', () => {
  const base = { season: 2025, week: 9, blendWeight: 0.25, homeAway: false };
  const clean = Object.fromEntries(metrics.SALTS.map((s) => [s, { ...base, hashValue: `h-${s}` }]));
  assert.equal(arms.assertSaltAffectsOnlyHashValue({ runsBySalt: clean }), true);

  // A salt that changes a MODEL input is averaging over different models.
  const tampered = { ...clean };
  tampered[metrics.SALTS[3]] = { ...base, blendWeight: 0.6, hashValue: 'h-x' };
  assert.throws(() => arms.assertSaltAffectsOnlyHashValue({ runsBySalt: tampered }),
    /changes an input other than hashValue.*24 different models/s);

  // All 24 must be present, and their hashValues must actually differ.
  const short = { ...clean };
  delete short[metrics.SALTS[0]];
  assert.throws(() => arms.assertSaltAffectsOnlyHashValue({ runsBySalt: short }),
    /1 of the 24 preregistered salts are missing/);
  const duplicated = Object.fromEntries(metrics.SALTS.map((s) => [s, { ...base, hashValue: 'same' }]));
  assert.throws(() => arms.assertSaltAffectsOnlyHashValue({ runsBySalt: duplicated }),
    /must produce 24 distinct hashValues/);
});

// ---------------------------------------------------------------------------
// The two point-identity assertions
// ---------------------------------------------------------------------------

// A generateProjections-shaped run: { projections: Map<playerId, projection>, inputCutoff, sourceCoverage }.
const projRun = (entries, extra = {}) => ({
  projections: new Map(entries.map((p) => [p.playerId, p])),
  inputCutoff: '2025-09-01T00:00:00.000Z',
  sourceCoverage: { nflverse: true },
  ...extra,
});

test('usage-25 x off must be BIT-identical to the control (Map-safe, per-projection)', () => {
  const a = { playerId: 'p1', median: 12.5, p10: 3, factors: { usage: { effect: 0.1 } } };
  const run = projRun([a]);
  assert.equal(arms.assertControlBitIdentity({
    controlRun: run, usage25OffRun: JSON.parse(JSON.stringify(run)),
  }), true);
  // Key order is not a difference (canonical serialization).
  assert.equal(arms.assertControlBitIdentity({
    controlRun: { a: 1, b: 2 }, usage25OffRun: { b: 2, a: 1 },
  }), true);
  // A last-digit difference IS one: they are the same configuration, so any
  // difference was introduced by the harness.
  assert.throws(() => arms.assertControlBitIdentity({
    controlRun: { median: 12.5 }, usage25OffRun: { median: 12.500000001 },
  }), /not bit-identical.*harness introduced one/s);
});

test('assertProjectionRunBitIdentical: Map-safe wrapper for the sealed usage-25 == control assertion', () => {
  const a = { playerId: 'p1', median: 12.5, p10: 3, factors: { usage: { effect: 0.1 } } };
  const run = projRun([a]);
  assert.equal(arms.assertProjectionRunBitIdentical({
    controlRun: run, usage25OffRun: projRun([JSON.parse(JSON.stringify(a))]),
    controlPlayerIds: ['p1'], usage25OffPlayerIds: ['p1'],
  }), true);

  // A last-digit difference IS one: they are the same configuration, so any
  // difference was introduced by the harness.
  assert.throws(() => arms.assertProjectionRunBitIdentical({
    controlRun: projRun([{ playerId: 'p1', median: 12.5 }]),
    usage25OffRun: projRun([{ playerId: 'p1', median: 12.500000001 }]),
    controlPlayerIds: ['p1'], usage25OffPlayerIds: ['p1'],
  }), /not bit-identical.*harness introduced one/s);

  // A duplicated raw id is caught BEFORE any Map is built.
  assert.throws(() => arms.assertProjectionRunBitIdentical({
    controlRun: run, usage25OffRun: projRun([a]),
    controlPlayerIds: ['p1', 'p1'], usage25OffPlayerIds: ['p1'],
  }), /duplicate id/);

  // A playerId present on one side and absent on the other fails the
  // set-level check.
  assert.throws(() => arms.assertProjectionRunBitIdentical({
    controlRun: run,
    usage25OffRun: projRun([a, { playerId: 'p2', median: 1 }]),
    controlPlayerIds: ['p1'], usage25OffPlayerIds: ['p1', 'p2'],
  }), /cardinality differs|key sets differ/);

  // Passing a whole run object's Map directly to canonicalJson would
  // silently serialize to "{}" and compare vacuously - this function must
  // never do that, so two runs that genuinely differ must still fail.
  assert.throws(() => arms.assertProjectionRunBitIdentical({
    controlRun: projRun([{ playerId: 'p1', median: 1 }]),
    usage25OffRun: projRun([{ playerId: 'p1', median: 2 }]),
    controlPlayerIds: ['p1'], usage25OffPlayerIds: ['p1'],
  }), /not bit-identical/);

  // The two named non-Map fields are compared too.
  assert.throws(() => arms.assertProjectionRunBitIdentical({
    controlRun: run,
    usage25OffRun: projRun([JSON.parse(JSON.stringify(a))], { inputCutoff: '2025-09-02T00:00:00.000Z' }),
    controlPlayerIds: ['p1'], usage25OffPlayerIds: ['p1'],
  }), /not bit-identical/);
});

test('the cache-compatible allowlist is INDEPENDENTLY frozen, not derived by subtraction from the fresh list', () => {
  // Independent implementation review (round 2) finding: this was
  // `FRESH_VS_FRESH_ALLOWLIST.filter(p => p !== 'effectiveGames')`, exactly
  // the derivation PHASE5_EXECUTION_SPEC.md section 8.6.3 forbids. The
  // subtraction produced the right SET today, so a set-equality test alone
  // would NOT have caught it - what distinguishes the two is whether
  // appending to the fresh list silently propagates. Assert the real
  // property: the two lists are separate literals.
  const fresh = [...arms.FRESH_VS_FRESH_ALLOWLIST];
  const cache = [...arms.CACHE_COMPATIBLE_ALLOWLIST];

  // The one documented difference: top-level effectiveGames has no cache
  // column (loadCachedRows never SELECTs it, saveProjections never writes it).
  assert.equal(fresh.includes('effectiveGames'), true);
  assert.equal(cache.includes('effectiveGames'), false);
  // The NESTED one does round-trip, through the factors JSONB column.
  assert.equal(cache.includes('factors.recentProduction.effectiveGames'), true);
  assert.deepEqual(
    fresh.filter((p) => !cache.includes(p)),
    ['effectiveGames'],
    'top-level effectiveGames is the ONLY field the cache list drops'
  );
  assert.deepEqual(cache.filter((p) => !fresh.includes(p)), [], 'the cache list adds nothing');

  // The independence property itself: a field appended to the fresh list
  // must NOT appear in the cache list, because the cache list is its own
  // frozen literal rather than a filtered view of the fresh one. Under the
  // old subtraction this assertion was unsatisfiable by construction.
  const freshWithNewField = Object.freeze([...arms.FRESH_VS_FRESH_ALLOWLIST, 'factors.brandNew.untracedField']);
  assert.equal(
    arms.CACHE_COMPATIBLE_ALLOWLIST.includes('factors.brandNew.untracedField'),
    false,
    'a field added to the fresh list must never silently appear in the cache list without being traced through the cache path'
  );
  assert.equal(freshWithNewField.length, arms.CACHE_COMPATIBLE_ALLOWLIST.length + 2);
});

test('homeaway-on-stored must be POINT-identical to homeaway-on', () => {
  assert.equal(arms.assertHomeAwayStoredPointIdentity({
    storedRun: { median: 10, p90: 20, provenance: 'stored' },
    computedRun: { median: 10, p90: 20, provenance: 'computed' },
  }), true, 'differing provenance metadata is allowed; differing NUMBERS are not');
  // A float artifact is not a difference at the preregistered precision.
  assert.equal(arms.assertHomeAwayStoredPointIdentity({
    storedRun: { median: 0.1 + 0.2 }, computedRun: { median: 0.3 },
  }), true);
  assert.throws(() => arms.assertHomeAwayStoredPointIdentity({
    storedRun: { median: 10 }, computedRun: { median: 10.5 },
  }), /differ on 1 value/);
  // A null on one side and a number on the other is a difference.
  assert.throws(() => arms.assertHomeAwayStoredPointIdentity({
    storedRun: { p10: null }, computedRun: { p10: 3 },
  }), /differ on 1 value/);
});

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

const projection = (over = {}) => ({
  eligible: true, neutralSite: false, knownOrientation: true,
  factors: { homeAway: { available: true, effect: 0.02 } }, ...over,
});

test('activation needs available === true AND a non-zero raw effect', () => {
  assert.equal(arms.isActivated(projection()), true);
  // Available but shrunk to exactly zero changes nothing, so it is not treated.
  assert.equal(arms.isActivated(projection({
    factors: { homeAway: { available: true, effect: 0 } },
  })), false);
  assert.equal(arms.isActivated(projection({
    factors: { homeAway: { available: false, effect: 0.03 } },
  })), false);
  assert.equal(arms.isActivated(projection({ factors: {} })), false);
  assert.equal(arms.isActivated(null), false);
  // A negative effect is still an effect.
  assert.equal(arms.isActivated(projection({
    factors: { homeAway: { available: true, effect: -0.02 } },
  })), true);
});

test('the denominator is eligible, NON-NEUTRAL, KNOWN-ORIENTATION projections', () => {
  assert.equal(arms.isEligibleForActivation(projection()), true);
  assert.equal(arms.isEligibleForActivation(projection({ neutralSite: true })), false,
    'nobody played a home game in London');
  assert.equal(arms.isEligibleForActivation(projection({ knownOrientation: false })), false);
  assert.equal(arms.isEligibleForActivation(projection({ eligible: false })), false);
});

test('any position below 0.85 makes the homeAway claim INCONCLUSIVE for that season', () => {
  assert.equal(arms.ACTIVATION_THRESHOLD, 0.85);
  const treated = Object.fromEntries(metrics.MACRO_POSITIONS.map((p) => [p,
    Array.from({ length: 20 }, () => projection())]));
  const good = arms.activationReport({ projectionsByPosition: treated });
  assert.equal(good.verdict, 'treated');
  assert.deepEqual(good.belowThreshold, []);
  assert.equal(good.byPosition.DEF.rate, 1);

  // DEF is IN the denominator, per position including DEF - so DEF alone
  // falling short is enough.
  const defStarved = { ...treated };
  defStarved.DEF = Array.from({ length: 20 }, (unused, i) => projection(
    i < 10 ? { factors: { homeAway: { available: true, effect: 0 } } } : {}
  ));
  const bad = arms.activationReport({ projectionsByPosition: defStarved });
  assert.equal(bad.verdict, 'inconclusive');
  assert.deepEqual(bad.belowThreshold, ['DEF']);
  assert.equal(bad.byPosition.DEF.rate, 0.5);
  assert.match(bad.detail, /not actually treated cannot be compared to an off-cell/);

  // Neutral-site and unknown-orientation rows leave the denominator and are
  // counted, so they cannot drag the rate down.
  const withNeutral = { ...treated };
  withNeutral.QB = [...Array.from({ length: 20 }, () => projection()),
    ...Array.from({ length: 50 }, () => projection({ neutralSite: true }))];
  const neutralOk = arms.activationReport({ projectionsByPosition: withNeutral });
  assert.equal(neutralOk.byPosition.QB.rate, 1);
  assert.equal(neutralOk.byPosition.QB.excludedIneligible, 50);

  // A position with NO eligible projections cannot demonstrate treatment
  // either, so it counts as below threshold rather than being skipped.
  const empty = { ...treated, K: [] };
  assert.deepEqual(arms.activationReport({ projectionsByPosition: empty }).belowThreshold, ['K']);
});

test('MUTATION TEST: activation is checked ONCE PER SEASON, independently - a strong season cannot mask a weak one', () => {
  // Independent implementation review finding: `activationReport` alone has
  // no season dimension - a caller feeding it blended or single-season data
  // could silently mask a real per-season shortfall the sealed table
  // (prereg 11.2) requires to surface on its own ("2025 (primary)" and
  // "2024 (safety)" are two separate 0.85 rows, not one blended check).
  const treated = Object.fromEntries(metrics.MACRO_POSITIONS.map((p) => [p,
    Array.from({ length: 20 }, () => projection())]));
  const starved = { ...treated };
  starved.DEF = Array.from({ length: 20 }, (unused, i) => projection(
    i < 10 ? { factors: { homeAway: { available: true, effect: 0 } } } : {}
  ));

  // Both seasons healthy -> treated.
  const bothGood = arms.activationReportBothSeasons({
    projectionsByPositionBySeason: { 2025: treated, 2024: treated },
  });
  assert.equal(bothGood.verdict, 'treated');
  assert.deepEqual(bothGood.inconclusiveSeasons, []);

  // 2025 (primary) starved, 2024 (safety) healthy - a strong 2024 must NOT
  // rescue a weak 2025: still inconclusive, and 2025 is named.
  const primaryStarved = arms.activationReportBothSeasons({
    projectionsByPositionBySeason: { 2025: starved, 2024: treated },
  });
  assert.equal(primaryStarved.verdict, 'inconclusive');
  assert.deepEqual(primaryStarved.inconclusiveSeasons, ['2025']);
  assert.equal(primaryStarved.bySeason['2025'].verdict, 'inconclusive');
  assert.equal(primaryStarved.bySeason['2024'].verdict, 'treated');

  // 2024 (safety) starved, 2025 (primary) healthy - the reverse must also
  // be caught, symmetrically.
  const safetyStarved = arms.activationReportBothSeasons({
    projectionsByPositionBySeason: { 2025: treated, 2024: starved },
  });
  assert.equal(safetyStarved.verdict, 'inconclusive');
  assert.deepEqual(safetyStarved.inconclusiveSeasons, ['2024']);

  // Both seasons required, no default, no silent single-season check.
  assert.throws(
    () => arms.activationReportBothSeasons({ projectionsByPositionBySeason: { 2025: treated } }),
    /missing 2024/
  );
  assert.throws(
    () => arms.activationReportBothSeasons({ projectionsByPositionBySeason: {} }),
    /missing 2025, 2024/
  );
});

// ---------------------------------------------------------------------------
// Component (f): the exact binomial machinery
// ---------------------------------------------------------------------------

test('the binomial tail is exact, and the documented 8-of-8 discreteness case holds', () => {
  assert.equal(arms.binomialCoefficient(8, 0), 1);
  assert.equal(arms.binomialCoefficient(8, 8), 1);
  assert.equal(arms.binomialCoefficient(8, 4), 70);
  // With n = 8 at alpha/7, the ONLY passing outcome is k = 8.
  assert.equal(arms.binomialUpperTail(8, 8), 1 / 256);
  assert.ok(1 / 256 <= metrics.COMPONENT_ALPHA, 'k = 8 passes');
  assert.equal(arms.binomialUpperTail(8, 7), 9 / 256);
  assert.ok(9 / 256 > metrics.COMPONENT_ALPHA, 'k = 7 does NOT');
});

test('the sign test shifts by the margin, drops exact ties, and inverts to the same answer', () => {
  // All eight weeks comfortably below the margin: k = 8, p = 1/256, passes.
  const allFavourable = arms.exactSignTest({ weekDeltas: new Array(8).fill(-0.01) });
  assert.equal(allFavourable.n, 8);
  assert.equal(allFavourable.k, 8);
  assert.ok(Math.abs(allFavourable.p - 1 / 256) < 1e-12);
  assert.equal(allFavourable.passes, true);
  assert.equal(allFavourable.boundAgrees, true, 'the test and its inverted bound cannot disagree');

  // Seven of eight is not enough - the documented discreteness.
  const sevenOfEight = arms.exactSignTest({
    weekDeltas: [...new Array(7).fill(-0.01), 0.5],
  });
  assert.equal(sevenOfEight.k, 7);
  assert.equal(sevenOfEight.passes, false);
  assert.equal(sevenOfEight.boundAgrees, true);

  // A week exactly ON the shifted margin is DROPPED, and n shrinks with it.
  const withTie = arms.exactSignTest({
    weekDeltas: [...new Array(8).fill(-0.01), arms.DELTA_F],
  });
  assert.equal(withTie.droppedTiedWeeks, 1, 'the exactly-zero shifted week is dropped');
  assert.equal(withTie.n, 8);

  // Every week tied leaves the test with no information at all.
  const allTied = arms.exactSignTest({ weekDeltas: new Array(6).fill(arms.DELTA_F) });
  assert.equal(allTied.evaluable, false);
  assert.match(allTied.reason, /no information/);
});

test('MUTATION TEST: exactSignTest is unevaluable when no finite inverted bound exists, even with a non-zero n', () => {
  // Independent implementation review finding: this previously always
  // reported `evaluable: true` once n > 0 (regardless of whether the
  // j-search ever found a finite i), so prereg 9.8 point 6's "if no such i
  // exists the bound is +infinity and the endpoint is UNEVALUABLE" was
  // silently violated - such an endpoint fell through to `status: 'failed'`
  // downstream instead of `unevaluable`. tail(n,n) = (1/2)^n must be <=
  // alpha for ANY finite bound to exist at all; below n=8 (at the default
  // alpha=1/140) it cannot be, and n can shrink below the raw cluster count
  // via tie-dropping even when the raw cluster count cleared MIN_F_CLUSTERS.
  const belowN8 = arms.exactSignTest({ weekDeltas: new Array(6).fill(-0.01) });
  assert.equal(belowN8.n, 6);
  assert.equal(belowN8.evaluable, false);
  assert.equal(belowN8.bound, Infinity);
  assert.match(belowN8.reason, /no finite i in 1\.\.6/);

  // Reachable through the full component (f) pipeline: 8 RAW weeks clears
  // MIN_F_CLUSTERS, but two of them tie exactly on the margin and are
  // dropped, leaving only 6 non-tied weeks - below the n=8 floor at which a
  // finite bound is even possible. The endpoint must report `unevaluable`/
  // `inconclusive`, never `failed`/`fail`.
  const endpoint = arms.componentFEndpoint({
    weekDeltas: [arms.DELTA_F, arms.DELTA_F, ...new Array(6).fill(-0.01)],
    subgroupRows: 40, meanAbsBaseline: 1.0, weekMeanAbsBaselines: new Array(8).fill(1.0),
  });
  assert.equal(endpoint.status, 'unevaluable');
  assert.equal(endpoint.claimVerdict, 'inconclusive');
  assert.notEqual(endpoint.status, 'failed');
});

/** A healthy single endpoint: 8 clusters, 40 rows, a falsifiable baseline. */
const HEALTHY_F = Object.freeze({
  weekDeltas: new Array(8).fill(-0.01), subgroupRows: 40, meanAbsBaseline: 1.0,
  weekMeanAbsBaselines: new Array(8).fill(1.0),
});

test('revision-18 pinned salt composition vector is byte-exact', () => {
  // Section 3.2's pinned vector is THIRTY-TWO hex characters. Revisions 18-28
  // gave a 64-character stand-in and revision 29 withdrew it: `scoringHash` is
  // `sha256(...).digest('hex').slice(0, 32)` (projectionModel.js:317-319), so a
  // 64-character left operand is one the function can never produce.
  const scoringHash = '0123456789abcdef0123456789abcdef';
  const salt = 'pit-01-879c6f8eae4b';
  assert.equal(
    arms.composeSaltedHashValue({ scoringHash, salt }),
    '0123456789abcdef0123456789abcdef:pit-01-879c6f8eae4b'
  );
  assert.throws(() => arms.composeSaltedHashValue({ scoringHash, salt: 'wrong' }), /24 preregistered salts/);
});
const HEALTHY_VETO = Object.freeze({
  subgroupPlayerWeeks: [{ season: 2025, week: 2, playerId: 1 }],
  realizations: metrics.SALTS.map((salt) => ({ season: 2025, week: 2, playerId: 1, salt, incrementalError: 0.01 })),
});

test('an (f) endpoint is UNEVALUABLE below the minimums, and that is INCONCLUSIVE, never a pass', () => {
  assert.equal(arms.componentFEndpoint(HEALTHY_F).status, 'passed');

  // Too few CLUSTERS.
  const fewClusters = arms.componentFEndpoint({ ...HEALTHY_F, weekDeltas: new Array(7).fill(-0.01) });
  assert.equal(fewClusters.status, 'unevaluable');
  assert.equal(fewClusters.claimVerdict, 'inconclusive');
  assert.equal(fewClusters.passes, false);
  assert.match(fewClusters.reason, /the minimum is 8 clusters and 30 rows/);

  // Too few ROWS.
  const fewRows = arms.componentFEndpoint({ ...HEALTHY_F, subgroupRows: 29 });
  assert.equal(fewRows.claimVerdict, 'inconclusive');

  // ZERO rows is "not estimable", not a formal pass.
  const zeroRows = arms.componentFEndpoint({ ...HEALTHY_F, weekDeltas: [], subgroupRows: 0 });
  assert.equal(zeroRows.status, 'unevaluable');
  assert.equal(zeroRows.claimVerdict, 'inconclusive');
  assert.equal(zeroRows.passes, false);
  assert.match(zeroRows.reason, /Zero rows is "not estimable", not a formal pass/);
  assert.match(zeroRows.reason, /2024 cannot rescue sparse 2025 evidence/);
});

test('EVERY unevaluable (f) return carries qualifyingWeekCount, including the misaligned-series branch (round-3 BLOCKER 1, QA follow-up)', () => {
  // Section 6.1a item 1 defines the qualifying week count by the endpoint's
  // own D_w series, so it is publishable whether or not the endpoint is
  // evaluable - and the runner's evidence cross-check compares it against
  // that series' length for every published endpoint. The runner can no
  // longer REACH this branch (the derivation aligns the series by
  // construction and a length mismatch is a malformed document before
  // componentF runs), but componentFEndpoint is a library callable outside
  // the runner, and the round-3 fix covered BOTH pre-guard returns.
  // Negative control: revert this return to the bare transparency block -
  // qualifyingWeekCount comes back undefined and the equality below fails.
  const misaligned = arms.componentFEndpoint({
    ...HEALTHY_F,
    weekMeanAbsBaselines: new Array(7).fill(1.0),
  });
  assert.equal(misaligned.status, 'unevaluable');
  assert.match(misaligned.reason, /misaligned/);
  assert.equal(misaligned.transparency.qualifyingWeekCount, HEALTHY_F.weekDeltas.length);

  const belowMinimum = arms.componentFEndpoint({ ...HEALTHY_F, subgroupRows: 29 });
  assert.equal(belowMinimum.transparency.qualifyingWeekCount, HEALTHY_F.weekDeltas.length);
});

test('component (f) uses the transformed weekly-median bound only', () => {
  assert.equal(arms.FALSIFIABILITY_FLOOR, 0.3, '0.30 remains disclosure-only');
  const pooledPassesButMedianFails = arms.componentFEndpoint({
    ...HEALTHY_F, meanAbsBaseline: 1.0,
    weekMeanAbsBaselines: [0.1, 0.1, 0.1, 0.1, 0.1, 10, 10, 10],
  });
  assert.equal(pooledPassesButMedianFails.status, 'unevaluable');
  assert.match(pooledPassesButMedianFails.reason, /median transformed weekly attainable bound/);
  const pooledFailsButMedianPasses = arms.componentFEndpoint({
    ...HEALTHY_F, meanAbsBaseline: 0.1,
    weekMeanAbsBaselines: [1, 1, 1, 1, 1, 1, 1, 0.1],
  });
  assert.equal(pooledFailsButMedianPasses.status, 'passed');
  const evenBoundary = arms.componentFEndpoint({
    ...HEALTHY_F, weekMeanAbsBaselines: new Array(8).fill(0.3),
  });
  assert.equal(evenBoundary.status, 'unevaluable', 'even-week median equality is unfalsifiable');
  assert.equal(evenBoundary.transparency.medianWeeklyBound, 0.025);
});

test('the disclosure threshold is corrected to 3.80, roundToTie-normalized', () => {
  assert.equal(arms.CATASTROPHIC_CAP_COULD_FIRE_THRESHOLD, 3.8);
  const atBoundary = arms.componentFEndpoint({
    weekDeltas: new Array(8).fill(-0.01), subgroupRows: 40, meanAbsBaseline: 1.0,
    maxAbsBaseline: 3.8, weekMeanAbsBaselines: new Array(8).fill(1.0),
  });
  assert.equal(atBoundary.transparency.catastrophicCapCouldFire, false, 'exactly AT the threshold, not above it');
  const justAbove = arms.componentFEndpoint({
    weekDeltas: new Array(8).fill(-0.01), subgroupRows: 40, meanAbsBaseline: 1.0,
    maxAbsBaseline: 3.81, weekMeanAbsBaselines: new Array(8).fill(1.0),
  });
  assert.equal(justAbove.transparency.catastrophicCapCouldFire, true);
});

test('the catastrophic cap is Cartesian, complete, and independent of Level 3', () => {
  assert.equal(arms.CATASTROPHIC_CAP, 0.20);
  const oneSaltHarmful = {
    ...HEALTHY_VETO,
    realizations: HEALTHY_VETO.realizations.map((row, index) => ({ ...row, incrementalError: index === 0 ? 0.21 : 0.01 })),
  };
  const veto = arms.evaluateCatastrophicVeto(oneSaltHarmful);
  assert.equal(veto.catastrophicVeto, true);
  assert.equal(veto.realizationCount, 24);
  assert.equal(veto.expectedCount, 24);
  const missing = { ...HEALTHY_VETO, realizations: HEALTHY_VETO.realizations.slice(1) };
  assert.throws(() => arms.evaluateCatastrophicVeto(missing), /incomplete player-week x salt coverage/);
  const duplicate = { ...HEALTHY_VETO, realizations: [...HEALTHY_VETO.realizations, HEALTHY_VETO.realizations[0]] };
  assert.throws(() => arms.evaluateCatastrophicVeto(duplicate), /duplicate composite key/);
});

test('MUTATION TEST: the Level-2 veto overrides a would-be unevaluable component', () => {
  // Independent implementation review finding: the veto previously ran LAST,
  // after three possible early `unevaluable` returns - so a catastrophic row
  // on an endpoint that was ALSO sparse, unfalsifiable, or exact-test-
  // unevaluable would report `unevaluable`/inconclusive instead of
  // `vetoed`/fail, contradicting section 6.4's "vetoes the cell immediately,
  // regardless of whether either endpoint would otherwise have been
  // evaluable." Each case below is independently sufficient to be
  // unevaluable on its own; the veto must still win in every one.

  const veto = { ...HEALTHY_VETO, realizations: HEALTHY_VETO.realizations.map((row, i) => ({ ...row, incrementalError: i === 0 ? 0.21 : 0.01 })) };
  const result = arms.componentF({ f1: { ...HEALTHY_F, subgroupRows: 5 }, f2: HEALTHY_F, veto });
  assert.equal(result.status, 'unevaluable');
  assert.equal(result.catastrophicVeto, true);
  const claim = arms.evaluateClaim({
    cell: 'usage-40-on',
    components: { a: { passes: true }, b: { passes: true }, c: { passes: true }, d: { passes: true }, e1: { passes: true }, e2: { passes: true }, f: result },
  });
  assert.equal(claim.verdict, 'vetoed');
});

test('an (f) endpoint reports everything the transparency requirement names', () => {
  const result = arms.componentFEndpoint({
    weekDeltas: new Array(9).fill(-0.02), subgroupRows: 44, meanAbsBaseline: 1.25,
    maxAbsBaseline: 6.5,
    // One of these five weeks is at or below the corrected 0.30
    // falsifiability floor, so a favourable sign in that week is
    // structurally uninformative and the transparency block has to say how
    // much of k rests on it.
    weekMeanAbsBaselines: [0.2, 0.3, 0.31, 3.0, 1, 1, 1, 1, 1],
  });
  assert.equal(result.status, 'passed');
  const t = result.transparency;
  assert.equal(t.nonTiedWeeks, 9);
  assert.equal(t.k, 9);
  assert.ok(t.exactP <= metrics.COMPONENT_ALPHA);
  assert.equal(t.subgroupRows, 44);
  assert.equal(t.meanAbsBaseline, 1.25);
  // Prereg 9.8 names the MAXIMUM |b| as well as the mean, and the per-week
  // floor count. Neither may be a placeholder.
  assert.equal(t.maxAbsBaseline, 6.5);
  assert.equal(t.weeksBelowFalsifiabilityFloor, 2, '0.2 and 0.3 are at or below 0.30; 0.31 is not');
  assert.equal(t.weeksWithBaseline, 9);
  assert.equal(t.catastrophicCapCouldFire, true, '6.5 exceeds 0.20 / 0.03');
  assert.equal(t.weekSignIndependenceAssumed, true,
    'the exact test rests on week-sign independence and says so');
  assert.ok(Number.isFinite(t.invertedBound));

  // A missing maximum is reported as missing, never as a zero that would read
  // as "the cap could not fire".
  const noMax = arms.componentFEndpoint(HEALTHY_F).transparency;
  assert.equal(noMax.maxAbsBaseline, null);
  assert.equal(noMax.catastrophicCapCouldFire, null);
  assert.equal(noMax.weeksBelowFalsifiabilityFloor, 0);
});

test('component (f) runs BOTH preregistered endpoints and passes only if BOTH pass', () => {
  assert.deepEqual(arms.F_ENDPOINTS, { F1: 'f1-subgroup-mae', F2: 'f2-subgroup-absolute-bias' });

  // BOTH pass -> pass.
  const both = arms.componentF({ f1: HEALTHY_F, f2: HEALTHY_F, veto: HEALTHY_VETO });
  assert.equal(both.status, 'passed');
  assert.equal(both.claimVerdict, 'pass');
  assert.equal(both.passes, true);
  // Transparency is reported PER ENDPOINT, so a reader can see which is which.
  assert.equal(both.transparency.length, 2);
  assert.deepEqual(both.transparency.map((t) => t.endpoint),
    ['f1-subgroup-mae', 'f2-subgroup-absolute-bias']);
  assert.equal(both.endpoints['f1-subgroup-mae'].passes, true);
  assert.equal(both.endpoints['f2-subgroup-absolute-bias'].passes, true);

  // f1 passes, f2 FAILS -> the component FAILS. This is the case a
  // single-endpoint implementation would have reported as a pass.
  const f2Fails = arms.componentF({
    f1: HEALTHY_F,
    f2: { ...HEALTHY_F, weekDeltas: new Array(8).fill(0.5) },
    veto: HEALTHY_VETO,
  });
  assert.equal(f2Fails.status, 'failed');
  assert.equal(f2Fails.claimVerdict, 'fail');
  assert.equal(f2Fails.passes, false);
  assert.match(f2Fails.reason, /f2-subgroup-absolute-bias did not clear noninferiority/);
  assert.equal(f2Fails.endpoints['f1-subgroup-mae'].passes, true,
    'the passing endpoint is still reported as passing');

  // f1 passes, f2 UNEVALUABLE -> INCONCLUSIVE, never a pass.
  const f2Unevaluable = arms.componentF({
    f1: HEALTHY_F,
    f2: { ...HEALTHY_F, subgroupRows: 12 },
    veto: HEALTHY_VETO,
  });
  assert.equal(f2Unevaluable.status, 'unevaluable');
  assert.equal(f2Unevaluable.claimVerdict, 'inconclusive');
  assert.equal(f2Unevaluable.passes, false);
  assert.match(f2Unevaluable.reason, /^f2-subgroup-absolute-bias: below the evaluability minimum/);

  // Symmetric: the same failure on f1 is the same verdict, so neither endpoint
  // is privileged.
  assert.equal(arms.componentF({ f1: { ...HEALTHY_F, subgroupRows: 12 }, f2: HEALTHY_F, veto: HEALTHY_VETO }).claimVerdict,
    'inconclusive');
  assert.equal(arms.componentF({
    f1: { ...HEALTHY_F, weekDeltas: new Array(8).fill(0.5) }, f2: HEALTHY_F, veto: HEALTHY_VETO,
  }).claimVerdict, 'fail');
});

test('f1 and f2 with DIFFERENT qualifying week SETS evaluate independently - one endpoint firing does not fire the other (spec 6.1a mutation test (iv); round-4 MINOR D)', () => {
  // The runner-level derivation yields one shared operand set (a disclosed
  // narrowing); arms.js keeps per-endpoint independence REPRESENTABLE, and no
  // prior test exercised differing week SETS - only differing rows or deltas.
  // f2's own NINE-week set clears both minimums but misses the falsifiability
  // floor (0.05 * 0.1 + 0.01 = 0.015 <= DELTA_F 0.025); f1's eight-week set
  // clears it. The guard fires per endpoint, on each endpoint's own set.
  const result = arms.componentF({
    f1: HEALTHY_F,
    f2: {
      weekDeltas: new Array(9).fill(-0.01),
      subgroupRows: 40,
      meanAbsBaseline: 0.1,
      weekMeanAbsBaselines: new Array(9).fill(0.1),
    },
    veto: HEALTHY_VETO,
  });
  assert.equal(result.endpoints['f1-subgroup-mae'].status, 'passed', "f1 evaluates on its own set; f2's guard does not fire it");
  assert.equal(result.endpoints['f2-subgroup-absolute-bias'].status, 'unevaluable');
  assert.match(result.endpoints['f2-subgroup-absolute-bias'].reason, /median transformed weekly attainable bound/);
  assert.equal(result.status, 'unevaluable');
  assert.equal(result.claimVerdict, 'inconclusive');
});

test('exactSignTest refuses a non-finite week delta outright - absent evidence is never a favourable sign (round-4 BLOCKER A)', () => {
  // Number(null) === 0, and 0 is the most favourable value the margin-shifted
  // sign test can see. The document boundary rejects such a series first; this
  // guard is the library's own fail-closed layer, mirroring bootstrapMean.
  // Negative control: remove the guard - the all-null series returns
  // { passes: true } with p = 0.00390625.
  for (const bad of [[null, -0.01, -0.01], [NaN, -0.01], ['x', -0.01], [undefined, -0.01]]) {
    assert.throws(
      () => arms.exactSignTest({ weekDeltas: bad }),
      /every week delta must be a finite number/
    );
  }
});

test('component (f) combiner: a veto outranks an unevaluable endpoint', () => {
  // A veto is positive evidence of harm; unevaluable is merely absent
  // evidence. Missing evidence in one endpoint must never mask measured harm
  // in the other, so the combined status is vetoed/fail, not inconclusive.
  const harmfulVeto = { ...HEALTHY_VETO, realizations: HEALTHY_VETO.realizations.map((row, i) => ({ ...row, incrementalError: i === 0 ? 0.21 : 0.01 })) };
  const vetoBeatsUnevaluable = arms.componentF({
    f1: { ...HEALTHY_F, subgroupRows: 12 },
    f2: HEALTHY_F,
    veto: harmfulVeto,
  });
  assert.equal(vetoBeatsUnevaluable.status, 'unevaluable');
  assert.equal(vetoBeatsUnevaluable.catastrophicVeto, true);
  assert.equal(vetoBeatsUnevaluable.passes, false);

  // And in the mirrored order, so neither endpoint is privileged.
  const mirrored = arms.componentF({
    f1: HEALTHY_F,
    f2: { ...HEALTHY_F, subgroupRows: 12 },
    veto: harmfulVeto,
  });
  assert.equal(mirrored.status, 'unevaluable');
  assert.equal(mirrored.catastrophicVeto, true);
});

test('component (f) cannot be run with only one endpoint', () => {
  // The single-endpoint mistake has to be UNREPRESENTABLE, not merely
  // discouraged: an omitted f2 must throw rather than default to "the half I
  // was given passed".
  for (const bad of [
    { f1: HEALTHY_F },
    { f2: HEALTHY_F },
    {},
    { f1: HEALTHY_F, f2: null },
  ]) {
    assert.throws(() => arms.componentF(bad), /requires BOTH endpoints/,
      `${JSON.stringify(Object.keys(bad))} must not be runnable`);
  }
  // And a passing f1 alone does not become a passing component by any route.
  assert.throws(() => arms.componentF({ f1: HEALTHY_F, f2: undefined }),
    /per-week subgroup MAE and per-week subgroup absolute bias/);
});

// ---------------------------------------------------------------------------
// The bootstrap components and the claim
// ---------------------------------------------------------------------------

test('a co-primary component needs BOTH bounds, from the SAME resamples, at alpha/7', () => {
  const resamples = metrics.buildBootstrapResamples({ clusterCount: 17 });
  // Comfortably better than control on both endpoints.
  const strong = arms.coPrimaryComponent({
    name: 'a',
    regretWeeks: new Array(17).fill(-0.5),
    pairwiseWeeks: new Array(17).fill(0.05),
    resamples,
    regretThreshold: -arms.DELTA_R,
    pairwiseThreshold: arms.DELTA_P,
  });
  assert.equal(strong.passes, true);
  assert.equal(strong.regret.ok, true);
  assert.equal(strong.pairwise.ok, true);
  assert.equal(strong.alpha, metrics.COMPONENT_ALPHA);

  // Regret good, pairwise not: the component still fails. Both must hold.
  const half = arms.coPrimaryComponent({
    name: 'a',
    regretWeeks: new Array(17).fill(-0.5),
    pairwiseWeeks: new Array(17).fill(0.001),
    resamples,
    regretThreshold: -arms.DELTA_R,
    pairwiseThreshold: arms.DELTA_P,
  });
  assert.equal(half.passes, false);
  assert.match(half.detail, /pairwise lower .* is not above 0.005/);
  assert.equal(arms.DELTA_R, 0.15);
  assert.equal(arms.DELTA_P, 0.005);
});

test('the claim is an IUT: every component must pass, the divisor stays 7', () => {
  const pass = { passes: true };
  const all = { a: pass, b: pass, c: pass, d: pass, e1: pass, e2: pass, f: pass };
  const good = arms.evaluateClaim({ cell: 'usage-40-on', components: all });
  assert.equal(good.verdict, 'pass');
  assert.equal(good.divisor, 7);
  assert.equal(good.alpha, metrics.COMPONENT_ALPHA);

  // One failure fails the claim.
  const oneFail = arms.evaluateClaim({
    cell: 'usage-40-on', components: { ...all, d: { passes: false } },
  });
  assert.equal(oneFail.verdict, 'fail');
  assert.deepEqual(oneFail.failures, ['d failed']);

  // A MISSING component fails - there is no "assume pass".
  const missing = { ...all };
  delete missing.e2;
  const withMissing = arms.evaluateClaim({ cell: 'usage-40-on', components: missing });
  assert.equal(withMissing.verdict, 'fail');
  assert.deepEqual(withMissing.failures, ['e2 is missing']);

  // A not-applicable component passes VACUOUSLY BY DEFINITION - and the
  // divisor is still 7, so an off-cell gets no alpha discount for skipping.
  const offCell = arms.evaluateClaim({
    cell: 'usage-40-off',
    components: { ...all, b: { applicable: false }, f: { applicable: false } },
  });
  assert.equal(offCell.verdict, 'pass');
  assert.equal(offCell.components.b.status, 'not-applicable');
  assert.equal(offCell.divisor, 7);

  // An UNEVALUABLE component makes the claim INCONCLUSIVE, never a pass.
  const unevaluable = arms.evaluateClaim({
    cell: 'usage-40-on',
    components: { ...all, f: { status: 'unevaluable', reason: 'below the minimum' } },
  });
  assert.equal(unevaluable.verdict, 'inconclusive');
  assert.match(unevaluable.inconclusive[0], /f: below the minimum/);

  // A real FAILURE outranks an inconclusive: one unmeasurable component does
  // not rescue a cell that was measured and lost.
  const both = arms.evaluateClaim({
    cell: 'usage-40-on',
    components: { ...all, d: { passes: false }, f: { status: 'unevaluable', reason: 'x' } },
  });
  assert.equal(both.verdict, 'fail');
});

// ---------------------------------------------------------------------------
// The corrected Level-2 cell table: vetoed, non-(f) unevaluable is FAIL,
// wide-straddle, activation, and the full precedence order
// ---------------------------------------------------------------------------

test('a NON-(f) component unevaluable for any reason is FAIL, never inconclusive - only (f) gets that exception', () => {
  const pass = { passes: true };
  const all = { a: pass, b: pass, c: pass, d: pass, e1: pass, e2: pass, f: pass };
  const nonFUnevaluable = arms.evaluateClaim({
    cell: 'usage-40-on',
    components: { ...all, e1: { status: 'unevaluable', reason: 'no finite exact bound' } },
  });
  assert.equal(nonFUnevaluable.verdict, 'fail', 'no named exception covers a non-(f) component');
  assert.deepEqual(nonFUnevaluable.failures, ['e1: no finite exact bound']);
  assert.equal(nonFUnevaluable.inconclusive.length, 0);

  // (f) unevaluable is still the named exception -> inconclusive.
  const fUnevaluable = arms.evaluateClaim({
    cell: 'usage-40-on',
    components: { ...all, f: { status: 'unevaluable', reason: 'falsifiability floor missed' } },
  });
  assert.equal(fUnevaluable.verdict, 'inconclusive');
});

test('component (f) catastrophicVeto produces cell status VETOED, which outranks fail', () => {
  const pass = { passes: true };
  const all = { a: pass, b: pass, c: pass, d: pass, e1: pass, e2: pass, f: pass };
  const vetoed = arms.evaluateClaim({
    cell: 'usage-40-on',
    components: { ...all, f: { passes: true, catastrophicVeto: true, veto: { reason: 'incremental error exceeded the cap' } } },
  });
  assert.equal(vetoed.verdict, 'vetoed');
  assert.deepEqual(vetoed.vetoedReasons, ['f: incremental error exceeded the cap']);

  // vetoed outranks an independent fail elsewhere on the same cell.
  const vetoedAndFailed = arms.evaluateClaim({
    cell: 'usage-40-on',
    components: { ...all, d: { passes: false }, f: { passes: true, catastrophicVeto: true, veto: { reason: 'x' } } },
  });
  assert.equal(vetoedAndFailed.verdict, 'vetoed');

  // A Level-3 vetoed status is prohibited.
  assert.throws(() => arms.evaluateClaim({
    cell: 'usage-40-on',
    components: { ...all, a: { status: 'vetoed', reason: 'x' } },
  }), /never a Level-3 component status/);
});

test('any component wide-straddle produces cell status inconclusive', () => {
  const pass = { passes: true };
  const all = { a: pass, b: pass, c: pass, d: pass, e1: pass, e2: pass, f: pass };
  const straddled = arms.evaluateClaim({
    cell: 'usage-40-on',
    components: { ...all, e2: { status: 'wide-straddle', reason: 'interval spans both boundaries' } },
  });
  assert.equal(straddled.verdict, 'inconclusive');
  assert.match(straddled.inconclusive[0], /e2: wide-straddle/);
});

test('an activation shortfall (on-cells only) is inconclusive, UNLESS the reducer already produced an independent fail', () => {
  const pass = { passes: true };
  const all = { a: pass, b: pass, c: pass, d: pass, e1: pass, e2: pass, f: pass };
  const shortfall = { verdict: 'inconclusive', detail: 'DEF below 0.85' };
  const inconclusiveFromActivation = arms.evaluateClaim({
    cell: 'usage-25-on', components: all, activation: shortfall,
  });
  assert.equal(inconclusiveFromActivation.verdict, 'inconclusive');
  assert.match(inconclusiveFromActivation.inconclusive[0], /activation: DEF below 0.85/);

  // fail stands even with an activation shortfall also present.
  const failStands = arms.evaluateClaim({
    cell: 'usage-25-on', components: { ...all, d: { passes: false } }, activation: shortfall,
  });
  assert.equal(failStands.verdict, 'fail');

  // A 'treated' activation report contributes nothing.
  const treated = arms.evaluateClaim({
    cell: 'usage-25-on', components: all, activation: { verdict: 'treated', detail: 'every position clears 0.85' },
  });
  assert.equal(treated.verdict, 'pass');
});

// ---------------------------------------------------------------------------
// Level 4: the signed-boundary bootstrap-endpoint classifier
// ---------------------------------------------------------------------------

test('classifyBootstrapEndpoint: unevaluable, passed, wide-straddle, and the threshold-not-established catch-all', () => {
  assert.equal(arms.FAVORABLE_BOUNDARY, 0);
  // Unevaluable.
  assert.deepEqual(
    arms.classifyBootstrapEndpoint({ evaluable: false, reason: 'below n=15' }),
    { status: 'unevaluable', passes: false, reason: 'below n=15' }
  );

  // A superiority endpoint (component (a) regret): passing -0.15, harmful +0.15.
  const passed = arms.classifyBootstrapEndpoint({
    evaluable: true, lower: -0.6, upper: -0.4,
    passingBoundary: -0.15, harmfulBoundary: 0.15, direction: 'below',
  });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.passes, true);

  // Interval spans BOTH 0 and +0.15 -> wide-straddle, not merely "not passed".
  const straddled = arms.classifyBootstrapEndpoint({
    evaluable: true, lower: -0.05, upper: 0.2,
    passingBoundary: -0.15, harmfulBoundary: 0.15, direction: 'below',
  });
  assert.equal(straddled.status, 'wide-straddle');
  assert.equal(straddled.passes, false);

  // Fully evaluated, does not pass, does not span both boundaries -> the
  // exhaustive catch-all, never unevaluable.
  const notEstablished = arms.classifyBootstrapEndpoint({
    evaluable: true, lower: -0.1, upper: -0.05,
    passingBoundary: -0.15, harmfulBoundary: 0.15, direction: 'below',
  });
  assert.equal(notEstablished.status, 'threshold-not-established');
  assert.equal(notEstablished.passes, false);

  // Zero-margin endpoints (b, c, d): passing = harmful = 0, so wide-straddle
  // can never fire by construction - it falls to the catch-all instead.
  const zeroMargin = arms.classifyBootstrapEndpoint({
    evaluable: true, lower: -0.5, upper: 0.5,
    passingBoundary: 0, harmfulBoundary: 0, direction: 'below',
  });
  assert.equal(zeroMargin.status, 'threshold-not-established');

  // A favorable-positive endpoint (pairwise): direction 'above'.
  const positivePassed = arms.classifyBootstrapEndpoint({
    evaluable: true, lower: 0.01, upper: 0.03,
    passingBoundary: 0.005, harmfulBoundary: -0.005, direction: 'above',
  });
  assert.equal(positivePassed.status, 'passed');
});

test('classifyTriggeredEndpoint: the AND rule, exact-side precedence, and agreement/disagreement', () => {
  const passedBootstrap = { status: 'passed', passes: true };
  const notEstablishedBootstrap = { status: 'threshold-not-established', passes: false };
  const straddledBootstrap = { status: 'wide-straddle', passes: false, reason: 'spans both' };
  const passExact = { evaluable: true, passes: true };
  const failExact = { evaluable: true, passes: false };
  const unevaluableExact = { evaluable: false, reason: 'no finite bound' };

  // Exact-side non-estimability ALWAYS takes precedence, even over a
  // bootstrap-side wide-straddle.
  assert.equal(
    arms.classifyTriggeredEndpoint({ bootstrap: straddledBootstrap, exact: unevaluableExact }).status,
    'unevaluable'
  );
  // Bootstrap unevaluable, exact fine -> still unevaluable (not fully evaluated).
  assert.equal(
    arms.classifyTriggeredEndpoint({
      bootstrap: { status: 'unevaluable', reason: 'x' }, exact: passExact,
    }).status,
    'unevaluable'
  );
  // Both evaluable, bootstrap wide-straddle -> outranks agreement handling.
  assert.equal(
    arms.classifyTriggeredEndpoint({ bootstrap: straddledBootstrap, exact: passExact }).status,
    'wide-straddle'
  );
  // Agreement, both pass -> passed.
  assert.deepEqual(
    arms.classifyTriggeredEndpoint({ bootstrap: passedBootstrap, exact: passExact }),
    { status: 'passed', passes: true, reason: null }
  );
  // Agreement, both fail -> threshold-not-established.
  assert.equal(
    arms.classifyTriggeredEndpoint({ bootstrap: notEstablishedBootstrap, exact: failExact }).status,
    'threshold-not-established'
  );
  // Disagreement -> threshold-not-established, NEVER unevaluable (both were computed).
  assert.equal(
    arms.classifyTriggeredEndpoint({ bootstrap: passedBootstrap, exact: failExact }).status,
    'threshold-not-established'
  );
  assert.equal(
    arms.classifyTriggeredEndpoint({ bootstrap: notEstablishedBootstrap, exact: passExact }).status,
    'threshold-not-established'
  );
});

// ---------------------------------------------------------------------------
// Level 1 (run void) and Level 5 (selection)
// ---------------------------------------------------------------------------

test('classifyRun: void PREEMPTS the cell-level table, from any of the FOUR named causes', () => {
  assert.equal(arms.classifyRun({}).status, 'valid');
  assert.equal(arms.classifyRun({ canariesPassed: false }).status, 'void');
  assert.equal(arms.classifyRun({ permutationControlPassed: false }).status, 'void');
  assert.equal(arms.classifyRun({ identityAssertionsPassed: false }).status, 'void');
  // Independent implementation review finding: a real salt-collision
  // (section 3.4 item 5) previously had no run-voiding effect wired at all.
  const saltCollision = arms.classifyRun({ saltCollisionPassed: false });
  assert.equal(saltCollision.status, 'void');
  assert.match(saltCollision.reasons[0], /salt-collision/);
  const allFour = arms.classifyRun({
    canariesPassed: false, permutationControlPassed: false, identityAssertionsPassed: false,
    saltCollisionPassed: false,
  });
  assert.equal(allFour.reasons.length, 4);
});

test('selectAtLevel5: the frozen precedence - void, no-proposal causes, none-passed, then parsimony', () => {
  const cell = (name) => arms.ALL_CELLS.find((c) => c.name === name);

  assert.deepEqual(
    arms.selectAtLevel5({ runStatus: 'void', passingCells: [cell('usage-40-off')] }).outcome,
    'no-selection'
  );
  assert.equal(
    arms.selectAtLevel5({ runStatus: 'valid', passingCells: [], orderingDisagreement: true }).outcome,
    'no-proposal'
  );
  assert.equal(
    arms.selectAtLevel5({
      runStatus: 'valid', passingCells: [cell('usage-40-off')], deployedPolicyDisagreement: true,
    }).outcome,
    'no-proposal'
  );
  assert.equal(
    arms.selectAtLevel5({ runStatus: 'valid', passingCells: [] }).outcome,
    'no-proposal'
  );
  const selected = arms.selectAtLevel5({
    runStatus: 'valid', passingCells: [cell('usage-25-on'), cell('usage-40-off')],
  });
  assert.equal(selected.outcome, 'selected');
  assert.equal(selected.selected.name, 'usage-40-off', 'parsimony, unchanged, still decides among passing cells');
});

// ---------------------------------------------------------------------------
// Parsimony
// ---------------------------------------------------------------------------

test('parsimony selects by the total order and NEVER by point estimate', () => {
  const cell = (name) => arms.ALL_CELLS.find((c) => c.name === name);

  // Rule 1: fewest changed constants. usage-40-off changes one; usage-40-on
  // changes two.
  assert.equal(arms.selectByParsimony({
    passingCells: [cell('usage-40-on'), cell('usage-40-off')],
  }).selected.name, 'usage-40-off');

  // Rule 2: at equal change counts, a cell that activates NO new gated factor
  // outranks one that does - usage-40-off over usage-25-on, the preregistered
  // example.
  assert.equal(arms.selectByParsimony({
    passingCells: [cell('usage-25-on'), cell('usage-40-off')],
  }).selected.name, 'usage-40-off');

  // Rule 3: smallest absolute blendWeight change. 0.40 is 0.15 away from 0.25;
  // 0.60 is 0.35 away; 0.00 is 0.25 away.
  assert.equal(arms.selectByParsimony({
    passingCells: [cell('usage-60-off'), cell('usage-00-off'), cell('usage-40-off')],
  }).selected.name, 'usage-40-off');
  assert.equal(arms.selectByParsimony({
    passingCells: [cell('usage-60-off'), cell('usage-00-off')],
  }).selected.name, 'usage-00-off');

  // Rule 4: the fixed cell order, used only when 1-3 tie.
  const ranked = arms.selectByParsimony({ passingCells: [...arms.SELECTION_FAMILY] });
  assert.equal(ranked.selected.name, 'usage-40-off');
  assert.match(ranked.reason, /point estimates never break a tie/);

  // Nothing passing selects nothing.
  assert.equal(arms.selectByParsimony({ passingCells: [] }).selected, null);
  assert.throws(() => arms.selectByParsimony({
    passingCells: [{ name: 'not-a-cell', blendWeight: 0.25, homeAway: 'off' }],
  }), /not in the preregistered fixed cell order/);
});

test('for THIS family, parsimony rules 2 and 3 alone determine the order', () => {
  // A finding worth recording rather than hiding. The preregistration
  // specifies four rules, and the implementation applies all four faithfully -
  // but over these eight cells, rules 1 and 4 can NEVER fire:
  //
  //   - rule 1 (fewest changed constants) never disagrees with rules 2-3,
  //     because `changedConstants` is `activatesFactor` plus a usage change,
  //     so it is already implied by them here;
  //   - rule 4 (the fixed cell order) needs two cells tying through rules
  //     1-3, and no two of these seven do.
  //
  // Pinning it means a future change to the family that makes rule 4 reachable
  // shows up here instead of quietly changing which cell gets selected.
  const keys = arms.SELECTION_FAMILY.map((c) => arms.parsimonyKey(c));
  let tiedThroughRule3 = 0;
  let rule1Disagrees = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const x = keys[i];
      const y = keys[j];
      if (x.changedConstants === y.changedConstants
        && x.activatesFactor === y.activatesFactor
        && x.blendWeightChange === y.blendWeightChange) tiedThroughRule3++;
      const r1 = Math.sign(x.changedConstants - y.changedConstants);
      const r23 = Math.sign(x.activatesFactor - y.activatesFactor)
        || Math.sign(x.blendWeightChange - y.blendWeightChange);
      if (r1 !== 0 && r23 !== 0 && r1 !== r23) rule1Disagrees++;
    }
  }
  assert.equal(tiedThroughRule3, 0, 'no two cells tie through rules 1-3, so rule 4 never fires');
  assert.equal(rule1Disagrees, 0, 'rule 1 never disagrees with rules 2-3 over this family');
  // The order is nonetheless a TOTAL order over the seven, which is what the
  // preregistration needs it to be.
  const ranked = arms.selectByParsimony({ passingCells: [...arms.SELECTION_FAMILY] }).ranked;
  assert.equal(new Set(ranked.map((c) => c.name)).size, 7);
  assert.deepEqual(ranked.map((c) => c.name), [
    'usage-40-off', 'usage-00-off', 'usage-60-off',
    'usage-25-on', 'usage-40-on', 'usage-00-on', 'usage-60-on',
  ], 'and it happens to reproduce the preregistered fixed order exactly');
});

test('the parsimony key exposes each rule so a reader can audit the ordering', () => {
  const key = (name) => arms.parsimonyKey(arms.ALL_CELLS.find((c) => c.name === name));
  assert.deepEqual(key('usage-40-off'),
    { changedConstants: 1, activatesFactor: 0, blendWeightChange: 0.15, fixedOrder: 0 });
  assert.deepEqual(key('usage-25-on'),
    { changedConstants: 1, activatesFactor: 1, blendWeightChange: 0, fixedOrder: 3 });
  // usage-25-on changes the SAME number of constants but activates a factor,
  // which is exactly why rule 2 exists and rule 3 never gets to speak.
  assert.equal(key('usage-25-on').blendWeightChange < key('usage-40-off').blendWeightChange, true,
    'rule 3 would have preferred usage-25-on, and rule 2 outranks it');
  assert.deepEqual(key('usage-60-on'),
    { changedConstants: 2, activatesFactor: 1, blendWeightChange: 0.35, fixedOrder: 6 });
});

// ---------------------------------------------------------------------------
// Section 6.1's two owed directives (recorded NOT MET at revision 24).
//
// The spec requires "a test must assert that the constant is referenced by the
// disclosure count and by nothing that returns a status", and a mutation test
// "that changing 0.30 alone changes no status". Both are operationalizations of
// the same NEGATIVE, which is why the value assertion at the top of this file
// did not satisfy them: it carries the message '0.30 remains disclosure-only'
// while checking only that the number is 0.3 - an assertion message stating a
// property the assertion does not check.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');

const ARMS_PATH = path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', 'arms.js');

test('section 6.1: FALSIFIABILITY_FLOOR is referenced by the disclosure count and by nothing that returns a status', () => {
  const source = fs.readFileSync(ARMS_PATH, 'utf8');
  const lines = source.split(/\r?\n/);
  const sites = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((entry) => /\bFALSIFIABILITY_FLOOR\b/.test(entry.line))
    // The docblock above the suppression discusses the constant by name in
    // prose; only code references are in scope for this negative.
    .filter((entry) => !/^\s*(\*|\/\/)/.test(entry.line));

  assert.equal(sites.length, 3,
    `expected exactly three code references, got ${sites.length}: ${sites.map((s) => s.number).join(', ')}`);

  const [definition, disclosure, exported] = sites;
  assert.match(definition.line, /^const FALSIFIABILITY_FLOOR = \(DELTA_F - 0\.01\) \/ MAX_EFFECT;/,
    'the first reference must be the definition, retained solely as the per-week disclosure constant');
  // The comparison is roundToTie-normalized on BOTH operands (section 6.2's
  // component-(f) list, fourth row), so the pattern pins the SITE - a filtered
  // count - rather than the bare comparison form it used to have.
  assert.match(disclosure.line, /\.filter\(.*FALSIFIABILITY_FLOOR.*\)\.length/,
    'the second reference must be the disclosure COUNT and nothing else');
  assert.match(disclosure.line, /roundToTie\(Number\(b\)\) <= roundToTie\(FALSIFIABILITY_FLOOR\)/,
    'section 6.2 requires roundToTie on BOTH operands of this comparison');
  assert.match(exported.line, /^\s*FALSIFIABILITY_FLOOR,\s*$/,
    'the third reference must be the export list');

  // The disclosure site must feed a transparency field, never a status. Its
  // enclosing assignment is the count, so the constant cannot reach a verdict.
  assert.match(lines[disclosure.number - 2], /weeksBelowFalsifiabilityFloor/,
    'the disclosure reference must be the weeksBelowFalsifiabilityFloor field');

  // And it must not appear inside the evaluability guard, which section 6.1a
  // requires be written as the transformed-bound median comparison.
  const guardStart = lines.findIndex((line) => /medianWeeklyBound/.test(line));
  assert.ok(guardStart > 0, 'the transformed-bound median guard must exist');
  const guardEnd = guardStart + 30;
  for (const site of sites) {
    assert.ok(site.number < guardStart || site.number > guardEnd,
      `FALSIFIABILITY_FLOOR must not appear inside the evaluability guard (line ${site.number})`);
  }
});

test('section 6.1: MUTATION - changing 0.30 alone changes no status, only the disclosure count', (t) => {
  const source = fs.readFileSync(ARMS_PATH, 'utf8');
  const libDir = path.dirname(ARMS_PATH).split(path.sep).join('/');
  const mutated = source
    .replace(
      /^const FALSIFIABILITY_FLOOR = \(DELTA_F - 0\.01\) \/ MAX_EFFECT;.*$/m,
      'const FALSIFIABILITY_FLOOR = 99;'
    )
    .replace(/require\('\.\//g, `require('${libDir}/`);
  assert.ok(mutated.includes('FALSIFIABILITY_FLOOR = 99;'), 'the mutation must actually apply');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arms-mutation-'));
  const mutantPath = path.join(dir, 'arms.mutant.js');
  fs.writeFileSync(mutantPath, mutated);
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  const mutant = require(mutantPath);
  assert.equal(mutant.FALSIFIABILITY_FLOOR, 99, 'the mutant must carry the mutated constant');

  // A battery spanning every (f) outcome: healthy, below the row minimum, a
  // failing endpoint, and an unevaluable one.
  const nearFloor = { ...HEALTHY_F, weekDeltas: new Array(8).fill(-0.29), weekMeanAbsBaselines: new Array(8).fill(1.0) };
  const cases = [
    { label: 'healthy', input: { f1: HEALTHY_F, f2: HEALTHY_F, veto: HEALTHY_VETO } },
    { label: 'near the floor', input: { f1: nearFloor, f2: nearFloor, veto: HEALTHY_VETO } },
    { label: 'below row minimum', input: { f1: { ...HEALTHY_F, subgroupRows: 5 }, f2: HEALTHY_F, veto: HEALTHY_VETO } },
    { label: 'f2 harmful', input: { f1: HEALTHY_F, f2: { ...HEALTHY_F, weekDeltas: new Array(8).fill(0.5) }, veto: HEALTHY_VETO } },
  ];

  let disclosureDiffered = false;
  for (const { label, input } of cases) {
    const before = arms.componentF(input);
    const after = mutant.componentF(input);

    assert.equal(after.status, before.status, `${label}: status changed`);
    assert.equal(after.passes, before.passes, `${label}: passes changed`);
    assert.equal(after.claimVerdict, before.claimVerdict, `${label}: claimVerdict changed`);
    for (const key of Object.keys(before.endpoints || {})) {
      assert.equal(after.endpoints[key].passes, before.endpoints[key].passes, `${label}/${key}: endpoint passes changed`);
      assert.equal(after.endpoints[key].status, before.endpoints[key].status, `${label}/${key}: endpoint status changed`);
    }
    for (const [index, row] of (before.transparency || []).entries()) {
      if (after.transparency[index].weeksBelowFalsifiabilityFloor !== row.weeksBelowFalsifiabilityFloor) {
        disclosureDiffered = true;
      }
    }
  }

  // The mutation must be LIVE. If the constant reached nothing at all, this
  // test would pass vacuously and prove nothing about statuses.
  assert.ok(disclosureDiffered,
    'the mutation changed no disclosure count either, so this test proved nothing - the probe is broken, not the code');
});

test('section 8.2a rule 3: the pass test is STRICT on RAW operands, never tie-rounded', () => {
  // Rounding lower/upper/passing before the pass test unifies two conventions
  // rule 3 says "differ on purpose and must not be unified": a one-ulp bound
  // below a passing boundary passes strictly and fails once rounded, turning
  // `passed` into `threshold-not-established` -> component `failed` -> cell
  // `fail`. The pre-fix suite used only coarse values and did not reach it.
  const cases = [
    { label: 'favorable-negative, one ulp inside', input: { lower: -0.35, upper: -0.15000000005, passingBoundary: -0.15, harmfulBoundary: 0.15, favorableBoundary: -0.15, direction: 'below', evaluable: true } },
    { label: 'favorable-negative, e1-regret', input: { lower: 0.05, upper: 0.14999999999, passingBoundary: 0.15, harmfulBoundary: 0.15, favorableBoundary: -0.15, direction: 'below', evaluable: true } },
    { label: 'favorable-positive, a-pairwise', input: { lower: 0.00500000001, upper: 0.9, passingBoundary: 0.005, harmfulBoundary: -0.005, favorableBoundary: 0.005, direction: 'above', evaluable: true } },
  ];
  for (const { label, input } of cases) {
    const result = arms.classifyBootstrapEndpoint(input);
    assert.equal(result.status, 'passed', `${label}: must pass on the raw strict comparison`);
    assert.equal(result.passes, true, label);
  }

  // The straddle test, by contrast, IS inclusive and tie-rounded: an endpoint
  // landing one ulp outside both boundaries still spans them.
  const straddle = arms.classifyBootstrapEndpoint({
    lower: -0.15000000001, upper: 0.15000000001, passingBoundary: -0.15, harmfulBoundary: 0.15, favorableBoundary: -0.15, direction: 'below', evaluable: true,
  });
  assert.equal(straddle.status, 'wide-straddle', 'the straddle test keeps the rounded operands');
});
