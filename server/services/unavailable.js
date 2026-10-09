'use strict';

/**
 * Unavailable (CONTEXT.md): the one server verdict on whether a player can
 * play this week. It is an internal seam of the Weekly projection read
 * (projection.service.js; ADR 0061): every other reader gets the Start verdict
 * by player id from the read's result and passes no facts of its own. Lineup
 * lock is not part of it; callers that need both compose the lock beside the
 * verdict.
 */

// An NFL roster status older than this reads as Active (#1767): the daily ESPN
// Sync run writes a fresh row for every player still on a team roster, so a
// stale row means the player dropped off every roster group since.
const NFL_ROSTER_STATUS_FRESH_MS = 48 * 60 * 60 * 1000;

/**
 * Pure: true when `nflRosterStatus` (the latest `player_nfl_roster_status`
 * row as `{ status, capturedAt }`, see nflRosterStatus.js) says `status` and
 * was captured within the last 48 hours of `now`. Missing, stale, unparseable
 * and any other status all read false: Active and Reserve gate nothing.
 */
function rosterStatusIs(status, nflRosterStatus, now) {
  if (!nflRosterStatus || nflRosterStatus.status !== status) return false;
  const capturedAt = new Date(nflRosterStatus.capturedAt).getTime();
  if (!Number.isFinite(capturedAt)) return false;
  return new Date(now).getTime() - capturedAt <= NFL_ROSTER_STATUS_FRESH_MS;
}

// Practice participation (CONTEXT.md; ADR 0056): the nflverse injury report's
// practice_status reads "Did Not Participate In Practice" and its primary
// injury text carries "Not injury related - resting player" for a vet's rest
// day. Rest is the whole word "rest" or "resting" in either primary-injury
// text, nothing broader: "Not injury related - personal matter" (or illness,
// or no reason at all) is a real absence and counts as did not participate.
const DID_NOT_PARTICIPATE = /did not participate/i;
const REST_RELATED = /\brest(ing)?\b/i;

// Coverage (ADR 0056): the nflverse file carries only the LATEST report, so one
// observation first seen late in the week says nothing about the days before
// it. A week's observations count only when the earliest was observed by the
// end of the week's Thursday (ET, the Thursday on or before the game day: the
// last team practice-report day for a Sunday or Monday game) AND at least 48
// hours before the player's kickoff (which is what binds for a Thursday or
// Saturday game, whose practice days come earlier).
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const COVERAGE_LEAD_MS = 48 * HOUR_MS;
const ET_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function etParts(at) {
  return Object.fromEntries(ET_DATE_PARTS.formatToParts(at).map((p) => [p.type, p.value]));
}

/** The instant of midnight (ET) starting the given calendar date: 05:00Z reads
 * 00:00 under EST and 01:00 under EDT, so stepping back that hour lands on
 * midnight either way. */
function etMidnight(year, month, day) {
  const guess = Date.UTC(year, month - 1, day, 5);
  return guess - Number(etParts(new Date(guess)).hour) * HOUR_MS;
}

/**
 * Pure: when Practice participation coverage must have begun for `kickoffAt`
 * (a Date or ISO string): the earlier of the end of the Thursday (ET) on or
 * before the kickoff's ET date and 48 hours before kickoff, as a Date; null
 * when there is no readable kickoff.
 */
function practiceCoverageDeadline(kickoffAt) {
  const kickoff = kickoffAt == null ? NaN : new Date(kickoffAt).getTime();
  if (!Number.isFinite(kickoff)) return null;
  const parts = etParts(new Date(kickoff));
  const daysSinceThursday = (WEEKDAYS.indexOf(parts.weekday) - WEEKDAYS.indexOf('Thu') + 7) % 7;
  const thursday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - daysSinceThursday * DAY_MS);
  const endOfThursday = etMidnight(thursday.getUTCFullYear(), thursday.getUTCMonth() + 1, thursday.getUTCDate() + 1);
  return new Date(Math.min(endOfThursday, kickoff - COVERAGE_LEAD_MS));
}

/**
 * Pure: true when `observations` (`[{ practiceStatus, practicePrimaryInjury,
 * reportPrimaryInjury, observedAt }]`, every Practice participation
 * observation stored for the player this week) show no practice all week: at
 * least one observation, coverage begun by `practiceCoverageDeadline(kickoffAt)`
 * (the earliest observation, whatever order the list is in), every
 * practice_status did-not-participate (blank is not), and no observation
 * rest-related. No guessed practice days: the observations are the only input,
 * and with no kickoff on file nothing fires.
 */
