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

// Practice participation (CONTEXT.md; ADR 0056): the nflverse injury report's
// practice_status reads "Did Not Participate In Practice" and its primary
// injury text carries "Not injury related - resting player" for a vet's rest day.
const DID_NOT_PARTICIPATE = /did not participate/i;
const REST_RELATED = /not injury related|rest/i;

/**
 * Pure: true when `observations` (`[{ practiceStatus, practicePrimaryInjury,
 * reportPrimaryInjury }]`, every Practice participation observation stored for
 * the player this week) show no practice all week: at least one observation,
 * every practice_status did-not-participate (blank is not), and no observation
 * rest-related. No guessed practice days: the observations are the only input.
 */
function noPracticeAllWeek(observations) {
  if (!Array.isArray(observations) || observations.length === 0) return false;
  return observations.every((o) => DID_NOT_PARTICIPATE.test(String(o.practiceStatus || ''))
    && !REST_RELATED.test(String(o.practicePrimaryInjury || ''))
    && !REST_RELATED.test(String(o.reportPrimaryInjury || '')));
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
 * Precedence: bye, then No NFL team, then Practice squad, then Out and IR, then
 * Position-baseline (#1775, `positionBaseline`: available but never
 * auto-recommended; passed only by readers that already hold a projection).
 * `nflRosterStatus` is the fact every reader passes from its own player read
 * (`nflRosterStatus.js`'s column); `now` is injectable for tests.
 *
 * `practice` (`{ observations }`, ADR 0056) is passed ONLY by Start/sit advice:
 * a Questionable player with no practice all week (`noPracticeAllWeek`) reads
 * `no_practice`, never auto-recommended, after Position-baseline and Doubtful
 * and before plain Questionable. Every other reader omits it, so its verdict
 * and the stored active probability are unchanged. The active probability
 * stays null.
 */
function unavailableFor({
  injuryStatus = null, onBye = false, noTeam = false, nflRosterStatus = null, now = new Date(),
  locked = false, lockedSlot = null, positionBaseline = false, practice = null,
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
  if (positionBaseline) {
    // A Position-baseline projection (#1775): the number is the position's
    // average, not this player's own evidence. Startable if a manager insists,
    // never AUTO-recommended (Start/sit advice never moves him onto the
    // lineup). Reads only AFTER a Weekly projection exists, so the engine's
    // pre-projection call never passes it and no stored field changes. Bye,
    // no team, Out and IR (above) still win; this wins over Doubtful,
    // Questionable and no designation.
    return {
      available: true,
      autoRecommend: false,
      activeProbability: status === 'D' || status === 'Q' ? null : 1,
      reason: 'no_history',
      status,
      locked,
      lockedSlot,
    };
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
    if (practice && noPracticeAllWeek(practice.observations)) {
      return {
        available: true,
        autoRecommend: false,
        activeProbability: null,
        reason: 'no_practice',
        status,
        locked,
        lockedSlot,
      };
    }
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
