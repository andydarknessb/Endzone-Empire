const test = require('node:test');
const assert = require('node:assert/strict');

const armWeekEvaluator = require('../../scripts/backtest/lib/armWeekEvaluator');
const controlCellEvaluator = require('../../scripts/backtest/lib/controlCellEvaluator');
const inputsAssembly = require('../../scripts/backtest/lib/inputsAssembly');
const sweepEvidence = require('../../scripts/backtest/lib/sweepEvidence');
const metrics = require('../../scripts/backtest/lib/metrics');
const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');

// The REAL production wrapper pieces, exactly as the control evaluator's own
// test injects them: the deployed-policy estimand runs production's
// availability rule and optimizer, never a stand-in.
const { availabilityFor } = require('../services/projectionModel');
const { optimalAssignment } = require('../services/lineupOptimizer');

// ---------------------------------------------------------------------------
// Fixtures - the control evaluator test's builders, replicated (that file
// exports nothing), plus projections with real interval fields.
// ---------------------------------------------------------------------------

/**
 * `deepBench` adds a second K and DEF: the control-evaluator test's original
 * shape has ONE member in each, which gives those positions zero eligible
 * pairs and silently made `values.pairwise` null in EVERY test (QA on this
 * increment: hardcoding `pairwise: null` passed the whole suite). The deep
 * shape makes all six positions pair-eligible, so the numeric pairwise path
 * is actually exercised.
 */
function makeRoster({ season, week, replicate = 0, teamIndex = 0, deepBench = false }) {
  const starters = [];
  const bench = [];
  let id = 1;
  const add = (position, starterSlots, benchCount) => {
    for (const slot of starterSlots) {
      starters.push({ slot, playerId: id, teamKey: `T${id}`, position, isDefense: position === 'DEF' });
      id++;
    }
    for (let i = 0; i < benchCount; i++) {
      bench.push({ playerId: id, teamKey: `T${id}`, position, isDefense: position === 'DEF' });
      id++;
    }
  };
  add('QB', ['QB'], 1);
  add('RB', ['RB', 'RB'], 3);
  add('WR', ['WR', 'WR'], 3);
  add('TE', ['TE'], 1);
  add('K', ['K'], deepBench ? 1 : 0);
  add('DEF', ['DEF'], deepBench ? 1 : 0);
  const players = [...starters, ...bench].map((p) => ({ ...p }));
  return {
    season, week, replicate, teamIndex, draftSlot: teamIndex, players, starters, bench,
  };
}

function makeRosterWeek({ season, week, deepBench = false }) {
  const roster = makeRoster({ season, week, deepBench });
  return { season, week, poolSize: roster.players.length, rosters: [roster] };
}

function makeCohortWeek({ season, week, rosterWeek, actualFor = (id) => id }) {
  const roster = rosterWeek.rosters[0];
  const members = [...roster.starters, ...roster.bench].map((p) => ({
    season,
    week,
    gsisId: p.isDefense ? null : `gsis-${p.playerId}`,
    playerId: p.playerId,
    position: p.position,
    team: p.teamKey,
    teamKey: p.teamKey,
    injuryStatus: null,
    onBye: false,
    isDefense: p.isDefense,
    contradiction: null,
  }));
  const actualPointsByPlayerId = new Map(members.map((m) => [m.playerId, actualFor(m.playerId)]));
  return {
    season, week, members, actualPointsByPlayerId,
  };
}

function makeRanks(rosterWeek) {
  const roster = rosterWeek.rosters[0];
  const positionRank = new Map([['QB', 1], ['RB', 2], ['WR', 3], ['TE', 4], ['K', 5], ['DEF', 6]]);
  const nameRankById = new Map(roster.players.map((p) => [p.playerId, p.playerId]));
  return { positionRank, nameRankById };
}

/** Full projections with interval fields: median varies non-monotonically with id so pairwise is non-trivial. */
function makeProjections(cohortWeek, { intervals = true } = {}) {
  return new Map(cohortWeek.members.map((m) => {
    const median = m.playerId + ((m.playerId % 3) - 1) * 0.75;
    return [m.playerId, {
      playerId: m.playerId,
      median,
      p10: intervals ? median - 2 : null,
      p25: intervals ? median - 1 : null,
      p75: intervals ? median + 1 : null,
      p90: intervals ? median + 2 : null,
      factors: {},
    }];
  }));
}

