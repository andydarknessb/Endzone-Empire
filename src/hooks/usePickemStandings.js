import { invalidate } from '../lib/resourceCache';
import { useResource } from './useResource';

// Standings move only when picks are saved or games resolve, and the two
// screens that show them (the pick'em-only dashboard, then the Pick'em page's
// Standings tab one click later) are visited back to back: a short TTL turns
// three identical full-season recomputes per navigation into one.
const TTL_MS = 30000;

// Keyed by league and season. A request without a season lets the server pick
// the league's current one, so it is the two-element key, which the
// league-prefix clear covers along with every explicit season.
const keyFor = (leagueId, season) => (
  season == null ? ['pickem-standings', leagueId] : ['pickem-standings', leagueId, season]
);

const urlFor = (leagueId, season) => (
  `/api/pickem/league/${leagueId}/standings${season == null ? '' : `?season=${season}`}`
);

/**
 * Drops cached standings for one league (every season), or everything when
 * called with no id. A picks save calls this so the Standings tab reflects the
 * new picks immediately instead of after the TTL, reloading the table that is
 * already on screen.
 */
export function clearPickemStandingsCache(leagueId) {
  invalidate(leagueId == null ? ['pickem-standings'] : ['pickem-standings', leagueId]);
}

/**
 * Shared GET /api/pickem/league/:id/standings[?season=]. Dedupes concurrent
 * mounts and serves repeat mounts within the TTL; the table for a league the
 * hook has moved away from never lands as the current one.
 */
export function usePickemStandings(leagueId, season) {
  const key = leagueId != null ? keyFor(leagueId, season) : null;
  return useResource(key, urlFor(leagueId, season), { ttl: TTL_MS });
}
