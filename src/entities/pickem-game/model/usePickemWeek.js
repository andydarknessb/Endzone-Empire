import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';

/**
 * One week of Pick'em: the slate, my picks, and the picks of everyone else
 * that have already been revealed by kickoff.
 *
 * `savePicks` never throws — a rejected save comes back as
 * `{ ok: false, code, gameKeys }` and is also parked in `saveError`, because
 * the board needs to highlight the exact rows the server refused (a game that
 * kicked off between render and save, or a duplicate confidence value). A
 * successful save leaves the standings cache (`entities/pickem-standings`)
 * stale, since saved picks change the standings' made/pending counts, but
 * clearing it is NOT this hook's job: sibling entities do not import each
 * other (ADR 0029), so the composer that reads both entities -
 * `pages/pickem` (#1267), via `widgets/pickem-board`'s `onSaved` callback -
 * clears it when `savePicks` resolves `{ ok: true }`.
 */
export default function usePickemWeek(leagueId, week, { enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  // Bumped by every load() call so a response can tell, at the point it is
  // about to apply, whether a newer request has since superseded it. Gating
  // here (rather than around the outer load() wrapper) is required: the
  // wrapper only learns a newer request started *after* this one already
  // resolved and called setData, which is too late.
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;
    const isStale = () => requestId !== requestIdRef.current;
    if (!enabled || leagueId == null || week == null) {
      setLoading(false);
      return Promise.resolve();
    }
    setLoading(true);
    setError(null);
    return apiClient
      .get(`/api/pickem/league/${leagueId}/week/${week}`)
      .then((res) => {
        if (isStale()) return;
        setData(res.data);
      })
      .catch((requestError) => {
        if (isStale()) return;
        setError(readHttpFailure(requestError).message || requestError.message || 'Request failed');
      })
      .finally(() => {
        if (isStale()) return;
        setLoading(false);
      });
  }, [leagueId, week, enabled]);

  useEffect(() => {
    // The week changed — drop the old board rather than showing last week's
    // picks against this week's games while the request is in flight.
    setData(null);
    setSaveError(null);
    load();
  }, [load]);

  const savePicks = useCallback(
    async (picks) => {
      setSaving(true);
      setSaveError(null);
      try {
        await apiClient.put(`/api/pickem/league/${leagueId}/week/${week}/picks`, { picks });
        await load();
        return { ok: true };
      } catch (requestError) {
        const body = requestError?.response?.data || {};
        const readFailure = readHttpFailure(requestError);
        const failure = {
          ok: false,
          message: readFailure.message || requestError.message || 'Request failed',
          code: readFailure.code || body.code || null,
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
