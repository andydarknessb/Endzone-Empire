// League phase: where a league sits in its lifecycle, derived from the raw
// leagues columns (draft_status, season_status, pickem_only) and never
// stored. This is the client twin of server/services/leaguePhase.js: the
// derivation, the joinability answer and the settings freeze are identical on
// both sides, and both test suites run the shared fixture beside this file
// (leaguePhase.fixture.json) plus a parity test, so the two cannot drift.
//
// Phase answers league-level questions only. The draft's own turn-by-turn
// state is DRAFT STATUS, not phase: the draft-room tree and the Draft Central
// card read draft_status raw. Every other league-level screen asks here.

import { isPickemOnly } from './leagueType';

export const LEAGUE_PHASE = Object.freeze({
  PRE_DRAFT: 'pre-draft',
  DRAFTING: 'drafting',
  IN_SEASON: 'in-season',
  PLAYOFFS: 'playoffs',
  COMPLETE: 'complete',
});

export function deriveLeaguePhase(league) {
  if (!league) return null;
  // A pick'em-only league has no draft: it is in season from creation until
  // the season completes, whatever draft_status says. A league kind is not a
  // position in time, so it maps onto the existing phases rather than a new one.
  if (isPickemOnly(league)) {
    return league.season_status === 'complete' ? LEAGUE_PHASE.COMPLETE : LEAGUE_PHASE.IN_SEASON;
  }
  if (league.draft_status === 'pending') return LEAGUE_PHASE.PRE_DRAFT;
  if (league.draft_status === 'active') return LEAGUE_PHASE.DRAFTING;
  if (league.season_status === 'playoffs') return LEAGUE_PHASE.PLAYOFFS;
  if (league.season_status === 'complete') return LEAGUE_PHASE.COMPLETE;
  return LEAGUE_PHASE.IN_SEASON;
}

/** Why a league refuses a new team. Cross-side contract, mirrored in the fixture. */
export const JOIN_REFUSAL_REASON = Object.freeze({
  DRAFT_STARTED: 'draft-started',
  SEASON_COMPLETE: 'season-complete',
});

/**
 * Will this league accept a new team right now?
 * `{ joinable: true }` or `{ joinable: false, reason }`. Per-manager gates
 * (already a member, league full, approval required, not public) are layered
 * on top by the caller. A missing row fails closed with no reason.
 */
export function joinability(league) {
  if (!league) return { joinable: false, reason: null };
  const phase = deriveLeaguePhase(league);
  if (isPickemOnly(league)) {
    return phase === LEAGUE_PHASE.COMPLETE
      ? { joinable: false, reason: JOIN_REFUSAL_REASON.SEASON_COMPLETE }
      : { joinable: true };
  }
  return phase === LEAGUE_PHASE.PRE_DRAFT
    ? { joinable: true }
    : { joinable: false, reason: JOIN_REFUSAL_REASON.DRAFT_STARTED };
}

/** Why a league refuses a team removal. Cross-side contract, mirrored in the fixture. */
export const REMOVE_REFUSAL_REASON = Object.freeze({
  DRAFT_STARTED: 'draft-started',
});

/**
 * The manager-readable message for each removal refusal, byte-identical to the
 * server's REMOVE_REFUSAL_MESSAGES (leaguePhase.test.js pins the two equal).
 * The commissioner-tools removal control renders this so the sentence a stale
 * client shows is the same one removeTeam raises on the 409.
 */
export const REMOVE_REFUSAL_MESSAGES = Object.freeze({
  [REMOVE_REFUSAL_REASON.DRAFT_STARTED]: "teams can't be removed once the draft has started",
});

/**
 * Will this league let a team be removed right now? The mirror of `joinability`
 * and the read side of CONTEXT.md's Removable term: a league with a fantasy
 * side is removable only while pre-draft (once the draft has started, removing
 * a team would rewrite its picks, rosters, schedule and lineups); a pick'em-only
 * league has no draft and its teams stay removable in every phase. The
 * commissioner-tools removal control keys its disabled state on this so the UI
 * never offers a removal the server refuses for phase reasons. `{ removable:
 * true }` or `{ removable: false, reason }`. Per-team gates (a commissioner
 * never removes their own team, nor the creator's) are layered on top. A
 * missing row fails closed with no reason.
 */
