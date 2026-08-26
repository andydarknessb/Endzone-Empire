/**
 * Team identity on league-shared contracts (#112, parent #108).
 *
 * CONTEXT.md's Team identity entry is the rule this module implements: the
 * Team name (and avatar) is the only identity a surface shared with other
 * managers may carry, and a manager's account identifier stays confined to
 * their own private account chrome. Every league-shared surface now honours
 * that rule: the authenticated REST payloads (league detail, chat, pick'em,
 * rosters, matchup detail) and the Draft / chat Socket.IO broadcasts all carry
 * Team identity with the account fields removed.
 *
 * This is the machinery of an expand/migrate/contract migration:
 *
 *   #112 (here)  every league-shared contract gained Team ID and Team name
 *                BESIDE its existing account fields, and an explicit
 *                viewer-relative field. Nothing was removed, so no consumer
 *                was forced to move.
 *   #113 / #114  league, Draft, chat and pick'em consumers moved onto those
 *                fields.
 *   #115         the account fields were removed from league-shared payloads,
 *                split by surface: #343 contracted the REST payloads and #344
 *                contracted the Draft / chat Socket.IO payloads (both done).
 *
 * Two naming rules keep the contract learnable in one go:
 *
 * 0. What moves here is the identifying half of Team identity: the Team ID
 *    and the Team name. CONTEXT.md's Team identity entry also covers the
 *    avatar, and the surfaces that render one (league detail's teams,
 *    pick'em standings, rosters) already carry it; #113 and #114 ask their
 *    consumers for Team names and Team IDs only, so no contract here starts
 *    carrying an avatar it did not carry before.
 *
 * 1. Team identity is always `teamId` and `teamName`, camelCase, on every
 *    surface, even where the fields around it are snake_case columns. One
 *    name per concept is what makes #113 and #114 mechanical, and camelCase
 *    is already this repo's wire convention for identity (the rosters
 *    endpoint, matchup detail, pick'em standings and power rankings all
 *    spell it that way). `TEAM_IDENTITY_FIELDS` is those two names, exported
 *    and frozen, and it is the ENFORCEMENT of this rule rather than the
 *    paragraph you are reading (#200, folded into #115): `teamIdentityColumns()`
 *    mints the SQL aliases from it and `teamIdentityOf()` builds its object
 *    from it, so neither can drift from the wire contract, and neither can
 *    drift from the client mirror because `src/lib/teamIdentity.js` exports the
 *    identical list and a test pins the two equal. Change the strings in one
 *    place, here, or the contract tests go red.
 *
 * 2. The viewer's own Team is always `viewerTeamId`: the Team ID of the
 *    signed-in manager on THIS league, so "which one of these is me" is
 *    `entry.teamId === viewerTeamId` and never needs another manager's
 *    account ID (the precedent is matchup detail and power rankings, which
 *    already answer it that way).
 *
 *    `viewerTeamId` rides only on per-viewer channels: a REST response, or
 *    the acknowledgement to `league:join` / `draft:join`. It deliberately
 *    never rides on a broadcast Socket.IO payload, because one `draft:state`,
 *    `draft:picked`, `draft:presence` or `chat:message` payload is sent to
 *    the whole league room and cannot be true for every recipient at once. A
 *    broadcast carries Team identity only, and the client compares it against
 *    the `viewerTeamId` it was given on the per-viewer channel.
 *
 *    `viewerTeamId` is no longer the only field that rule governs. The same
 *    join acknowledgement carries `isCommissioner`, whether the viewer may
 *    act as this league's commissioner (#178): a different fact about the
 *    same viewer, on the same per-viewer channel, kept off `draft:state` for
 *    the same reason. So what makes a field belong here is the CHANNEL it
 *    can honestly travel on, not the name - `viewerTeamId` names one
 *    concept, it does not exhaust the category. Any further per-viewer field
 *    takes an ack or a REST response and never a broadcast.
 *
 *    Chat history is the one surface with no root to hang the field on: it
 *    is a bare JSON array. Its viewer gets `viewerTeamId` from the join
 *    acknowledgement instead, which is why `league:join` answers it too and
 *    not just `draft:join`: the chat panel joins the league room and never
 *    reads league detail, so that ack is its only per-viewer channel.
 */

