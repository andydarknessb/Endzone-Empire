'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const preflight = require('../../scripts/backtest/lib/sweepPreflight');
const { SALTS } = require('../../scripts/backtest/lib/metrics');
const { ALL_CELLS } = require('../../scripts/backtest/lib/arms');

const cohortRosterRows = [{ season: 2025, week: 2, playerId: 7 }];
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
    realizations: SALTS.map((salt) => ({ ...cohortRosterRows[0], salt, incrementalError: 0.01 })),
  }));
}

function matchedOffBaselineRows() {
  return ALL_CELLS.filter((cell) => cell.homeAway === 'on').map((cell) => ({ cellName: cell.name, ...cohortRosterRows[0], baseline: -1 }));
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
