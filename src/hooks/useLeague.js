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

  // The same write-through for the teams half: the dashboard patches an avatar
  // into the membership it is showing (a team-profile event, no request), and
  // every mount on this league sees it. The merge base is the row on screen for
  // the same reason updateLeague's is, and it stands down whenever a response
  // is already on its way: with nothing to merge into (no row here and none in
  // the store) a load is about to start, and with a load in flight that load
  // carries the new avatar itself.
  const updateTeams = useCallback((updater) => {
    if (leagueId == null || typeof updater !== 'function') return;
    const entry = read(keyFor(leagueId));
    // Standing down mid-load is not only deference: setResource bumps the
    // generation, so a write-through here would make the store refuse the
    // response still on the wire and pin the pre-reload row as fresh for a
    // whole TTL, on this mount and every sibling. updateLeague deliberately
    // keeps winning instead, because a PUT result supersedes a read.
    if (entry?.promise) return;
    const current = dataRef.current || entry?.data;
    if (!current) return;
    setResource(keyFor(leagueId), {
      league: current.league ?? null,
      teams: updater(current.teams ?? []),
    });
  }, [leagueId]);

  return {
    league: data?.league ?? null,
    teams: data?.teams ?? [],
    loading,
    error,
    refetch,
    updateLeague,
    updateTeams,
  };
}
