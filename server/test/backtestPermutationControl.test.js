const test = require('node:test');
const assert = require('node:assert/strict');

const metrics = require('../../scripts/backtest/lib/metrics');
const permutationControl = require('../../scripts/backtest/lib/permutationControl');


const { optimalAssignment } = require('../../server/services/lineupOptimizer');
const { availabilityFor } = require('../../server/services/projectionModel');
const { DEFAULT_ROSTER_SLOTS } = require('../../server/services/lineup.service');
const { ORDERINGS } = require('../../scripts/backtest/lib/ordering');

// Section 5's T_regret is mean DEPLOYED-POLICY regret over the week's rosters,
// so the control needs the same roster/cohort artifacts and lineup machinery the
// control cell evaluator uses. The runner injects the functions; the --inputs
// document carries the data.
function policyInputs(playerIds) {
  const ids = playerIds || [1, 2];
  const byWeek = (build) => Object.fromEntries(metrics.EVALUATED_WEEKS.map((week) => [week, build(week)]));
  return {
    rosterWeeks: byWeek(() => ({
      rosters: [{
        replicate: 1,
        teamIndex: 0,
        starters: [],
        bench: metrics.MACRO_POSITIONS.flatMap((position) => ids.map((id) => ({ playerId: playerKey(position, id) }))),
      }],
    })),
    cohortWeeks: byWeek(() => ({
      members: metrics.MACRO_POSITIONS.flatMap((position) => ids.map((id) => ({
        playerId: playerKey(position, id), position, teamKey: `T${playerKey(position, id)}`, injuryStatus: null, onBye: false,
      }))),
    })),
    positionRank: new Map(metrics.MACRO_POSITIONS.map((position, i) => [position, i + 1])),
    nameRankById: new Map(metrics.MACRO_POSITIONS.flatMap((position) => ids.map((id) => [playerKey(position, id), playerKey(position, id)]))),
    rosterSlots: DEFAULT_ROSTER_SLOTS,
    availabilityFor,
    optimize: optimalAssignment,
    // Injected machinery, like the optimizer: the module fails closed on a
    // missing ordering rather than riding policy.js's default (round 3).
    ordering: ORDERINGS.PRIMARY,
    // Section 5 pins the denominator at 50 rosters (10 teams x 5 replicates),
    // which is 204M lineup solves - a production run, not a unit test. The
    // count is INJECTED, so tests exercise the derivation at 1 roster; the
    // runner-default test in backtestRunBacktestSweep.test.js proves main()
    // injects the pinned 50, and the rejection test below proves a count the
    // artifacts contradict fails closed.
    expectedRosterCount: 1,
  };
}

/** Player ids must be unique ACROSS positions once rosters exist. */
function playerKey(position, id) { return metrics.MACRO_POSITIONS.indexOf(position) * 100 + id; }

function rawControl({ fail = false } = {}) {
  const rosterRows = metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.flatMap((position) => [
    { season: 2025, week, position, playerId: playerKey(position, 1) },
    { season: 2025, week, position, playerId: playerKey(position, 2) },
  ]));
  const observations = metrics.SALTS.flatMap((salt) => metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.flatMap((position) => [
    { season: 2025, week, salt, position, playerId: playerKey(position, 1), actual: fail ? 0 : 1, projected: 1 },
    { season: 2025, week, salt, position, playerId: playerKey(position, 2), actual: fail ? 1 : 0, projected: 0 },
  ])));
  return { observations, rosterRows };
}

test('permutation control derives both published endpoints from one sealed 10,000-replicate raw stream', () => {
  const result = metrics.computePermutationControl({ ...rawControl(), ...policyInputs() });
  assert.deepEqual(
    { seed: result.seed, replicates: result.replicates, regret: result.regret.observed, pairwise: result.pairwise.observed },
    { seed: 940227589, replicates: 10000, regret: 0, pairwise: 1 }
  );
  assert.equal(result.regret.p, 1 / 10001);
  assert.equal(result.pairwise.p, 1 / 10001);
  assert.equal(result.void, false);
  assert.equal(result.regret.draws, 10000);
  assert.equal(result.pairwise.draws, 10000);
});

