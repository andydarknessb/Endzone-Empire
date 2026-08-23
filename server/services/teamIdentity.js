/**
 * Team identity on league-shared contracts (#112, parent #108).
 *
 * CONTEXT.md's Team identity entry is the rule this module implements: the
 * Team name (and avatar) is the only identity a surface shared with other
 * managers may carry, and a manager's account identifier stays confined to
 * their own private account chrome. Today's league detail, Draft, chat and
 * pick'em payloads still identify participants and authors by `owner_id` /
 * `user_id` / `username`, so they cannot honour that rule yet.
 *
 * This is the EXPAND step of an expand/migrate/contract migration:
 *
 *   #112 (here)  every league-shared contract gains Team ID and Team name
 *                BESIDE its existing account fields, and gains an explicit
 *                viewer-relative field. Nothing is removed, so no consumer
 *                is forced to move.
 *   #113 / #114  league, Draft, chat and pick'em consumers move onto those
 *                fields.
 *   #115         the account fields are removed from league-shared payloads.
 *
 * Two naming rules keep the expanded contract learnable in one go:
 *
 * 1. Team identity is always `teamId` and `teamName`, camelCase, on every
 *    surface, even where the fields around it are snake_case columns. One
 *    name per concept is what makes #113 and #114 mechanical, and camelCase
 *    is already this repo's wire convention for identity (the rosters
 *    endpoint, matchup detail, pick'em standings and power rankings all
 *    spell it that way). `teamIdentityColumns()` produces the SQL aliases so
 *    they cannot drift from the JS ones.
 *
 * 2. The viewer-relative field is always `viewerTeamId`: the Team ID of the
 *    signed-in manager on THIS league, so "which one of these is me" is
 *    `entry.teamId === viewerTeamId` and never needs another manager's
 *    account ID (the precedent is matchup detail and power rankings, which
 *    already answer it that way).
 *
 *    `viewerTeamId` rides only on per-viewer channels: a REST response, or
 *    the `draft:join` acknowledgement. It deliberately never rides on a
 *    broadcast Socket.IO payload, because one `draft:state`, `draft:picked`,
 *    `draft:presence` or `chat:message` payload is sent to the whole league
 *    room and cannot be true for every recipient at once. A broadcast
 *    carries Team identity only, and the client compares it against the
 *    `viewerTeamId` it was given on the per-viewer channel. Chat history is
 *    a bare JSON array with no root to hang a field on, so its viewer takes
 *    `viewerTeamId` from the league detail response the same page loads.
 */

/**
 * Shape one `teams` row as the Team identity a league-shared payload may
 * carry. Takes a `teams` row (or anything with its `id` and `name`), never a
 * pick or player row, whose `name` is a player's. Missing input is answered
 * with nulls rather than an omitted field, so a consumer can read the field
 * unconditionally.
 */
function teamIdentityOf(teamRow) {
  if (!teamRow) return { teamId: null, teamName: null };
  return {
    teamId: teamRow.id == null ? null : teamRow.id,
    teamName: teamRow.name == null ? null : teamRow.name,
  };
}

/**
 * Add Team identity beside whatever an entry already carries. Beside, never
 * instead of: the legacy account fields survive this phase untouched.
 */
function withTeamIdentity(entry, teamRow) {
  return { ...entry, ...teamIdentityOf(teamRow) };
}

/**
 * The SELECT fragment that puts Team identity on the wire under its contract
 * names. `alias` is the table alias the `teams` row is joined under.
 */
function teamIdentityColumns(alias = 'teams') {
  return `"${alias}"."id" AS "teamId", "${alias}"."name" AS "teamName"`;
}

/**
 * One manager's team in one league, or null when they hold none. Read-only
 * and never throws: this answers an identity question, not an authorization
 * one, so callers that must refuse a non-member keep using requireMember.
 */
async function lookupTeam(db, { leagueId, userId } = {}) {
  if (!leagueId || !userId) return null;
  const result = await db.query(
    `SELECT "id", "name" FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
    [leagueId, userId]
  );
  return result.rows[0] || null;
}

/**
 * The viewer's own Team ID, picked out of a list of `teams` rows a caller
 * already holds, so a per-viewer response needs no extra query.
 */
function viewerTeamIdOf(teams, userId) {
  if (!userId || !Array.isArray(teams)) return null;
  const mine = teams.find((team) => team.owner_id === userId);
  return mine ? mine.id : null;
}

module.exports = {
  teamIdentityOf,
  withTeamIdentity,
  teamIdentityColumns,
  lookupTeam,
  viewerTeamIdOf,
};
