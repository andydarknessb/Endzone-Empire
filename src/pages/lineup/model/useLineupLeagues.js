import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { isPickemOnly } from '../../../lib/leagueType';

/**
 * The Lineup page's league inventory and selection (#1237, restated from
 * TeamLineup.jsx): the route (`/team`) carries no leagueId of its own, so a
 * manager in more than one fantasy league needs a picker, defaulted to the
 * league named in `?leagueId=` or the first one. Every other query param
 * (the Bench what-if swap, `?swapOut=&swapIn=`) rides through unmolested.
 */
export function useLineupLeagues() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [leagues, setLeagues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLeagues = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get('/api/league');
      const rosterLeagues = (Array.isArray(res.data) ? res.data : []).filter((l) => !isPickemOnly(l));
      setLeagues(rosterLeagues);
      if (rosterLeagues.length > 0) {
        const requestedId = Number(searchParams.get('leagueId'));
        const selected = rosterLeagues.find((l) => l.id === requestedId) || rosterLeagues[0];
        if (String(selected.id) !== searchParams.get('leagueId')) {
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.set('leagueId', String(selected.id));
              return next;
            },
            { replace: true }
          );
        }
      }
    } catch (err) {
      setError(readHttpFailure(err).message || err.message);
    } finally {
      setLoading(false);
    }
    // League inventory is loaded once when the route mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchLeagues();
  }, [fetchLeagues]);

  const selectedLeagueId = (() => {
    const requestedId = Number(searchParams.get('leagueId'));
    if (leagues.some((l) => l.id === requestedId)) return requestedId;
    return leagues[0]?.id ?? null;
  })();

  const setSelectedLeagueId = (leagueId) => {
    // The whole query is replaced, deliberately: a Bench what-if swap names
    // players on the league it was found in, so it does not follow the
    // manager to a different one (TeamLineup.jsx's own rule).
    setSearchParams({ leagueId: String(leagueId) }, { replace: true });
  };

  return { leagues, selectedLeagueId, setSelectedLeagueId, loading, error };
}

export default useLineupLeagues;
