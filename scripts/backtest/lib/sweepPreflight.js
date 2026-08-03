'use strict';

/**
 * Gate 2 pre-flight validation over raw-shaped, already-generated synthetic
 * projection records. This module never generates a projection, opens a
 * snapshot, or reads a database. Its only job is to prove the complete domain
 * was checked before the sweep reducer sees an operator-supplied boolean.
 */

const arms = require('./arms');
const { SALTS } = require('./metrics');

function playerId(value, label) {
  if (!Number.isFinite(Number(value))) throw new Error(`${label}: playerId must be finite`);
  return String(Number(value));
}

function playerWeekKey({ season, week, playerId: id }, label) {
  if (!Number.isInteger(Number(season)) || !Number.isInteger(Number(week))) {
    throw new Error(`${label}: season and week must be integers`);
  }
  return `${Number(season)}:${Number(week)}:${playerId(id, label)}`;
}

function runKey({ season, week, salt }, label) {
  if (!SALTS.includes(salt)) throw new Error(`${label}: salt must be one of the 24 preregistered salts`);
  return `${Number(season)}:${Number(week)}:${salt}`;
}

function normalizeProjectionRun(run, label) {
  if (!run || typeof run !== 'object') throw new Error(`${label}: run must be an object`);
  if (run.projections instanceof Map) return run;
  if (!Array.isArray(run.projections)) {
    throw new Error(`${label}: projections must be a Map or a raw projections array`);
  }
  const ids = run.projections.map((projection) => projection && projection.playerId);
  arms.assertNoDuplicateRawIds(ids, `${label}: raw projections`);
  const projections = new Map();
  for (const projection of run.projections) {
    if (!projection || !Number.isFinite(Number(projection.playerId))) {
      throw new Error(`${label}: every raw projection requires a finite playerId`);
    }
    projections.set(projection.playerId, projection);
  }
  return { ...run, projections };
}

function assertRecordCoverage({ expectedPlayerWeeks, records, label }) {
  if (!Array.isArray(expectedPlayerWeeks) || !Array.isArray(records)) {
    throw new Error(`${label}: expectedPlayerWeeks and records must be arrays`);
  }
  const expectedByWeek = new Map();
  for (const row of expectedPlayerWeeks) {
    const key = playerWeekKey(row, `${label}: expected player-week`);
    const weekKey = key.split(':').slice(0, 2).join(':');
    if (!expectedByWeek.has(weekKey)) expectedByWeek.set(weekKey, new Set());
    const ids = expectedByWeek.get(weekKey);
    const id = playerId(row.playerId, `${label}: expected player-week`);
    if (ids.has(id)) throw new Error(`${label}: duplicate expected player-week ${key}`);
    ids.add(id);
  }
  const expectedRuns = new Set([...expectedByWeek.keys()].flatMap((weekKey) => SALTS.map((salt) => `${weekKey}:${salt}`)));
  const actualRuns = new Set();
  for (const record of records) {
    const key = runKey(record, label);
    if (actualRuns.has(key)) throw new Error(`${label}: duplicate run coordinate ${key}`);
    actualRuns.add(key);
    const weekKey = key.split(':').slice(0, 2).join(':');
    const expectedIds = expectedByWeek.get(weekKey);
    if (!expectedIds) throw new Error(`${label}: unexpected season-week ${weekKey}`);
    for (const side of ['leftPlayerIds', 'rightPlayerIds']) {
      const ids = record[side];
      arms.assertNoDuplicateRawIds(ids, `${label}: ${key} ${side}`);
      const actualIds = new Set(ids.map((id) => playerId(id, `${label}: ${key} ${side}`)));
      if (actualIds.size !== ids.length) {
        throw new Error(`${label}: ${key} ${side} contains duplicate canonical playerId values`);
      }
      const missing = [...expectedIds].filter((id) => !actualIds.has(id));
      const unexpected = [...actualIds].filter((id) => !expectedIds.has(id));
      if (missing.length > 0 || unexpected.length > 0) {
        throw new Error(`${label}: ${key} ${side} does not cover the expected player-week set; missing ${missing.length}, unexpected ${unexpected.length}`);
      }
    }
  }
  const missingRuns = [...expectedRuns].filter((key) => !actualRuns.has(key));
  const unexpectedRuns = [...actualRuns].filter((key) => !expectedRuns.has(key));
  if (missingRuns.length > 0 || unexpectedRuns.length > 0) {
    throw new Error(`${label}: incomplete season-week x salt coverage; missing ${missingRuns.length}, unexpected ${unexpectedRuns.length}`);
  }
  return { playerWeekCount: expectedPlayerWeeks.length, runCount: actualRuns.size, complete: true };
}