function weekInputs({ season = 2025, week = 5, intervals = true, actualFor, deepBench = false } = {}) {
  const rosterWeek = makeRosterWeek({ season, week, deepBench });
  const cohortWeek = makeCohortWeek({ season, week, rosterWeek, actualFor });
  const { positionRank, nameRankById } = makeRanks(rosterWeek);
  return {
    season,
    week,
    rosterWeek,
    cohortWeek,
    projectionsByPlayerId: makeProjections(cohortWeek, { intervals }),
    positionRank,
    nameRankById,
    availabilityFor,
    optimize: optimalAssignment,
  };
}

// ---------------------------------------------------------------------------
// Equivalence with the approved control path
// ---------------------------------------------------------------------------

test('regret and pairwise are BIT-IDENTICAL to evaluateControlWeek on identical inputs', () => {
  // deepBench: pairwise is FINITE here, so this compares two real numbers,
  // never null === null.
  const inputs = weekInputs({ deepBench: true });
  // The SAME label on both sides: the collapsers embed their label in the
  // detail objects, and the point of this test is that everything ELSE is
  // the identical computation.
  const generalized = armWeekEvaluator.evaluateArmWeek({ ...inputs, label: 'control evaluator' });
  const control = controlCellEvaluator.evaluateControlWeek({ ...inputs, label: 'control evaluator' });
  assert.equal(generalized.values.regret, control.regret);
  assert.equal(generalized.values.pairwise, control.pairwise);
  assert.ok(Number.isFinite(generalized.values.pairwise), 'the comparison must be over a real pairwise score');
  assert.equal(
    canonicalJson(generalized.detail.pairwise),
    canonicalJson(control.pairwiseDetail),
    'the pairwise detail must be the identical computation, not a parallel one'
  );
  assert.equal(
    canonicalJson(generalized.detail.perRosterDetail),
    canonicalJson(control.perRosterDetail),
    'the per-roster regret path must be the identical computation'
  );
});

test('VALUE_KEYS is the assembly layer\'s own frozen key array, aliased not copied', () => {
  assert.equal(armWeekEvaluator.VALUE_KEYS, sweepEvidence.METRIC_KEYS);
});

// ---------------------------------------------------------------------------
// The five added endpoints
// ---------------------------------------------------------------------------

test('mae/rmse/rho match an independent computation over the same membership, bit-exactly', () => {
  const inputs = weekInputs();
  const result = armWeekEvaluator.evaluateArmWeek(inputs);
  // Independent recomputation in MACRO_POSITIONS-then-cohort order - the
  // pinned iteration order - from the raw fixture values.
  const rows = [];
  for (const position of metrics.MACRO_POSITIONS) {
    for (const member of inputs.cohortWeek.members) {
      if (member.position !== position) continue;
      rows.push({
        projected: inputs.projectionsByPlayerId.get(member.playerId).median,
        actual: inputs.cohortWeek.actualPointsByPlayerId.get(member.playerId),
      });
    }
  }
  let absSum = 0;
  let sqSum = 0;
  for (const row of rows) {
    const e = row.projected - row.actual;
    absSum += Math.abs(e);
    sqSum += e * e;
  }
  assert.equal(result.values.mae, absSum / rows.length);
  assert.equal(result.values.rmse, Math.sqrt(sqSum / rows.length));
  assert.equal(typeof result.values.rho, 'number');
  assert.equal(result.detail.points.n, rows.length);
  assert.equal(result.values.rho, result.detail.points.spearman, 'rho is spearman renamed at the boundary');
});

test('coverage and WIS match hand computation when intervals are present', () => {
  const inputs = weekInputs();
  const result = armWeekEvaluator.evaluateArmWeek(inputs);
  // Coverage by hand: actual = id, band = [median-2, median+2], median =
  // id + ((id%3)-1)*0.75, so |actual - median| = 0.75 or 0 - every row is
  // covered.
  assert.equal(result.values.coverage, 1);
  assert.equal(result.detail.coverage.scored, inputs.cohortWeek.members.length);
  // WIS by hand for one row shape: intervals (0.5: +-1, 0.2: +-2) with the
  // actual INSIDE both bands, so IS = width only; per-row WIS =
  // (0.5*|y-m| + 0.25*2 + 0.1*4) / 2.5.
  const perRow = inputs.cohortWeek.members.map((m) => {
    const median = m.playerId + ((m.playerId % 3) - 1) * 0.75;
    return (0.5 * Math.abs(m.playerId - median) + 0.25 * 2 + 0.1 * 4) / 2.5;
  });
  assert.equal(result.values.wis, perRow.reduce((a, b) => a + b, 0) / perRow.length);
});

