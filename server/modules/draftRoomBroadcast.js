const { logger } = require('./logger');
const sentry = require('./sentry');

/**
 * The one adapter every room-wide Draft broadcast rides (#745). It folds the
 * five old broadcast helpers and the ten inline `io.to(...).emit` sites into one
 * boot-constructed object with named methods, so a room event can no longer be
 * emitted three different ways under three different policies for a missing `io`.
 *
 * It is constructed ONCE at boot, per process, over a transport shaped
 * `{ to(room) -> { emit(event, payload) } }`:
 *   - the API passes its Socket.IO `io` (from attachDraftSocket), whose
 *     `to(room).emit(...)` fans out in-process and, behind the redis-adapter, to
 *     every instance;
 *   - the worker passes the redis emitter transport (#744, ADR 0025), whose
 *     `to(room).emit(...)` publishes over Redis and resolves once the publish is
 *     handed to the transport or the timeout bound fires.
 * The worker never has an `io`, and startDraft/the Pick clock run there on
 * scheduled autostart and expiry, so before this adapter their `draft_start`
 * activity and state refresh were dropped silently in production (#745). There
 * is no `require('./io')` here on purpose: the module never reaches for a
 * transport, it is handed one, which is what makes the worker path honest.
 *
 * The interface is by MEANING (`pickLanded`, `activityAppended`, ...); the wire
 * names (`draft:picked`, `draft:activity`, ...) are internal to this module, so
 * a caller cannot spell one wrong. Each method is "delivered or reported": it
 * returns `{ delivered, transport, error? }` and on ANY failure logs one pino
 * error and reports one Sentry event, then returns. It never throws to a caller
 * post-commit, never retries, and never dedupes: a reconnect refetch of
 * `draft:state` is the client's backstop (ADR 0025).
 */
function createDraftRoomBroadcast(io, transportName = 'local') {
  // `io` is the io-SHAPED transport `{ to(room) -> { emit(event, payload) } }`:
  // the API passes its real Socket.IO server, the worker passes the Redis
  // emitter transport (#744). This module is the ONE place a room-wide Draft
  // event is spelled `io.to(...).emit(...)` (the source-form guard pins that);
  // every former helper and inline site now routes through here.
  //
  // Construction with no transport throws in EVERY environment (#745): there is
  // no silent default that drops the event, which is the exact production bug
  // this adapter removes. A test injects a recording transport instead.
  if (!io || typeof io.to !== 'function') {
    throw new Error('draft room broadcast requires a transport shaped { to(room) -> { emit(event, payload) } }');
  }

  async function send(leagueId, event, payload) {
    try {
      // The API transport's emit is synchronous and returns undefined; the
      // worker's returns a publish promise. Await only a thenable so the io path
      // adds no microtask and the emitter path is bounded/reported.
      const pending = io.to(`league:${leagueId}`).emit(event, payload);
      if (pending && typeof pending.then === 'function') await pending;
      return { delivered: true, transport: transportName };
    } catch (error) {
      logger.error({ err: error, event, leagueId }, 'draft room broadcast failed');
      sentry.captureError(error, { event, leagueId });
      return { delivered: false, transport: transportName, error };
    }
  }

  return {
    /** A committed Pick (manual or auto). The payload is built at the caller
     *  (`{ ...outcome, auto }`) so socketPayloadShape keeps its pinnable sites. */
    pickLanded: (leagueId, payload) => send(leagueId, 'draft:picked', payload),
    /** One typed lifecycle/Pick activity entry for the combined feed (ADR 0012). */
    activityAppended: (leagueId, entry) => send(leagueId, 'draft:activity', entry),
    /** The board signal that the draft finished. */
    draftCompleted: (leagueId) => send(leagueId, 'draft:complete', { leagueId }),
    /** The availability read model changed; clients refetch the Player list. */
    rosterChanged: (leagueId) => send(leagueId, 'roster:changed', { leagueId }),
    /** The whole-board refresh. The snapshot is computed in-process from the
     *  committed database, in EITHER process, so the worker ships the same
     *  `draft:state` the API would (ADR 0025). A failure to read it is reported
     *  like any other, never thrown post-commit. */
    stateChanged: async (leagueId) => {
      try {
        // Lazy require: draftSocket constructs this adapter at attach time, so a
        // top-level require would close a cycle. getDraftState reads only the
        // pool, so it runs in the worker as well as the API.
        const { getDraftState } = require('./draftSocket');
        const snapshot = await getDraftState(leagueId);
        return await send(leagueId, 'draft:state', snapshot);
      } catch (error) {
        logger.error({ err: error, event: 'draft:state', leagueId }, 'draft room broadcast failed');
        sentry.captureError(error, { event: 'draft:state', leagueId });
        return { delivered: false, transport: transportName, error };
      }
    },
  };
}

// The process-wide broadcast, registered once at boot: the API in
// attachDraftSocket, the worker in startWorker. Services (pickClock, draftStart)
// and the draft router read it through getDraftRoomBroadcast() rather than
// reaching for a transport themselves; a test swaps in a recording broadcast.
let current = null;

/** Register the process's broadcast. Returns the previously registered one. */
function setDraftRoomBroadcast(instance) {
  const prior = current;
  current = instance;
  return prior;
}

/** The registered broadcast, or throw if boot never registered one. Throwing is
 *  deliberate: a room emit with no transport is the production bug #745 fixes,
 *  so it must be loud rather than silently dropped. */
function getDraftRoomBroadcast() {
  if (!current) throw new Error('draft room broadcast is not initialised for this process');
  return current;
}

/** The registered broadcast or null, without throwing. For boot/teardown code
 *  that captures and restores the registration (the socket harness, test hooks). */
function peekDraftRoomBroadcast() {
  return current;
}

module.exports = {
  createDraftRoomBroadcast,
  setDraftRoomBroadcast,
  getDraftRoomBroadcast,
  peekDraftRoomBroadcast,
};
