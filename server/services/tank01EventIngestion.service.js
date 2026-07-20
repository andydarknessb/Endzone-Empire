const round2 = (value) => Math.round(value * 100) / 100;

function coerceFiniteNumber(value) {
  if (value == null || value === '') return 0;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sequenceOf(event) {
  const sequence = Number(event && event.sequence);
  return Number.isFinite(sequence) ? sequence : Number.MAX_SAFE_INTEGER;
}

function eventKey(event) {
  if (event && event.event_id != null) return `event:${event.event_id}`;
  if (event && event.source && event.source.checksum) return `checksum:${event.source.checksum}`;
  return `sequence:${sequenceOf(event)}`;
}

function normalizeEvent(event) {
  const stats = (event && event.stats) || {};
  const relationships = (event && event.relationships) || {};
  const player = (event && event.player) || {};
  const passingYards = coerceFiniteNumber(stats.passing_yards);
  const passingTouchdowns = coerceFiniteNumber(stats.passing_touchdowns);
  const passerId = relationships.passer_id || (player.position === 'QB' ? player.player_id : null);

  return {
    eventId: event && event.event_id != null ? String(event.event_id) : null,
    sequence: sequenceOf(event),
    receivedAt: event && event.received_at ? String(event.received_at) : null,
    gameId: event && event.game && event.game.game_id ? String(event.game.game_id) : null,
    passerId,
    receiverId: relationships.receiver_id || null,
    normalizedStats: {
      passingYards,
      passingTouchdowns,
    },
    passingPoints: passerId ? round2(passingYards * 0.04 + passingTouchdowns * 4) : 0,
  };
}

async function ingestTank01Events(events, { writeEvent = async () => {} } = {}) {
  if (!Array.isArray(events)) throw new TypeError('Tank01 events must be an array');
  if (typeof writeEvent !== 'function') throw new TypeError('writeEvent must be a function');

  const ordered = events
    .map((event, inputIndex) => ({ event, inputIndex }))
    .sort((a, b) => sequenceOf(a.event) - sequenceOf(b.event) || a.inputIndex - b.inputIndex);
  const seen = new Set();
  const processedEvents = [];
  const playerScores = {};
  const latestSequenceByGame = {};
  let duplicatesDropped = 0;

  for (const { event } of ordered) {
    const key = eventKey(event);
    if (seen.has(key)) {
      duplicatesDropped += 1;
      continue;
    }
    seen.add(key);

    const normalized = normalizeEvent(event);
    if (normalized.passerId) {
      playerScores[normalized.passerId] = round2(
        (playerScores[normalized.passerId] || 0) + normalized.passingPoints
      );
    }
    if (normalized.gameId) latestSequenceByGame[normalized.gameId] = normalized.sequence;

    await writeEvent(normalized);
    processedEvents.push(normalized);
  }

  return {
    received: events.length,
    processed: processedEvents.length,
    duplicatesDropped,
    processedEvents,
    playerScores,
    latestSequenceByGame,
  };
}

module.exports = {
  coerceFiniteNumber,
  ingestTank01Events,
  normalizeEvent,
};
