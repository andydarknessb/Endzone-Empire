const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert } = require('./helpers/fakePool');
const push = require('../services/push.service');
const clock = require('../modules/clock');
const { alertBigPlays } = require('../modules/scheduler');
const { banterFor } = require('../services/pushBanter');

// Matchup 100: team 1 (owner 11) vs team 2 (owner 22). Players 501 and 601 start
// for the home team, 502 sits on its bench, 701 starts for the away team.
const SCORED = [{ matchupId: 100, homeTeamId: 1, awayTeamId: 2, homeScore: 50, awayScore: 40 }];
const LINEUP = [
  { team_id: 1, player_id: 501, slot: 'WR' },
  { team_id: 1, player_id: 601, slot: 'RB' },
  { team_id: 1, player_id: 502, slot: 'BENCH' },
  { team_id: 2, player_id: 701, slot: 'WR' },
];
const play = (over) => ({
  playerId: 501, name: 'Home Wideout', type: 'receiving',
  tdDelta: 1, pointsDelta: 6, isTouchdown: true, ...over,
});

// The fake answers the lineup query by honouring its slot and player predicates,
// models the push_events ledger (rows carry the pinned clock's created_at), and
// reports each stat as already at its first count.
function world(t) {
  const state = { now: new Date('2026-10-11T18:00:00Z'), ledger: [], sent: [] };
  t.mock.method(clock, 'now', () => state.now);
  createFakePool([
    [select('leagues'), () => ({ rows: [{ id: 42, scoring_rules: null }] })],
    [select('lineup_entries'), (text, [teamIds, , , playerIds]) => ({
      rows: LINEUP.filter((r) => teamIds.includes(r.team_id) && playerIds.includes(r.player_id)
        && !['BENCH', 'IR'].includes(r.slot)),
    })],
    [select('teams'), () => ({ rows: [{ id: 1, owner_id: 11 }, { id: 2, owner_id: 22 }] })],
    [select('player_stats'), () => ({ rows: [] })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({ rows: [] })],
    [select('push_events'), (text, [userId, cutoff]) => ({
      rows: state.ledger.filter((r) => r.user_id === userId && r.kind === 'big-play' && r.created_at > cutoff),
    })],
    [insert('push_events'), (text, [userIds, kind, subject, fingerprint]) => ({
      rows: userIds
        .filter((id) => !state.ledger.some((r) => r.user_id === id && r.kind === kind
          && r.subject === subject && r.fingerprint === fingerprint))
        .map((user_id) => {
          state.ledger.push({ user_id, kind, subject, fingerprint, created_at: state.now });
          return { user_id };
        }),
    })],
  ]).install(t);
  t.mock.method(push, 'sendPushToUsers', async (userIds, payload) => {
    state.sent.push({ userIds, payload });
    return { sent: userIds.length };
  });
  return state;
}

const run = (plays) => alertBigPlays({ leagueId: 42, season: 2026, week: 5, scored: SCORED, plays });

test('a 6.0-point receiving TD by a home starter pushes the home owner "yours" and the away owner "opponent"', async (t) => {
  const state = world(t);

  await run([play()]);

  const byOwner = Object.fromEntries(state.sent.map((s) => [s.userIds[0], s.payload]));
  assert.deepEqual(Object.keys(byOwner).sort(), ['11', '22']);
  assert.equal(byOwner[11].title, 'Big play: Home Wideout receiving touchdown');
  assert.equal(byOwner[11].body, 'Home Wideout receiving touchdown (6 pts, yours)');
  assert.equal(byOwner[22].body, "Home Wideout receiving touchdown (6 pts, your opponent's)");
  assert.equal(byOwner[11].url, '/#/league/42/game-center');
  const facts = { player: 'Home Wideout', event: 'receiving touchdown', points: 6 };
  assert.equal(byOwner[11].banter, banterFor('bigPlayMine', 'big-play:100:501:receivingTDs:1', facts));
  assert.equal(byOwner[22].banter, banterFor('bigPlayTheirs', 'big-play:100:501:receivingTDs:1', facts));
  assert.deepEqual(state.ledger.map((r) => [r.user_id, r.subject, r.fingerprint]), [
    [11, '100', '501:receivingTDs:1'],
    [22, '100', '501:receivingTDs:1'],
  ]);
});

test('a 3-point field goal pushes nothing', async (t) => {
  const state = world(t);

  await run([play({ type: 'fieldGoal', pointsDelta: 3, isTouchdown: false })]);

  assert.deepEqual(state.sent, []);
});

test('a bench player\'s TD pushes nothing', async (t) => {
  const state = world(t);

  await run([play({ playerId: 502 })]);

  assert.deepEqual(state.sent, []);
});

test('BIG_PLAY_MIN_POINTS raises the threshold', async (t) => {
  const state = world(t);
  process.env.BIG_PLAY_MIN_POINTS = '7';
  t.after(() => { delete process.env.BIG_PLAY_MIN_POINTS; });

  await run([play()]);

  assert.deepEqual(state.sent, []);
});

test('two qualifying plays in one sync give each owner one push titled "2 big plays"', async (t) => {
  const state = world(t);

  await run([play(), play({ playerId: 701, name: 'Away Wideout' })]);

  assert.equal(state.sent.length, 2);
  for (const s of state.sent) assert.equal(s.payload.title, '2 big plays');
  const home = state.sent.find((s) => s.userIds[0] === 11).payload.body.split('\n');
  assert.deepEqual(home, [
    'Home Wideout receiving touchdown (6 pts, yours)',
    "Away Wideout receiving touchdown (6 pts, your opponent's)",
  ]);
  assert.equal(state.ledger[0].fingerprint, '501:receivingTDs:1,701:receivingTDs:1');
  for (const s of state.sent) {
    assert.equal(s.payload.banter, banterFor('bigPlaySeveral', 'big-play:100:501:receivingTDs:1,701:receivingTDs:1', { count: 2 }));
  }
});

test('a second qualifying sync 2 minutes after a push sends nothing; 6 minutes after sends one', async (t) => {
  const state = world(t);
  await run([play()]);
  assert.equal(state.sent.length, 2);

  state.now = new Date(state.now.getTime() + 2 * 60 * 1000);
  await run([play({ playerId: 601, name: 'Second Back', type: 'rushing' })]);
  assert.equal(state.sent.length, 2, 'inside the five-minute cap the play is dropped');

  state.now = new Date(state.now.getTime() + 4 * 60 * 1000);
  await run([play({ playerId: 601, name: 'Second Back', type: 'rushing' })]);
  assert.equal(state.sent.length, 4, 'six minutes on, the same play now sends (it was dropped, not queued or ledgered)');
  assert.equal(state.sent[2].payload.title, 'Big play: Second Back rushing touchdown');
});

test('a qualifying play for a played or final matchup sends nothing', async (t) => {
  const state = world(t);

  for (const status of ['played', 'final']) {
    await alertBigPlays({ leagueId: 42, season: 2026, week: 5, scored: [{ ...SCORED[0], status }], plays: [play()] });
  }

  assert.deepEqual(state.sent, []);
  assert.deepEqual(state.ledger, []);
});