test('section 5: T_regret is DEPLOYED-POLICY regret - a level-biased but correctly-ORDERED projection has zero regret and a live permutation leg', () => {
  // NEW-A (round 2): every prior PASSING fixture set projected === actual,
  // where deployed-policy regret and the pre-0d6a753 statistic (mean
  // per-player |projected - actual|) are BOTH exactly 0 - and the fail:true
  // variants are equally blind (both statistics land at T = -1, p = 1) - so
  // reverting the scorer left the whole suite's results identical. This
  // fixture separates them: a uniform +100 level bias with the within-cell
  // ORDER preserved (the worked diverging input from
  // MEMO-blocker3-permutation-regret.md section 1).
  //   deployed-policy regret: ordered projections still start the best lineup,
  //     so T_obs = 0; a permuted cell starts the wrong player and degrades T
  //     -> p = 1/10001, run live. (The decisive cells are the SINGLE-slot
  //     positions - QB, K, DEF; RB/WR/TE swaps are absorbed by the two-slot +
  //     FLEX geometry. The seeded p is exact either way: no replicate leaves
  //     all 51 decisive cells unpermuted.)
  //   per-player error: |(a+100) - a| = 100 for every row, and a swap scores
  //     (100+d) + (100-d) over the pair - permutation-INVARIANT. T_obs = -100,
  //     every replicate ties, p = 1, and the regret leg VOIDS the run.
  // (A probe with projected = 0 for every player was rejected: uniform
  //  projections are order-DEGENERATE, so the started lineup is decided by rank
  //  tie-breaks rather than by the statistic under test.)
  // Negative control: revert scoreWeek's regret leg to per-player error - this
  // test fails on observed, p, AND void while the rest of the file passes.
  const rosterRows = metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.flatMap((position) => [
    { season: 2025, week, position, playerId: playerKey(position, 1) },
    { season: 2025, week, position, playerId: playerKey(position, 2) },
  ]));
  const observations = metrics.SALTS.flatMap((salt) => metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.flatMap((position) => [
    { season: 2025, week, salt, position, playerId: playerKey(position, 1), actual: 10, projected: 110 },
    { season: 2025, week, salt, position, playerId: playerKey(position, 2), actual: 20, projected: 120 },
  ])));
  const result = metrics.computePermutationControl({ observations, rosterRows, ...policyInputs() });
  assert.equal(result.regret.observed, 0, 'ordered projections start the best lineup: regret 0. Per-player error gives -100');
  assert.equal(result.regret.p, 1 / 10001, 'the permutation must DEGRADE the statistic. Per-player error is invariant: p = 1');
  assert.equal(result.void, false, 'under per-player error the regret leg voids the run');
  assert.equal(result.pairwise.observed, 1, 'liveness: the level bias leaves the pairwise leg untouched');
});

test('permutation raw domains reject missing, extra, duplicate, and reordered coordinates before reduction', () => {
  const valid = rawControl();
  assert.doesNotThrow(() => permutationControl.canonicalObservations(valid.observations, valid.rosterRows));

  const missingSalt = rawControl();
  missingSalt.observations = missingSalt.observations.filter((row) => row.salt !== metrics.SALTS[0]);
  assert.throws(() => permutationControl.canonicalObservations(missingSalt.observations, missingSalt.rosterRows), /missing salt\/cell/);

  const missingRosterWeek = rawControl();
  missingRosterWeek.rosterRows = missingRosterWeek.rosterRows.filter((row) => row.week !== 2);
  assert.throws(() => permutationControl.canonicalObservations(missingRosterWeek.observations, missingRosterWeek.rosterRows), /missing roster cell/);

  const missingPosition = rawControl();
  missingPosition.rosterRows = missingPosition.rosterRows.filter((row) => !(row.week === 2 && row.position === 'QB'));
  assert.throws(() => permutationControl.canonicalObservations(missingPosition.observations, missingPosition.rosterRows), /missing roster cell/);

  const missingPlayer = rawControl();
  missingPlayer.observations = missingPlayer.observations.filter((row) => !(row.salt === metrics.SALTS[0] && row.week === 2 && row.position === 'QB' && row.playerId === playerKey('QB', 2)));
  assert.throws(() => permutationControl.canonicalObservations(missingPlayer.observations, missingPlayer.rosterRows), /salt player domain differs/);

  const extraPlayer = rawControl();
  extraPlayer.observations.push({ season: 2025, week: 18, salt: metrics.SALTS.at(-1), position: 'DEF', playerId: playerKey('DEF', 3), actual: 0, projected: 0 });
  assert.throws(() => permutationControl.canonicalObservations(extraPlayer.observations, extraPlayer.rosterRows), /salt player domain differs/);

  const duplicate = rawControl();
  duplicate.observations.splice(1, 0, { ...duplicate.observations[0] });
  assert.throws(() => permutationControl.canonicalObservations(duplicate.observations, duplicate.rosterRows), /canonical salt\/week\/position\/player order/);

  const reordered = rawControl();
  [reordered.observations[0], reordered.observations[1]] = [reordered.observations[1], reordered.observations[0]];
  assert.throws(() => permutationControl.canonicalObservations(reordered.observations, reordered.rosterRows), /canonical salt\/week\/position\/player order/);
});

