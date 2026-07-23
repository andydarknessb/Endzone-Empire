const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const push = require('../services/push.service');
const prefs = require('../services/prefs.service');
const { alertCloseMatchups } = require('../modules/scheduler');

test('close-matchup push targets Game Center instead of the retired Matchups route', async (t) => {
  let sent;
  t.mock.method(pool, 'query', async () => ({ rows: [{ owner_id: 11 }, { owner_id: 22 }] }));
  t.mock.method(prefs, 'usersWanting', async (ownerIds, key) => {
    assert.deepEqual(ownerIds, [11, 22]);
    assert.equal(key, 'closeMatchups');
    return ownerIds;
  });
  t.mock.method(push, 'sendPushToUsers', async (ownerIds, payload) => {
    sent = { ownerIds, payload };
    return { sent: ownerIds.length };
  });

  await alertCloseMatchups({
    leagueId: 42,
    week: 7,
    scored: [{ matchupId: 987654, homeTeamId: 3, awayTeamId: 4, homeScore: 101, awayScore: 96.5 }],
  });

  assert.deepEqual(sent.ownerIds, [11, 22]);
  assert.equal(sent.payload.url, '/#/league/42/game-center');
  assert.equal(sent.payload.title, 'Your matchup is close!');
});
