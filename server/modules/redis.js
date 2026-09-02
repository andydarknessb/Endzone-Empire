const { createClient } = require('redis');
const { logger } = require('./logger');

// The room-facing publish is bounded so a hung publish (a disconnect that
// queues rather than fails) cannot leave a caller awaiting forever. The shim in
// draftEvents.js races the publish against this bound; the constant lives here
// so the transport owns its own timeout (#744).
const DRAFT_PUBLISH_TIMEOUT_MS = 2000;

let clientPromise = null;

// Exported so boot code and tests can substitute the client. The publisher runs
// with the offline queue disabled: a publish during a disconnect must fail fast
// (so the shim can report it) rather than queue silently (#744).
function newClient() {
  return createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true });
}

async function getRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!clientPromise) {
    const client = module.exports.newClient();
    client.on('error', (error) => {
      logger.error({ err: error }, 'redis client error');
      // A fatal error tears the socket down (isOpen goes false) after a
      // successful connect, leaving a dead client cached forever. Drop the
      // cached promise so the next getRedisClient() reconnects rather than
      // handing the dead client to every later caller (#744).
      if (!client.isOpen && clientPromise) clientPromise = null;
    });
    clientPromise = Promise.resolve(client.connect())
      .then(() => client)
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}

async function createRedisSubscriber() {
  const client = await getRedisClient();
  if (!client) return null;
  // Same offline-queue setting as the publisher; #614 reuses this subscriber.
  const subscriber = client.duplicate({ disableOfflineQueue: true });
  subscriber.on('error', (error) => logger.error({ err: error }, 'redis subscriber error'));
  await subscriber.connect();
  return subscriber;
}

async function closeRedis() {
  if (!clientPromise) return;
  const client = await clientPromise.catch(() => null);
  clientPromise = null;
  if (client && client.isOpen) await client.quit();
}

module.exports = {
  DRAFT_PUBLISH_TIMEOUT_MS,
  closeRedis,
  createRedisSubscriber,
  getRedisClient,
  newClient,
};
