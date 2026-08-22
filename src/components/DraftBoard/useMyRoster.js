import { useState, useEffect, useCallback } from 'react';
import apiClient from '../../api/apiClient';

/**
 * The caller's own current roster in this league — id/name/nfl_team/bye_week
 * per rostered player, from the same endpoint TeamManagement uses. Feeds only
 * the pool's Bye overlap hint (see PlayerPoolTable): "N rostered players
 * share this candidate's Bye". Refetches whenever a pick lands so a manager's
 * own picks are reflected without a page reload.
 *
 * A spectator (no team in this league) or a transient fetch error both just
 * mean no overlap hint is shown — neither is worth surfacing as a page error.
 */
export default function useMyRoster(leagueId) {
  const [roster, setRoster] = useState([]);

  const fetchRoster = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/team/roster', { params: { leagueId: Number(leagueId) } });
      setRoster(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setRoster([]);
    }
  }, [leagueId]);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  return { roster, refetchRoster: fetchRoster };
}
