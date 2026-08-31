const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getIo, setIo } = require('../modules/io');
const draftEvents = require('../modules/draftEvents');
const { broadcastRosterAvailability } = require('../modules/rosterAvailabilityBroadcast');

test('availability broadcast is scoped to the changed league and exposes no roster details', async (t) => {
  const previousIo = getIo();
  const events = [];
  setIo({ to: (room) => ({ emit: (event, payload) => events.push({ room, event, payload }) }) });
  t.after(() => setIo(previousIo));

  await broadcastRosterAvailability(13);

  assert.deepEqual(events, [{
    room: 'league:13',
    event: 'roster:changed',
    payload: { leagueId: 13 },
  }]);
});

test('worker-side availability broadcast is relayed through Redis', async (t) => {
  const previousIo = getIo();
  const published = [];
  setIo(null);
  t.after(() => setIo(previousIo));
  t.mock.method(draftEvents, 'publishDraftEvent', async (event) => published.push(event));

  await broadcastRosterAvailability(13);

  assert.deepEqual(published, [{ leagueId: 13, event: 'roster:changed', payload: { leagueId: 13 } }]);
});
