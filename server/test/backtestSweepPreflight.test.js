'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const preflight = require('../../scripts/backtest/lib/sweepPreflight');
const { SALTS } = require('../../scripts/backtest/lib/metrics');
const { ALL_CELLS } = require('../../scripts/backtest/lib/arms');
// MODEL_CONSTANTS builds the fixtures' RECORDED arm constants below - the
// evidence section 8.6.1's guard runs on. The guard takes no constants of its
// own: an earlier version that did used them to re-derive both operands and
// thereby checked itself instead of the arms.
const { MODEL_CONSTANTS } = require('../services/projectionModel');
const USAGE25 = ALL_CELLS.find((cell) => cell.blendWeight === 0.25 && cell.homeAway === 'on');
const arms = require('../../scripts/backtest/lib/arms');
const BASE_RESOLVED = arms.resolveConstants({ cell: USAGE25, baseConstants: MODEL_CONSTANTS });
const STORED_RESOLVED = arms.resolveConstantsWithStoredHistory({ cell: USAGE25, baseConstants: MODEL_CONSTANTS });

// The bare player-week tuple spreads into realization/baseline rows, which
// carry no eligibility fields; the roster row itself carries prereg 4.1's
// facts (the A4 membership ruling) and is validated for them.
const PLAYER_WEEK = { season: 2025, week: 2, playerId: 7 };
const cohortRosterRows = [{ ...PLAYER_WEEK, position: 'RB', onBye: false }];
const projection = () => ({ playerId: 7, median: 12.5, p10: 4, factors: {} });
const run = () => ({
  projections: new Map([[7, projection()]]),
  inputCutoff: '2025-09-01T00:00:00.000Z',
  sourceCoverage: { synthetic: true },
});

function identityRecords() {
  return SALTS.map((salt) => ({
    season: 2025, week: 2, salt,
    leftPlayerIds: [7], rightPlayerIds: [7], leftRun: run(), rightRun: run(),
    // Section 8.6.1's guard runs on the constants each arm was ACTUALLY built
    // with, so a mis-built on-stored arm is catchable at all.
    leftConstants: BASE_RESOLVED, rightConstants: STORED_RESOLVED,
  }));
}

function seedRecords() {
  return ALL_CELLS.map((cell) => ({
    cellName: cell.name, season: 2025, week: 2, playerId: 7,
    seedsBySalt: Object.fromEntries(SALTS.map((salt, index) => [salt, index])),
  }));
}

function componentFVetoRecords() {
  return ALL_CELLS.filter((cell) => cell.homeAway === 'on').map((cell) => ({
    cellName: cell.name,
    realizations: SALTS.map((salt) => ({ ...PLAYER_WEEK, salt, incrementalError: 0.01 })),
  }));
}

function matchedOffBaselineRows() {
  return ALL_CELLS.filter((cell) => cell.homeAway === 'on').map((cell) => ({ cellName: cell.name, ...PLAYER_WEEK, baseline: -1 }));
}

test('runPreflight derives both identity gates and exhaustive salt seeds from raw-shaped synthetic records', () => {
  const result = preflight.runPreflight({
    cohortRosterRows,
    controlUsage25Records: identityRecords(),
    homeAwayStoredRecords: identityRecords(),
    saltSeedRecords: seedRecords(),
    componentFVetoRecords: componentFVetoRecords(),
    matchedOffBaselineRows: matchedOffBaselineRows(),
  });
  assert.equal(result.passed, true);
  assert.equal(result.identities.controlUsage25.runCount, 24);
  assert.equal(result.identities.homeAwayStored.runCount, 24);
  assert.equal(result.saltSeeds.coordinateCount, 8);
  assert.equal(result.componentFVeto.cellCount, 4);
});

test('authoritative preflight refuses an empty or truncated cohort/roster domain', () => {
  assert.throws(() => preflight.deriveCohortPlayerWeeks([]), /non-empty validated cohort\/roster domain/);
  const result = preflight.runPreflight({
    cohortRosterRows: [], controlUsage25Records: [], homeAwayStoredRecords: [], saltSeedRecords: [],
    matchedOffBaselineRows: [], componentFVetoRecords: [],
  });
  assert.equal(result.passed, false);
  assert.match(result.identities.controlUsage25.detail, /non-empty validated cohort\/roster domain/);
});

