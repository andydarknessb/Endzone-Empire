const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSocketHarness } = require('./helpers/socketHarness');
const { signToken } = require('../modules/auth');
const { leagueWorld, LEAGUE_ID, OWNER, CO_COMMISSIONER, MEMBER } = require('./helpers/socketJoinWorld');
const {
  MAX_SOCKETS_PER_USER,
  BUCKET_CAPACITY,
  REFILL_PER_SECOND,
} = require('../modules/socketRateLimit');

/**
 * #2605 (spec #2602, 3/6): one League member can no longer tie up the database
 * pool with socket events.
 *
 * This suite runs through the REAL harness (server, production wiring, real
 * client) with an INJECTED clock, so it measures the two things a unit test of
 * the bucket cannot: that the middleware sits before every handler, and that
 * its refusals reach the client in the error shape the handlers already use.
 *
 * The clock is a mutable variable read at each decision, never a mocked global
 * Date: the socket server itself keeps heartbeats and timeouts on the real
 * timers, and a mocked global Date stalls them.
 *
 * Each test uses its OWN user id. The harness's server (and so its bucket
 * store) lives for the whole file, and a shared bucket would leak one test's
 * spend into the next.
 *
 * REMOVING THE MIDDLEWARE TURNS THE FIRST TEST RED, and it is meant to be the
 * control: the refused 21st event is a real `league:join`, which really reads
 * the database, so without the middleware it answers `{ ok: true }` after
 * issuing its queries. Nothing here asserts merely that "an error" arrived.
 */
let clock = 1_000_000;
const harness = createSocketHarness({ secret: 'socket-rate-limit-secret', now: () => clock });

/** `league:join` for one user: a handled event that issues two queries. */
const eventsIn = (client, count) => Promise.all(
  Array.from({ length: count }, () => harness.emit(client, 'league:join', { leagueId: LEAGUE_ID }))
);

test('the bucket holds 20 events and refills at 2 a second', () => {
  // The contract every test below is written against, asserted once.
  assert.equal(BUCKET_CAPACITY, 20);
  assert.equal(REFILL_PER_SECOND, 2);
});

test('a 21st event inside one second is refused, issues no query, and the socket stays connected', async (t) => {
  const fake = leagueWorld({}).install(t);
  const client = await harness.connectAs(OWNER, t);

  const handled = await eventsIn(client, 20);
  assert.deepEqual(handled.map((ack) => ack.ok), Array(20).fill(true), 'the first 20 are handled');

  const spent = fake.calls.length;
  const refused = await harness.emit(client, 'league:join', { leagueId: LEAGUE_ID });

  assert.equal(refused.code, 'RATE_LIMITED');
  assert.equal(typeof refused.error, 'string', 'the ack keeps the handlers\' error shape');
  assert.ok(refused.retryAfterMs > 0, 'the client is told when to retry');
  assert.equal(fake.calls.length, spent, 'the refused event never reached its handler');
  assert.equal(client.connected, true, 'the socket is not disconnected');
});

test('two sockets of one user draw on the same bucket: 20 across both are handled and the 21st is refused', async (t) => {
  leagueWorld({}).install(t);
  const first = await harness.connectAs(MEMBER, t);
  const second = await harness.connectAs(MEMBER, t);

  const handled = [
    ...await Promise.all(Array.from({ length: 10 }, () => harness.emit(first, 'league:join', { leagueId: LEAGUE_ID }))),
    ...await Promise.all(Array.from({ length: 10 }, () => harness.emit(second, 'league:join', { leagueId: LEAGUE_ID }))),
  ];
  assert.deepEqual(handled.map((ack) => ack.ok), Array(20).fill(true), 'the first 20 are handled');

  const refused = await harness.emit(second, 'league:join', { leagueId: LEAGUE_ID });
  assert.equal(refused.code, 'RATE_LIMITED');
  assert.equal(first.connected, true);
  assert.equal(second.connected, true);
});

test('a second later two more events are handled, and a third is refused again', async (t) => {
  leagueWorld({}).install(t);
  const client = await harness.connectAs(CO_COMMISSIONER, t);

  await eventsIn(client, 20);
  assert.equal((await harness.emit(client, 'league:join', { leagueId: LEAGUE_ID })).code, 'RATE_LIMITED');

  clock += 1000;
  const [a, b] = await eventsIn(client, 2);
  assert.equal(a.ok, true, 'the clock refilled two tokens');
  assert.equal(b.ok, true, 'the clock refilled two tokens');
  assert.equal((await harness.emit(client, 'league:join', { leagueId: LEAGUE_ID })).code, 'RATE_LIMITED');
});

test('an 11th socket is refused with TOO_MANY_SOCKETS, and a different user still connects', async (t) => {
  leagueWorld({}).install(t);
  const held = [];
  for (let i = 0; i < MAX_SOCKETS_PER_USER; i += 1) {
    held.push(await harness.connectAs(OWNER, t));
  }
  assert.equal(held.filter((client) => client.connected).length, MAX_SOCKETS_PER_USER);

  const outcome = await harness.connectExpectingRefusal(
    { auth: { token: signToken({ id: OWNER.userId, username: OWNER.username }) } },
    t
  );
  assert.equal(outcome, 'TOO_MANY_SOCKETS');

  const other = await harness.connectAs(MEMBER, t);
  assert.equal(other.connected, true, 'the cap is per user, not global');
});
