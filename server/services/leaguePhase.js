/**
 * League phase: where a league sits in its lifecycle (pre-draft, drafting,
 * in-season, playoffs, complete), derived from the raw leagues columns
 * (draft_status, season_status, pickem_only) and never stored. This is the
 * server twin of src/lib/leaguePhase.js: the derivation is identical on both
 * sides and both test suites run the shared fixture beside the client module
 * (src/lib/leaguePhase.fixture.json), so the two cannot drift silently.
 *
 * Phase answers league-level questions only: may a team join (`joinability`),
 * may these settings still change (`frozenSettingKeys` and its SQL twin
 * `settingsUnfrozenWhereSql`), is the season live (`fantasySeasonLiveWhereSql`),
 * may season operations create or finalize season state
 * (`seasonOperationsAvailable`, #194). The draft's own turn-by-turn state is
 * DRAFT STATUS, not phase: the draft workflow, the pick'em season workflow and
 * rollover write those columns and keep reading them raw. Every other reader
 * asks here, season operations included: they write none of these columns,
 * they only refuse on them.
 *
 * A pick'em-only league has no draft: it is in-season from creation until
 * its season completes, whatever draft_status says, and it is joinable for
 * exactly that span (a rollover puts it back to regular, so it is joinable
 * again). A league with a fantasy side is joinable only while pre-draft.
 */

const { isPickemOnly, column, pickemOnlyWhereSql, fantasySideWhereSql } = require('./leagueType');

const LEAGUE_PHASE = Object.freeze({
  PRE_DRAFT: 'pre-draft',
  DRAFTING: 'drafting',
  IN_SEASON: 'in-season',
  PLAYOFFS: 'playoffs',
  COMPLETE: 'complete',
});

/** Why a league refuses a new team. Cross-side contract, mirrored in the fixture. */
const JOIN_REFUSAL_REASON = Object.freeze({
  DRAFT_STARTED: 'draft-started',
  SEASON_COMPLETE: 'season-complete',
});

/** The manager-readable message for each refusal reason (409 bodies). */
const JOIN_REFUSAL_MESSAGES = Object.freeze({
  [JOIN_REFUSAL_REASON.DRAFT_STARTED]: 'league draft already started',
  [JOIN_REFUSAL_REASON.SEASON_COMPLETE]: 'league season is complete',
});

/** Pure: the phase for a leagues row. Null for a missing row. Same rule as the client. */
function deriveLeaguePhase(league) {
  if (!league) return null;
  if (isPickemOnly(league)) {
    return league.season_status === 'complete' ? LEAGUE_PHASE.COMPLETE : LEAGUE_PHASE.IN_SEASON;
  }
  if (league.draft_status === 'pending') return LEAGUE_PHASE.PRE_DRAFT;
  if (league.draft_status === 'active') return LEAGUE_PHASE.DRAFTING;
  if (league.season_status === 'playoffs') return LEAGUE_PHASE.PLAYOFFS;
  if (league.season_status === 'complete') return LEAGUE_PHASE.COMPLETE;
  return LEAGUE_PHASE.IN_SEASON;
}

/**
 * Pure: will this league accept a new team right now?
 * `{ joinable: true }` or `{ joinable: false, reason }`. Per-manager gates
 * (already a member, league full, approval required, not public) are layered
 * on top by the caller. A missing row fails closed with no reason.
 */
