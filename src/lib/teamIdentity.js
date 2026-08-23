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
 * keeps everything they authored: chat messages and pick'em picks (#114),
 * Pick history and co-commissioner grants (#113). All of it reads back with
 * `teamName: null`. Rendering that straight prints nothing (a blank label
 * that looks broken) or the string "null", so a null Team name reads as
 * "Former manager" instead, on every surface without exception.
 *
 * This module belongs to no one surface. Anything added here should read as
 * something a league, Draft, chat or pick'em consumer could all call.
 */

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