test('component (f) preflight rejects missing, duplicate, and extra composite keys before reduction', () => {
  const missing = componentFVetoRecords();
  missing[0].realizations.pop();
  assert.throws(() => preflight.assertComponentFVetoCoverage({ cohortRosterRows, matchedOffBaselineRows: matchedOffBaselineRows(), records: missing }), /incomplete player-week x salt coverage/);

  const duplicate = componentFVetoRecords();
  duplicate[0].realizations.push({ ...duplicate[0].realizations[0] });
  assert.throws(() => preflight.assertComponentFVetoCoverage({ cohortRosterRows, matchedOffBaselineRows: matchedOffBaselineRows(), records: duplicate }), /duplicate composite key/);

  const extra = componentFVetoRecords();
  extra[0].realizations.push({ ...extra[0].realizations[0], playerId: 99 });
  assert.throws(() => preflight.assertComponentFVetoCoverage({ cohortRosterRows, matchedOffBaselineRows: matchedOffBaselineRows(), records: extra }), /incomplete player-week x salt coverage/);
});

test('component (f) preflight derives membership and rejects missing or nonfinite incremental errors', () => {
  const missingError = componentFVetoRecords();
  delete missingError[0].realizations[0].incrementalError;
  assert.throws(() => preflight.assertComponentFVetoCoverage({ cohortRosterRows, matchedOffBaselineRows: matchedOffBaselineRows(), records: missingError }), /finite season, week, playerId, incrementalError/);

  const nonfiniteError = componentFVetoRecords();
  nonfiniteError[0].realizations[0].incrementalError = Infinity;
  assert.throws(() => preflight.assertComponentFVetoCoverage({ cohortRosterRows, matchedOffBaselineRows: matchedOffBaselineRows(), records: nonfiniteError }), /finite season, week, playerId, incrementalError/);

  const missingMembership = componentFVetoRecords().slice(1);
  assert.throws(() => preflight.assertComponentFVetoCoverage({ cohortRosterRows, matchedOffBaselineRows: matchedOffBaselineRows(), records: missingMembership }), /incomplete on-cell coverage/);
});

test('salt preflight requires exactly the 24 preregistered salts for every coordinate', () => {
  const missingSalt = seedRecords();
  delete missingSalt[0].seedsBySalt[SALTS[0]];
  assert.throws(() => preflight.assertSaltSeedCoverage({
    cohortRosterRows, records: missingSalt,
  }), /requires exactly the 24 preregistered salts/);

  const unexpectedSalt = seedRecords();
  unexpectedSalt[0].seedsBySalt['not-preregistered'] = 25;
  assert.throws(() => preflight.assertSaltSeedCoverage({
    cohortRosterRows, records: unexpectedSalt,
  }), /requires exactly the 24 preregistered salts/);
});

test('preflight fails closed on missing identity coverage, an identity mutation, or a salt-seed collision', () => {
  assert.throws(() => preflight.assertIdentityCoverage({
    cohortRosterRows,
    controlUsage25Records: identityRecords().slice(1),
    homeAwayStoredRecords: identityRecords(),
  }), /incomplete season-week x salt coverage/);

  const mutated = identityRecords();
  mutated[0].rightRun.projections.get(7).median = 12.500000001;
  assert.throws(() => preflight.assertIdentityCoverage({
    cohortRosterRows, controlUsage25Records: mutated, homeAwayStoredRecords: identityRecords(),
  }), /not bit-identical/);

  const seeds = seedRecords();
  seeds[0].seedsBySalt[SALTS[1]] = 0;
  assert.throws(() => preflight.assertSaltSeedCoverage({
    cohortRosterRows, records: seeds,
  }), /identical final seed/);
});