test('the production permutation path uses section 5.1 per-(replicate, cellKey) SHA-256 seeding, not a shared stream', () => {
  const control = rawControl();
  const { cells } = permutationControl.canonicalObservations(control.observations, control.rosterRows);
  const built = metrics.buildPermutations({ cells });

  // Step 2: the seed is SHA-256 of `PERMUTATION_SEED|replicate|cellKey`, so the
  // production orders must equal the pinned derivation cell by cell.
  const orders = built.replicate(0);
  for (const cellKey of ['2025:2:QB', '2025:2:RB', '2025:9:WR', '2025:18:DEF']) {
    assert.deepEqual(orders[cellKey], built.permutationFor(0, cellKey));
  }

  // Required test (ii): replicate 9,999 is obtainable without generating 0-9,998.
  assert.ok(Array.isArray(built.permutationFor(9999, '2025:2:QB')));

  // Required test (iv): a one-character change to cellKey yields a different seed.
  assert.notEqual(built.seedFor(0, '2025:2:QB'), built.seedFor(0, '2025:3:QB'));

  // Required test (iii): a differently-ORDERED roster input yields the SAME
  // permutation, because step 4 sorts rather than rejects.
  const shuffled = rawControl();
  shuffled.rosterRows = [...shuffled.rosterRows].reverse();
  const { cells: reorderedCells } = permutationControl.canonicalObservations(shuffled.observations, shuffled.rosterRows);
  assert.deepEqual(reorderedCells, cells);
  assert.deepEqual(metrics.buildPermutations({ cells: reorderedCells }).replicate(0), orders);
});

// ---------------------------------------------------------------------------
// Regression coverage for the section 5.1 wiring itself.
//
// The fix that routed production through `buildPermutations` was initially
// shipped with a test that never called the production function and whose first
// assertion was a tautology (`replicate(index)` is DEFINED as that map). With
// that test green, reverting the production line to a shared RNG stream still
// passed the entire suite - the same "conformant twin next to the code that
// actually runs" defect the fix existed to remove, one level up.
//
// These pin the SEAM: that production calls section 5.1's derivation, and that
// the sort is numeric.
// ---------------------------------------------------------------------------

test('the production permutation path actually calls section 5.1 derivation, not any other source of orders', () => {
  // The module memoizes on JSON.stringify({observations, rosterRows}) and the
  // label is NOT part of that key, so this fixture must differ in the observed
  // values or the spy sees a cache hit and zero calls - which is exactly what
  // happened on the first attempt at this test.
  const control = rawControl();
  control.observations = control.observations.map((row) => ({ ...row, actual: row.actual + 0.5 }));
  const realBuild = metrics.buildPermutations;
  const calls = [];
  try {
    metrics.buildPermutations = (args) => {
      calls.push(args);
      return realBuild(args);
    };
    permutationControl.computePermutationControlFromObservations({
      observations: control.observations,
      rosterRows: control.rosterRows,
      ...policyInputs(),
    });
  } finally {
    metrics.buildPermutations = realBuild;
  }
  assert.equal(calls.length, 1, 'production must derive its orders from buildPermutations exactly once');
  assert.ok(calls[0].cells && typeof calls[0].cells === 'object', 'it must be given the canonical cells');
  // A shared-stream implementation would never reach this call at all.
  assert.deepEqual(
    Object.keys(calls[0].cells).sort(),
    metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.map((p) => `2025:${week}:${p}`)).sort()
  );
});

