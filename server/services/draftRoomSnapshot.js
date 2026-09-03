const pool = require('../modules/pool');
const { teamForPick } = require('./draftOrder.service');
const { teamIdentityColumns } = require('./teamIdentity');

/**
 * The Draft room snapshot, named after the room it feeds (#788). It is the
 * builder of the most-broadcast payload in the feature - `draft:state`,
 * per-socket on join (draftSocket.js) and room-wide through the adapter
 * (draftRoomBroadcast.stateChanged) - plus the anonymous presenter board
 * (draft.router.js `GET /board/:token`). It lives here, not in the Socket.IO
 * attach module, so the presenter route no longer imports the socket module and
 * the lazy `require('./draftSocket')` the adapter used to dodge a construction
 * cycle is gone.
 *
 * TWO NAMED READS, ONE PER AUDIENCE:
 *
 *   memberSnapshot(leagueId)     -> what an authenticated league member sees
 *   presenterSnapshot(leagueId)  -> what a share-link holder sees
 *
 * Both return null for an unknown league. They share the teams read, the picks
 * read and the on-the-clock derivation (`teamForPick` over the league's rotation
 * and any commissioner overrides); they differ only in which league columns are
 * read and how each object is narrowed for its audience.
 *
 * WHY NAMED COLUMNS. The old builder read the whole `leagues` row - an
 * unrestricted star-select minus one denylisted column - so publication was the
 * DEFAULT: every column added to `leagues` reached every member on the next
 * `draft:state` the day it landed, and nothing failed. Two such columns were
 * already riding the member broadcast - `owner_id`, an account identifier
 * CONTEXT.md's Team identity rule and #115 forbid on a league-shared payload,
 * and `draft_share_token`, the presenter credential only a commissioner may
 * generate or rotate. Naming the columns is what stops that, and stops the next
 * column added to `leagues` from publishing itself. A field reaches a client
 * only because it is named in one of the lists below; adding a name to a list is
 * a deliberate act of publication, and `server/test/helpers/draftStatePins.js`
 * keeps an INDEPENDENT copy of each list so a widened read fails a pin loudly
 * instead of shipping silently.
 *
 * `owner_id`, `draft_share_token` and `invite_code` are never selected here,
 * under any circumstances.
 *
 * The presenter lists are, in effect, the definition of what a presenter-rendered
 * component may read. The only consumer today is
 * src/components/DraftPresenter/DraftPresenter.jsx, which passes the payload into
 * DraftBoardMatrix, Countdown, lib/rosterShape draftRounds() and lib/teamIdentity;
 * a component added to that page needs its fields added to the presenter lists
 * here too. This is the same guarantee publicRead.service.js's rule 2 gives the
 * rest of the anonymous surface ("every value returned to the client passes
 * through an explicit serializer that names each field"), reached a different
 * way - that module cannot serve this route, because its rule 1 forbids it from
 * touching a league-scoped table and the presenter board is nothing but
 * league-scoped.
 */

// The league columns an authenticated member's draft:state carries. Derived from
// the reads the DraftBoard / draft libs make off `league` (the ruling-2 grep,
// 2026-09-03, re-verified in #788: every column below is a real non-comment read
// and none of `owner_id`, `draft_share_token`, `invite_code`, `max_teams` is).
// snake_case unchanged - camelCase renaming is out of scope (#788 ruling 7).
const MEMBER_LEAGUE_COLUMNS = [
  'id', 'name', 'draft_status', 'draft_paused', 'draft_type', 'draft_rotation',
  'draft_order_overrides', 'current_pick', 'pick_deadline_at', 'pick_time_seconds',
  'autodraft_delay_seconds', 'draft_rounds', 'roster_limit', 'roster_slots',
  'bench_slots', 'ir_slots', 'min_teams', 'draft_date', 'draft_timezone',
];

// The league columns a presenter share-link holder may see (today's
// PUBLIC_LEAGUE_FIELDS from draft.router.js). Account identity never qualifies:
// a share link is held by anyone, so the board is Team identity and public draft
// state only.
const PRESENTER_LEAGUE_FIELDS = [
  'name', 'draft_status', 'draft_paused', 'pick_deadline_at',
  // rosterShape.draftRounds() on the presenter reads all three (ADR 0005).
  'draft_rounds', 'roster_limit', 'ir_slots',
];

// Columns the on-the-clock derivation needs but the presenter never publishes.
// They are read to compute `onTheClock` and then dropped from the returned
// `league`, so the presenter stays a narrow query (never `SELECT *`, never
// `owner_id` / `draft_share_token`) while its published league key set stays
// exactly PRESENTER_LEAGUE_FIELDS. `draft_status` is already published above.
const ONTHECLOCK_LEAGUE_COLUMNS = ['current_pick', 'draft_rotation', 'draft_order_overrides'];

// The presenter league READ is the published fields plus the derivation-only
// ones, de-duplicated; the presenter league OUTPUT is PRESENTER_LEAGUE_FIELDS.
const PRESENTER_LEAGUE_QUERY_COLUMNS = [
  ...new Set([...PRESENTER_LEAGUE_FIELDS, ...ONTHECLOCK_LEAGUE_COLUMNS]),
];

// A presenter team / on-the-clock entry: Team identity and draft position, the
// former PUBLIC_TEAM_FIELDS. `teamId` / `teamName` are the aliases the shared
// teams read already mints.
const PRESENTER_TEAM_FIELDS = ['teamId', 'teamName', 'draft_position'];

