const { test } = require('node:test');
const assert = require('node:assert/strict');
const { unavailableFor, startVerdictFor } = require('../services/unavailable');

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
];

for (const [name, facts, expected] of ROWS) {
  test(`unavailableFor: ${name}`, () => {
    const verdict = unavailableFor(facts);
    for (const [key, value] of Object.entries(expected)) assert.equal(verdict[key], value, key);
  });
}

// ADR 0061: Lineup lock is a Lineup fact composed beside the verdict by the
// callers that need both, never a field of it. Threading `locked` back into the
// facts turns this red.
test('unavailableFor: the verdict carries no lock, whatever facts are passed', () => {
  for (const facts of [{}, { onBye: true }, { injuryStatus: 'O' }, { injuryStatus: 'D' }, { injuryStatus: 'Q' }, { backup: true }, { positionBaseline: true }]) {
    const verdict = unavailableFor({ ...facts, locked: true, lockedSlot: 'QB' });
    assert.equal('locked' in verdict, false, JSON.stringify(facts));
    assert.equal('lockedSlot' in verdict, false, JSON.stringify(facts));
  }
});

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

const suspended = (h = 1) => ({ status: 'suspended', capturedAt: hoursBefore(h) });

test('unavailableFor (#2150): a fresh suspended roster status is Unavailable with active probability 0', () => {
  const verdict = unavailableFor({ nflRosterStatus: suspended(), now: NOW });
  assert.equal(verdict.available, false);
  assert.equal(verdict.activeProbability, 0);
  assert.equal(verdict.reason, 'suspended');
});

test('unavailableFor (#2150): a suspended row 49h old reads available; 48h exactly is still fresh', () => {
  assert.equal(unavailableFor({ nflRosterStatus: suspended(49), now: NOW }).available, true);
  assert.equal(unavailableFor({ nflRosterStatus: suspended(48), now: NOW }).available, false);
  assert.equal(unavailableFor({ nflRosterStatus: { status: 'suspended', capturedAt: 'garbage' }, now: NOW }).available, true, 'unparseable');
});

