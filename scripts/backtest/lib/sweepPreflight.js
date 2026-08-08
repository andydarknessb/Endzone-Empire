'use strict';

/**
 * Gate 2 pre-flight validation over raw-shaped, already-generated synthetic
 * projection records. This module never generates a projection, opens a
 * snapshot, or reads a database. Its only job is to prove the complete domain
 * was checked before the sweep reducer sees an operator-supplied boolean.
 */

const arms = require('./arms');
const { SALTS, MACRO_POSITIONS } = require('./metrics');

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

function deriveCohortPlayerWeeks(rows, label = 'cohort roster') {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${label}: requires a non-empty validated cohort/roster domain`);
  const seen = new Set();
  return rows.map((row, index) => {
    const key = playerWeekKey(row || {}, `${label}[${index}]`);
    if (seen.has(key)) throw new Error(`${label}: duplicate player-week ${key}`);
    seen.add(key);
    return { season: Number(row.season), week: Number(row.week), playerId: Number(row.playerId) };
  });
}

/**
 * Component (f) subgroup ELIGIBILITY: prereg 4.1's point-accuracy exclusion
 * (macro position, not on bye) propagated into section 6.3's membership -
 * the A4 membership ruling, made 2026-08-08 and riding to the B3 spec
 * revision. A cohort member on bye or outside the six macro positions
 * contributes no scored endpoint row (`armWeekEvaluator`'s prereg-4.1
 * exclusion), so it carries no (f) evidence either: its error pair is an
 * exactly-zero delta that can only dilute `D_w` toward the veto NOT firing.
 *
 * THE PERMUTATION DOMAIN DOES NOT TAKE THIS PREDICATE'S BYE LEG
 * (determination 8's asymmetry, part of the same ruling): the reducer's
 * policy-artifact domain requires an observation for every rostered player
 * and byes stay rostered, so byes remain IN section 5's cells while leaving
 * 6.3's subgroup. (The macro-position leg is NOT asymmetric - determination
 * 8's own domain already excludes non-macro members, as counted
 * exclusions.) Baseline and identity COVERAGE stay total over the whole
 * cohort as well - only the subgroup's membership narrows.
 *
 * `position` and `onBye` are asserted, never coerced or defaulted (QA
 * finding A1's doctrine): a malformed field silently excluding a member
 * would shrink the subgroup fail-open, in exactly the direction that
 * weakens the veto, so it throws by name instead. The cohort artifact
 * writer emits both fields on every member (`lib/cohort` marks even
 * non-bye members `onBye: false`), so absence is a defect, not a default.
 */
function componentFSubgroupEligible(row, label) {
  if (!row || typeof row !== 'object') throw new Error(`${label}: subgroup eligibility requires a member/roster row object`);
  if (typeof row.position !== 'string') {
    throw new Error(`${label}: subgroup eligibility requires a string position, got ${JSON.stringify(row.position)} - asserted, never coerced`);
  }
  if (typeof row.onBye !== 'boolean') {
    throw new Error(`${label}: subgroup eligibility requires a boolean onBye, got ${JSON.stringify(row.onBye)} - asserted, never coerced`);
  }
  return MACRO_POSITIONS.includes(row.position) && row.onBye === false;
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

/**
 * The serialization-safe inverse of `normalizeProjectionRun`, kept beside it
 * so the round-trip contract lives in one module. A production run carries
 * `projections` as a Map, and `snapshotStore.canonicalJson` serializes any
 * Map as `{}` SILENTLY - so an identity record written to disk (the
 * `--records-out` checkpoint, the final `--inputs` document) would carry
 * `projections: {}` for every run side, and `normalizeProjectionRun` would
 * reject the document at the reducer's preflight. This converts to the raw
 * ARRAY form `normalizeProjectionRun` already accepts, ascending by numeric
 * playerId so document bytes stay deterministic.
 *
 * Fails closed rather than repairs: every Map value must be an object whose
 * own `playerId` equals its Map key (serialization keeps ONE of the two, so
 * a disagreement is evidence corruption, never a choice), and a bare-number
 * projection value cannot survive the array form at all - the reducer
 * requires objects with ids - so it is rejected here, at capture, instead of
 * voiding the document later.
 */
function serializableProjectionRun(run, label) {
  if (!run || typeof run !== 'object') throw new Error(`${label}: run must be an object`);
  if (Array.isArray(run.projections)) {
    const seen = new Set();
    let sorted = true;
    for (const [index, projection] of run.projections.entries()) {
      if (!projection || typeof projection !== 'object' || !Number.isFinite(Number(projection.playerId))) {
        throw new Error(`${label}: raw projections[${index}] must be an object with a finite playerId`);
      }
      const canonical = String(Number(projection.playerId));
      if (seen.has(canonical)) {
        throw new Error(`${label}: raw projections carry canonical playerId ${canonical} twice - two conflicting projections for one player is evidence corruption, never a bigger run`);
      }
      seen.add(canonical);
      if (index > 0 && Number(run.projections[index - 1].playerId) > Number(projection.playerId)) sorted = false;
    }
    if (sorted) return run;
    // Re-sorted COPY, never in place: document bytes must not depend on
    // which shape the caller happened to hold.
    return { ...run, projections: [...run.projections].sort((a, b) => Number(a.playerId) - Number(b.playerId)) };
  }
  if (!(run.projections instanceof Map)) {
    throw new Error(`${label}: projections must be a Map or a raw projections array`);
  }
  const projections = [];
  const seen = new Set();
  for (const [id, projection] of run.projections) {
    if (!projection || typeof projection !== 'object') {
      throw new Error(`${label}: projection for playerId ${JSON.stringify(id)} must be an object to survive serialization - a bare value has no playerId for the reducer to re-key`);
    }
    if (Number(projection.playerId) !== Number(id) || !Number.isFinite(Number(id))) {
      throw new Error(`${label}: projection.playerId ${JSON.stringify(projection.playerId)} disagrees with its Map key ${JSON.stringify(id)} - serialization keeps one of the two, so they must agree`);
    }
    // Canonical-duplicate rejection (adversarial QA on c95d751): Map keys 7
    // and '7' are distinct to SameValue but collapse to one canonical id in
    // the array form - two conflicting projections for one player must be
    // rejected at the serialization boundary, not silently carried.
    const canonical = String(Number(id));
    if (seen.has(canonical)) {
      throw new Error(`${label}: projections carry canonical playerId ${canonical} under two Map keys - two conflicting projections for one player is evidence corruption, never a bigger run`);
    }
    seen.add(canonical);
    projections.push(projection);
  }
  projections.sort((a, b) => Number(a.playerId) - Number(b.playerId));
  return { ...run, projections };
}

function assertRecordCoverage({ cohortRosterRows, records, label }) {
  if (!Array.isArray(records)) {
    throw new Error(`${label}: records must be an array`);
  }
  const expectedPlayerWeeks = deriveCohortPlayerWeeks(cohortRosterRows, `${label}: cohort roster`);
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

function assertIdentityCoverage({ cohortRosterRows, controlUsage25Records, homeAwayStoredRecords, label = 'preflight identity' }) {
  const controlUsage25 = assertControlUsage25IdentityCoverage({
    cohortRosterRows,
    controlUsage25Records,
    label: `${label}: usage-25 x off == control`,
  });
  const homeAwayStored = assertHomeAwayStoredPointIdentityCoverage({
    cohortRosterRows,
    homeAwayStoredRecords,
    label: `${label}: homeaway-on == homeaway-on-stored`,
  });
  return { controlUsage25, homeAwayStored, passed: true };
}

function assertControlUsage25IdentityCoverage({ cohortRosterRows, controlUsage25Records, label = 'preflight identity: usage-25 x off == control' }) {
  const controlCoverage = assertRecordCoverage({ cohortRosterRows, records: controlUsage25Records, label });
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

function assertHomeAwayStoredPointIdentityCoverage({ cohortRosterRows, homeAwayStoredRecords, label = 'preflight identity: homeaway-on == homeaway-on-stored' }) {
  // Section 8.6.1: "BEFORE comparing outputs, assert THE TWO ARMS' resolved
  // constants differ in EXACTLY the homeAway.useStoredHistory leaf and nothing
  // else (analogous to assertSaltAffectsOnlyHashValue proving a salt varies only
  // hashValue)".
  //
  // The analogy is load-bearing and it is what the first attempt at this got
  // wrong. assertSaltAffectsOnlyHashValue takes the ACTUAL RUNS. An earlier
  // version of this guard re-derived both operands from the injected
  // MODEL_CONSTANTS via resolveConstants and resolveConstantsWithStoredHistory -
  // but the second is literally the first plus that one leaf, so the assertion
  // was a self-consistency check on two pure functions of one input. It could
  // only fail if MODEL_CONSTANTS itself already set useStoredHistory, and it
  // never touched the arms whose outputs are compared. An on-stored arm
  // mis-built with plain resolveConstants passed it, which is the exact defect
  // 8.6.1 exists to catch and which 8.6.1 says the numeric comparison CANNOT
  // catch ("expected to be a complete no-op on every published field today").
  //
  // The operands now come from the RECORD - the constants each arm was actually
  // built with - so the guard checks the evidence rather than itself.
  const storedCoverage = assertRecordCoverage({
    cohortRosterRows,
    records: homeAwayStoredRecords,
    label,
  });
  for (const record of homeAwayStoredRecords) {
    if (!record || !record.leftConstants || !record.rightConstants) {
      throw new Error(
        `${label}: ${runKey(record, label)} carries no leftConstants/rightConstants. Section 8.6.1's `
        + 'single-leaf guard must run on the constants the two arms were actually built with; without '
        + 'them the structural check has no object and the numeric comparison below passes vacuously.'
      );
    }
    arms.assertOnlyStoredHistoryLeafDiffers({
      baseResolved: record.leftConstants,
      storedResolved: record.rightConstants,
      label: `${label}: ${runKey(record, label)} single-leaf`,
    });
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