test('preflight rejects a projection Map that silently dropped a raw player id', () => {
  const records = identityRecords();
  records[0].leftPlayerIds = [7, 8];
  assert.throws(() => preflight.assertIdentityCoverage({
    cohortRosterRows, controlUsage25Records: records, homeAwayStoredRecords: identityRecords(),
  }), /does not cover the expected player-week set/);
});

test('preflight accepts JSON-shaped raw projection arrays without weakening duplicate checks', () => {
  const records = identityRecords().map((record) => ({
    ...record,
    leftRun: { ...record.leftRun, projections: [...record.leftRun.projections.values()] },
    rightRun: { ...record.rightRun, projections: [...record.rightRun.projections.values()] },
  }));
  assert.equal(preflight.assertIdentityCoverage({
    cohortRosterRows, controlUsage25Records: records, homeAwayStoredRecords: records,
  }).passed, true);
  records[0].leftRun.projections.push({ ...records[0].leftRun.projections[0] });
  assert.throws(() => preflight.assertIdentityCoverage({
    cohortRosterRows, controlUsage25Records: records, homeAwayStoredRecords: identityRecords(),
  }), /duplicate id/);
});

test('section 8.6.1: a mis-built on-stored arm is caught THROUGH THE PREFLIGHT, on the evidence', () => {
  // 8.6.1 says useStoredHistory "is expected to be a complete no-op on every
  // published field today", so the numeric comparison passes VACUOUSLY. The
  // structural guard is the only thing that can catch a mis-built variant - and
  // it only can if its operands are the constants the arms were actually built
  // with. An earlier version re-derived both from MODEL_CONSTANTS, so it checked
  // itself rather than the evidence and this exact input passed.
  const misbuilt = identityRecords().map((record) => ({ ...record, rightConstants: BASE_RESOLVED }));
  const result = preflight.runPreflight({
    cohortRosterRows, controlUsage25Records: identityRecords(), homeAwayStoredRecords: misbuilt,
    saltSeedRecords: seedRecords(), matchedOffBaselineRows: matchedOffBaselineRows(),
  });
  assert.equal(result.identities.homeAwayStored.passed, false, 'an on-stored arm built with plain resolveConstants must be rejected');
  assert.match(result.identities.homeAwayStored.detail, /must have useStoredHistory === true/);

  // And a record that carries no constants fails closed rather than skipping.
  const stripped = identityRecords().map(({ leftConstants, rightConstants, ...rest }) => rest);
  const noConstants = preflight.runPreflight({
    cohortRosterRows, controlUsage25Records: identityRecords(), homeAwayStoredRecords: stripped,
    saltSeedRecords: seedRecords(), matchedOffBaselineRows: matchedOffBaselineRows(),
  });
  assert.equal(noConstants.identities.homeAwayStored.passed, false);
  assert.match(noConstants.identities.homeAwayStored.detail, /carries no leftConstants/);

  // The honest fixture still passes.
  const clean = preflight.runPreflight({
    cohortRosterRows, controlUsage25Records: identityRecords(), homeAwayStoredRecords: identityRecords(),
    saltSeedRecords: seedRecords(), matchedOffBaselineRows: matchedOffBaselineRows(),
  });
  assert.equal(clean.identities.homeAwayStored.passed, true);
});

test('componentFSubgroupEligible: prereg-4.1 eligibility (A4 ruling) - macro/non-bye in, bye and non-macro out, malformed fields throw by name', () => {
  assert.equal(preflight.componentFSubgroupEligible({ position: 'RB', onBye: false }, 't'), true);
  assert.equal(preflight.componentFSubgroupEligible({ position: 'RB', onBye: true }, 't'), false);
  assert.equal(preflight.componentFSubgroupEligible({ position: 'FB', onBye: false }, 't'), false);
  // Asserted, never coerced: a malformed field silently excluding a member
  // would shrink the subgroup in exactly the direction that weakens the veto.
  assert.throws(() => preflight.componentFSubgroupEligible({ onBye: false }, 't'), /string position.*never coerced/);
  assert.throws(() => preflight.componentFSubgroupEligible({ position: 'RB' }, 't'), /boolean onBye.*never coerced/);
  assert.throws(() => preflight.componentFSubgroupEligible({ position: 'RB', onBye: 'false' }, 't'), /boolean onBye/);
  assert.throws(() => preflight.componentFSubgroupEligible(null, 't'), /row object/);
});

