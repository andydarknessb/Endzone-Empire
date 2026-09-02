const { Emitter } = require('@socket.io/redis-emitter');
const redis = require('./redis');
const { logger } = require('./logger');
const sentry = require('./sentry');

/**
 * A room-facing emitter over the hardened Redis client.
 *
 * `@socket.io/redis-emitter`'s own `emit` is fire-and-forget: it calls
 * `client.publish(...)` and returns `true` without awaiting the publish, so its
 * return value cannot tell delivery from loss. We wrap the client so the emit
 * hands back the underlying publish promise, letting publishDraftEvent bound and
 * report it. The real fan-out still rides the same `@socket.io/redis-adapter`
 * the API runs; only the awaiting is ours.
 *
 * Exported (and called through module.exports below) so a test can inject a fake
 * emitter whose emit never resolves, to prove the timeout bound is what fires.
 */
function buildEmitter(client) {
  return {
    emit(room, event, payload) {
      let publish = null;
      const capturingClient = {
        publish: (channel, message) => {
          publish = Promise.resolve(client.publish(channel, message));
          return publish;
        },
      };
      // The BroadcastOperator's emit calls capturingClient.publish synchronously,
      // setting `publish` to the real publish promise before it returns. If a
      // future emitter version defers, batches, or short-circuits on an empty
      // room and never calls publish, `publish` stays null and we throw rather
      // than silently reporting a delivery that never happened (review 751-f5).
      new Emitter(capturingClient).to(room).emit(event, payload);
      if (!publish) throw new Error('emitter did not publish the draft event');
      return publish;
    },
  };
}

/** Reject if `promise` has not settled within `ms`, so a hung publish fails. */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`draft room publish exceeded ${ms}ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Publish a room-wide Draft event through the standard emitter.
 *
 * The contract is "delivered or reported": it returns
 * `{ delivered: true, transport: 'emitter' }` once the event is handed to the
 * transport without error, or on ANY failure logs one pino error, reports one
 * Sentry event, and returns `{ delivered: false, transport: 'emitter', error }`.
 * It never returns a bare boolean and never resolves without either delivering
 * or reporting. "Delivered" means handed to the transport, not acknowledged by a
 * client; a reconnect refetch of `draft:state` remains the client's backstop, so
 * there is no retry here (a retry would hide the failure and can reorder an event
 * behind a later success). See ADR 0025.
 */
async function publishDraftEvent({ leagueId, event, payload }) {
  try {
    const client = await redis.getDraftPublisher();
    if (!client) throw new Error('no Redis client for draft room publish');

    let body = payload;
    if (event === 'draft:state') {
      // The worker computes the snapshot in-process from the same database
      // post-commit; the old API-side re-derive is gone (ADR 0025).
      const { getDraftState } = require('./draftSocket');
      body = await getDraftState(leagueId);
    }

    const emitter = module.exports.buildEmitter(client);
    await withTimeout(emitter.emit(`league:${leagueId}`, event, body), redis.DRAFT_PUBLISH_TIMEOUT_MS);
    return { delivered: true, transport: 'emitter' };
  } catch (error) {
    logger.error({ err: error, event, leagueId }, 'draft room publish failed');
    sentry.captureError(error, { event, leagueId });
    return { delivered: false, transport: 'emitter', error };
  }
}

module.exports = {
  buildEmitter,
  publishDraftEvent,
  withTimeout,
};
