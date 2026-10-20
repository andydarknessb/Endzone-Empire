const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSocketHarness } = require('./helpers/socketHarness');
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
const { leagueWorld, LEAGUE_ID, OWNER, MEMBER } = require('./helpers/socketJoinWorld');

/**
 * Team removal / Remove & ban (#2412): through a real socket.io server and
 * client, membershipEnded tells the removed manager's page and takes their
 * sockets out of the league room, so a later room broadcast reaches the
 * remaining member and not the removed one.
 */

const harness = createSocketHarness({ secret: 'membership-ended-end-to-end-secret' });

test('after membershipEnded the removed manager gets league:removed and misses later league broadcasts', async (t) => {
  leagueWorld({}).install(t);
  const stayer = await harness.connectAs(OWNER, t);
  const removed = await harness.connectAs(MEMBER, t);
  await harness.emit(stayer, 'league:join', { leagueId: LEAGUE_ID });
  await harness.emit(removed, 'league:join', { leagueId: LEAGUE_ID });

  const removedEvent = harness.nextEvent(removed, 'league:removed');
  const result = await getDraftRoomBroadcast().membershipEnded(LEAGUE_ID, MEMBER.userId, { leagueName: 'Minneapple League' });

  assert.equal(result.delivered, true);
  assert.deepEqual(await removedEvent, { leagueId: LEAGUE_ID, leagueName: 'Minneapple League' });

  let removedHeard = false;
  removed.on('roster:changed', () => { removedHeard = true; });
  const stayerHeard = harness.nextEvent(stayer, 'roster:changed');
  await getDraftRoomBroadcast().rosterChanged(LEAGUE_ID);

  assert.deepEqual(await stayerHeard, { leagueId: LEAGUE_ID });
  // The stayer's copy has arrived; give the removed socket one more turn.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(removedHeard, false, 'the removed manager no longer hears the league room');
});
