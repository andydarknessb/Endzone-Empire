const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert } = require('./helpers/fakePool');
const push = require('../services/push.service');
const { alertScoreUpdates } = require('../modules/scheduler');

// Team 3 (owner 11) is home, team 4 (owner 22) is away, matchup 987.
// The ledger fake models the unique index and orders rows by insertion.
function world(t, { optedOut = [] } = {}) {
  const ledger = [];
  const sent = [];
  const fake = createFakePool([
    [select('teams'), () => ({
      rows: [{ id: 3, name: 'Home FC', owner_id: 11 }, { id: 4, name: 'Away FC', owner_id: 22 }],
    })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({
      rows: optedOut.map((user_id) => ({ user_id, prefs: { scoreUpdates: false } })),
    })],
    [select('push_events'), (text, [subject]) => {
      const last = ledger.filter((r) => r.kind === 'score-lead' && r.subject === subject).pop();
      return { rows: last ? [{ fingerprint: last.fingerprint }] : [] };
    }],
    [insert('push_events'), (text, [userIds, kind, subject, fingerprint]) => ({
      rows: userIds
        .filter((u) => !ledger.some((r) => r.user_id === u && r.kind === kind && r.subject === subject && r.fingerprint === fingerprint))
        .map((user_id) => { ledger.push({ user_id, kind, subject, fingerprint }); return { user_id }; }),
    })],
  ]).install(t);
  t.mock.method(push, 'sendPushToUsers', async (userIds, payload) => {
    sent.push({ userIds, payload });
    return { sent: userIds.length };
  });
  const call = (homeScore, awayScore, status = 'live') => alertScoreUpdates({
    leagueId: 42, season: 2026, week: 7,
    scored: [{ matchupId: 987, homeTeamId: 3, awayTeamId: 4, homeScore, awayScore, status }],
  });
  return { fake, sent, call, ledger };
}

const titles = (sent) => sent.map((s) => [s.userIds[0], s.payload.title]);

test('a lead change pushes each owner once; the first scoring and a steady lead push nothing', async (t) => {
  const { sent, call } = world(t);

  await call(10, 5);
  assert.deepEqual(sent, [], 'first scoring records the leader without a push');

  await call(12, 15);
  assert.deepEqual(titles(sent), [[11, 'You lost the lead'], [22, 'You took the lead']]);
  assert.equal(sent[0].payload.body, 'Home FC 12.0 - Away FC 15.0');
  assert.equal(sent[1].payload.body, 'Away FC 15.0 - Home FC 12.0');
  assert.equal(sent[0].payload.url, '/#/league/42/game-center');

  await call(12, 16);
  assert.equal(sent.length, 2, 'same leader again pushes nothing');
});

test('home -> away -> home pushes on both changes', async (t) => {
  const { sent, call } = world(t);

  await call(10, 5);
  await call(10, 15);
  await call(20, 15);

  assert.deepEqual(titles(sent), [
    [11, 'You lost the lead'], [22, 'You took the lead'],
    [11, 'You took the lead'], [22, 'You lost the lead'],
  ]);
});

test('a tie is a lead change from either side', async (t) => {
  const { sent, call } = world(t);

  await call(10, 5);
  await call(10, 10);

  assert.deepEqual(titles(sent), [[11, 'Tied up'], [22, 'Tied up']]);
});

test('reaching played pushes the result once per owner, then never', async (t) => {
  const { sent, call } = world(t);

  await call(100.25, 90, 'live');
  await call(100.25, 90, 'played');
  await call(100.25, 90, 'played');

  assert.deepEqual(titles(sent), [[11, 'Final: you won 100.3-90.0'], [22, 'Final: you lost 90.0-100.3']]);
  assert.match(sent[0].payload.body, /unofficial until the commissioner advances the week/i);
});

test('a final matchup pushes nothing', async (t) => {
  const { fake, call } = world(t);

  await call(10, 5, 'final');

  assert.equal(fake.calls.length, 0);
});

test('an owner with scoreUpdates off gets nothing, the other still does', async (t) => {
  const { sent, call, ledger } = world(t, { optedOut: [22] });

  await call(10, 5);
  await call(10, 15, 'played');

  assert.deepEqual(titles(sent), [[11, 'You lost the lead'], [11, 'Final: you lost 10.0-15.0']]);
  assert.ok(ledger.every((r) => r.user_id === 11));
});