/**
 * The canonical Team identity wire keys, frozen so no caller can mutate the
 * shared list, and the single source of the strings `teamId` / `teamName` in
 * this module (#200). Its client mirror `src/lib/teamIdentity.js` exports the
 * identical array; teamIdentityFields.test.js pins the two equal.
 */
const TEAM_IDENTITY_FIELDS = Object.freeze(['teamId', 'teamName']);

/**
 * Shape one `teams` row as the Team identity a league-shared payload may
 * carry. Takes a `teams` row (or anything with its `id` and `name`), never a
 * pick or player row, whose `name` is a player's. Missing input is answered
 * with nulls rather than an omitted field, so a consumer can read the field
 * unconditionally.
 *
 * The output keys come from `TEAM_IDENTITY_FIELDS`, not from the strings
 * spelled out again here, so the object this returns cannot name a field the
 * contract does not.
 */
function teamIdentityOf(teamRow) {
  const [idField, nameField] = TEAM_IDENTITY_FIELDS;
  if (!teamRow) return { [idField]: null, [nameField]: null };
  return {
    [idField]: teamRow.id == null ? null : teamRow.id,
    [nameField]: teamRow.name == null ? null : teamRow.name,
  };
}

/**
 * Add Team identity beside whatever an entry already carries. Beside, never
 * instead of: the fields already on `entry` survive untouched.
 *
 * This was the EXPAND-step helper: it put Team identity beside account fields
 * while both had to coexist. With #115 complete (#343 for REST, #344 for the
 * Socket.IO payloads), no league-shared payload carries account identity any
 * more, so nothing in production calls it today - the socket builders that were
 * its last callers now use `teamIdentityOf` directly. It is kept as a generic
 * merge utility (and covered by teamIdentity.test.js); do NOT reach for it to
 * put an account field back beside Team identity on a shared payload, which is
 * exactly what this migration removed.
 */
function withTeamIdentity(entry, teamRow) {
  return { ...entry, ...teamIdentityOf(teamRow) };
}

/**
 * The SELECT fragment that puts Team identity on the wire under its contract
 * names. `alias` is the table alias the `teams` row is joined under.
 *
 * `prefix` is for the one case where a payload already spends the bare names
 * on something else: the league object's own `teamId` would read as the
 * LEAGUE's team, so its creator's identity is `ownerTeamId` / `ownerTeamName`
 * instead. The prefixed names are minted here rather than hand-written at the
 * call site, so they cannot drift from the bare ones either.
 */
function teamIdentityColumns(alias = 'teams', prefix = null) {
  const [idField, nameField] = TEAM_IDENTITY_FIELDS;
  // Prefixing turns `teamId` into `ownerTeamId`: the bare field with its first
  // letter capitalised, so the prefixed alias is minted from the same source
  // string as the bare one and cannot drift from it.
  const withPrefix = (field) =>
    prefix ? `${prefix}${field[0].toUpperCase()}${field.slice(1)}` : field;
  return `"${alias}"."id" AS "${withPrefix(idField)}", "${alias}"."name" AS "${withPrefix(nameField)}"`;
}

/**
 * The LEFT JOIN that reaches a manager's team in one league, for a table that
 * records who did something by account. Both legs matter: without the
 * `league_id` one a manager's team in a DIFFERENT league would answer, which
 * is exactly the identity leak this migration exists to close. It is written
 * once here so no call site can forget it.
 *
 * LEFT, always: an author who has since left the league keeps their row in
 * chat history, pick'em picks and the co-commissioner roster (all reference
 * users, not teams), and reads back with null Team identity rather than
 * dropping out of the result. On Pick history the LEFT join is defensive
 * rather than
 * load-bearing: `draft_picks.team_id` CASCADEs, and a fantasy league is
 * Removable only while pre-draft (CONTEXT.md, #195), so a team is only ever
 * removed before any pick exists and this join never sees a removed team from
 * a started draft.
 */
function teamIdentityJoin(leagueIdColumn, ownerIdColumn, alias = 'teams') {
  return `LEFT JOIN "teams" AS "${alias}"
            ON "${alias}"."league_id" = ${leagueIdColumn}
           AND "${alias}"."owner_id" = ${ownerIdColumn}`;
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
  TEAM_IDENTITY_FIELDS,
  teamIdentityOf,
  withTeamIdentity,
  teamIdentityColumns,
  teamIdentityJoin,
  lookupTeam,
  viewerTeamIdOf,
};