test('the result cache MISSES on a changed Map-valued rank input and HITS on an identical repeat (NEW-C)', () => {
  // NEW-C (round 2): the key omitted positionRank/nameRankById/rosterSlots/
  // ordering - inputs that change the lineup, and with it the result. Worse,
  // JSON.stringify(new Map()) === '{}', so even once keyed, a Map-valued rank
  // contributed NOTHING until canonicalized to its entry array.
  //
  // COVERAGE LIMIT, stated: this pins nameRankById - the input whose Map hole
  // was the found failure mode - and the repeat-call hit. positionRank,
  // rosterSlots and ordering are in the key but have no per-input variation
  // test, because each variation costs a full 10,000-replicate computation.
  //
  // ORDER COUPLING, on purpose and SELF-CHECKED below: this test reuses the
  // seam-spy test's observation stream (actual + 0.5), whose result that test
  // - which runs just above - has already cached. A key that drops the Maps
  // COLLIDES with that entry: the divergent call would stale-hit and the spy
  // would see zero buildPermutations calls.
  // Negative control: drop canonicalRankMap from the cache key - the
  // divergent-call assertion fails on a stale hit.
  const control = rawControl();
  control.observations = control.observations.map((row) => ({ ...row, actual: row.actual + 0.5 }));
  const inputs = policyInputs();
  // Same players, reversed tie-break ranking - a result-changing input.
  const reversedNameRank = new Map([...inputs.nameRankById.entries()].map(([id]) => [id, -id]));
  const realBuild = metrics.buildPermutations;
  const calls = [];
  try {
    metrics.buildPermutations = (args) => { calls.push(args); return realBuild(args); };
    // PREMISE, self-checked: the spy test's identical call must still be
    // cached, or the stale-hit discrimination below proves nothing. If this
    // assertion fails, the file was reordered (or the pre-seeding fixture
    // changed) and this test has silently lost its discriminating power -
    // which also means it fails loudly under --test-name-pattern isolation,
    // by design.
    permutationControl.computePermutationControlFromObservations({
      observations: control.observations, rosterRows: control.rosterRows, ...inputs,
    });
    assert.equal(calls.length, 0, 'PREMISE: the seam-spy test must have cached this exact call already');
    permutationControl.computePermutationControlFromObservations({
      observations: control.observations, rosterRows: control.rosterRows,
      ...inputs, nameRankById: reversedNameRank,
    });
    assert.equal(calls.length, 1, 'a changed Map-valued rank input must MISS the cache and recompute');
    permutationControl.computePermutationControlFromObservations({
      observations: control.observations, rosterRows: control.rosterRows,
      ...inputs, nameRankById: reversedNameRank,
    });
    assert.equal(calls.length, 1, 'an identical repeat call must HIT the cache');
  } finally {
    metrics.buildPermutations = realBuild;
  }
});

test('the pinned roster count fails closed: missing and contradicted injections are rejected before any replicate runs (NEW-B)', () => {
  // Both rejections throw in assertPolicyArtifactDomain - before the policy
  // context is built or a single replicate runs - and a rejection is never
  // cached, so it cannot mask or be masked by another call. The fail:true
  // stream keeps both keys novel in this file.
  const missing = { ...rawControl({ fail: true }), ...policyInputs() };
  delete missing.expectedRosterCount;
  assert.throws(
    () => permutationControl.computePermutationControlFromObservations(missing),
    /the pinned roster count must be injected/
  );
  assert.throws(
    () => permutationControl.computePermutationControlFromObservations({
      ...rawControl({ fail: true }), ...policyInputs(), expectedRosterCount: 3,
    }),
    /carries 1 rosters, not the 3 /
  );
});

