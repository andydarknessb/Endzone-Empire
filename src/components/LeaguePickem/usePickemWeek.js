import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { clearPickemStandingsCache } from '../../hooks/usePickemStandings';

const message = (error) =>
  error?.response?.data?.error || error?.message || 'Request failed';

/**
 * One week of Pick'em: the slate, my picks, and the picks of everyone else
 * that have already been revealed by kickoff.
 *
 * `savePicks` never throws — a rejected save comes back as
 * `{ ok: false, code, gameKeys }` and is also parked in `saveError`, because
 * the board needs to highlight the exact rows the server refused (a game that
 * kicked off between render and save, or a duplicate confidence value).
 */
export default function usePickemWeek(leagueId, week, { enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(() => {
    if (!enabled || leagueId == null || week == null) {
      setLoading(false);
      return Promise.resolve();
    }
    setLoading(true);
    setError(null);
    return apiClient
      .get(`/api/pickem/league/${leagueId}/week/${week}`)
      .then((res) => setData(res.data))
      .catch((requestError) => setError(message(requestError)))
      .finally(() => setLoading(false));
  }, [leagueId, week, enabled]);

  useEffect(() => {
    let active = true;
    // The week changed — drop the old board rather than showing last week's
    // picks against this week's games while the request is in flight.
    setData(null);
    setSaveError(null);
    load().then(() => {
      if (!active) return;
    });
    return () => { active = false; };
  }, [load]);

  const savePicks = useCallback(
    async (picks) => {
      setSaving(true);
      setSaveError(null);
      try {
        await apiClient.put(`/api/pickem/league/${leagueId}/week/${week}/picks`, { picks });
        // Saved picks change the standings' made/pending counts: drop the
        // shared cache so the Standings tab reflects them right away.
        clearPickemStandingsCache(leagueId);
        await load();
        return { ok: true };
      } catch (requestError) {
        const body = requestError?.response?.data || {};
        const failure = {
          ok: false,
          message: body.error || message(requestError),
          code: body.code || null,
          gameKeys: Array.isArray(body.gameKeys) ? body.gameKeys : [],
        };
        setSaveError(failure);
        // A lock rejection means the board is stale — pull the fresh slate so
        // the newly locked game renders as locked instead of still editable.
        if (failure.code === 'PICKEM_LOCKED') await load();
        return failure;
      } finally {
        setSaving(false);
      }
    },
    [leagueId, week, load]
  );

  return { data, loading, error, reload: load, saving, saveError, savePicks };
}
