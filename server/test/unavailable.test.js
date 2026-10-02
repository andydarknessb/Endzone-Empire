const { test } = require('node:test');
const assert = require('node:assert/strict');
const { unavailableFor } = require('../services/unavailable');

// One row per fact the Unavailable verdict reads. Deleting the no_team branch
// turns the no_team row red.
const ROWS = [
  ['bye', { onBye: true }, { available: false, activeProbability: 0, reason: 'bye' }],
  ['no_team', { noTeam: true }, { available: false, activeProbability: 0, reason: 'no_team' }],
  ['out', { injuryStatus: 'O' }, { available: false, activeProbability: 0, reason: 'out' }],
  ['ir', { injuryStatus: 'IR' }, { available: false, activeProbability: 0, reason: 'ir' }],
  ['doubtful', { injuryStatus: 'D' }, { available: true, autoRecommend: false, activeProbability: null, reason: 'doubtful' }],
  ['questionable', { injuryStatus: 'Q' }, { available: true, autoRecommend: true, activeProbability: null, reason: 'questionable' }],
  ['healthy', {}, { available: true, autoRecommend: true, activeProbability: 1, reason: null }],
  ['locked', { locked: true, lockedSlot: 'QB' }, { available: true, autoRecommend: true, activeProbability: 1, reason: null, locked: true, lockedSlot: 'QB' }],
];

for (const [name, facts, expected] of ROWS) {
  test(`unavailableFor: ${name}`, () => {
    const verdict = unavailableFor(facts);
    for (const [key, value] of Object.entries(expected)) assert.equal(verdict[key], value, key);
  });
}

// #1775: a Position-baseline projection is available but never auto-recommended.
test('unavailableFor: positionBaseline wins over no designation, Questionable and Doubtful', () => {
  for (const injuryStatus of [null, 'Q', 'D']) {
    const verdict = unavailableFor({ injuryStatus, positionBaseline: true });
    assert.equal(verdict.available, true, String(injuryStatus));
    assert.equal(verdict.autoRecommend, false, String(injuryStatus));
    assert.equal(verdict.reason, 'no_history', String(injuryStatus));
  }
});

test('unavailableFor: bye, no team, Out and IR still win over positionBaseline', () => {
  assert.equal(unavailableFor({ onBye: true, positionBaseline: true }).reason, 'bye');
  assert.equal(unavailableFor({ noTeam: true, positionBaseline: true }).reason, 'no_team');
  assert.equal(unavailableFor({ injuryStatus: 'O', positionBaseline: true }).reason, 'out');
  assert.equal(unavailableFor({ injuryStatus: 'IR', positionBaseline: true }).reason, 'ir');
  assert.equal(unavailableFor({ injuryStatus: 'O', positionBaseline: true }).available, false);
});

test('unavailableFor: Practice squad outranks positionBaseline too (bye, No NFL team, Practice squad, Out, IR, then Position-baseline)', () => {
  const ps = { status: 'practice_squad', capturedAt: new Date().toISOString() };
  const verdict = unavailableFor({ nflRosterStatus: ps, positionBaseline: true });
  assert.equal(verdict.reason, 'practice_squad');
  assert.equal(verdict.available, false);
  assert.equal(unavailableFor({ onBye: true, nflRosterStatus: ps, positionBaseline: true }).reason, 'bye');
  assert.equal(unavailableFor({ noTeam: true, nflRosterStatus: ps, positionBaseline: true }).reason, 'no_team');
  assert.equal(unavailableFor({ nflRosterStatus: { ...ps, status: 'active' }, positionBaseline: true }).reason, 'no_history');
});

test('unavailableFor: positionBaseline false or absent changes nothing', () => {
  assert.equal(unavailableFor({ positionBaseline: false }).reason, null);
  assert.equal(unavailableFor({ injuryStatus: 'D', positionBaseline: false }).reason, 'doubtful');
});

test('unavailableFor: bye outranks no_team; called with nothing is healthy', () => {
  assert.equal(unavailableFor({ onBye: true, noTeam: true }).reason, 'bye');
  assert.equal(unavailableFor().available, true);
});

// #1767: the NFL roster status fact. `now` is pinned so the 48-hour rule is
// deterministic.
const NOW = new Date('2026-10-01T18:00:00Z');
const hoursBefore = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
const practiceSquad = (h = 1) => ({ status: 'practice_squad', capturedAt: hoursBefore(h) });

test('unavailableFor (#1767): Practice squad is Unavailable with active probability 0', () => {
  const verdict = unavailableFor({ nflRosterStatus: practiceSquad(), now: NOW });
  assert.equal(verdict.available, false);
  assert.equal(verdict.activeProbability, 0);
  assert.equal(verdict.reason, 'practice_squad');
});

test('unavailableFor (#1767): bye and No NFL team outrank Practice squad; Practice squad outranks Out and IR', () => {
  const ps = practiceSquad();
  assert.equal(unavailableFor({ onBye: true, nflRosterStatus: ps, now: NOW }).reason, 'bye');
  assert.equal(unavailableFor({ noTeam: true, nflRosterStatus: ps, now: NOW }).reason, 'no_team');
  assert.equal(unavailableFor({ injuryStatus: 'O', nflRosterStatus: ps, now: NOW }).reason, 'practice_squad');
  const ir = unavailableFor({ injuryStatus: 'IR', nflRosterStatus: ps, now: NOW });
  assert.equal(ir.reason, 'practice_squad');
  assert.equal(ir.status, 'IR', 'the injury designation still rides along');
});

