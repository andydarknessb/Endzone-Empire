const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSocketHarness } = require('./helpers/socketHarness');
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
const { leagueWorld, LEAGUE_ID, OWNER, MEMBER } = require('./helpers/socketJoinWorld');

/**
 * Account deletion / password reset (#2415): through a real socket.io server and
 * client, sessionEnded closes the user's open sockets (reason `io server
 * disconnect`) and leaves another user in the same league room connected.
 */

const harness = createSocketHarness({ secret: 'session-ended-end-to-end-secret' });

test('sessionEnded disconnects that user and leaves the other member in the league room connected', async (t) => {
  leagueWorld({}).install(t);
  const stayer = await harness.connectAs(OWNER, t);
  const ended = await harness.connectAs(MEMBER, t);
  await harness.emit(stayer, 'league:join', { leagueId: LEAGUE_ID });
  await harness.emit(ended, 'league:join', { leagueId: LEAGUE_ID });

  const reason = new Promise((resolve) => ended.once('disconnect', resolve));
  const result = await getDraftRoomBroadcast().sessionEnded(MEMBER.userId);

  assert.equal(result.delivered, true);
  assert.equal(await reason, 'io server disconnect');

  const stayerHeard = harness.nextEvent(stayer, 'roster:changed');
  await getDraftRoomBroadcast().rosterChanged(LEAGUE_ID);
  assert.deepEqual(await stayerHeard, { leagueId: LEAGUE_ID });
  assert.equal(stayer.connected, true, 'the other member stays connected');
  assert.equal(ended.connected, false);
});
