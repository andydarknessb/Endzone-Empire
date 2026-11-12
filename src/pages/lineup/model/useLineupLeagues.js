import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { isPickemOnly } from '../../../shared/lib';

const FIRST_LEAGUE_KEY = 'endzone_lineup_league';

// Only a positive integer names a league to read: `Infinity`, `-5`, `1.5` and `abc` are not one.
const leagueIdOf = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Keyed by account, so one manager on a shared browser never reads another's remembered league.
const storageKeyFor = (userId) => `${FIRST_LEAGUE_KEY}:${userId}`;

function rememberedLeagueId(userId) {
  if (userId == null) return null;
  try {
    return window.localStorage.getItem(storageKeyFor(userId));
  } catch {
    return null;
  }
}

/**
 * The Lineup page's league inventory and selection (#1237, restated from
 * TeamLineup.jsx): the route (`/team`) carries no leagueId of its own, so a
 * manager in more than one fantasy league needs a picker, defaulted to the
 * league named in `?leagueId=` or the first one. Every other query param
 * (the Bench what-if swap, `?swapOut=&swapIn=`) rides through unmolested.
 *
 * `readLeagueId` lets the page start its league and lineup reads beside the
 * inventory read instead of after it: while the inventory loads it is the
 * league the URL names, or the one a bare `/team` resolved to last time
 * (remembered per account on this device), and once the inventory lands it is
 * `selectedLeagueId`, which confirms or corrects it. Only reads take it; every
 * write and subscription waits for `selectedLeagueId`.
 */
export function useLineupLeagues() {
  const userId = useSelector((store) => store.user.id);
  const [searchParams, setSearchParams] = useSearchParams();
  const [rememberedId] = useState(() => rememberedLeagueId(userId));
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
      if (userId != null) {
        try {
          if (rosterLeagues.length > 0) window.localStorage.setItem(storageKeyFor(userId), String(rosterLeagues[0].id));
          else window.localStorage.removeItem(storageKeyFor(userId));
        } catch { /* storage blocked: the next visit reads the inventory first */ }
      }
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
  const readLeagueId = selectedLeagueId ?? (loading ? leagueIdOf(searchParams.get('leagueId')) || leagueIdOf(rememberedId) : null);

  const setSelectedLeagueId = (leagueId) => {
    // The whole query is replaced, deliberately: a Bench what-if swap names
    // players on the league it was found in, so it does not follow the
    // manager to a different one (TeamLineup.jsx's own rule).
    setSearchParams({ leagueId: String(leagueId) }, { replace: true });
  };

  return { leagues, selectedLeagueId, readLeagueId, setSelectedLeagueId, loading, error, refetch: fetchLeagues };
}

export default useLineupLeagues;
