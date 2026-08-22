// League type: the create-time choice of what a league plays. "Both" is a
// fantasy league with pick'em enabled from day one, not a third structure, so
// the server stores only `pickem_only`; the three-way label lives here.

export const LEAGUE_TYPE = Object.freeze({
  FANTASY: 'fantasy',
  PICKEM: 'pickem',
  BOTH: 'both',
});

// Copy for the create dialogs. Middot separators, no em-dashes (house style).
export const LEAGUE_TYPE_OPTIONS = Object.freeze([
  {
    value: LEAGUE_TYPE.FANTASY,
    label: 'Fantasy football league',
    helper: 'Draft, rosters, lineups, and weekly matchups.',
  },
  {
    value: LEAGUE_TYPE.PICKEM,
    label: "NFL pick'em league",
    helper: 'Pick winners every week. No draft and no rosters.',
  },
  {
    value: LEAGUE_TYPE.BOTH,
    label: 'Both',
    helper: "A full fantasy league with pick'em turned on from day one.",
  },
]);

/**
 * The one normaliser for both wire dialects a stored league row arrives in:
 * snake_case `pickem_only` off a leagues row, camelCase `pickemOnly` off the
 * Discover projection. Never returns "both" - that is a create-form value,
 * never inferred from a row, since a fantasy league's pickemEnabled setting
 * is not its type. A missing row is null, not a type; an absent key reads as
 * fantasy (today's falsy read).
 */
export function leagueTypeOf(row) {
  if (!row) return null;
  return row.pickem_only || row.pickemOnly ? LEAGUE_TYPE.PICKEM : LEAGUE_TYPE.FANTASY;
}

/** Null-tolerant: a missing row is not pick'em-only, so callers fail open. */
export const isPickemOnly = (row) => leagueTypeOf(row) === LEAGUE_TYPE.PICKEM;

// The two-way label for a stored league row: the words the type chips use,
// for tables and lists that show one league type per row.
export const shortLeagueTypeLabel = (row) => (isPickemOnly(row) ? "Pick'em" : 'Fantasy');

// Pinned to server/services/leagueSize.js by leagueSize.fixture.json (parity
// test on each side): fantasy leagues are capped by the head-to-head
// schedule, a pick'em pool has no schedule to balance.
export const FANTASY_MAX_TEAMS = 20;
export const PICKEM_MAX_TEAMS = 50;
export const MIN_TEAMS = 2;

export const isPickemOnlyType = (type) => type === LEAGUE_TYPE.PICKEM;
export const includesPickem = (type) => type === LEAGUE_TYPE.PICKEM || type === LEAGUE_TYPE.BOTH;
export const includesFantasy = (type) => type !== LEAGUE_TYPE.PICKEM;

/** The max-teams cap the create form should enforce for a chosen type. */
export function capForType(type) {
  return isPickemOnlyType(type) ? PICKEM_MAX_TEAMS : FANTASY_MAX_TEAMS;
}

/**
 * Re-cap a team-count field value when the league type changes. A number is
 * pulled under `cap` and rounded down to a whole count (the fantasy Select
 * only holds integers); anything that is not a number yet (an empty field
 * mid-edit) is left exactly as it is rather than silently rewritten.
 */
export function clampTeamCount(value, cap) {
  if (value === '' || value == null) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return Math.min(Math.trunc(n), cap);
}

/** True when a team-count field holds a whole number inside [MIN_TEAMS, cap]. */
export function isValidTeamCount(value, cap) {
  const n = Number(value);
  return value !== '' && value != null && Number.isInteger(n) && n >= MIN_TEAMS && n <= cap;
}

/**
 * The type-dependent part of a POST /api/league body. Always names the type;
 * carries the pick'em mode only when the type includes pick'em; and never
 * carries bestBall / scoringPreset / draftDate / draftTimezone for a
 * pick'em-only league, which the server rejects on presence (not value), so
 * stale state left over from a type switch must be dropped here rather than
 * sent as false/null.
 *
 * `draftDate` is taken as the caller already converted it: a UTC ISO string,
 * via draftTimezone.js's zonedWallTimeToUtcIso (#116 AC4) — this function
 * does no zone math of its own, it only decides what gets sent. draftTimezone
 * rides along only when draftDate does (#116 AC2): a zone means nothing
 * without the instant it was confirmed against.
 */
export function leagueTypePayload({ leagueType, pickemMode, bestBall, scoringPreset, draftDate, draftTimezone }) {
  const payload = { leagueType };
  if (includesPickem(leagueType)) payload.pickemMode = pickemMode;
  if (includesFantasy(leagueType)) {
    if (bestBall) payload.bestBall = true;
    if (scoringPreset) payload.scoringPreset = scoringPreset;
    if (draftDate) {
      payload.draftDate = draftDate;
      if (draftTimezone) payload.draftTimezone = draftTimezone;
    }
  }
  return payload;
}
