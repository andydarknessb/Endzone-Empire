'use strict';

/**
 * Unavailable (CONTEXT.md): the one server verdict on whether a player can
 * play this week. Every server reader (the projection engine, Start/sit
 * advice, the Expected final, the Lineup wire, the League detail fallback)
 * calls this with the same facts, so they cannot disagree.
 */

/**
 * Pure: hard availability, applied BEFORE optimization rather than as a
 * projection haircut.
 *
 * `activeProbability` is 1 for a player with no designation, 0 for a bye/Out/IR
 * and null for Questionable/Doubtful. That null is the honest answer: the only
 * injury signal this app stores is a coarse four-value designation, and there
 * is no snapshot history to calibrate "Questionable" into a real probability
 * from. Inventing 0.6 would look like a measurement.
 */
function unavailableFor({
  injuryStatus = null, onBye = false, noTeam = false, locked = false, lockedSlot = null,
} = {}) {
  const status = injuryStatus ? String(injuryStatus).toUpperCase() : null;
  if (onBye) {
    return { available: false, activeProbability: 0, reason: 'bye', status, locked, lockedSlot };
  }
  // No NFL team (players.nfl_team IS NULL): no game to play in, so hard
  // unavailable like a bye. The projected number itself is unchanged (#1589).
  if (noTeam) {
    return { available: false, activeProbability: 0, reason: 'no_team', status, locked, lockedSlot };
  }
  if (status === 'O') {
    return { available: false, activeProbability: 0, reason: 'out', status, locked, lockedSlot };
  }
  if (status === 'IR') {
    return { available: false, activeProbability: 0, reason: 'ir', status, locked, lockedSlot };
  }
  if (status === 'D') {
    // Doubtful players are startable if a manager insists, but never
    // AUTO-recommended over a healthy player: without a real active
    // probability there is nothing to trade off against.
    return {
      available: true,
      autoRecommend: false,
      activeProbability: null,
      reason: 'doubtful',
      status,
      locked,
      lockedSlot,
    };
  }
  if (status === 'Q') {
    return {
      available: true,
      autoRecommend: true,
      activeProbability: null,
      reason: 'questionable',
      status,
      locked,
      lockedSlot,
    };
  }
  return { available: true, autoRecommend: true, activeProbability: 1, reason: null, status, locked, lockedSlot };
}

module.exports = { unavailableFor };
