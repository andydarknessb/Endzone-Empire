const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert } = require('./helpers/fakePool');
const push = require('../services/push.service');
const { alertScoreUpdates } = require('../modules/scheduler');
const { banterFor } = require('../services/pushBanter');

const HOME = { mine: 'Home FC', theirs: 'Away FC' };
const AWAY = { mine: 'Away FC', theirs: 'Home FC' };

// Team 3 (owner 11) is home, team 4 (owner 22) is away, matchup 987.
// The ledger fake models the unique index and orders rows by insertion.
function world(t, { optedOut = [] } = {}) {
  const ledger = [];
  const sent = [];
  const clock = { minutes: 0 }; // the fake database's now()
  const fake = createFakePool([
    [select('teams'), () => ({
      rows: [{ id: 3, name: 'Home FC', owner_id: 11 }, { id: 4, name: 'Away FC', owner_id: 22 }],
    })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({
      rows: optedOut.map((user_id) => ({ user_id, prefs: { scoreUpdates: false } })),
    })],
    // The per-owner cap: a non-silent score-lead row under five minutes old.
    [/NOT LIKE/, (text, [userId]) => ({
      rows: ledger.some((r) => r.user_id === userId && r.kind === 'score-lead' && !r.fingerprint.endsWith(':0') && clock.minutes - r.at < 5)
        ? [{ '?column?': 1 }] : [],
    })],
    [select('push_events'), (text, [userId, subject]) => {
      const last = ledger.filter((r) => r.user_id === userId && r.kind === 'score-lead' && r.subject === subject).pop();
      return { rows: last ? [{ fingerprint: last.fingerprint }] : [] };
    }],
    // sendPushOnce inserts (userIds, kind, subject, fingerprint); the silent
    // record inserts (userId, subject, fingerprint) with a literal kind.
    [insert('push_events'), (text, params) => {
      const [ids, kind, subject, fingerprint] = params.length === 4 ? params : [[params[0]], 'score-lead', params[1], params[2]];
      return {
        rows: ids
          .filter((u) => !ledger.some((r) => r.user_id === u && r.kind === kind && r.subject === subject && r.fingerprint === fingerprint))
          .map((user_id) => { ledger.push({ user_id, kind, subject, fingerprint, at: clock.minutes }); return { user_id }; }),
      };
    }],
  ]).install(t);
  t.mock.method(push, 'sendPushToUsers', async (userIds, payload) => {
    sent.push({ userIds, payload });
    return { sent: userIds.length };
  });
  const call = (homeScore, awayScore, status = 'live') => alertScoreUpdates({
    leagueId: 42, season: 2026, week: 7,
    scored: [{ matchupId: 987, homeTeamId: 3, awayTeamId: 4, homeScore, awayScore, status }],
  });
  return { fake, sent, call, ledger, clock };
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
  assert.equal(sent[0].payload.banter, banterFor('leadLost', 'score-lead:987:away:1', HOME));
  assert.equal(sent[1].payload.banter, banterFor('leadTaken', 'score-lead:987:away:1', AWAY));

  await call(12, 16);
  assert.equal(sent.length, 2, 'same leader again pushes nothing');
});

test('home -> away -> home pushes on both changes', async (t) => {
  const { sent, call, clock } = world(t);

  await call(10, 5);
  await call(10, 15);
  clock.minutes = 6; // past the per-owner cap
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
  assert.equal(sent[0].payload.banter, banterFor('tied', 'score-lead:987:tied:1', HOME));
  assert.equal(sent[1].payload.banter, banterFor('tied', 'score-lead:987:tied:1', AWAY));
});

test('reaching played pushes the result once per owner, then never', async (t) => {
  const { sent, call } = world(t);

  await call(100.25, 90, 'live');
  await call(100.25, 90, 'played');
  await call(100.25, 90, 'played');

  assert.deepEqual(titles(sent), [[11, 'Final: you won 100.3-90.0'], [22, 'Final: you lost 90.0-100.3']]);
  assert.match(sent[0].payload.body, /unofficial until the commissioner advances the week/i);
  assert.equal(sent[0].payload.banter, banterFor('finalWon', 'score-played:987:played', HOME));
  assert.equal(sent[1].payload.banter, banterFor('finalLost', 'score-played:987:played', AWAY));
});