function assertSaltSeedCoverage({ cohortRosterRows, records, label = 'preflight salt seeds' }) {
  if (!Array.isArray(records)) {
    throw new Error(`${label}: records must be an array`);
  }
  const coordinateKey = (row) => `${row.cellName}:${playerWeekKey(row, label)}`;
  const expected = new Set();
  for (const row of deriveCohortPlayerWeeks(cohortRosterRows, `${label}: cohort roster`)) {
    for (const cell of arms.ALL_CELLS) expected.add(coordinateKey({ ...row, cellName: cell.name }));
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

function assertComponentFVetoCoverage({ cohortRosterRows, matchedOffBaselineRows, records, label = 'preflight component (f) veto' }) {
  if (!Array.isArray(matchedOffBaselineRows) || !Array.isArray(records)) throw new Error(`${label}: matchedOffBaselineRows and records must be arrays`);
  const expectedCells = new Set(arms.ALL_CELLS.filter((cell) => cell.homeAway === 'on').map((cell) => cell.name));
  const cohort = deriveCohortPlayerWeeks(cohortRosterRows, `${label}: cohort roster`);
  const cohortKeys = new Set(cohort.map((row) => playerWeekKey(row, label)));
  // Subgroup ELIGIBILITY rides on the raw roster rows (deriveCohortPlayerWeeks
  // normalizes them down to bare player-weeks): validated for every row, not
  // only members - a malformed field on any cohort row is an artifact defect.
  const eligibleByKey = new Map((cohortRosterRows || []).map((row, index) => [
    playerWeekKey(row || {}, `${label}: cohort roster[${index}]`),
    componentFSubgroupEligible(row, `${label}: cohort roster[${index}]`),
  ]));
  const baselineByCell = new Map();
  for (const row of matchedOffBaselineRows) {
    if (!row || !expectedCells.has(row.cellName) || !Number.isFinite(Number(row.baseline))) throw new Error(`${label}: every matched-off baseline needs an on-cell and finite baseline`);
    // Subgroup membership is assigned over the COHORT's player-weeks (prereg
    // 9.8). A baseline row outside that domain has no legitimate role, and an
    // unrejected superset would widen the derived component (f) gate operands
    // past the veto domain - the round-3 SUBSTANTIVE 2 divergence, reachable
    // through extra raw rows instead of a free-hand number. Extra input is
    // rejected, never silently ignored (the same posture as the veto's own
    // extra-composite-key check).
    if (!cohortKeys.has(playerWeekKey(row, label))) {
      throw new Error(`${label}: matched-off baseline ${row.cellName}:${playerWeekKey(row, label)} lies OUTSIDE the cohort domain`);
    }
    const key = `${row.cellName}:${playerWeekKey(row, label)}`;
    if (baselineByCell.has(key)) throw new Error(`${label}: duplicate matched-off baseline ${key}`);
    baselineByCell.set(key, Number(row.baseline));
  }
  for (const cellName of expectedCells) for (const row of cohort) {
    const key = `${cellName}:${playerWeekKey(row, label)}`;
    if (!baselineByCell.has(key)) throw new Error(`${label}: missing matched-off baseline ${key}`);
  }
  const actualCells = new Set();
  for (const record of records) {
    if (!record || typeof record.cellName !== 'string') throw new Error(`${label}: every record requires a cellName`);
    if (actualCells.has(record.cellName)) throw new Error(`${label}: duplicate cell record ${record.cellName}`);
    actualCells.add(record.cellName);
    if (!expectedCells.has(record.cellName)) throw new Error(`${label}: unexpected non-on cell ${record.cellName}`);
    const subgroupPlayerWeeks = cohort.filter((row) => baselineByCell.get(`${record.cellName}:${playerWeekKey(row, label)}`) <= 0
      && eligibleByKey.get(playerWeekKey(row, label)) === true);
    arms.assertVetoRealizationCoverage({
      subgroupPlayerWeeks,
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

function runPreflight({ cohortRosterRows, controlUsage25Records, homeAwayStoredRecords, saltSeedRecords, matchedOffBaselineRows, componentFVetoRecords, label = 'sweep preflight' }) {
  const capture = (name, fn) => {
    try {
      return fn();
    } catch (error) {
      return { passed: false, detail: `${name}: ${error.message}` };
    }
  };
  const controlUsage25 = capture('usage-25 identity', () => assertControlUsage25IdentityCoverage({
    cohortRosterRows, controlUsage25Records, label: `${label}: usage-25 x off == control`,
  }));
  const homeAwayStored = capture('homeaway stored identity', () => assertHomeAwayStoredPointIdentityCoverage({
    cohortRosterRows, homeAwayStoredRecords, label: `${label}: homeaway-on == homeaway-on-stored`,
  }));
  const identities = { controlUsage25, homeAwayStored, passed: controlUsage25.passed && homeAwayStored.passed };
  const saltSeeds = capture('salt seed guard', () => assertSaltSeedCoverage({
    cohortRosterRows, records: saltSeedRecords, label,
  }));
  const componentFVeto = capture('component (f) veto', () => assertComponentFVetoCoverage({
    cohortRosterRows, matchedOffBaselineRows, records: componentFVetoRecords,
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
  componentFSubgroupEligible,
  deriveCohortPlayerWeeks,
  normalizeProjectionRun,
  serializableProjectionRun,
  assertHomeAwayRunPointIdentity,
  assertMapMatchesRawIds,
  assertIdentityCoverage,
  assertControlUsage25IdentityCoverage,
  assertHomeAwayStoredPointIdentityCoverage,
  assertSaltSeedCoverage,
  assertComponentFVetoCoverage,
  runPreflight,
};
