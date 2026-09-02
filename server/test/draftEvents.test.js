const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createFakePool } = require('./helpers/fakePool');
const redis = require('../modules/redis');
const sentry = require('../modules/sentry');
const draftEvents = require('../modules/draftEvents');

// The Draft room transport must be honest: publishDraftEvent either hands the
// event to the emitter without error, or it reports the failure. It never
// returns a bare boolean and never resolves silent on loss (#744, ADR 0025).
// Each case below carries the negative control the criterion names, asserted.

test('with no Redis client, publishDraftEvent reports the failure (never a bare boolean)', async (t) => {
  t.mock.method(redis, 'getRedisClient', async () => null);
  const captured = [];
  t.mock.method(sentry, 'captureError', (err, ctx) => captured.push({ err, ctx }));

  const result = await draftEvents.publishDraftEvent({
    leagueId: 9,
    event: 'roster:changed',
    payload: { leagueId: 9 },
  });

  assert.deepEqual(
    { delivered: result.delivered, transport: result.transport },
    { delivered: false, transport: 'emitter' },
  );
  assert.ok(result.error instanceof Error);
  // Negative control (asserted): the shim must report through captureError with
  // { event, leagueId }. Deleting the shim's captureError call drops this to 0.
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].ctx, { event: 'roster:changed', leagueId: 9 });
});

test('a publish that outlasts DRAFT_PUBLISH_TIMEOUT_MS rejects on the bound and reports', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(redis, 'getRedisClient', async () => ({ publish: async () => {} }));
  // A fake emitter whose emit never resolves: only the bound can end this.
  t.mock.method(draftEvents, 'buildEmitter', () => ({ emit: () => new Promise(() => {}) }));
  const captured = [];
  t.mock.method(sentry, 'captureError', (err, ctx) => captured.push({ err, ctx }));

  const pending = draftEvents.publishDraftEvent({
    leagueId: 3,
    event: 'draft:picked',
    payload: { auto: true },
  });
  // Let the getRedisClient await settle so withTimeout's setTimeout is armed.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  t.mock.timers.tick(redis.DRAFT_PUBLISH_TIMEOUT_MS);
  const result = await pending;

  assert.equal(result.delivered, false);
  assert.equal(captured.length, 1);
  // The bound, not some other failure, is what fired.
  assert.match(result.error.message, new RegExp(String(redis.DRAFT_PUBLISH_TIMEOUT_MS)));
});

test('negative control: a publish resolving within the bound is delivered (the bound is what fired above)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(redis, 'getRedisClient', async () => ({ publish: async () => {} }));
  const belowBound = redis.DRAFT_PUBLISH_TIMEOUT_MS - 500;
  // Same code path, but now the publish beats the bound.
  t.mock.method(draftEvents, 'buildEmitter', () => ({
    emit: () => new Promise((resolve) => setTimeout(resolve, belowBound)),
  }));

  const pending = draftEvents.publishDraftEvent({
    leagueId: 3,
    event: 'draft:picked',
    payload: { auto: true },
  });
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  t.mock.timers.tick(belowBound);
  const result = await pending;

  assert.deepEqual(result, { delivered: true, transport: 'emitter' });
});

test('a fatal client error after connect drops the cached client so the next call reconnects', async (t) => {
  const originalUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = 'redis://fake:6379';
  t.after(async () => {
    await redis.closeRedis();
    if (originalUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalUrl;
  });
  await redis.closeRedis(); // start from a clean cache

  const makeFake = () => {
    const client = new EventEmitter();
    client.isOpen = false;
    client.connect = async () => { client.isOpen = true; return client; };
    client.publish = async () => {};
    client.quit = async () => { client.isOpen = false; };
    return client;
  };
  const clients = [makeFake(), makeFake()];
  let created = 0;
  t.mock.method(redis, 'newClient', () => clients[created++]);

  const first = await redis.getRedisClient();
  assert.equal(first, clients[0]);

  // A fatal error tears the socket down (isOpen false), then surfaces as 'error'.
  first.isOpen = false;
  first.emit('error', new Error('ECONNRESET'));

  const second = await redis.getRedisClient();
  assert.equal(second, clients[1]);
  assert.notEqual(second, first);
});

test('a draft:state publish emits the in-process snapshot, keyed to the socketPayloadShape draft:state pins', async (t) => {
  // Mirror socketPayloadShape.test.js's draftStateFake so the emitted payload is
  // the REAL getDraftState output; assert its root key set against the same pins
  // (STATE_ROOT_CLEAN = league / onTheClock / picks / teams).
  createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: 1,
        name: 'Sunday Ballers',
        draft_status: 'active',
        draft_rotation: 'snake',
        draft_order_overrides: null,
        current_pick: 0,
        invite_code: 'invite',
      }],
    })],
    [/FROM "teams"\s+WHERE/, () => ({ rows: [] })],
    [/FROM "draft_picks" JOIN "players"/, () => ({ rows: [] })],
  ]).install(t);

  t.mock.method(redis, 'getRedisClient', async () => ({ publish: async () => {} }));
  let emitted;
  t.mock.method(draftEvents, 'buildEmitter', () => ({
    emit: async (room, event, payload) => { emitted = { room, event, payload }; },
  }));

  const result = await draftEvents.publishDraftEvent({
    leagueId: 1,
    event: 'draft:state',
    payload: { ignoredByShape: true }, // proves the caller payload is NOT shipped
  });

  assert.equal(result.delivered, true);
  assert.equal(emitted.room, 'league:1');
  assert.equal(emitted.event, 'draft:state');
  assert.deepEqual(Object.keys(emitted.payload).sort(), ['league', 'onTheClock', 'picks', 'teams']);
  // The in-process snapshot shipped, not the caller's payload.
  assert.equal('ignoredByShape' in emitted.payload, false);
});

test('buildEmitter publishes the event to the room channel over the real emitter and resolves on the client publish', async (t) => {
  const published = [];
  const client = {
    publish: async (channel, message) => { published.push({ channel, message }); },
  };
  const emitter = draftEvents.buildEmitter(client);

  await emitter.emit('league:7', 'draft:picked', { auto: true });

  assert.equal(published.length, 1);
  // @socket.io/redis-emitter derives a per-room channel from the room name.
  assert.match(published[0].channel, /league:7/);
  assert.ok(published[0].message); // a non-empty encoded packet
});
