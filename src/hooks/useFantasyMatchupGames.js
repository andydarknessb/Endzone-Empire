import { useEffect, useState } from 'react';
import apiClient from '../api/apiClient';

/**
 * GET /api/matchups/:matchupId/real-games — the tank01_game_id of every real
 * NFL game either roster in this fantasy matchup has a player in. Powers
 * mounting one <LiveGameStatus> per real game a matchup actually spans,
 * instead of the caller guessing which games matter.
 */
export default function useFantasyMatchupGames(matchupId) {
  const [realGameIds, setRealGameIds] = useState([]);
  const [loading, setLoading] = useState(!!matchupId);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!matchupId) {
      setRealGameIds([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiClient
      .get(`/api/matchups/${matchupId}/real-games`)
      .then((res) => {
        if (cancelled) return;
        setRealGameIds(res.data || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [matchupId]);

  return { realGameIds, loading, error };
}