test('unavailableFor (#1767): a missing, stale (49h), Active or Reserve status reads as Active', () => {
  const healthy = (nflRosterStatus) => unavailableFor({ nflRosterStatus, now: NOW });
  assert.equal(healthy(null).available, true);
  assert.equal(healthy(practiceSquad(49)).available, true);
  assert.equal(healthy(practiceSquad(48)).available, false, '48h exactly is still fresh');
  assert.equal(healthy({ status: 'active', capturedAt: hoursBefore(1) }).available, true);
  assert.equal(healthy({ status: 'reserve', capturedAt: hoursBefore(1) }).available, true);
  assert.equal(healthy({ status: 'practice_squad', capturedAt: null }).available, true);
  assert.equal(healthy({ status: 'practice_squad', capturedAt: 'garbage' }).available, true, 'unparseable');
  assert.equal(healthy({ status: 'practice_squad' }).available, true, 'no timestamp');
});

// Practice participation (ADR 0056, ruling R2): a Questionable player who did
// not practice all week is never auto-recommended. Observations are
// `{ practiceStatus, practicePrimaryInjury, reportPrimaryInjury }`.
const dnp = (extra = {}) => ({ practiceStatus: 'Did Not Participate In Practice', practicePrimaryInjury: 'Hamstring', reportPrimaryInjury: 'Hamstring', ...extra });
const noPractice = (observations, facts = {}) => unavailableFor({ injuryStatus: 'Q', practice: { observations }, ...facts });

test('unavailableFor (practice): Questionable with every observation did-not-participate reads no_practice', () => {
  for (const observations of [[dnp()], [dnp(), dnp()], [dnp({ practiceStatus: 'did not participate' })]]) {
    const verdict = noPractice(observations);
    assert.equal(verdict.reason, 'no_practice');
    assert.equal(verdict.status, 'Q');
    assert.equal(verdict.available, true);
    assert.equal(verdict.autoRecommend, false);
    assert.equal(verdict.activeProbability, null);
  }
});

test('unavailableFor (practice): no observations, a limited one, or a blank one leaves plain Questionable', () => {
  assert.equal(noPractice([]).reason, 'questionable', 'no observation at all');
  assert.equal(noPractice(undefined).reason, 'questionable');
  assert.equal(unavailableFor({ injuryStatus: 'Q' }).reason, 'questionable', 'no practice input at all');
  assert.equal(noPractice([dnp(), dnp({ practiceStatus: 'Limited Participation in Practice' })]).reason, 'questionable', 'DNP then limited');
  assert.equal(noPractice([dnp({ practiceStatus: 'Full Participation in Practice' })]).reason, 'questionable');
  assert.equal(noPractice([dnp({ practiceStatus: null })]).reason, 'questionable', 'blank is not did-not-participate');
  assert.equal(noPractice([dnp({ practiceStatus: '' })]).reason, 'questionable');
  assert.equal(noPractice([dnp(), dnp({ practiceStatus: null })]).reason, 'questionable', 'one blank observation defeats it');
  assert.equal(noPractice([dnp()]).autoRecommend, false);
  assert.equal(noPractice([]).autoRecommend, true);
});

test('unavailableFor (practice): a rest-related observation defeats no_practice', () => {
  for (const injury of ['Not Injury Related - Resting Player', 'Rest', 'resting vet', 'NOT INJURY RELATED']) {
    assert.equal(noPractice([dnp({ practicePrimaryInjury: injury })]).reason, 'questionable', `practice: ${injury}`);
    assert.equal(noPractice([dnp({ reportPrimaryInjury: injury })]).reason, 'questionable', `report: ${injury}`);
  }
  assert.equal(noPractice([dnp(), dnp({ practicePrimaryInjury: 'Rest' })]).reason, 'questionable', 'any one observation');
  assert.equal(noPractice([dnp({ practicePrimaryInjury: null, reportPrimaryInjury: null })]).reason, 'no_practice', 'no injury text is not rest');
});

test('unavailableFor (practice): only Questionable is affected; Doubtful, Out, IR and no designation keep their reasons', () => {
  const observations = [dnp()];
  assert.equal(unavailableFor({ injuryStatus: 'D', practice: { observations } }).reason, 'doubtful');
  assert.equal(unavailableFor({ injuryStatus: 'O', practice: { observations } }).reason, 'out');
  assert.equal(unavailableFor({ injuryStatus: 'IR', practice: { observations } }).reason, 'ir');
  const healthy = unavailableFor({ practice: { observations } });
  assert.equal(healthy.reason, null);
  assert.equal(healthy.activeProbability, 1);
});

test('unavailableFor (practice): bye, no team, Practice squad and Position-baseline outrank no_practice', () => {
  const ps = { status: 'practice_squad', capturedAt: new Date().toISOString() };
  assert.equal(noPractice([dnp()], { onBye: true }).reason, 'bye');
  assert.equal(noPractice([dnp()], { noTeam: true }).reason, 'no_team');
  assert.equal(noPractice([dnp()], { nflRosterStatus: ps }).reason, 'practice_squad');
  assert.equal(noPractice([dnp()], { positionBaseline: true }).reason, 'no_history', 'Position-baseline wins');
});