export function removability(league) {
  if (!league) return { removable: false, reason: null };
  if (isPickemOnly(league)) return { removable: true };
  return deriveLeaguePhase(league) === LEAGUE_PHASE.PRE_DRAFT
    ? { removable: true }
    : { removable: false, reason: REMOVE_REFUSAL_REASON.DRAFT_STARTED };
}

/** Message for a removal-refusal answer; mirrors the server's removeRefusalMessage. */
export function removeRefusalMessage(reason) {
  return REMOVE_REFUSAL_MESSAGES[reason] || "teams can't be removed right now";
}

/**
 * The game-integrity settings (wire keys of PUT /api/league/:id) that lock
 * once the draft starts; the same list the server refuses. Administrative
 * settings (name, waivers, trades, trade deadline) stay editable all season.
 */
export const DRAFT_FROZEN_SETTING_KEYS = Object.freeze([
  'rosterSlots', 'positionCaps', 'benchSlots', 'dpEnabled', 'irSlots',
  'scoringRules', 'regularSeasonWeeks', 'playoffTeams',
  'playoffConsolation', 'pickTimeSeconds', 'minTeams', 'maxTeams', 'autodraftDelaySeconds',
  'draftDate', 'draftTimezone', 'draftType', 'draftRotation', 'keepersEnabled', 'keeperCount',
  'draftOrderOverrides', 'auctionSettings', 'keeperLockAt',
]);

/**
 * The setting keys frozen for this league right now: the full list once a
 * fantasy league is past pre-draft, empty pre-draft, empty for a pick'em-only
 * league (no draft, so nothing is draft-frozen). A missing row fails closed.
 * The commissioner-tools panels key their greyed-out state on this so the UI
 * never offers an edit the server refuses for phase reasons.
 */
export function frozenSettingKeys(league) {
  if (!league) return [...DRAFT_FROZEN_SETTING_KEYS];
  if (isPickemOnly(league)) return [];
  return deriveLeaguePhase(league) === LEAGUE_PHASE.PRE_DRAFT ? [] : [...DRAFT_FROZEN_SETTING_KEYS];
}

/** True when the draft-frozen settings are locked for this league. */
export function draftSettingsFrozen(league) {
  return frozenSettingKeys(league).length > 0;
}

/**
 * True while the season is being played (in season or playoffs): the week
 * can advance, matchups can score live. False pre-draft, drafting and once
 * the season completes. The client twin of the server's season-live rule.
 */
export function isSeasonLive(league) {
  const phase = deriveLeaguePhase(league);
  return phase === LEAGUE_PHASE.IN_SEASON || phase === LEAGUE_PHASE.PLAYOFFS;
}

export const LEAGUE_PHASE_META = Object.freeze({
  [LEAGUE_PHASE.PRE_DRAFT]: { label: 'Pre-draft', color: 'default' },
  [LEAGUE_PHASE.DRAFTING]: { label: 'Draft live', color: 'warning' },
  [LEAGUE_PHASE.IN_SEASON]: { label: 'In season', color: 'success' },
  [LEAGUE_PHASE.PLAYOFFS]: { label: 'Playoffs', color: 'warning' },
  [LEAGUE_PHASE.COMPLETE]: { label: 'Complete', color: 'default' },
});

export function rosterActionForPhase(league) {
  if (isPickemOnly(league)) {
    return { label: 'No rosters', disabled: true, helper: "This is a pick'em league. There are no rosters." };
  }
  const phase = deriveLeaguePhase(league);
  if (phase === LEAGUE_PHASE.PRE_DRAFT) {
    return { label: 'Draft not started', disabled: true, helper: 'Players are added through the Draft Room.' };
  }
  if (phase === LEAGUE_PHASE.DRAFTING) {
    return { label: 'Open Draft Room', disabled: true, helper: 'Draft picks must be made in the Draft Room.' };
  }
  if (phase === LEAGUE_PHASE.COMPLETE) {
    return { label: 'Season complete', disabled: true, helper: 'Roster moves are closed for this season.' };
  }
  return { label: 'Add free agent', disabled: false, helper: 'Add this available player immediately.' };
}
