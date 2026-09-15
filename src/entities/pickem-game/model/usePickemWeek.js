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
  // `desiredKeyRef` is the (leagueId, week) the hook currently wants to
  // show. It is advanced only by the effect below, when those props
  // change — never by a load() call itself — because savePicks and the
  // PICKEM_LOCKED refetch close over the load() of whatever render they
  // were created on, not necessarily the current one: ordering load()
  // calls by a single counter (an earlier version of this fix did that)
  // still let one of those stale reloads win, since it can be *issued*
  // (and so claim the highest id) after the current week's request even
  // though it targets a week the hook has since left (formal-001-f1).
  // `latestIdByKeyRef` tracks, per (leagueId, week), the id of the most
  // recently issued request for that exact key — so two requests for the
  // same key (e.g. two reload() calls for the week still on screen) still
  // resolve newest-wins, independent of the cross-key desiredKeyRef check.
  const desiredKeyRef = useRef({ leagueId: null, week: null });
  const latestIdByKeyRef = useRef(new Map());
  const nextIdRef = useRef(0);

  const load = useCallback(() => {
    if (!enabled || leagueId == null || week == null) {
      setLoading(false);
      return Promise.resolve();
    }

    const key = `${leagueId}:${week}`;
    const id = ++nextIdRef.current;
    latestIdByKeyRef.current.set(key, id);
    // A response applies only when it still belongs to the hook's current
    // (leagueId, week) AND is the freshest request issued for that key — so
    // a reload for a week/league the hook has since left neither applies
    // nor can it supersede the current week's request, no matter which
    // resolves first.
    const applies = () =>
      desiredKeyRef.current.leagueId === leagueId &&
      desiredKeyRef.current.week === week &&
      latestIdByKeyRef.current.get(key) === id;

    // A load for a key that isn't current writes no hook state at issue
    // time either: otherwise a save's reload for the week the manager just
    // left could flip `loading` back on (or wipe a current-week `error`)
    // for a request whose result `applies()` above can never let through
    // anyway (formal-002-f1).
    if (applies()) {
      setLoading(true);
      setError(null);
    }
    return apiClient
      .get(`/api/pickem/league/${leagueId}/week/${week}`)
      .then((res) => {
        if (!applies()) return;
        setData(res.data);
      })
      .catch((requestError) => {
        if (!applies()) return;
        setError(readHttpFailure(requestError).message || requestError.message || 'Request failed');
      })
      .finally(() => {
        if (!applies()) return;
        setLoading(false);
      });
  }, [leagueId, week, enabled]);

  useEffect(() => {
    desiredKeyRef.current = { leagueId, week };
    // The week changed — drop the old board rather than showing last week's
    // picks against this week's games while the request is in flight.
    setData(null);
    setSaveError(null);
    load();
  }, [load, leagueId, week]);

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
