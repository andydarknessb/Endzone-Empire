import { useCallback, useRef } from 'react';
import { invalidate, read, setResource } from '../lib/resourceCache';
import { useResource } from './useResource';

// Every league subpage wants the same league row, so the shared store dedupes
// concurrent requests and serves repeat mounts from cache within the TTL
// instead of each screen re-fetching it.
const TTL_MS = 60000;

const keyFor = (leagueId) => ['league', leagueId];
const urlFor = (leagueId) => `/api/league/${leagueId}`;

/**
 * Clears the shared league cache for one league, or every league when called
 * with no id. Mounted hooks reload, keeping the row they already have on
 * screen until the new one lands.
 */
export function clearLeagueCache(leagueId) {
  invalidate(leagueId == null ? ['league'] : keyFor(leagueId));
}

/**
 * Deprecated: kept only until the dashboard reads through the hook (a later
 * commit in this series deletes it, along with the dashboard's raw GET and its
 * test). Seeds the shared store with the GET /api/league/:id payload the
 * dashboard already has in hand (the league row and its teams), so the
 * subpages reached from it, and the FantasyOnly guard in front of them, mount
 * without a second request. A payload without a league row is ignored rather
 * than cached.
 */
export function primeLeagueCache(leagueId, payload) {
  if (leagueId == null || !payload?.league) return;
  setResource(keyFor(leagueId), { league: payload.league, teams: payload.teams ?? [] });
}

/**
 * Shared GET /api/league/:id. Returns the league row and its teams (the
 * league's membership), so no page needs a second request for the same
 * payload.
 */
export function useLeague(leagueId) {
  const key = leagueId != null ? keyFor(leagueId) : null;
  const { data, loading, error, refetch } = useResource(key, urlFor(leagueId), { ttl: TTL_MS });

  // The row this mount is showing, for the write-through below to merge into.
  // A ref rather than a dependency, so updateLeague keeps one identity across
  // the renders its callers pass it through.
  const dataRef = useRef(data);
  dataRef.current = data;

  // Write-through after a successful PUT: merge the changed fields into the
  // row on screen and push the result to every mount on this league, with no
  // request.
  //
  // The merge base is what this mount holds, not what the store holds. While a
  // reload is in flight the store entry is data-less (invalidate dropped it,
  // and the pending entry only carries what was there before, which for a
  // reload after a failed request is nothing), and merging over that would
  // publish a truncated row as fresh: PUT /api/league/:id returns the bare
  // `leagues` row, so `is_commissioner` and `co_commissioners`, which only the
  // GET adds, would vanish and demote the commissioner on screen for a whole
  // TTL. The generation bump inside setResource would then make the store
  // refuse the real response still on the wire.
  const updateLeague = useCallback((changes) => {
    if (leagueId == null || !changes) return;
    const current = dataRef.current || read(keyFor(leagueId))?.data;
    setResource(keyFor(leagueId), {
      league: { ...(current?.league || {}), ...changes },
      teams: current?.teams ?? [],
    });
  }, [leagueId]);

  return {
    league: data?.league ?? null,
    teams: data?.teams ?? [],
    loading,
    error,
    refetch,
    updateLeague,
  };
}
