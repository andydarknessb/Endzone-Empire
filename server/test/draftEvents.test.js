const { test } = require('node:test');
const assert = require('node:assert/strict');
const redis = require('../modules/redis');
const {
  DRAFT_EVENTS_CHANNEL,
  publishDraftEvent,
  startDraftEventRelay,
  closeDraftEventRelay,
} = require('../modules/draftEvents');

test('publishDraftEvent serializes the event onto the shared Redis channel', async (t) => {
  const published = [];
  const client = {
    publish: async (...args) => published.push(args),
  };
  t.mock.method(redis, 'getRedisClient', async () => client);

  const event = { leagueId: 13, event: 'draft:picked', payload: { auto: true } };
  assert.equal(await publishDraftEvent(event), true);
  assert.deepEqual(published, [[DRAFT_EVENTS_CHANNEL, JSON.stringify(event)]]);
});

test('the API relay forwards worker draft events to the league room', async (t) => {
  let listener;
  const subscriber = {
    isOpen: true,
    subscribe: async (channel, callback) => {
      assert.equal(channel, DRAFT_EVENTS_CHANNEL);
      listener = callback;
    },
    unsubscribe: async (channel) => {
      assert.equal(channel, DRAFT_EVENTS_CHANNEL);
    },
    quit: async () => {},
  };
  t.mock.method(redis, 'createRedisSubscriber', async () => subscriber);
  const emitted = [];
  const io = {
    to: (room) => ({
      emit: (event, payload) => emitted.push({ room, event, payload }),
    }),
  };

  const relay = await startDraftEventRelay(io);
  await listener(JSON.stringify({
    leagueId: 13,
    event: 'draft:picked',
    payload: { leagueId: 13, nextTeamId: 2, auto: true },
  }));

  assert.deepEqual(emitted, [{
    room: 'league:13',
    event: 'draft:picked',
    payload: { leagueId: 13, nextTeamId: 2, auto: true },
  }]);
  await closeDraftEventRelay(relay);
});