function joinability(league) {
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

/** Message for a refusal answer; the draft-started text is the historic one. */
function joinRefusalMessage(reason) {
  return JOIN_REFUSAL_MESSAGES[reason] || 'league is not accepting new teams';
}

/* ------------------------------------------------------------------ *
 * SQL fragments. Code literals only: the alias is a table alias chosen *
 * by the caller, never request input, and it is validated as an       *
 * identifier so the fragment can be spliced where discovery already   *
 * splices code-literal fragments.                                     *
 * ------------------------------------------------------------------ */

/** WHERE fragment: the same rule as `joinability`, for the Discover query. */
function joinableWhereSql(alias) {
  const draftStatus = column(alias, 'draft_status');
  const seasonStatus = column(alias, 'season_status');
  return `((${fantasySideWhereSql(alias)} AND ${draftStatus} = 'pending')` +
    ` OR (${pickemOnlyWhereSql(alias)} AND ${seasonStatus} <> 'complete'))`;
}

/**
 * WHERE fragment: a fantasy league whose season is live (draft complete,
 * season not complete). The eligibility rule for the weekly jobs; pick'em-only
 * leagues are excluded, as they always were.
 */
function fantasySeasonLiveWhereSql(alias) {
  const draftStatus = column(alias, 'draft_status');
  const seasonStatus = column(alias, 'season_status');
  return `(${fantasySideWhereSql(alias)} AND ${draftStatus} = 'complete' AND ${seasonStatus} <> 'complete')`;
}

/**
 * The manager-readable refusal when season operations are asked to act before
 * the draft is done. Plain words, no em-dash (house style).
 */
const SEASON_BEFORE_DRAFT_MESSAGE =
  'the draft has not finished; schedule and scoring are available once it completes';

/**
 * Pure: may season operations create or finalize season state for this row?
 * False only while a fantasy league is PRE_DRAFT or DRAFTING. `in-season`,
 * `playoffs` and `complete` all pass: what a COMPLETE season refuses is season
 * operations' own business, not a phase question. A pick'em-only league has no
 * draft and is never in those two phases, so it always passes here; the
 * routers refuse it upstream in `requireFantasyLeague` regardless. A missing
 * row fails closed, as everywhere else in this module.
 *
 * This is the read side of the rule `fantasySeasonLiveWhereSql` states in SQL,
 * minus that fragment's season-not-complete clause, and it derives from
 * `deriveLeaguePhase` rather than comparing `draft_status` so the two cannot
 * disagree.
 */
function seasonOperationsAvailable(league) {
  const phase = deriveLeaguePhase(league);
  if (phase === null) return false;
  return phase !== LEAGUE_PHASE.PRE_DRAFT && phase !== LEAGUE_PHASE.DRAFTING;
}

/* ------------------------------------------------------------------ *
 * Settings freeze                                                     *
 * ------------------------------------------------------------------ */

/**
 * The game-integrity settings (wire keys of PUT /api/league/:id) that lock
 * once the draft starts. Administrative settings (name, waivers, trades)
 * stay editable all season and are not listed. Phase owns WHEN these lock;
 * the settings module (leagueSettings.service.js) owns which class each
 * setting is in, including which ones a pick'em-only league refuses.
 */
const DRAFT_FROZEN_SETTING_KEYS = Object.freeze([
  'rosterSlots', 'positionCaps', 'benchSlots', 'dpEnabled', 'irSlots',
  'scoringRules', 'regularSeasonWeeks', 'playoffTeams',
  'playoffConsolation', 'pickTimeSeconds', 'minTeams', 'maxTeams', 'autodraftDelaySeconds',
  'draftDate', 'draftTimezone', 'draftType', 'draftRotation', 'keepersEnabled', 'keeperCount',
  'draftOrderOverrides', 'auctionSettings', 'keeperLockAt',
]);

/**
 * Pure: the setting keys frozen for this league right now. The full list
 * once a fantasy league is past pre-draft; empty pre-draft; empty for a
 * pick'em-only league (it has no draft, so nothing is draft-frozen). A
 * missing row fails closed: nothing could be verified pre-draft.
 */
function frozenSettingKeys(league) {
  if (!league) return [...DRAFT_FROZEN_SETTING_KEYS];
  if (isPickemOnly(league)) return [];
  return deriveLeaguePhase(league) === LEAGUE_PHASE.PRE_DRAFT ? [] : [...DRAFT_FROZEN_SETTING_KEYS];
}

/**
 * WHERE fragment: the SQL twin of `frozenSettingKeys(row).length === 0`,
 * i.e. no setting is draft-frozen for this row (a pick'em-only league, or a
 * fantasy league still pre-draft). The settings UPDATE splices it as its
 * race guard so a draft that starts between the status read and the write
 * zeroes the update instead of slipping a frozen edit through.
 */
function settingsUnfrozenWhereSql(alias) {
  const draftStatus = column(alias, 'draft_status');
  return `(${pickemOnlyWhereSql(alias)} OR ${draftStatus} = 'pending')`;
}

module.exports = {
  LEAGUE_PHASE,
  JOIN_REFUSAL_REASON,
  JOIN_REFUSAL_MESSAGES,
  DRAFT_FROZEN_SETTING_KEYS,
  deriveLeaguePhase,
  joinability,
  joinRefusalMessage,
  joinableWhereSql,
  fantasySeasonLiveWhereSql,
  seasonOperationsAvailable,
  SEASON_BEFORE_DRAFT_MESSAGE,
  frozenSettingKeys,
  settingsUnfrozenWhereSql,
};
