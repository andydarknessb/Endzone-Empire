import { invalidate } from '../../../lib/resourceCache';

/**
 * Drops the cached week Matchups for one league (every week), or for every
 * league when called with no id, and reloads the mounts already reading them
 * (#1881). The list carries each Matchup's Expected final, which the server
 * recomputes from the live lineup rows on every request, so a write that
 * changes the lineup or the roster (a saved move, an applied advice plan, a
 * drop or an undo) leaves the cached figure stale for the rest of the 30 s TTL
 * until this runs. Called by the features that make those writes once the
 * write has landed. The reload is stale-while-revalidate: a mounted Lineup page
 * keeps its current figure on screen until the new response arrives.
 *
 * Its own file, with nothing but the cache store behind it, so the features that
 * call it reach it directly instead of through the `entities/matchup` barrel:
 * `swap-players` is in the Draft room's import closure (via the player-decision
 * card's `slotActions`), and the barrel would pull `useLeagueMatchups` and
 * `useMatchup` and their API calls into that closure.
 */
export function clearWeekMatchupsCache(leagueId) {
  invalidate(leagueId == null ? ['league-matchups'] : ['league-matchups', leagueId]);
}