test('an interval-free (benchmark-shaped) arm scores null coverage and WIS with published exclusion counts', () => {
  const inputs = weekInputs({ intervals: false });
  const result = armWeekEvaluator.evaluateArmWeek(inputs);
  assert.equal(result.values.coverage, null);
  assert.equal(result.values.wis, null);
  assert.equal(result.detail.coverage.excludedNullInterval, inputs.cohortWeek.members.length);
  assert.equal(result.detail.wis.excludedNullInterval, inputs.cohortWeek.members.length);
  // The point metrics still score: a benchmark has a median even with no band.
  assert.equal(typeof result.values.mae, 'number');
});

test('bare-number projections score point metrics but not intervals', () => {
  const inputs = weekInputs();
  inputs.projectionsByPlayerId = new Map(
    [...inputs.projectionsByPlayerId].map(([id, projection]) => [id, projection.median])
  );
  const result = armWeekEvaluator.evaluateArmWeek(inputs);
  assert.equal(typeof result.values.mae, 'number');
  assert.equal(result.values.coverage, null);
  assert.equal(result.values.wis, null);
});

test('onBye members are excluded from every endpoint, bit-identically to their absence', () => {
  const withBye = weekInputs();
  // A 17th member, on bye, with values that WOULD move every metric if read.
  withBye.cohortWeek.members.push({
    season: 2025, week: 5, gsisId: 'gsis-99', playerId: 99, position: 'QB', team: 'T99', teamKey: 'T99',
    injuryStatus: null, onBye: true, isDefense: false, contradiction: null,
  });
  withBye.cohortWeek.actualPointsByPlayerId.set(99, 1000);
  withBye.projectionsByPlayerId.set(99, { playerId: 99, median: -1000, p10: -2000, p25: -1500, p75: -500, p90: 0, factors: {} });
  const result = armWeekEvaluator.evaluateArmWeek(withBye);
  const baseline = armWeekEvaluator.evaluateArmWeek(weekInputs());
  assert.equal(canonicalJson(result.values), canonicalJson(baseline.values));
});

test('the numeric pairwise path scores the macro-average over all six positions', () => {
  const inputs = weekInputs({ deepBench: true });
  const result = armWeekEvaluator.evaluateArmWeek(inputs);
  assert.ok(Number.isFinite(result.values.pairwise));
  assert.deepEqual(result.detail.pairwise.droppedPositions, []);
  // Independent recomputation: equally-weighted mean of the six per-position
  // scores the detail itself carries.
  const perPosition = metrics.MACRO_POSITIONS.map((position) => result.detail.pairwise.perPosition[position].score);
  assert.equal(result.values.pairwise, perPosition.reduce((a, b) => a + b, 0) / perPosition.length);
});

test('equal actuals remove pairs: a single dropped position still scores the week, reported', () => {
  // Equalize the two K members' actuals - their only pair loses its
  // denominator (prereg 6.2's equal-actuals rule), K drops, and the week
  // survives on the five remaining positions.
  const inputs = weekInputs({ deepBench: true });
  const kMembers = inputs.cohortWeek.members.filter((m) => m.position === 'K');
  assert.equal(kMembers.length, 2);
  for (const member of kMembers) inputs.cohortWeek.actualPointsByPlayerId.set(member.playerId, 7);
  const result = armWeekEvaluator.evaluateArmWeek(inputs);
  assert.deepEqual(result.detail.pairwise.droppedPositions, ['K']);
  assert.equal(result.detail.pairwise.weekDropped, false);
  assert.ok(Number.isFinite(result.values.pairwise), 'one dropped position must not drop the week');
});

test('a >1-position pairwise drop yields pairwise null while the other endpoints still score', () => {
  // The original (shallow) roster shape: K and DEF have one member each, so
  // both have zero eligible pairs - exactly the two-position drop that
  // nulls the week (prereg 6.2).
  const inputs = weekInputs();
  const result = armWeekEvaluator.evaluateArmWeek(inputs);
  assert.equal(result.values.pairwise, null, 'K and DEF have one member each - two dropped positions drop the week');
  assert.equal(result.detail.pairwise.weekDropped, true);
  assert.equal(typeof result.values.regret, 'number');
  assert.equal(typeof result.values.mae, 'number');
});

test('an absent projections argument throws; a string-keyed map throws by key', () => {
  const missing = weekInputs();
  delete missing.projectionsByPlayerId;
  assert.throws(() => armWeekEvaluator.evaluateArmWeek(missing), /projectionsByPlayerId is required/);

  const stringKeyed = weekInputs();
  stringKeyed.projectionsByPlayerId = new Map(
    [...stringKeyed.projectionsByPlayerId].map(([id, projection]) => [String(id), projection])
  );
  assert.throws(() => armWeekEvaluator.evaluateArmWeek(stringKeyed), /non-numeric key "1"/);

  const stringKeyedActuals = weekInputs();
  stringKeyedActuals.cohortWeek.actualPointsByPlayerId = new Map(
    [...stringKeyedActuals.cohortWeek.actualPointsByPlayerId].map(([id, value]) => [String(id), value])
  );
  assert.throws(() => armWeekEvaluator.evaluateArmWeek(stringKeyedActuals), /actualPointsByPlayerId carries a non-numeric key/);
});

