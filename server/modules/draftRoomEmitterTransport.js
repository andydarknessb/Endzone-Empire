const { Emitter } = require('@socket.io/redis-emitter');
const redis = require('./redis');

/**
 * The WORKER's Draft room transport: a `{ to(room) -> { emit(event, payload) } }`
 * over the hardened Redis client (#744, ADR 0025), handed to the one draft room
 * broadcast adapter (#745) at worker boot. The worker has no local Socket.IO
 * server, so a room event it produces (a scheduled autostart's state refresh, an
 * expiry autopick, an escalation) rides here to the same `@socket.io/redis-adapter`
 * the API instances subscribe to, and fans out to every connected client.
 *
 * The honesty this preserves from #744: `@socket.io/redis-emitter`'s own `emit`
 * is fire-and-forget - it calls `client.publish(...)` and returns `true` without
 * awaiting - so its return value cannot tell delivery from loss. We wrap the
 * client so `emit` hands back the underlying publish promise and race it against
 * a timeout bound; the adapter above then reports a failure rather than claiming
 * a delivery that never happened. "Delivered" means handed to the transport, not
 * acknowledged by a client; the client's reconnect refetch of `draft:state`
 * remains the backstop, so there is no retry here.
 */

/** Reject if `promise` has not settled within `ms`, so a hung publish fails
 *  loudly instead of leaving the caller awaiting forever. */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`draft room publish exceeded ${ms}ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createEmitterTransport() {
  return {
    to(room) {
      return {
        async emit(event, payload) {
          const client = await redis.getDraftPublisher();
          if (!client) throw new Error('no Redis client for draft room publish');

          let publish = null;
          const capturingClient = {
            publish: (channel, message) => {
              publish = Promise.resolve(client.publish(channel, message));
              return publish;
            },
          };
          // The BroadcastOperator's emit calls capturingClient.publish
          // synchronously, setting `publish` to the real publish promise before
          // it returns. If a future emitter version defers, batches, or
          // short-circuits on an empty room and never calls publish, `publish`
          // stays null and we throw rather than reporting a delivery that never
          // happened (#744, review 751-f5).
          new Emitter(capturingClient).to(room).emit(event, payload);
          if (!publish) throw new Error('emitter did not publish the draft event');
          await withTimeout(publish, redis.DRAFT_PUBLISH_TIMEOUT_MS);
        },
      };
    },
  };
}

module.exports = { createEmitterTransport, withTimeout };
