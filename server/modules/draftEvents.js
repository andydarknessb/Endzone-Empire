const redis = require('./redis');
const { logger } = require('./logger');

const DRAFT_EVENTS_CHANNEL = 'endzone:draft-events:v1';
const DRAFT_EVENT_NAMES = new Set([
  'draft:picked',
  'draft:activity',
  'draft:complete',
  'draft:state',
  'roster:changed',
]);

/** Publish a draft event for a separate API/web process to relay to sockets. */
async function publishDraftEvent(event) {
  try {
    const publisher = await redis.getRedisClient();
    if (!publisher) return false;
    await publisher.publish(DRAFT_EVENTS_CHANNEL, JSON.stringify(event));
    return true;
  } catch (error) {
    logger.error({ err: error, event: event.event, leagueId: event.leagueId }, 'draft event publish failed');
    return false;
  }
}

/** Start the API-side Redis subscriber that relays worker events to Socket.IO. */
async function startDraftEventRelay(io) {
  const subscriber = await redis.createRedisSubscriber();
  if (!subscriber) return null;
  await subscriber.subscribe(DRAFT_EVENTS_CHANNEL, (message) => {
    return relayDraftEvent(io, message).catch((error) => {
      logger.error({ err: error }, 'draft event relay failed');
    });
  });
  return subscriber;
}

async function relayDraftEvent(io, rawMessage) {
  let message;
  try {
    message = JSON.parse(rawMessage);
  } catch (error) {
    logger.warn({ err: error }, 'invalid draft event received');
    return;
  }
  if (!Number.isInteger(message.leagueId) || !DRAFT_EVENT_NAMES.has(message.event)) {
    logger.warn({ event: message.event, leagueId: message.leagueId }, 'ignored invalid draft event');
    return;
  }

  let payload = message.payload;
  if (message.event === 'draft:state') {
    // The worker publishes a state-refresh request rather than duplicating the
    // full snapshot. The API owns getDraftState and can read the latest commit.
    const { getDraftState } = require('./draftSocket');
    payload = await getDraftState(message.leagueId);
  }
  io.to(`league:${message.leagueId}`).emit(message.event, payload);
}

async function closeDraftEventRelay(subscriber) {
  if (!subscriber || !subscriber.isOpen) return;
  await subscriber.unsubscribe(DRAFT_EVENTS_CHANNEL);
  await subscriber.quit();
}

module.exports = {
  DRAFT_EVENTS_CHANNEL,
  closeDraftEventRelay,
  publishDraftEvent,
  startDraftEventRelay,
};
