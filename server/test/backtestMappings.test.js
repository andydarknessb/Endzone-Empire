const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ROSTER_STATUS_VOCABULARY,
  ACTIVE_ROSTER_STATUSES,
  RESERVE_ROSTER_STATUSES,
  OFF_ROSTER_STATUSES,
  INJURY_REPORT_STATUS_MAP,
  APP_INJURY_STATUSES,
  ROSTER_POSITION_VOCABULARY,
  FANTASY_ROSTER_POSITIONS,
  FANTASY_POSITIONS,
  NFLVERSE_TEAM_CODES,
  KNOWN_TEAM_CODE_DIVERGENCES,
  normalizeSourceField,
  classifyRosterStatus,
  mapInjuryReportStatus,
  isFantasyRosterPosition,
  assertKnownVocabulary,
} = require('../../scripts/backtest/lib/mappings');
const { availabilityFor } = require('../services/projectionModel');

// --- roster status ---------------------------------------------------------

test('the three roster status classes PARTITION the observed vocabulary', () => {
  const codes = Object.keys(ROSTER_STATUS_VOCABULARY).sort();
  assert.deepEqual(codes, ['ACT', 'CUT', 'DEV', 'E01', 'EXE', 'INA', 'RES', 'RET', 'TRC', 'TRD']);
  const union = [...ACTIVE_ROSTER_STATUSES, ...RESERVE_ROSTER_STATUSES, ...OFF_ROSTER_STATUSES];
  assert.equal(new Set(union).size, union.length, 'the three sets are disjoint');
  assert.deepEqual([...union].sort(), codes, 'and together they cover every code');
});

test('the active-type set is the cohort and includes game-day inactives', () => {
  assert.deepEqual([...ACTIVE_ROSTER_STATUSES], ['ACT', 'INA']);
  assert.equal(classifyRosterStatus('ACT'), 'active');
  // Dropping INA would keep only players who dressed, which is the
  // survivorship cohort this whole rebuild exists to remove.
  assert.equal(classifyRosterStatus('INA'), 'active');
});

test('the reserve-type set is the IR-equivalent signal and is NOT in the cohort', () => {
  assert.deepEqual([...RESERVE_ROSTER_STATUSES], ['RES', 'RET', 'EXE', 'E01']);
  for (const code of RESERVE_ROSTER_STATUSES) assert.equal(classifyRosterStatus(code), 'reserve');
});

test('practice squad, cuts, and trades are off-roster', () => {
  for (const code of ['DEV', 'CUT', 'TRD', 'TRC']) {
    assert.equal(classifyRosterStatus(code), 'off_roster');
  }
});

test('classifyRosterStatus fails closed on an unseen code and names the sealed set', () => {
  assert.throws(() => classifyRosterStatus('XYZ'), /unknown roster status code "XYZ"/);
  assert.throws(() => classifyRosterStatus('XYZ'), /ACT, CUT, DEV, E01, EXE, INA, RES, RET, TRC, TRD/);
  assert.throws(() => classifyRosterStatus(''), /unknown roster status code/);
  assert.throws(() => classifyRosterStatus(null), /unknown roster status code/);
});

test('every vocabulary entry records a class and the league description code that corroborates it', () => {
  for (const [code, entry] of Object.entries(ROSTER_STATUS_VOCABULARY)) {
    assert.ok(['active', 'reserve', 'off_roster'].includes(entry.class), code);
    assert.ok(entry.meaning.length > 0, code);
    assert.ok(entry.dominantDescription.length > 0, code);
  }
});

// --- injury status ---------------------------------------------------------

test('report_status maps onto exactly the app injury_status vocabulary', () => {
  assert.equal(mapInjuryReportStatus(''), null);
  assert.equal(mapInjuryReportStatus('Questionable'), 'Q');
  assert.equal(mapInjuryReportStatus('Doubtful'), 'D');
  assert.equal(mapInjuryReportStatus('Out'), 'O');
  for (const value of Object.values(INJURY_REPORT_STATUS_MAP)) {
    assert.ok(APP_INJURY_STATUSES.includes(value), `${value} is outside the app vocabulary`);
  }
});

test('"Note" maps to null: the source itself says the player has no game status', () => {
  assert.equal(mapInjuryReportStatus('Note'), null);
});