function assertMapMatchesRawIds({ run, playerIds, label }) {
  const raw = new Set(playerIds.map((id) => playerId(id, label)));
  const mapped = new Set([...run.projections.keys()].map((id) => playerId(id, label)));
  if (raw.size !== mapped.size || [...raw].some((id) => !mapped.has(id))) {
    throw new Error(`${label}: projection keys do not exactly match the raw playerIds set`);
  }
}

function assertHomeAwayRunPointIdentity({ leftRun, rightRun, leftPlayerIds, rightPlayerIds, label }) {
  leftRun = normalizeProjectionRun(leftRun, `${label}: left run`);
  rightRun = normalizeProjectionRun(rightRun, `${label}: right run`);
  if (!leftRun || !(leftRun.projections instanceof Map) || !rightRun || !(rightRun.projections instanceof Map)) {
    throw new Error(`${label}: both runs must be generateProjections-shaped objects with projections Maps`);
  }
  arms.assertNoDuplicateRawIds(leftPlayerIds, `${label}: left raw playerIds`);
  arms.assertNoDuplicateRawIds(rightPlayerIds, `${label}: right raw playerIds`);
  assertMapMatchesRawIds({ run: leftRun, playerIds: leftPlayerIds, label: `${label}: left run` });
  assertMapMatchesRawIds({ run: rightRun, playerIds: rightPlayerIds, label: `${label}: right run` });
  arms.assertMatchedKeySets(leftRun.projections, rightRun.projections, `${label}: projections`);
  for (const [id, projection] of leftRun.projections) {
    arms.assertHomeAwayStoredPointIdentity({
      computedRun: projection,
      storedRun: rightRun.projections.get(id),
      label: `${label}: player ${id}`,
    });
  }
  return true;
}

function assertIdentityCoverage({ expectedPlayerWeeks, controlUsage25Records, homeAwayStoredRecords, label = 'preflight identity' }) {
  const controlUsage25 = assertControlUsage25IdentityCoverage({
    expectedPlayerWeeks,
    controlUsage25Records,
    label: `${label}: usage-25 x off == control`,
  });
  const homeAwayStored = assertHomeAwayStoredPointIdentityCoverage({
    expectedPlayerWeeks,
    homeAwayStoredRecords,
    label: `${label}: homeaway-on == homeaway-on-stored`,
  });
  return { controlUsage25, homeAwayStored, passed: true };
}

function assertControlUsage25IdentityCoverage({ expectedPlayerWeeks, controlUsage25Records, label = 'preflight identity: usage-25 x off == control' }) {
  const controlCoverage = assertRecordCoverage({ expectedPlayerWeeks, records: controlUsage25Records, label });
  for (const record of controlUsage25Records) {
    const controlRun = normalizeProjectionRun(record.leftRun, `${label}: control ${runKey(record, label)}`);
    const usage25OffRun = normalizeProjectionRun(record.rightRun, `${label}: usage-25 x off ${runKey(record, label)}`);
    assertMapMatchesRawIds({ run: controlRun, playerIds: record.leftPlayerIds, label: `${label}: control ${runKey(record, label)}` });
    assertMapMatchesRawIds({ run: usage25OffRun, playerIds: record.rightPlayerIds, label: `${label}: usage-25 x off ${runKey(record, label)}` });
    arms.assertProjectionRunBitIdentical({
      controlRun,
      usage25OffRun,
      controlPlayerIds: record.leftPlayerIds,
      usage25OffPlayerIds: record.rightPlayerIds,
      label: `${label}: ${runKey(record, label)}`,
    });
  }
  return { ...controlCoverage, passed: true };
}

function assertHomeAwayStoredPointIdentityCoverage({ expectedPlayerWeeks, homeAwayStoredRecords, label = 'preflight identity: homeaway-on == homeaway-on-stored' }) {
  const storedCoverage = assertRecordCoverage({
    expectedPlayerWeeks,
    records: homeAwayStoredRecords,
    label,
  });
  for (const record of homeAwayStoredRecords) {
    assertHomeAwayRunPointIdentity({
      leftRun: record.leftRun,
      rightRun: record.rightRun,
      leftPlayerIds: record.leftPlayerIds,
      rightPlayerIds: record.rightPlayerIds,
      label: `${label}: ${runKey(record, label)}`,
    });
  }
  return { ...storedCoverage, passed: true };
}

