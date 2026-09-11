import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { applyTeamProfileUpdate, subscribeToTeamProfileUpdates } from '../../../lib/teamProfileEvents';
import { isFrozenPickemSeason, allTimeFromResponse } from './seasonArchiveModel';

/**
 * A League's Season archive, read once and kept live (ADR 0029: the thin hook
 * on the entity's index, on the Matchup entity's `useMatchup` shape). Reads
 * through `apiClient` (a plain fetch), never `useResource`: this is read once
 * per navigation to this page, not the multi-mount shape `useResource` exists
 * for (ADR 0004's admission rule).
 *
 * A live Team-profile update (a rename or new avatar published by another
 * manager's session) patches straight into the held seasons and the all-time
 * roster, matched by Team id, so the page never re-fetches for it. Per season
 * this is guarded by `isFrozenPickemSeason`: a declared pick'em result is
 * frozen archive text and is never patched, while every other season (a
 * fantasy one, or a legacy undeclared pick'em one) keeps patching through, as
 * it always has. The all-time roster is never frozen this way: it is current
 * Team identity by definition (CONTEXT.md "Team identity"), so every row
 * patches.
 *
 * Returns:
 *   status   'loading' | 'error' | 'ready'
 *   seasons  the archived seasons, newest first, exactly as the wire sends
 *            them (a caller reads one through the entity's `seasonView`).
 *   allTime  the League's all-time Team roster (entity's `allTimeRowFromRow`
 *            shape), in the order the server sends it.
 *   error    the read's failure message, or null.
 *   refetch  re-runs the read.
 */
export function useLeagueHistory(leagueId) {
  const [seasons, setSeasons] = useState([]);
  const [allTime, setAllTime] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get(`/api/league/${leagueId}/history`);
      setSeasons(Array.isArray(res.data?.seasons) ? res.data.seasons : []);
      setAllTime(allTimeFromResponse(res.data));
    } catch (err) {
      setError(readHttpFailure(err).message || err.message);
      setSeasons([]);
      setAllTime([]);
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () =>
      subscribeToTeamProfileUpdates((update) => {
        if (Number(update.leagueId) !== Number(leagueId)) return;
        setSeasons((prev) =>
          prev.map((season) => {
            if (isFrozenPickemSeason(season)) return season;
            return {
              ...season,
              champions: Array.isArray(season.champions)
                ? season.champions.map((champion) => applyTeamProfileUpdate(champion, update))
                : season.champions,
              standings: Array.isArray(season.standings)
                ? season.standings.map((team) => applyTeamProfileUpdate(team, update))
                : season.standings,
              draftGrades: Array.isArray(season.draftGrades)
                ? season.draftGrades.map((team) => applyTeamProfileUpdate(team, update))
                : season.draftGrades,
            };
          })
        );
        setAllTime((prev) => prev.map((row) => applyTeamProfileUpdate(row, update)));
      }),
    [leagueId]
  );

  const status = loading ? 'loading' : error ? 'error' : 'ready';
  return { status, seasons, allTime, error, refetch: load };
}

export default useLeagueHistory;