test('prereg 6.2: a dropped pairwise week is EXCLUDED from the mean, never scored 0 (round-3 MINOR 5)', () => {
  // weekPairwise returns score null for a week where more than one position
  // has no eligible pair; the salt mean previously coerced that null to 0
  // ("sum + null === sum"), scoring the dropped week as the minimum possible
  // accuracy - a measured zero standing in for missing evidence. Week 2's QB
  // and RB actuals TIE here, so week 2 drops under every salt and every
  // replicate (eligibility is a function of the actuals alone, identical
  // across salts), and the observed pairwise must be the mean of the 16
  // SURVIVING weeks - exactly 1. p_hat was invariant to the old bug because
  // both T_obs and every T_b shared it; the discriminator is the published
  // statistic itself.
  // Negative control: restore the coercing reduce in either aggregation site
  // - this fails with 16/17 (observed) or a shifted p (one-sided change).
  const rosterRows = metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.flatMap((position) => [
    { season: 2025, week, position, playerId: playerKey(position, 1) },
    { season: 2025, week, position, playerId: playerKey(position, 2) },
  ]));
  const tied = (week, position) => week === 2 && (position === 'QB' || position === 'RB');
  const observations = metrics.SALTS.flatMap((salt) => metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.flatMap((position) => [
    { season: 2025, week, salt, position, playerId: playerKey(position, 1), actual: tied(week, position) ? 15 : 10, projected: 110 },
    { season: 2025, week, salt, position, playerId: playerKey(position, 2), actual: tied(week, position) ? 15 : 20, projected: 120 },
  ])));
  const result = metrics.computePermutationControl({ observations, rosterRows, ...policyInputs() });
  assert.equal(result.pairwise.observed, 1, 'the mean over the 16 SURVIVING weeks; the coercing mean gave 16/17');
  assert.equal(result.regret.observed, 0, 'tied actuals make week 2 regret-neutral; the other 16 weeks stay ordered');
  assert.equal(result.void, false);

  // Drop WITNESS, unit-level: with every surviving week scoring exactly 1,
  // the end-to-end mean cannot distinguish "week 2 excluded" from "week 2
  // included at a perfect score" - so the drop itself is pinned directly.
  // Removing prereg 6.2's drop rule from weekPairwise fails here, not above.
  const tiedWeekRows = Object.fromEntries(metrics.MACRO_POSITIONS.map((position) => [position,
    ['QB', 'RB'].includes(position)
      ? [{ actual: 15, projected: 110 }, { actual: 15, projected: 120 }]
      : [{ actual: 10, projected: 110 }, { actual: 20, projected: 120 }],
  ]));
  const witness = metrics.weekPairwise(tiedWeekRows, { label: 'drop witness' });
  assert.equal(witness.weekDropped, true, 'two of six positions have no eligible pair, so the WEEK drops (prereg 6.2)');
  assert.equal(witness.score, null);
});

test('cross-salt actual inconsistency fails closed - the pairwise drop convention rests on it (round-3 MINOR 5)', () => {
  // actualsByWeek was last-wins: the same (week, player) carrying different
  // actuals under two salts silently kept whichever salt sorted last, and the
  // permutation-invariance of prereg 6.2's drop (identical week set in T_obs
  // and every T_b) rests on cross-salt consistency. Now it is asserted.
  const control = rawControl();
  const target = control.observations.findIndex((row) => row.salt === metrics.SALTS[1]
    && row.week === 2 && row.position === 'QB' && row.playerId === playerKey('QB', 1));
  control.observations[target] = { ...control.observations[target], actual: 99 };
  assert.throws(
    () => permutationControl.computePermutationControlFromObservations({ ...control, ...policyInputs() }),
    /under one salt and .* under another/
  );
});

test('a missing lineup ordering is rejected fail-closed, never defaulted three modules away (round-3 SUBSTANTIVE 4)', () => {
  // metrics' key list admits `ordering` as injected machinery, but nothing
  // injected it: production reached the right value only through policy.js's
  // own destructuring default, one key-list edit from operator-supplied. The
  // runner now injects ORDERINGS.PRIMARY explicitly and this module refuses
  // undefined, mirroring the optimize/availabilityFor guard.
  const inputs = { ...rawControl(), ...policyInputs() };
  delete inputs.ordering;
  assert.throws(
    () => permutationControl.computePermutationControlFromObservations(inputs),
    /the lineup ordering must be injected explicitly/
  );
});

test('section 5.1 step 4 sorts playerIds NUMERICALLY, not lexicographically', () => {
  // "10" < "9" as strings would reorder the cell, and the fixture's 1/2 ids
  // cannot tell the two sorts apart.
  const ids = [1, 9, 10];
  const rosterRows = metrics.EVALUATED_WEEKS.flatMap((week) => metrics.MACRO_POSITIONS.flatMap(
    (position) => ids.map((playerId) => ({ season: 2025, week, position, playerId }))
  ));
  const cells = permutationControl.canonicalRosterRows([...rosterRows].reverse(), 'numeric sort probe');
  assert.deepEqual(cells['2025:2:QB'], [1, 9, 10], 'a lexicographic sort would give [1, 10, 9]');
});