function noPracticeAllWeek(observations, kickoffAt) {
  if (!Array.isArray(observations) || observations.length === 0) return false;
  const deadline = practiceCoverageDeadline(kickoffAt);
  if (deadline === null) return false;
  const earliest = Math.min(...observations.map((o) => (o.observedAt == null ? NaN : new Date(o.observedAt).getTime())));
  if (!Number.isFinite(earliest) || earliest >= deadline.getTime()) return false;
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
 * Precedence: bye, then No NFL team, then Practice squad, then Suspended, then Out and IR, then
 * Backup quarterback (ADR 0057, `backup`: available but never auto-recommended,
 * reason `backup`; above Position-baseline since the 2026-10-07 amendment, #2044),
 * then Position-baseline (#1775, `positionBaseline`: the same shape, reason
 * `no_history`; passed only by the read once it holds a projection), then
 * Doubtful, no-practice and Questionable.
 * `nflRosterStatus` is the fact the projection read passes from its own player
 * read (`nflRosterStatus.js`'s column); `now` is injectable for tests.
 *
 * `practice` (`{ observations, kickoffAt }`, ADR 0056) is passed ONLY by the
 * Weekly projection read's `startVerdictFor` (the one producer of the Start
 * verdict, spec #2042; ADR 0061): a Questionable player with no practice all
 * week (`noPracticeAllWeek`, with `kickoffAt` his game for the coverage
 * deadline) reads `no_practice`, never auto-recommended, after Position-baseline
 * and Doubtful and before plain Questionable. The engine's own call omits it, so
 * the stored verdict and the stored active probability are unchanged. The
 * active probability stays null.
 */
function unavailableFor({
  injuryStatus = null, onBye = false, noTeam = false, nflRosterStatus = null, now = new Date(),
  positionBaseline = false, backup = false, practice = null,
} = {}) {
  const status = injuryStatus ? String(injuryStatus).toUpperCase() : null;
  if (onBye) {
    return { available: false, activeProbability: 0, reason: 'bye', status };
  }
  // No NFL team (players.nfl_team IS NULL): no game to play in, so hard
  // unavailable like a bye. The projected number itself is unchanged (#1589).
  if (noTeam) {
    return { available: false, activeProbability: 0, reason: 'no_team', status };
  }
  // Practice squad (#1767): not on the 53, so no game this week unless
  // elevated (#1768 checks that a Saturday elevation reads Active). Like No
  // NFL team, the projected number itself is unchanged.
  if (rosterStatusIs('practice_squad', nflRosterStatus, now)) {
    return { available: false, activeProbability: 0, reason: 'practice_squad', status };
  }
  // Suspended (#2150): ESPN's roster `suspended` group, a fact apart from the
  // injury designation (which stays null). Same freshness as the Practice squad;
  // like No NFL team, the projected number itself is unchanged.
  if (rosterStatusIs('suspended', nflRosterStatus, now)) {
    return { available: false, activeProbability: 0, reason: 'suspended', status };
  }
  if (status === 'O') {
    return { available: false, activeProbability: 0, reason: 'out', status };
  }
  if (status === 'IR') {
    return { available: false, activeProbability: 0, reason: 'ir', status };
  }
  if (backup) {
    // A Backup quarterback (ADR 0057): behind an available teammate on the
    // Depth chart, so he will not play. His number is his own evidence and
    // stays; like Position-baseline he is never AUTO-recommended. Above
    // no_history (below): a QB who is both reads `backup`, so the Start
    // verdict keeps the fact that decides his zero in a valued lineup (ADR 0057,
    // amended 2026-10-07; #2044). Above Doubtful, no-practice and Questionable.
    return {
      available: true,
      autoRecommend: false,
      activeProbability: status === 'D' || status === 'Q' ? null : 1,
      reason: 'backup',
      status,
    };
  }
  if (positionBaseline) {
    // A Position-baseline projection (#1775): the number is the position's
    // average, not this player's own evidence. Startable if a manager insists,
    // never AUTO-recommended (Start/sit advice never moves him onto the
    // lineup). Reads only AFTER a Weekly projection exists, so the engine's
    // pre-projection call never passes it and no stored field changes. Bye,
    // no team, Out, IR and Backup (above) still win; this wins over Doubtful,
    // Questionable and no designation.
    return {
      available: true,
      autoRecommend: false,
      activeProbability: status === 'D' || status === 'Q' ? null : 1,
      reason: 'no_history',
      status,
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
    };
  }
  if (status === 'Q') {
    if (practice && noPracticeAllWeek(practice.observations, practice.kickoffAt)) {
      return {
        available: true,
        autoRecommend: false,
        activeProbability: null,
        reason: 'no_practice',
        status,
      };
    }
    return {
      available: true,
      autoRecommend: true,
      activeProbability: null,
      reason: 'questionable',
      status,
    };
  }
  return { available: true, autoRecommend: true, activeProbability: 1, reason: null, status };
}

// A Position-baseline or Backup quarterback's number is not trusted: it is the
// position's average or a teammate's job, so he has no Upgrade (spec #2042).
// Doubtful and no-practice Questionable keep a trusted number: the verdict
// moves, the number stands.
const UNTRUSTED_NUMBER_REASONS = new Set(['no_history', 'backup']);

/**
 * Pure: the Start verdict (CONTEXT.md; spec #2042) read off an `unavailableFor`
 * verdict. `outcome` is 'unavailable' (will not play), 'not_recommended'
 * (available, never auto-recommended; `reason` says why) or 'recommendable';
 * `numberTrusted` says whether his projected number is his own evidence. The
 * Weekly projection read passes a stored Unavailable verdict through as it is,
 * so precedence lives in `unavailableFor` alone.
 */
function startVerdictOf(availability) {
  let outcome = 'not_recommended';
  if (availability.available === false) outcome = 'unavailable';
  else if (availability.autoRecommend) outcome = 'recommendable';
  return { outcome, reason: availability.reason, numberTrusted: !UNTRUSTED_NUMBER_REASONS.has(availability.reason) };
}

/** Pure: the Start verdict for `facts`, the options `unavailableFor` takes. */
function startVerdictFor(facts = {}) {
  return startVerdictOf(unavailableFor(facts));
}

module.exports = { unavailableFor, startVerdictFor, startVerdictOf, practiceCoverageDeadline, NFL_ROSTER_STATUS_FRESH_MS };