test('assertComponentFVetoCoverage: a bye member with b <= 0 leaves the expected veto domain (A4 ruling), and a realization for it is rejected as unexpected', () => {
  // Second cohort member: on bye, negative baseline everywhere - in the
  // cohort (baseline coverage stays TOTAL), out of the subgroup.
  const byeWeek = { season: 2025, week: 2, playerId: 8 };
  const roster = [...cohortRosterRows, { ...byeWeek, position: 'RB', onBye: true }];
  const baselines = ALL_CELLS.filter((cell) => cell.homeAway === 'on').flatMap((cell) => ([
    { cellName: cell.name, ...PLAYER_WEEK, baseline: -1 },
    { cellName: cell.name, ...byeWeek, baseline: -1 },
  ]));
  // Records covering ONLY the eligible member pass: the bye member is not in
  // the veto domain, so its absence from the realizations is correct.
  const eligibleOnly = preflight.assertComponentFVetoCoverage({
    cohortRosterRows: roster, matchedOffBaselineRows: baselines, records: componentFVetoRecords(),
  });
  assert.equal(eligibleOnly.passed, true);
  // Records that ALSO carry the bye member's realizations fail by exact-set
  // coverage - an ineligible realization is unexpected, never extra evidence.
  const withBye = componentFVetoRecords().map((record) => ({
    ...record,
    realizations: [...record.realizations, ...SALTS.map((salt) => ({ ...byeWeek, salt, incrementalError: 0.01 }))],
  }));
  assert.throws(() => preflight.assertComponentFVetoCoverage({
    cohortRosterRows: roster, matchedOffBaselineRows: baselines, records: withBye,
  }), /incomplete player-week x salt coverage|unexpected/);
});

test('serializableProjectionRun: a Map-carrying run converts to the raw array form normalizeProjectionRun re-Maps, values intact (canonicalJson writes a Map as {})', () => {
  const mapRun = {
    projections: new Map([[9, { playerId: 9, median: 11.25, p10: 3 }], [7, { playerId: 7, median: 12.5, p10: 4 }]]),
    inputCutoff: '2025-09-01T00:00:00.000Z',
    sourceCoverage: { synthetic: true },
  };
  const serializable = preflight.serializableProjectionRun(mapRun, 't');
  // Ascending playerId, so document bytes stay deterministic.
  assert.deepEqual(serializable.projections.map((p) => p.playerId), [7, 9]);
  assert.equal(serializable.inputCutoff, mapRun.inputCutoff);
  // The round trip through JSON preserves every value - the exact property a
  // Map-carrying record loses silently (JSON.parse(canonicalJson) would give
  // projections: {} and the reducer would void the document).
  const parsed = JSON.parse(JSON.stringify(serializable));
  const restored = preflight.normalizeProjectionRun(parsed, 't');
  assert.equal(restored.projections.get(7).median, 12.5);
  assert.equal(restored.projections.get(9).median, 11.25);
  // An already-array run passes through unchanged.
  assert.equal(preflight.serializableProjectionRun(serializable, 't'), serializable);
  // Fail-closed, never repaired: a Map key disagreeing with its projection's
  // own playerId is evidence corruption; a bare-number value cannot carry an
  // id into the array form at all.
  assert.throws(() => preflight.serializableProjectionRun({
    projections: new Map([[7, { playerId: 8, median: 1 }]]),
  }, 't'), /disagrees with its Map key/);
  assert.throws(() => preflight.serializableProjectionRun({
    projections: new Map([[7, 12.5]]),
  }, 't'), /must be an object to survive serialization/);
  assert.throws(() => preflight.serializableProjectionRun({ projections: {} }, 't'), /Map or a raw projections array/);
});