test('a final lost by less than a point reads finalLostClose; by 2.0 it reads finalLost; a tie reads finalTied', async (t) => {
  const close = world(t);
  await close.call(10.5, 10);
  await close.call(10.5, 10, 'played');
  assert.equal(close.sent[0].payload.banter, banterFor('finalWon', 'score-played:987:played', HOME));
  assert.equal(close.sent[1].payload.banter, banterFor('finalLostClose', 'score-played:987:played', AWAY));

  const far = world(t);
  await far.call(12, 10);
  await far.call(12, 10, 'played');
  assert.equal(far.sent[1].payload.banter, banterFor('finalLost', 'score-played:987:played', AWAY));

  const tie = world(t);
  await tie.call(10, 10);
  await tie.call(10, 10, 'played');
  assert.equal(tie.sent[0].payload.banter, banterFor('finalTied', 'score-played:987:played', HOME));
  assert.equal(tie.sent[1].payload.banter, banterFor('finalTied', 'score-played:987:played', AWAY));
});

test('the close-loss boundary compares in hundredths: 63.1 to 64.1 is finalLost, 63.1 to 64.0 is finalLostClose', async (t) => {
  const full = world(t);
  await full.call(64.1, 63.1);
  await full.call(64.1, 63.1, 'played');
  assert.equal(full.sent[1].payload.banter, banterFor('finalLost', 'score-played:987:played', AWAY));

  const under = world(t);
  await under.call(64.0, 63.1);
  await under.call(64.0, 63.1, 'played');
  assert.equal(under.sent[1].payload.banter, banterFor('finalLostClose', 'score-played:987:played', AWAY));
});

test('a final matchup pushes nothing', async (t) => {
  const { fake, call } = world(t);

  await call(10, 5, 'final');

  assert.equal(fake.calls.length, 0);
});

test('an owner with scoreUpdates off gets nothing, the other still does', async (t) => {
  const { sent, call, ledger } = world(t, { optedOut: [22] });

  await call(10, 5);
  await call(10, 15, 'live');
  await call(10, 15, 'played');

  assert.deepEqual(titles(sent), [[11, 'You lost the lead'], [11, 'Final: you lost 10.0-15.0']]);
  assert.ok(ledger.every((r) => r.user_id === 11));
});

test('once played, only the Final push goes out; a later correction sends nothing', async (t) => {
  const { sent, call } = world(t);

  await call(30, 20);
  await call(30, 31, 'played');
  assert.deepEqual(titles(sent), [[11, 'Final: you lost 30.0-31.0'], [22, 'Final: you won 31.0-30.0']]);

  await call(32, 31, 'played');
  assert.equal(sent.length, 2, 'a correction after played is not a lead change');
});

test('scores that round to the same figure print two decimals', async (t) => {
  const { sent, call } = world(t);

  await call(10, 5);
  await call(100.2, 100.24);

  assert.equal(sent[0].payload.body, 'Home FC 100.20 - Away FC 100.24');
  assert.equal(sent[1].payload.body, 'Away FC 100.24 - Home FC 100.20');
});

test('lead pushes are capped at one per owner per five minutes; a capped flip is delayed, not lost', async (t) => {
  const { sent, call, clock, ledger } = world(t);

  clock.minutes = -10;
  await call(10, 5); // records home, no push
  clock.minutes = 0;
  await call(12, 15); // flips to away: pushed
  assert.equal(sent.length, 2);

  clock.minutes = 2;
  await call(20, 15); // flips back inside the cap: no push, no row
  assert.equal(sent.length, 2);
  assert.equal(ledger.filter((r) => r.fingerprint.startsWith('home:') && !r.fingerprint.endsWith(':0')).length, 0);

  clock.minutes = 6;
  await call(20, 15); // still flipped once the cap lapses: pushed
  assert.deepEqual(titles(sent.slice(2)), [[11, 'You took the lead'], [22, 'You lost the lead']]);
});

test('the played push is never capped', async (t) => {
  const { sent, call, clock } = world(t);

  clock.minutes = -10;
  await call(10, 5);
  clock.minutes = 0;
  await call(10, 15); // lead push, starts the cap
  clock.minutes = 1;
  await call(10, 15, 'played');

  assert.deepEqual(titles(sent.slice(2)), [[11, 'Final: you lost 10.0-15.0'], [22, 'Final: you won 15.0-10.0']]);
});
