import { useMemo } from 'react';
import { useResource } from '../../../hooks/useResource';
import { matchupFromListRow } from './matchupModel';

/**
 * One league week's Matchups as read models (#1872, ADR 0004 / ADR 0029): the
 * shared, cached read of the league's matchups list for one week, which is on the
 * service-worker API allowlist and is read by more than one mount on the
 * Lineup page (the page itself, the team-summary-strip and the matchup-preview),
 * so it goes through `useResource` and the store dedupes them into one request.
 * `useResource` is plumbing with no domain meaning, reached below the island the
 * way `useLeagueMatchups` reaches `src/api/apiClient` (ADR 0029).
 *
 * Keyed by league and week, so a surface on a different week (the page reads the
 * viewed week, both widgets read the league's current week) keeps reading the
 * week it always did, and they coincide on one request only when the weeks do.
 * No TTL: a mount always reloads, and only mounts in flight together share.
 *
 * A null `leagueId` or `week` never fetches (the same null-URL contract the plain
 * reads it replaces relied on), and `enabled: false` is the same for a caller
 * that has a reason not to read (best ball shows no card). Returns
 * `{ matchups, loading, error }`: `matchups` is the rows already read through
 * `matchupFromListRow` (empty until loaded), `loading` is true from mount until
 * the read settles, `error` is set when it failed. `useLeagueMatchups` reads the
 * unscoped list and is a different read.
 */
export function useWeekMatchups(leagueId, week, { enabled = true } = {}) {
  const active = enabled && leagueId != null && week != null;
  const { data, loading, error } = useResource(
    active ? ['league-matchups', leagueId, week] : null,
    active ? `/api/league/${leagueId}/matchups?week=${week}` : null
  );
  const matchups = useMemo(
    () => (Array.isArray(data) ? data.map(matchupFromListRow) : []),
    [data]
  );
  return { matchups, loading: active && loading, error };
}

export default useWeekMatchups;
