'use strict';

/**
 * Unavailable (CONTEXT.md): the one server verdict on whether a player can
 * play this week. Every server reader (the projection engine, Start/sit
 * advice, the Expected final, the Lineup wire, the League detail fallback)
 * calls this with the same facts, so they cannot disagree.
 */

// An NFL roster status older than this reads as Active (#1767): the daily ESPN
// Sync run writes a fresh row for every player still on a team roster, so a
// stale row means the player dropped off every roster group since.
const NFL_ROSTER_STATUS_FRESH_MS = 48 * 60 * 60 * 1000;

/**
 * Pure: true when `nflRosterStatus` (the latest `player_nfl_roster_status`
 * row as `{ status, capturedAt }`, see nflRosterStatus.js) says Practice squad
 * and was captured within the last 48 hours of `now`. Missing, stale,
 * unparseable, Active and Reserve all read false: Reserve gates nothing.
 */
function onPracticeSquad(nflRosterStatus, now) {
  if (!nflRosterStatus || nflRosterStatus.status !== 'practice_squad') return false;
  const capturedAt = new Date(nflRosterStatus.capturedAt).getTime();
  if (!Number.isFinite(capturedAt)) return false;
  return new Date(now).getTime() - capturedAt <= NFL_ROSTER_STATUS_FRESH_MS;
}

/**
 * Pure: hard availability, applied BEFORE optimization rather than as a
 * projection haircut.
 *
 * `activeProbability` is 1 for a player with no designation, 0 for a bye/Out/IR
 * and null for Questionable/Doubtful. That null is the honest answer: the only
 * injury signal this app stores is a coarse four-value designation, and there
 * is no snapshot history to calibrate "Questionable" into a real probability
 * from. Inventing 0.6 would look like a measurement.
 *
 * Precedence: bye, then No NFL team, then Practice squad, then Out and IR.
 * `nflRosterStatus` is the fact every reader passes from its own player read
 * (`nflRosterStatus.js`'s column); `now` is injectable for tests.
 */
function unavailableFor({
  injuryStatus = null, onBye = false, noTeam = false, nflRosterStatus = null, now = new Date(),
  locked = false, lockedSlot = null,
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
  // Practice squad (#1767): not on the 53, so no game this week unless
  // elevated (#1768 checks that a Saturday elevation reads Active). Like No
  // NFL team, the projected number itself is unchanged.
  if (onPracticeSquad(nflRosterStatus, now)) {
    return { available: false, activeProbability: 0, reason: 'practice_squad', status, locked, lockedSlot };
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

module.exports = { unavailableFor, NFL_ROSTER_STATUS_FRESH_MS };
