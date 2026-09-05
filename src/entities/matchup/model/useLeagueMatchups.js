import { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../../../api/apiClient';
import { subscribeToScoreFeed } from '../../../shared/lib';
import { subscribeToTeamProfileUpdates } from '../../../lib/teamProfileEvents';
import { matchupFromListRow, applyScoreEvent, applyIdentityPatch } from './matchupModel';

/**
 * A league's Matchups as read models (ADR 0029: the thin hook on the entity's
 * index that composes a fetch with the live feeds over the pure module).
 *
 * It composes three sources onto the one model:
 *   - a plain fetch of the Matchup list (NOT the resource cache: this is the
 *     only mount of this URL on the page, so ADR 0004's admission rule is not
 *     met), mapped through `matchupFromListRow`;
 *   - the live score feed (shared/lib), applied through `applyScoreEvent`, with
 *     a full refetch on the feed's `resync`; and
 *   - the Team identity feed (teamProfileEvents), applied through
 *     `applyIdentityPatch`, scoped to this league.
 *
 * The whole score event (including its `plays`) is handed to an optional
 * `onScores` callback so a reader can keep its own concern - Game Center's
 * league-wide play ticker filters by the week on screen - without a second
 * socket. The callback is read through a ref so passing a fresh one never
 * re-subscribes the feed.
 *
 * @param {number|string} leagueId
 * @param {{ onScores?: (event: object) => void }} [options]
 * @returns {{ matchups: object[], loading: boolean, error: string|null, refetch: () => void }}
 */
export function useLeagueMatchups(leagueId, { onScores } = {}) {
  const [matchups, setMatchups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const onScoresRef = useRef(onScores);
  onScoresRef.current = onScores;

  const fetchMatchups = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get(`/api/league/${leagueId}/matchups`);
      const rows = Array.isArray(res.data) ? res.data : [];
      setMatchups(rows.map(matchupFromListRow));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    fetchMatchups();
  }, [fetchMatchups]);

  useEffect(() => {
    const unsubscribe = subscribeToScoreFeed(leagueId, {
      onScores: (event) => {
        const scored = (event && event.scored) || [];
        if (scored.length) {
          setMatchups((prev) => prev.map((model) => {
            const entry = scored.find((s) => s.matchupId === model.id);
            return entry ? applyScoreEvent(model, entry) : model;
          }));
        }
        onScoresRef.current?.(event);
      },
      resync: fetchMatchups,
    });
    return unsubscribe;
  }, [leagueId, fetchMatchups]);

  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setMatchups((prev) => prev.map((model) => applyIdentityPatch(model, update)));
  }), [leagueId]);

  return { matchups, loading, error, refetch: fetchMatchups };
}

export default useLeagueMatchups;