function assertSaltSeedCoverage({ expectedCoordinates, records, label = 'preflight salt seeds' }) {
  if (!Array.isArray(expectedCoordinates) || !Array.isArray(records)) {
    throw new Error(`${label}: expectedCoordinates and records must be arrays`);
  }
  const coordinateKey = (row) => `${row.cellName}:${playerWeekKey(row, label)}`;
  const expected = new Set();
  for (const row of expectedCoordinates) {
    if (typeof row.cellName !== 'string' || row.cellName.length === 0) throw new Error(`${label}: expected coordinate needs cellName`);
    const key = coordinateKey(row);
    if (expected.has(key)) throw new Error(`${label}: duplicate expected coordinate ${key}`);
    expected.add(key);
  }
  const actual = new Set();
  for (const record of records) {
    if (typeof record.cellName !== 'string' || record.cellName.length === 0) throw new Error(`${label}: record needs cellName`);
    const key = coordinateKey(record);
    if (actual.has(key)) throw new Error(`${label}: duplicate computed coordinate ${key}`);
    actual.add(key);
    arms.assertSaltsProduceDistinctSeeds({ seedsBySalt: record.seedsBySalt, label: `${label}: ${key}` });
  }
  const missing = [...expected].filter((key) => !actual.has(key));
  const unexpected = [...actual].filter((key) => !expected.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`${label}: incomplete cell x player-week coverage; missing ${missing.length}, unexpected ${unexpected.length}`);
  }
  return { coordinateCount: actual.size, complete: true, passed: true };
}

function assertComponentFVetoCoverage({ records, label = 'preflight component (f) veto' }) {
  if (!Array.isArray(records)) throw new Error(`${label}: records must be an array`);
  const expectedCells = new Set(arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on').map((cell) => cell.name));
  const actualCells = new Set();
  for (const record of records) {
    if (!record || typeof record.cellName !== 'string') throw new Error(`${label}: every record requires a cellName`);
    if (actualCells.has(record.cellName)) throw new Error(`${label}: duplicate cell record ${record.cellName}`);
    actualCells.add(record.cellName);
    if (!expectedCells.has(record.cellName)) throw new Error(`${label}: unexpected non-on cell ${record.cellName}`);
    arms.assertVetoRealizationCoverage({
      subgroupPlayerWeeks: record.subgroupPlayerWeeks,
      realizations: record.realizations,
      label: `${label}: ${record.cellName}`,
    });
  }
  const missing = [...expectedCells].filter((cellName) => !actualCells.has(cellName));
  const unexpected = [...actualCells].filter((cellName) => !expectedCells.has(cellName));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`${label}: incomplete on-cell coverage; missing ${missing.length}, unexpected ${unexpected.length}`);
  }
  return { cellCount: actualCells.size, complete: true, passed: true };
}

function runPreflight({ expectedPlayerWeeks, controlUsage25Records, homeAwayStoredRecords, saltSeedCoordinates, saltSeedRecords, componentFVetoRecords, label = 'sweep preflight' }) {
  const capture = (name, fn) => {
    try {
      return fn();
    } catch (error) {
      return { passed: false, detail: `${name}: ${error.message}` };
    }
  };
  const controlUsage25 = capture('usage-25 identity', () => assertControlUsage25IdentityCoverage({
    expectedPlayerWeeks, controlUsage25Records, label: `${label}: usage-25 x off == control`,
  }));
  const homeAwayStored = capture('homeaway stored identity', () => assertHomeAwayStoredPointIdentityCoverage({
    expectedPlayerWeeks, homeAwayStoredRecords, label: `${label}: homeaway-on == homeaway-on-stored`,
  }));
  const identities = { controlUsage25, homeAwayStored, passed: controlUsage25.passed && homeAwayStored.passed };
  const saltSeeds = capture('salt seed guard', () => assertSaltSeedCoverage({
    expectedCoordinates: saltSeedCoordinates, records: saltSeedRecords, label,
  }));
  const componentFVeto = capture('component (f) veto', () => assertComponentFVetoCoverage({
    records: componentFVetoRecords,
    label: `${label}: component (f) veto`,
  }));
  return {
    identities,
    saltSeeds,
    componentFVeto,
    passed: identities.passed && saltSeeds.passed && componentFVeto.passed,
  };
}

module.exports = {
  assertRecordCoverage,
  normalizeProjectionRun,
  assertHomeAwayRunPointIdentity,
  assertMapMatchesRawIds,
  assertIdentityCoverage,
  assertControlUsage25IdentityCoverage,
  assertHomeAwayStoredPointIdentityCoverage,
  assertSaltSeedCoverage,
  assertComponentFVetoCoverage,
  runPreflight,
};
