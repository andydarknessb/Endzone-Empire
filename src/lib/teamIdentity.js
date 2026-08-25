/**
 * Team identity on the client: the mirror of `server/services/teamIdentity.js`
 * (parent #108). That module is the contract; this one is how every
 * league-shared surface in `src/` renders what arrives under it.
 *
 * The contract in one paragraph, so a caller need not go and read it: every
 * league-shared payload carries `teamId` and `teamName`, camelCase, and the
 * viewer learns which one is their own from a `viewerTeamId` delivered on a
 * per-viewer channel (a REST response, or the `league:join` / `draft:join`
 * acknowledgement) and never on a broadcast. A manager's account identifier
 * never reaches a surface another manager can see, so there is no username to
 * fall back to anywhere in here.
 *
 * That leaves one gap the contract deliberately leaves to the client. The
 * server's joins are LEFT on purpose, so a manager who has left the league
 * keeps what they authored: chat messages and pick'em picks (#114), and
 * co-commissioner grants (#113). All three read back with `teamName: null`,
 * because `chat_messages` and `pickem_picks` reference users and
 * `league_commissioners` is keyed on (league, user) with no reference to
 * teams at all, so nothing about them is removed when a team is. Rendering
 * that null straight prints nothing (a blank label that looks broken) or the
 * string "null", so a null Team name reads as "Former manager" instead, on
 * every surface that can receive one.
 *
 * Pick history is NOT one of those cases, though an earlier version of this
 * comment said it was. `draft_picks.team_id` is notNullable and CASCADEs on
 * team deletion, and removing a team is a hard DELETE, so a removed manager's
 * picks are deleted with them and a Pick can never reach a client with a null
 * Team. The reason is recorded here rather than just the fact, so that nobody
 * notices the LEFT join on picks, assumes this comment drifted, and restores
 * the line. See #195, which owns the underlying defect: deleting those picks
 * silently rewrites a completed draft's record.
 *
 * "Every surface that can receive one" is the whole of the rule and not a
 * softening of it. A label is for identity that is genuinely absent; a
 * CURRENT team always has a name, so routing its render through this would
 * turn a data bug into a plausible-looking "Former manager" that nobody
 * investigates, which is the failure this label exists to prevent.
 *
 * This module belongs to no one surface. Anything added here should read as
 * something a league, Draft, chat or pick'em consumer could all call.
 *
 * `TEAM_IDENTITY_FIELDS` is the client half of the contract's enforcement
 * (#200): the same two wire keys the server exports, frozen, and the single
 * source of the strings `teamId` / `teamName` on this side. `teamIdentityOf`
 * reads a payload entry through it, so a consumer names Team identity by the
 * shared list rather than by hand, and teamIdentityFields.test.js pins this
 * array equal to the server's so the two mirrors cannot drift.
 */

/**
 * The canonical Team identity wire keys, frozen. Mirrors
 * `server/services/teamIdentity.js`' export of the same name; the two are
 * pinned equal by a contract test.
 */
export const TEAM_IDENTITY_FIELDS = Object.freeze(['teamId', 'teamName']);

/**
 * Read Team identity off a league-shared payload entry, by the shared field
 * list rather than by re-spelling the keys at the call site. Missing input (or
 * a departed manager's null identity) reads back as nulls, never absent keys,
 * so a consumer can destructure it unconditionally and hand `teamName` to
 * `teamNameLabel`.
 */
export function teamIdentityOf(entry) {
  const [idField, nameField] = TEAM_IDENTITY_FIELDS;
  return {
    teamId: entry == null || entry[idField] == null ? null : entry[idField],
    teamName: entry == null || entry[nameField] == null ? null : entry[nameField],
  };
}

/** What any league-shared surface calls someone whose Team is gone. */
export const FORMER_MANAGER_LABEL = 'Former manager';

/**
 * The name to show for one Team identity. Takes the `teamName` off a payload,
 * never an account field: there is none left to take. A whitespace-only name
 * is the empty case too, or it would render as an invisible label rather than
 * as the former-manager one.
 */
export function teamNameLabel(teamName) {
  const trimmed = typeof teamName === 'string' ? teamName.trim() : '';
  return trimmed === '' ? FORMER_MANAGER_LABEL : trimmed;
}

/**
 * The React key for one row of a league-shared list. The Team ID is the
 * identity to key on, but a departed manager's row has none, so its position
 * stands in; these lists are rebuilt whole on every load, never spliced, so
 * the index is stable for as long as the row is.
 */
export function teamRowKey(teamId, index) {
  return teamId == null ? `former-${index}` : teamId;
}

/**
 * Whether the viewer is the one who created this league, asked the only way
 * the contract allows: the league names its creator's Team (`ownerTeamId`),
 * the per-viewer channel names the reader's own, and the two are compared.
 * Never `user.id === league.owner_id`, which is what this replaces.
 *
 * The null guard is the whole reason this is a function rather than a
 * comparison written out at each call site. A league whose creator has left
 * it answers `ownerTeamId: null`, and a reader with no Team on this league is
 * `viewerTeamId: null`; without the guard those two nulls would match and
 * every such reader would be handed the creator's powers.
 */
export function isLeagueCreator(league, viewerTeamId) {
  if (viewerTeamId == null || !league) return false;
  return league.ownerTeamId === viewerTeamId;
}