test('the whitespace-only placeholder in the pinned files reads as blank, not as a status', () => {
  assert.equal(normalizeSourceField('\n    '), '');
  assert.equal(mapInjuryReportStatus('\n    '), null);
  assert.equal(mapInjuryReportStatus('  Out  '), 'O');
});

test('mapInjuryReportStatus fails closed on an unseen status', () => {
  assert.throws(() => mapInjuryReportStatus('Probable'), /unknown injury report_status "Probable"/);
  assert.throws(() => mapInjuryReportStatus('IR'), /unknown injury report_status/);
});

test('IR is unreachable from injury reports: it comes only from the reserve roster status', () => {
  assert.ok(!Object.values(INJURY_REPORT_STATUS_MAP).includes('IR'));
  assert.ok(!APP_INJURY_STATUSES.includes('IR'));
});

test('the mapped statuses drive the production availability function as intended', () => {
  // The mapping only means something if it lands on the vocabulary
  // `availabilityFor` actually branches on (projectionModel.js:754).
  assert.equal(availabilityFor({ injuryStatus: mapInjuryReportStatus('Out') }).available, false);
  assert.equal(availabilityFor({ injuryStatus: mapInjuryReportStatus('Out') }).reason, 'out');
  assert.equal(availabilityFor({ injuryStatus: mapInjuryReportStatus('Doubtful') }).autoRecommend, false);
  assert.equal(availabilityFor({ injuryStatus: mapInjuryReportStatus('Questionable') }).reason, 'questionable');
  const none = availabilityFor({ injuryStatus: mapInjuryReportStatus('Note') });
  assert.equal(none.available, true);
  assert.equal(none.activeProbability, 1);
  assert.equal(none.reason, null);
});

// --- positions -------------------------------------------------------------

test('the fantasy roster positions are the five scoring positions, DEF is synthesized', () => {
  assert.deepEqual([...FANTASY_ROSTER_POSITIONS], ['QB', 'RB', 'WR', 'TE', 'K']);
  assert.deepEqual([...FANTASY_POSITIONS], ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
  assert.ok(!ROSTER_POSITION_VOCABULARY.includes('DEF'), 'no roster row ever carries DEF');
});

test('isFantasyRosterPosition accepts the five, rejects the rest, and fails closed on an unseen code', () => {
  for (const code of FANTASY_ROSTER_POSITIONS) assert.equal(isFantasyRosterPosition(code), true);
  for (const code of ['DB', 'DL', 'LB', 'LS', 'OL', 'P']) assert.equal(isFantasyRosterPosition(code), false);
  assert.equal(isFantasyRosterPosition('\n    '), false, 'a whitespace placeholder is not a position');
  assert.throws(() => isFantasyRosterPosition('CB'), /unknown roster position code "CB"/);
});

// --- teams -----------------------------------------------------------------

test('the team vocabulary is 32 codes and records the two app spelling divergences', () => {
  assert.equal(NFLVERSE_TEAM_CODES.length, 32);
  assert.equal(new Set(NFLVERSE_TEAM_CODES).size, 32);
  assert.deepEqual(KNOWN_TEAM_CODE_DIVERGENCES, { LA: 'LAR', WAS: 'WSH' });
  for (const code of Object.keys(KNOWN_TEAM_CODE_DIVERGENCES)) {
    assert.ok(NFLVERSE_TEAM_CODES.includes(code));
  }
});

// --- vocabulary drift ------------------------------------------------------

test('assertKnownVocabulary catches a source that grows a new value', () => {
  assert.equal(assertKnownVocabulary(['ACT', 'RES'], Object.keys(ROSTER_STATUS_VOCABULARY)), true);
  assert.throws(
    () => assertKnownVocabulary(['ACT', 'NEW'], Object.keys(ROSTER_STATUS_VOCABULARY), { label: 'status' }),
    /status: source carries value\(s\) the sealed mapping does not cover: NEW/
  );
});

test('assertKnownVocabulary treats blank as allowed or not, on request', () => {
  assert.equal(assertKnownVocabulary(['', 'QB'], ['QB']), true);
  assert.throws(() => assertKnownVocabulary(['', 'QB'], ['QB'], { allowBlank: false }), /does not cover/);
});
