const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
const draftSocket = require('../modules/draftSocket');
const { logger } = require('../modules/logger');
const sentry = require('../modules/sentry');

/**
 * The one Draft room broadcast adapter (#745). It folds five helpers and ten
 * inline `io.to(...).emit` sites into one boot-constructed object over a
 * transport shaped `{ to(room) -> { emit(event, payload) } }`. These tests pin
 * the contract that made that fold safe:
 *   - each named method reaches the right ROOM with the right WIRE NAME and the
 *     caller's payload (the interface is by meaning; the wire names are the
 *     module's secret);
 *   - a transport whose emit rejects is REPORTED (one pino error, one
 *     captureError) and returns { delivered: false } rather than throwing to a
 *     post-commit caller;
 *   - construction with no transport THROWS in every environment, so there is no
 *     silent default - the exact production drop this adapter removes.
 */

/** A fake io-shaped transport recording every to(room).emit(event, payload). */
function recordingTransport() {
  const emits = [];
  return {
    emits,
    to(room) {
      return { emit(event, payload) { emits.push({ room, event, payload }); } };
    },
  };
}

test('each named method reaches to(league:<id>).emit(<wire name>, payload) on the transport', async (t) => {
  const transport = recordingTransport();
  const broadcast = createDraftRoomBroadcast(transport, 'io');

  const pickPayload = { player: { id: 7 }, auto: true };
  const activityEntry = { type: 'draft_activity', kind: 'pick', id: 3 };
  const snapshot = { league: { id: 5 }, teams: [], picks: [], onTheClock: null };
  // stateChanged computes the snapshot in-process via getDraftState (in EITHER
  // process); pin the wire mapping without touching the database.
  t.mock.method(draftSocket, 'getDraftState', async () => snapshot);

  assert.deepEqual(await broadcast.pickLanded(5, pickPayload), { delivered: true, transport: 'io' });
  await broadcast.activityAppended(5, activityEntry);
  await broadcast.draftCompleted(5);
  await broadcast.rosterChanged(5);
  await broadcast.stateChanged(5);

  assert.deepEqual(transport.emits, [
    { room: 'league:5', event: 'draft:picked', payload: pickPayload },
    { room: 'league:5', event: 'draft:activity', payload: activityEntry },
    { room: 'league:5', event: 'draft:complete', payload: { leagueId: 5 } },
    { room: 'league:5', event: 'roster:changed', payload: { leagueId: 5 } },
    { room: 'league:5', event: 'draft:state', payload: snapshot },
  ]);
});

test('scoresUpdated reaches to(league:<id>).emit(scores:updated, payload) with the payload unchanged (#765)', async () => {
  const transport = recordingTransport();
  const broadcast = createDraftRoomBroadcast(transport, 'emitter');

  const payload = {
    leagueId: 7,
    season: 2026,
    week: 8,
    scored: [{ matchupId: 70, homeScore: 12.5, awayScore: 9 }],
    plays: [{ playerId: 3, type: 'passing', isTouchdown: true }],
  };

  // Negative control (PR body): deleting the scoresUpdated method turns this red
  // (there is no such method to call), so the case pins the new tenant, not a
  // pre-existing one.
  assert.deepEqual(await broadcast.scoresUpdated(7, payload), { delivered: true, transport: 'emitter' });
  assert.equal(transport.emits.length, 1);
  assert.equal(transport.emits[0].room, 'league:7');
  assert.equal(transport.emits[0].event, 'scores:updated');
  assert.deepEqual(transport.emits[0].payload, payload);
});

test('scoresUpdated over a transport whose emit rejects yields { delivered: false } plus one pino error and one captureError (#765)', async (t) => {
  const boom = new Error('publish rejected');
  const transport = { to: () => ({ emit: () => Promise.reject(boom) }) };
  const broadcast = createDraftRoomBroadcast(transport, 'emitter');

  const errors = [];
  const captured = [];
  t.mock.method(logger, 'error', (obj, msg) => errors.push({ obj, msg }));
  t.mock.method(sentry, 'captureError', (err, ctx) => captured.push({ err, ctx }));

  const result = await broadcast.scoresUpdated(7, { leagueId: 7 });

  assert.equal(result.delivered, false);
  assert.equal(result.transport, 'emitter');
  assert.equal(result.error, boom);
  assert.equal(errors.length, 1, 'exactly one pino error');
  assert.equal(captured.length, 1, 'exactly one captureError');
  assert.deepEqual(captured[0].ctx, { event: 'scores:updated', leagueId: 7 });
  assert.equal(captured[0].err, boom);
});

test('a transport whose emit rejects yields { delivered: false } plus one pino error and one captureError', async (t) => {
  const boom = new Error('publish rejected');
  const transport = { to: () => ({ emit: () => Promise.reject(boom) }) };
  const broadcast = createDraftRoomBroadcast(transport, 'emitter');

  const errors = [];
  const captured = [];
  t.mock.method(logger, 'error', (obj, msg) => errors.push({ obj, msg }));
  t.mock.method(sentry, 'captureError', (err, ctx) => captured.push({ err, ctx }));

  const result = await broadcast.pickLanded(9, { auto: false });

  assert.equal(result.delivered, false);
  assert.equal(result.transport, 'emitter');
  assert.equal(result.error, boom);
  // Negative control (asserted): removing the captureError call in the adapter
  // drops this to 0, and removing the logger.error call drops the pino count.
  assert.equal(errors.length, 1, 'exactly one pino error');
  assert.equal(captured.length, 1, 'exactly one captureError');
  assert.deepEqual(captured[0].ctx, { event: 'draft:picked', leagueId: 9 });
  assert.equal(captured[0].err, boom);
});

test('stateChanged reports (never throws) when the in-process snapshot read fails', async (t) => {
  const transport = recordingTransport();
  const broadcast = createDraftRoomBroadcast(transport, 'io');
  const boom = new Error('snapshot read failed');
  t.mock.method(draftSocket, 'getDraftState', async () => { throw boom; });
  const captured = [];
  t.mock.method(logger, 'error', () => {});
  t.mock.method(sentry, 'captureError', (err, ctx) => captured.push({ err, ctx }));

  const result = await broadcast.stateChanged(5);

  // Post-commit, a failed snapshot read must be reported, not thrown: a started
  // or paused draft cannot be undone by a transport blip.
  assert.equal(result.delivered, false);
  assert.deepEqual(transport.emits, [], 'nothing was emitted');
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].ctx, { event: 'draft:state', leagueId: 5 });
});

test('construction with no transport throws (no silent default)', () => {
  assert.throws(() => createDraftRoomBroadcast(undefined, 'io'), /requires a transport/);
  assert.throws(() => createDraftRoomBroadcast(null), /requires a transport/);
  // Negative control: passing `undefined` as the fake (above) turns this red if
  // construction ever silently accepted a missing transport. A shaped object is
  // accepted, so the throw is about the transport, not about any argument.
  assert.doesNotThrow(() => createDraftRoomBroadcast({ to: () => ({ emit: () => {} }) }, 'io'));
});