// A presenter pick entry: the pick and its Team identity, the former
// PUBLIC_PICK_FIELDS. No `team_id` (redundant with `teamId` since #113).
const PRESENTER_PICK_FIELDS = [
  'pick_number', 'teamId', 'teamName', 'is_keeper', 'player_id', 'name', 'position', 'nfl_team',
];

/** A quoted, comma-joined column list for a bare-column SELECT. */
const columnList = (columns) => columns.map((column) => `"${column}"`).join(', ');

/**
 * A new object carrying exactly `fields`, with null for any the source lacks (or
 * null when the source itself is null). The key set is a property of the list,
 * not of whatever the row happened to hold, so a consumer reads every field
 * unconditionally and the pinned key set cannot quietly narrow when a query
 * changes. This is the old router `allowlisted()`, moved here (ruling 3).
 */
function shape(source, fields) {
  if (!source) return null;
  const shaped = {};
  for (const field of fields) shaped[field] = source[field] === undefined ? null : source[field];
  return shaped;
}

/** One `leagues` row by id, projecting exactly `columns`, or null. */
async function readLeague(leagueId, columns) {
  const result = await pool.query(
    `SELECT ${columnList(columns)} FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  return result.rows[0] || null;
}

/**
 * The teams in draft order: Team identity and the team's own draft columns, and
 * no manager account (#344). Byte-identical to the read the old socket-module
 * snapshot ran, so the member snapshot's teams are unchanged and the socket contract
 * tests that pin this SELECT (no `owner_id`, no `JOIN "users"`) still hold. A
 * team whose owner has left the league still appears - there is no owner join to
 * filter it out.
 */
async function readTeams(leagueId) {
  const result = await pool.query(
    `SELECT "teams"."id", "teams"."name", "teams"."draft_position", "teams"."autodraft",
            "teams"."draft_ready", ${teamIdentityColumns()}
     FROM "teams"
     WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "teams"."id"`,
    [leagueId]
  );
  return result.rows;
}

/**
 * The picks so far, each carrying the Team that made it by Team identity (a
 * pick's own `name` is the PLAYER's, so the Team needs its own contract fields,
 * #112). Byte-identical to the old socket-module snapshot read.
 */
async function readPicks(leagueId) {
  const result = await pool.query(
    `SELECT "draft_picks"."pick_number", "draft_picks"."team_id", "draft_picks"."is_keeper",
            ${teamIdentityColumns()},
            "players"."id" AS "player_id", "players"."name", "players"."position", "players"."nfl_team"
     FROM "draft_picks" JOIN "players" ON "players"."id" = "draft_picks"."player_id"
     LEFT JOIN "teams" ON "teams"."id" = "draft_picks"."team_id"
     WHERE "draft_picks"."league_id" = $1 ORDER BY "pick_number"`,
    [leagueId]
  );
  return result.rows;
}

/**
 * The team on the clock, or null when the draft is not active or has no teams.
 * The shared derivation (ruling 1): `teamForPick` over the league's rotation and
 * overrides, reading the same league fields the old socket-module snapshot read. The
 * `teams` must carry `id` (the overrides path keys on it), which the shared
 * `readTeams` projection provides - so the presenter's on-the-clock still honours
 * commissioner overrides, even though the presenter never publishes a team `id`.
 */
function onTheClockFrom(league, teams) {
  return league.draft_status === 'active' && teams.length > 0
    ? teamForPick(league.current_pick, teams, {
      rotation: league.draft_rotation,
      overrides: league.draft_order_overrides,
    })
    : null;
}

/**
 * The snapshot every league MEMBER receives on `draft:state`: the league by its
 * named member columns, teams in draft order, picks so far, and the team on the
 * clock. null for an unknown league. The league is projected to
 * MEMBER_LEAGUE_COLUMNS, so `owner_id`, `draft_share_token` and `invite_code`
 * cannot ride the broadcast even if the read later widens. Teams, picks and
 * onTheClock pass through verbatim (they already carry Team identity only).
 */
async function memberSnapshot(leagueId) {
  const league = await readLeague(leagueId, MEMBER_LEAGUE_COLUMNS);
  if (!league) return null;
  const teams = await readTeams(leagueId);
  const picks = await readPicks(leagueId);
  const onTheClock = onTheClockFrom(league, teams);
  return { league: shape(league, MEMBER_LEAGUE_COLUMNS), teams, picks, onTheClock };
}

/**
 * The snapshot a presenter SHARE-LINK holder receives: the published league,
 * team and pick fields only, and `onTheClock` shaped like a team. null for an
 * unknown league. The league is read with its published columns plus the few the
 * on-the-clock derivation needs (never `owner_id` / `draft_share_token`), then
 * narrowed to PRESENTER_LEAGUE_FIELDS; teams, picks and onTheClock are narrowed
 * to their published fields. This is a narrower QUERY, not a redaction of a wide
 * one: the row it starts from never carries the account identity or the
 * presenter credential in the first place.
 */
async function presenterSnapshot(leagueId) {
  const league = await readLeague(leagueId, PRESENTER_LEAGUE_QUERY_COLUMNS);
  if (!league) return null;
  const teams = await readTeams(leagueId);
  const picks = await readPicks(leagueId);
  const onTheClock = onTheClockFrom(league, teams);
  return {
    league: shape(league, PRESENTER_LEAGUE_FIELDS),
    teams: teams.map((team) => shape(team, PRESENTER_TEAM_FIELDS)),
    picks: picks.map((pick) => shape(pick, PRESENTER_PICK_FIELDS)),
    onTheClock: shape(onTheClock, PRESENTER_TEAM_FIELDS),
  };
}

module.exports = {
  memberSnapshot,
  presenterSnapshot,
};
