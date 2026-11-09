const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSocketHarness } = require('./helpers/socketHarness');

/**
 * A client's payload and acknowledgement are untrusted. `null` defeats a
 * destructuring default and a number is not callable, and the rejection from
 * either reached unhandledRejection, where processHandlers.js exits the
 * process: one event from any logged-in user shut the API down.
 */
const harness = createSocketHarness({ secret: 'socket-untrusted-payload-secret' });
const HANDLERS = ['league:join', 'draft:join', 'chat:send', 'draft:pick', 'draft:start'];

async function assertProcessSurvives(t, send) {
  const rejections = [];
  const record = (reason) => rejections.push(reason);
  process.on('unhandledRejection', record);
  t.after(() => process.off('unhandledRejection', record));
  const errors = t.mock.method(console, 'error', () => {});

  const client = await harness.connectAs({ userId: 7 }, t);
  for (const event of HANDLERS) send(client, event);
  // One socket's events run in order, so this ack returns after every event above.
  const ack = await harness.emit(client, 'league:join', {});

  assert.equal(ack.code, 'INVALID_REQUEST');
  assert.deepEqual(rejections, []);
  assert.equal(errors.mock.callCount(), 0);
}

test('a null payload never rejects', (t) => (
  assertProcessSurvives(t, (client, event) => client.emit(event, null))
));

test('a non-function acknowledgement never rejects', (t) => (
  assertProcessSurvives(t, (client, event) => client.emit(event, {}, 7))
));

test('a null payload answers its acknowledgement with the usual refusal', async (t) => {
  const client = await harness.connectAs({ userId: 7 }, t);
  const ack = await harness.emit(client, 'draft:pick', null);
  assert.deepEqual(ack, { error: 'leagueId and playerId (integers) required' });
});

test('a handler that throws is logged and never rejects', async (t) => {
  const rejections = [];
  const record = (reason) => rejections.push(reason);
  process.on('unhandledRejection', record);
  t.after(() => process.off('unhandledRejection', record));
  const errors = t.mock.method(console, 'error', () => {});

  const client = await harness.connectAs({ userId: 7 }, t);
  // chat:send reads the socket's rooms ahead of its try, so this throw has no catch of its own.
  Object.defineProperty(harness.serverSocket(client), 'rooms', {
    value: { has() { throw new Error('boom'); } },
  });
  client.emit('chat:send', { leagueId: 1, message: 'hello' });
  await harness.emit(client, 'league:join', {});

  assert.deepEqual(rejections, []);
  assert.equal(errors.mock.callCount(), 1);
});