test('an empty roster artifact throws rather than scoring regret null (documented asymmetry)', () => {
  const inputs = weekInputs();
  inputs.rosterWeek = { ...inputs.rosterWeek, rosters: [] };
  assert.throws(() => armWeekEvaluator.evaluateArmWeek(inputs), /no roster-weeks has no regret score/);
});

test('a zero-median bare-number projection keeps its median', () => {
  const inputs = weekInputs();
  inputs.projectionsByPlayerId = new Map(
    [...inputs.projectionsByPlayerId].map(([id, projection]) => [id, id === 1 ? 0 : projection.median])
  );
  const result = armWeekEvaluator.evaluateArmWeek(inputs);
  // Player 1's zero median is a VALUE, not an absence: it scores in the
  // point metrics (n stays the full cohort).
  assert.equal(result.detail.points.n, inputs.cohortWeek.members.length);
  assert.equal(result.detail.points.excludedNullProjection, 0);
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

test('artifact week/season mismatches, missing injections, and quarantined seasons throw by name', () => {
  const mismatch = weekInputs();
  mismatch.rosterWeek = makeRosterWeek({ season: 2025, week: 6 });
  assert.throws(() => armWeekEvaluator.evaluateArmWeek(mismatch), /rosterWeek is for 2025w6/);

  const noOptimize = weekInputs();
  delete noOptimize.optimize;
  assert.throws(() => armWeekEvaluator.evaluateArmWeek(noOptimize), /optimize must be injected/);

  const quarantined = weekInputs({ season: 2026 });
  assert.throws(() => armWeekEvaluator.evaluateArmWeek(quarantined), /quarantine/i);
});

// ---------------------------------------------------------------------------
// The record boundary into the assembly layer
// ---------------------------------------------------------------------------

test('toArmWeekMetricsRecord composes records the assembly layer accepts', () => {
  const evaluation = armWeekEvaluator.evaluateArmWeek(weekInputs());
  const records = metrics.SALTS.map((salt) => armWeekEvaluator.toArmWeekMetricsRecord({
    scoringProfile: sweepEvidence.PRIMARY_PROFILE, arm: 'usage-40-on', salt, evaluation,
  }));
  // indexArmWeekMetrics is the assembly layer's own validator: a full salt
  // group for one arm-week must index cleanly.
  const groups = inputsAssembly.indexArmWeekMetrics(records);
  assert.equal(groups.size, 1);
  const record = records[0];
  assert.deepEqual(Object.keys(record.values), [...sweepEvidence.METRIC_KEYS]);
  assert.equal(record.season, 2025);
  assert.equal(record.week, 5);
});

test('toArmWeekMetricsRecord rejects unknown arms, unknown salts, unknown profiles, and malformed values', () => {
  const evaluation = armWeekEvaluator.evaluateArmWeek(weekInputs());
  assert.throws(
    () => armWeekEvaluator.toArmWeekMetricsRecord({ scoringProfile: 'half-ppr', arm: 'usage-40-on', salt: metrics.SALTS[0], evaluation }),
    /not a sealed profile identifier/
  );
  assert.throws(
    () => armWeekEvaluator.toArmWeekMetricsRecord({ scoringProfile: 'half_ppr', arm: 'usage-99-on', salt: metrics.SALTS[0], evaluation }),
    /not one of the 8 cells or the 2 benchmark arms/
  );
  assert.throws(
    () => armWeekEvaluator.toArmWeekMetricsRecord({ scoringProfile: 'half_ppr', arm: 'usage-40-on', salt: 'pit-99-x', evaluation }),
    /not one of the 24 preregistered salts/
  );
  const mangled = { ...evaluation, values: { ...evaluation.values } };
  delete mangled.values.wis;
  assert.throws(
    () => armWeekEvaluator.toArmWeekMetricsRecord({ scoringProfile: 'half_ppr', arm: 'usage-40-on', salt: metrics.SALTS[0], evaluation: mangled }),
    /missing \[wis\]/
  );
});

test('evaluation is deterministic: two identical runs are byte-identical', () => {
  const first = armWeekEvaluator.evaluateArmWeek(weekInputs());
  const second = armWeekEvaluator.evaluateArmWeek(weekInputs());
  assert.equal(canonicalJson(first), canonicalJson(second));
});
