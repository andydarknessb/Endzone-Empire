const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseLastUpdated,
  latestWeekPracticeSquadIds,
  elevationDeadline,
  nflverseSaysPracticeSquad,
} = require('../modules/nflverseRosterStatus');

test('parseLastUpdated reads EDT and EST wall clocks, anything else is null', () => {
  assert.equal(parseLastUpdated('2026-10-21 08:56:32 EDT').toISOString(), '2026-10-21T12:56:32.000Z');
  assert.equal(parseLastUpdated('2026-12-01 08:56:32 EST').toISOString(), '2026-12-01T13:56:32.000Z');
  assert.equal(parseLastUpdated('garbage'), null);
  assert.equal(parseLastUpdated('2026-10-21 08:56:32 PST'), null);
});

test('latestWeekPracticeSquadIds keeps DEV rows at the max week only', () => {
  const rows = [
    { week: '6', status: 'DEV', espn_id: '1', team: 'HOU' },
    { week: '7', status: 'DEV', espn_id: '2', team: 'HOU' },
    { week: '7', status: 'ACT', espn_id: '3', team: 'HOU' },
    { week: '7', status: 'DEV', espn_id: '', team: 'HOU' },
    { week: '7', status: 'DEV', espn_id: '4', team: 'LA' },
  ];
  assert.deepEqual([...latestWeekPracticeSquadIds(rows)], ['2|HOU', '4|LAR']);
});

test('nflverseSaysPracticeSquad: a DEV row counts only on the team ESPN has him on', () => {
  const snapshot = { practiceSquadIds: latestWeekPracticeSquadIds([{ week: '7', status: 'DEV', espn_id: '9', team: 'PIT' }]), updatedAt: new Date('2026-10-21T12:56:32Z'), nextKickoffByTeam: new Map() };
  const now = new Date('2026-10-21T14:00:00Z');
  assert.equal(nflverseSaysPracticeSquad(snapshot, { athleteId: 9, teamCode: 'PIT', now }), true);
  assert.equal(nflverseSaysPracticeSquad(snapshot, { athleteId: 9, teamCode: 'NYG', now }), false, 'signed off the PIT practice squad onto NYG: ESPN stands');
});

test('elevationDeadline: 4pm ET the day before the kickoff ET date, DST-correct', () => {
  assert.equal(elevationDeadline(new Date('2026-11-01T18:00:00Z')).toISOString(), '2026-10-31T20:00:00.000Z');
  assert.equal(elevationDeadline(new Date('2026-10-25T17:00:00Z')).toISOString(), '2026-10-24T20:00:00.000Z');
  // Thursday 8:15pm EDT Oct 28 is ET date Oct 28 (UTC says Oct 29).
  assert.equal(elevationDeadline(new Date('2026-10-29T00:15:00Z')).toISOString(), '2026-10-27T20:00:00.000Z');
  // Winter: a deadline in EST is 21:00Z.
  assert.equal(elevationDeadline(new Date('2026-11-08T18:00:00Z')).toISOString(), '2026-11-07T21:00:00.000Z');
});