test('unavailableFor (#2150): bye, No NFL team and Practice squad outrank suspended; suspended outranks Out and IR', () => {
  const s = suspended();
  assert.equal(unavailableFor({ onBye: true, nflRosterStatus: s, now: NOW }).reason, 'bye');
  assert.equal(unavailableFor({ noTeam: true, nflRosterStatus: s, now: NOW }).reason, 'no_team');
  assert.equal(unavailableFor({ injuryStatus: 'O', nflRosterStatus: s, now: NOW }).reason, 'suspended');
  const ir = unavailableFor({ injuryStatus: 'IR', nflRosterStatus: s, now: NOW });
  assert.equal(ir.reason, 'suspended');
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

// Practice participation (ADR 0056, rulings R2 and R5): a Questionable player
// who did not practice all week is never auto-recommended. Observations are
// `{ practiceStatus, practicePrimaryInjury, reportPrimaryInjury, observedAt }`
// and `kickoffAt` is his game. Fixture week: Sunday 2026-10-11 1pm ET.
const SUNDAY_1PM = '2026-10-11T17:00:00Z';
const WED = '2026-10-07T22:00:00Z';
const THU = '2026-10-08T22:00:00Z';
const FRI = '2026-10-09T22:00:00Z';
const dnp = (extra = {}) => ({
  practiceStatus: 'Did Not Participate In Practice', practicePrimaryInjury: 'Hamstring',
  reportPrimaryInjury: 'Hamstring', observedAt: WED, ...extra,
});
const noPractice = (observations, facts = {}, kickoffAt = SUNDAY_1PM) =>
  unavailableFor({ injuryStatus: 'Q', practice: { observations, kickoffAt }, ...facts });

test('unavailableFor (practice): Questionable with every observation did-not-participate reads no_practice', () => {
  for (const observations of [[dnp()], [dnp(), dnp({ observedAt: FRI })], [dnp({ practiceStatus: 'did not participate' })]]) {
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
  assert.equal(noPractice([dnp(), dnp({ practiceStatus: 'Limited Participation in Practice', observedAt: THU })]).reason, 'questionable', 'DNP then limited');
  assert.equal(noPractice([dnp({ practiceStatus: 'Full Participation in Practice' })]).reason, 'questionable');
  assert.equal(noPractice([dnp({ practiceStatus: null })]).reason, 'questionable', 'blank is not did-not-participate');
  assert.equal(noPractice([dnp({ practiceStatus: '' })]).reason, 'questionable');
  assert.equal(noPractice([dnp(), dnp({ practiceStatus: null, observedAt: THU })]).reason, 'questionable', 'one blank observation defeats it');
  assert.equal(noPractice([dnp()]).autoRecommend, false);
  assert.equal(noPractice([]).autoRecommend, true);
});

// Ruling R5 (finding 3): rest-related is "rest" or "resting" as a whole word in
// either primary-injury text. "Not injury related" alone, or with another
// reason (personal matter, illness), is a real absence and counts.
test('unavailableFor (practice): a rest-related observation defeats no_practice', () => {
  for (const injury of ['Not Injury Related - Resting Player', 'Rest', 'resting vet', 'Not injury related - rest', 'REST DAY']) {
    assert.equal(noPractice([dnp({ practicePrimaryInjury: injury })]).reason, 'questionable', `practice: ${injury}`);
    assert.equal(noPractice([dnp({ reportPrimaryInjury: injury })]).reason, 'questionable', `report: ${injury}`);
  }
  assert.equal(noPractice([dnp(), dnp({ practicePrimaryInjury: 'Rest', observedAt: THU })]).reason, 'questionable', 'any one observation');
  assert.equal(noPractice([dnp({ practicePrimaryInjury: null, reportPrimaryInjury: null })]).reason, 'no_practice', 'no injury text is not rest');
});

test('unavailableFor (practice): a not-injury-related absence that is not rest still counts, and "rest" inside another word does not match', () => {
  for (const injury of ['Not injury related - personal matter', 'Not Injury Related', 'Not injury related - illness', 'Restricted', 'Wrestling injury']) {
    assert.equal(noPractice([dnp({ practicePrimaryInjury: injury, reportPrimaryInjury: injury })]).reason, 'no_practice', injury);
  }
});

// Ruling R5 (finding 2): one late observation is not a week. The rule fires
// only when coverage began in time: the earliest observation was observed by
// the end of the week's Thursday (ET, the Thursday on or before his game day)
// and at least 48 hours before his kickoff.
test('unavailableFor (practice): coverage that began Friday, after the Thursday deadline, never fires', () => {
  assert.equal(noPractice([dnp({ observedAt: FRI })]).reason, 'questionable', 'first seen Friday');
  assert.equal(noPractice([dnp({ observedAt: FRI }), dnp({ observedAt: '2026-10-10T20:00:00Z' })]).reason, 'questionable', 'two late observations');
  assert.equal(noPractice([dnp({ observedAt: '2026-10-09T03:59:59Z' })]).reason, 'no_practice', 'Thursday 11:59:59pm ET still counts');
  assert.equal(noPractice([dnp({ observedAt: '2026-10-09T04:00:00Z' })]).reason, 'questionable', 'Friday 12:00am ET is too late');
  // Deploy day (Friday 2026-10-02, week 4): nobody fires for week 4.
  assert.equal(noPractice([dnp({ observedAt: '2026-10-02T19:00:00Z' })], {}, '2026-10-04T17:00:00Z').reason, 'questionable', 'Sunday team');
  assert.equal(noPractice([dnp({ observedAt: '2026-10-02T19:00:00Z' })], {}, '2026-10-06T00:15:00Z').reason, 'questionable', 'Monday night team');
});

test('unavailableFor (practice): the earliest observation decides coverage, whatever order the list is in', () => {
  assert.equal(noPractice([dnp({ observedAt: FRI }), dnp({ observedAt: WED })]).reason, 'no_practice');
});

test('unavailableFor (practice): a Thursday or Saturday game needs coverage 48 hours before kickoff; Monday night keeps the Thursday deadline', () => {
  const thursdayNight = '2026-10-09T00:15:00Z'; // Thu 10-08 8:15pm ET
  assert.equal(noPractice([dnp({ observedAt: '2026-10-06T23:00:00Z' })], {}, thursdayNight).reason, 'no_practice', 'Tuesday 7pm ET');
  assert.equal(noPractice([dnp({ observedAt: '2026-10-07T01:00:00Z' })], {}, thursdayNight).reason, 'questionable', 'Tuesday 9pm ET, inside 48 hours');
  const saturday = '2026-10-10T20:30:00Z'; // Sat 4:30pm ET
  assert.equal(noPractice([dnp({ observedAt: '2026-10-08T19:00:00Z' })], {}, saturday).reason, 'no_practice', 'Thursday 3pm ET');
  assert.equal(noPractice([dnp({ observedAt: '2026-10-08T21:00:00Z' })], {}, saturday).reason, 'questionable', 'Thursday 5pm ET, inside 48 hours');
  const mondayNight = '2026-10-13T00:15:00Z'; // Mon 10-12 8:15pm ET
  assert.equal(noPractice([dnp({ observedAt: THU })], {}, mondayNight).reason, 'no_practice', 'Thursday evening');
  assert.equal(noPractice([dnp({ observedAt: FRI })], {}, mondayNight).reason, 'questionable', "Friday is past the week's Thursday");
  const london = '2026-10-11T13:30:00Z'; // Sun 9:30am ET
  assert.equal(noPractice([dnp({ observedAt: THU })], {}, london).reason, 'no_practice');
});

test('unavailableFor (practice): no kickoff on file, or an unreadable observation time, never fires', () => {
  assert.equal(noPractice([dnp()], {}, null).reason, 'questionable', 'no kickoff');
  assert.equal(noPractice([dnp()], {}, 'garbage').reason, 'questionable');
  assert.equal(noPractice([dnp({ observedAt: null })]).reason, 'questionable', 'no observation time');
  assert.equal(unavailableFor({ injuryStatus: 'Q', practice: { observations: [dnp()] } }).reason, 'questionable', 'kickoff omitted');
});

test("practiceCoverageDeadline: the earlier of the Thursday's end (ET) and 48 hours before kickoff, DST-correct", () => {
  const { practiceCoverageDeadline } = require('../services/unavailable');
  assert.equal(practiceCoverageDeadline(SUNDAY_1PM).toISOString(), '2026-10-09T04:00:00.000Z', 'Friday midnight EDT');
  assert.equal(practiceCoverageDeadline('2026-10-13T00:15:00Z').toISOString(), '2026-10-09T04:00:00.000Z', 'Monday night, same Thursday');
  assert.equal(practiceCoverageDeadline('2026-10-09T00:15:00Z').toISOString(), '2026-10-07T00:15:00.000Z', 'Thursday night: 48 hours before');
  assert.equal(practiceCoverageDeadline('2026-10-10T20:30:00Z').toISOString(), '2026-10-08T20:30:00.000Z', 'Saturday: 48 hours before');
  assert.equal(practiceCoverageDeadline('2026-11-08T18:00:00Z').toISOString(), '2026-11-06T05:00:00.000Z', 'after the DST end on 11-01, Friday midnight EST');
  assert.equal(practiceCoverageDeadline('2026-11-01T18:00:00Z').toISOString(), '2026-10-30T04:00:00.000Z', 'the DST-end Sunday itself: its Thursday is still EDT');
  assert.equal(practiceCoverageDeadline(null), null);
  assert.equal(practiceCoverageDeadline('garbage'), null);
});

test('unavailableFor (practice): only Questionable is affected; Doubtful, Out, IR and no designation keep their reasons', () => {
  const practice = { observations: [dnp()], kickoffAt: SUNDAY_1PM };
  assert.equal(unavailableFor({ injuryStatus: 'D', practice }).reason, 'doubtful');
  assert.equal(unavailableFor({ injuryStatus: 'O', practice }).reason, 'out');
  assert.equal(unavailableFor({ injuryStatus: 'IR', practice }).reason, 'ir');
  const healthy = unavailableFor({ practice });
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

// ADR 0057: a Backup quarterback is available but never auto-recommended, above
// no_history and above Doubtful, no-practice and Questionable.
test('unavailableFor: backup wins over no designation, Questionable and Doubtful, never auto-recommended', () => {
  for (const injuryStatus of [null, 'Q', 'D']) {
    const verdict = unavailableFor({ injuryStatus, backup: true });
    assert.equal(verdict.available, true, String(injuryStatus));
    assert.equal(verdict.autoRecommend, false, String(injuryStatus));
    assert.equal(verdict.reason, 'backup', String(injuryStatus));
    assert.equal(verdict.activeProbability, injuryStatus ? null : 1, String(injuryStatus));
  }
});

test('unavailableFor: backup outranks Position-baseline, so a QB who is both reads backup (ADR 0057, amended 2026-10-07)', () => {
  const verdict = unavailableFor({ positionBaseline: true, backup: true });
  assert.equal(verdict.reason, 'backup');
  assert.equal(verdict.autoRecommend, false);
  assert.equal(unavailableFor({ positionBaseline: true }).reason, 'no_history', 'Position-baseline alone is unchanged');
});

test('unavailableFor: bye, no team, Practice squad, Out and IR all win over backup', () => {
  const ps = { status: 'practice_squad', capturedAt: new Date().toISOString() };
  assert.equal(unavailableFor({ onBye: true, backup: true }).reason, 'bye');
  assert.equal(unavailableFor({ noTeam: true, backup: true }).reason, 'no_team');
  assert.equal(unavailableFor({ nflRosterStatus: ps, backup: true }).reason, 'practice_squad');
  assert.equal(unavailableFor({ injuryStatus: 'O', backup: true }).reason, 'out');
  assert.equal(unavailableFor({ injuryStatus: 'IR', backup: true }).reason, 'ir');
});

test('unavailableFor: backup outranks the no_practice verdict, and false or absent changes nothing', () => {
  assert.equal(noPractice([dnp()]).reason, 'no_practice', 'the same input without backup reads no_practice');
  assert.equal(noPractice([dnp()], { backup: true }).reason, 'backup');
  assert.equal(noPractice([dnp()], { backup: true }).status, 'Q');
  assert.equal(unavailableFor({ backup: false }).reason, null);
  assert.equal(unavailableFor({ injuryStatus: 'D', backup: false }).reason, 'doubtful');
});

// Start verdict (spec #2042): the one verdict per player per week. Each row is
// the facts and the `{ outcome, reason, numberTrusted }` they must read. The
// both-facts rows pin the precedence: swapping Position-baseline and Backup, or
// moving either above Out, turns a row red.
const squad = { status: 'practice_squad', capturedAt: NOW.toISOString() };
const verdict = (outcome, reason, numberTrusted = true) => ({ outcome, reason, numberTrusted });
const START_VERDICT_ROWS = [
  ['bye', { onBye: true, injuryStatus: 'Q' }, verdict('unavailable', 'bye')],
  ['No NFL team', { noTeam: true }, verdict('unavailable', 'no_team')],
  ['Practice squad', { nflRosterStatus: squad, now: NOW }, verdict('unavailable', 'practice_squad')],
  ['Suspended (#2150)', { nflRosterStatus: { status: 'suspended', capturedAt: NOW.toISOString() }, now: NOW }, verdict('unavailable', 'suspended')],
  ['Out', { injuryStatus: 'O', positionBaseline: true, backup: true }, verdict('unavailable', 'out')],
  ['IR',{ injuryStatus: 'IR', backup: true }, verdict('unavailable', 'ir')],
  ['Position-baseline', { injuryStatus: 'Q', positionBaseline: true }, verdict('not_recommended', 'no_history', false)],
  ['Backup over Position-baseline', { positionBaseline: true, backup: true }, verdict('not_recommended', 'backup', false)],
  ['Backup', { injuryStatus: 'D', backup: true }, verdict('not_recommended', 'backup', false)],
  ['Doubtful', { injuryStatus: 'D' }, verdict('not_recommended', 'doubtful')],
  ['no-practice Questionable', { injuryStatus: 'Q', practice: { observations: [dnp()], kickoffAt: SUNDAY_1PM } }, verdict('not_recommended', 'no_practice')],
  ['plain Questionable', { injuryStatus: 'Q', practice: { observations: [], kickoffAt: SUNDAY_1PM } }, verdict('recommendable', 'questionable')],
  ['healthy', {}, verdict('recommendable', null)],
];

for (const [name, facts, expected] of START_VERDICT_ROWS) {
  test(`startVerdictFor: ${name}`, () => {
    assert.deepEqual(startVerdictFor(facts), expected);
  });
}

test('startVerdictFor: called with nothing is a healthy, recommendable player', () => {
  assert.deepEqual(startVerdictFor(), verdict('recommendable', null));
});
