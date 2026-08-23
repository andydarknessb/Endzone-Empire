/**
 * Rendering Team identity on the client (#114, parent #108).
 *
 * `server/services/teamIdentity.js` is the contract this consumes: every
 * league-shared payload carries `teamId` and `teamName`, and the viewer knows
 * which one is their own from a `viewerTeamId` delivered on a per-viewer
 * channel (a REST response, or the `league:join` / `draft:join`
 * acknowledgement). A manager's account identifier never reaches a surface
 * another manager can see, so there is no username to fall back to here.
 *
 * That leaves exactly one gap to decide: the server's joins are LEFT on
 * purpose, so a manager who has left the league keeps their chat messages and
 * their pick'em picks and reads back with `teamName: null`. Rendering that
 * straight prints nothing (a blank chip that looks broken) or the string
 * "null". Both are worse than naming the situation, so a null Team name reads
 * as "Former manager" everywhere.
 */

/** What a league-shared surface calls an author whose Team is gone. */
export const FORMER_MANAGER_LABEL = 'Former manager';

/**
 * The name to show for one Team identity. Takes the `teamName` off a payload,
 * never an account field: there is none left to take.
 */
export function teamDisplayName(teamName) {
  const trimmed = typeof teamName === 'string' ? teamName.trim() : '';
  return trimmed === '' ? FORMER_MANAGER_LABEL : trimmed;
}
