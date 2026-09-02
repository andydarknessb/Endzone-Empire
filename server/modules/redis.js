const { createClient } = require('redis');
const { logger } = require('./logger');

// The room-facing publish is bounded so a hung publish (a disconnect that
// queues rather than fails) cannot leave a caller awaiting forever. The shim in
// draftEvents.js races the publish against this bound; the constant lives here
// so the transport owns its own timeout (#744).
const DRAFT_PUBLISH_TIMEOUT_MS = 2000;

let clientPromise = null;
let draftPublisherPromise = null;

// The SHARED client. It backs the Socket.IO @socket.io/redis-adapter's
// pubClient, whose publish calls the adapter makes are un-awaited and uncaught,
// so it MUST keep node-redis defaults: with the offline queue disabled a
// publish during a disconnect rejects, and unhandled inside the adapter that
// terminates the process, taking down every Socket.IO broadcast (league chat
// included). Fail-fast belongs to the dedicated draft publisher below, never
// here (#744, review 751-f1). Exported so boot code and tests can substitute it.
function newClient() {
  return createClient({ url: process.env.REDIS_URL });
}

// The DEDICATED room-facing draft publisher, separate from the shared adapter
// client. It runs fail-fast (offline queue disabled) so a publish during a
// disconnect rejects and the draft shim can bound and REPORT it instead of
// queuing it invisibly. Because it is its own client, that fail-fast never
// reaches the adapter's uncaught publish path.
function newDraftPublisher() {
  return createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true });
}

// A fatal error tears a client's socket down (isOpen goes false) after a
// successful connect, leaving a dead client cached forever. This handler drops
// the matching cached promise so the next getter reconnects rather than handing
// the dead client to every later caller (#744). A non-fatal error (isOpen still
// true) leaves the cache intact.
function attachFatalErrorReset(client, isCached, clearCache, label) {
  client.on('error', (error) => {
    logger.error({ err: error }, label);
    if (!client.isOpen && isCached()) clearCache();
  });
}

async function getRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!clientPromise) {
    const client = module.exports.newClient();
    attachFatalErrorReset(client, () => clientPromise !== null, () => { clientPromise = null; }, 'redis client error');
    clientPromise = Promise.resolve(client.connect())
      .then(() => client)
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}

async function getDraftPublisher() {
  if (!process.env.REDIS_URL) return null;
  if (!draftPublisherPromise) {
    const publisher = module.exports.newDraftPublisher();
    attachFatalErrorReset(publisher, () => draftPublisherPromise !== null, () => { draftPublisherPromise = null; }, 'draft publisher error');
    draftPublisherPromise = Promise.resolve(publisher.connect())
      .then(() => publisher)
      .catch((error) => {
        draftPublisherPromise = null;
        throw error;
      });
  }
  return draftPublisherPromise;
}

async function createRedisSubscriber() {
  const client = await getRedisClient();
  if (!client) return null;
  // The adapter's subClient: node-redis defaults, like its pubClient above.
  const subscriber = client.duplicate();
  subscriber.on('error', (error) => logger.error({ err: error }, 'redis subscriber error'));
  await subscriber.connect();
  return subscriber;
}

async function closeRedis() {
  const promises = [clientPromise, draftPublisherPromise];
  clientPromise = null;
  draftPublisherPromise = null;
  for (const promise of promises) {
    if (!promise) continue;
    const client = await promise.catch(() => null);
    if (client && client.isOpen) await client.quit();
  }
}

module.exports = {
  DRAFT_PUBLISH_TIMEOUT_MS,
  closeRedis,
  createRedisSubscriber,
  getDraftPublisher,
  getRedisClient,
  newClient,
  newDraftPublisher,
};
