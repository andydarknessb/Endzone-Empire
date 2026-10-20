const { test } = require('node:test');
const assert = require('node:assert/strict');
const redis = require('../modules/redis');
const { createEmitterTransport } = require('../modules/draftRoomEmitterTransport');

/**
 * The worker's Draft room transport (#744, relocated from the deleted
 * draftEvents.js shim under #745). It must be HONEST: `to(room).emit(...)`
 * either hands the event to the emitter and resolves, or it rejects so the one
 * Draft room adapter above can report the loss. These pin the three ways it can
 * end - published, no client, hung-past-the-bound - the cases the retired
 * draftEvents.test.js used to own.
 */

test('to(room).emit publishes to the room channel over the real emitter and resolves on the client publish', async (t) => {
  const published = [];
  t.mock.method(redis, 'getDraftPublisher', async () => ({
    publish: async (channel, message) => { published.push({ channel, message }); },
  }));

  await createEmitterTransport().to('league:7').emit('draft:picked', { auto: true });

  assert.equal(published.length, 1);
  // @socket.io/redis-emitter derives a per-room channel from the room name.
  assert.match(published[0].channel, /league:7/);
  assert.ok(published[0].message, 'a non-empty encoded packet');
});

test('with no Redis client, the emit rejects (so the adapter reports the failure)', async (t) => {
  t.mock.method(redis, 'getDraftPublisher', async () => null);

  await assert.rejects(
    createEmitterTransport().to('league:1').emit('draft:state', {}),
    /no Redis client/
  );
});

test('a publish that outlasts DRAFT_PUBLISH_TIMEOUT_MS rejects on the bound', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // A client whose publish never resolves: only the timeout bound can end this.
  t.mock.method(redis, 'getDraftPublisher', async () => ({ publish: () => new Promise(() => {}) }));

  const pending = createEmitterTransport().to('league:3').emit('draft:picked', { auto: true });
  // Let the getDraftPublisher await settle so withTimeout's setTimeout is armed.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  t.mock.timers.tick(redis.DRAFT_PUBLISH_TIMEOUT_MS);

  await assert.rejects(pending, new RegExp(String(redis.DRAFT_PUBLISH_TIMEOUT_MS)));
});

test('to(room).socketsLeave publishes exactly once through the captured client', async (t) => {
  const published = [];
  t.mock.method(redis, 'getDraftPublisher', async () => ({
    publish: async (channel, message) => { published.push({ channel, message }); },
  }));

  await createEmitterTransport().to('user:7').socketsLeave('league:3');

  assert.equal(published.length, 1);
  assert.ok(Buffer.from(published[0].message).toString('latin1').includes('user:7'), 'addressed to the user room');
});

test('socketsLeave rejects when there is no Redis client', async (t) => {
  t.mock.method(redis, 'getDraftPublisher', async () => null);

  await assert.rejects(
    createEmitterTransport().to('user:7').socketsLeave('league:3'),
    /no Redis client/
  );
});

test('socketsLeave rejects when the emitter never publishes', async (t) => {
  // A client that is present but never reached: simulate by a publisher whose
  // publish is never called, which happens if the operator short-circuits.
  t.mock.method(redis, 'getDraftPublisher', async () => ({ publish: async () => {} }));
  const emitterModule = require('@socket.io/redis-emitter');
  t.mock.method(emitterModule.BroadcastOperator.prototype, 'socketsLeave', () => {});

  await assert.rejects(
    createEmitterTransport().to('user:7').socketsLeave('league:3'),
    /did not publish/
  );
});

test('a socketsLeave publish that outlasts DRAFT_PUBLISH_TIMEOUT_MS rejects on the bound', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(redis, 'getDraftPublisher', async () => ({ publish: () => new Promise(() => {}) }));

  const pending = createEmitterTransport().to('user:7').socketsLeave('league:3');
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  t.mock.timers.tick(redis.DRAFT_PUBLISH_TIMEOUT_MS);

  await assert.rejects(pending, new RegExp(String(redis.DRAFT_PUBLISH_TIMEOUT_MS)));
});
