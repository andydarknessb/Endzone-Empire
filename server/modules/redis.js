const { createClient } = require('redis');
const { logger } = require('./logger');

let clientPromise = null;

function newClient() {
  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (error) => logger.error({ err: error }, 'redis client error'));
  return client;
}

async function getRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!clientPromise) {
    const client = newClient();
    clientPromise = client.connect().then(() => client).catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

async function createRedisSubscriber() {
  const client = await getRedisClient();
  if (!client) return null;
  const subscriber = client.duplicate();
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

module.exports = { closeRedis, createRedisSubscriber, getRedisClient };
