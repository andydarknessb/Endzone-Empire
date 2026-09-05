import { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../../../api/apiClient';
import { subscribeToScoreFeed } from '../../../shared/lib';
import { subscribeToTeamProfileUpdates } from '../../../lib/teamProfileEvents';
import { matchupFromDetailBody, applyScoreEvent, applyIdentityPatch } from './matchupModel';

/**
 * A single Matchup as a read model (ADR 0029: the thin hook on the entity's
 * index, the sibling of `useLeagueMatchups`). It composes the same three
 * sources onto the one model, for ONE matchup instead of a league's list:
 *   - a plain fetch of the Matchup DETAIL body
 *     (`GET /api/league/:id/matchups/:matchupId`), mapped through
 *     `matchupFromDetailBody`. It is never the list read: a Matchup Detail
 *     surface reads exactly its own matchup, never the whole week (AC: no list
 *     fetch);
 *   - the live score feed (shared/lib), applied through `applyScoreEvent`, with
 *     a full refetch on the feed's `resync` (a reconnect drift-recovery); and
 *   - the Team identity feed (teamProfileEvents), applied through
 *     `applyIdentityPatch`, scoped to this league.
 *
 * The whole score event (including its `plays`) is handed to an optional
 * `onScores` callback so a reader can keep its own play-driven concerns -
 * Matchup Detail's cutscenes, toasts, ticker, retro field and its optimistic
 * per-starter point bumps - without a second socket. The callback is read
 * through a ref so passing a fresh one never re-subscribes the feed.
 *
 * The raw detail body is returned alongside the model as `detail`: it carries
 * what the model deliberately does not (the two lineups' starters and benches,
 * the viewer's own Team id and the viewer what-if), which a box-score surface
 * still needs. The model is the one spelling of the scoreboard (totals, status,
 * Expected final, Players remaining); `detail` is the lineup payload beneath it.
 *
 * @param {number|string} leagueId
 * @param {number|string} matchupId
 * @param {{ onScores?: (event: object) => void }} [options]
 * @returns {{ matchup: object|null, detail: object|null, loading: boolean, error: string|null, refetch: () => void }}
 */
export function useMatchup(leagueId, matchupId, { onScores } = {}) {
  const [matchup, setMatchup] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const onScoresRef = useRef(onScores);
  onScoresRef.current = onScores;

  // `silent` separates the first load from a background refresh, exactly as the
  // league hook does: the first load drives `loading` (the page skeleton); a
  // resync (a reconnect refetch) must NOT, or every reconnect would blank the
  // live box score until the fetch resolves.
  const loadMatchup = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const res = await apiClient.get(`/api/league/${leagueId}/matchups/${matchupId}`);
      setDetail(res.data);
      setMatchup(matchupFromDetailBody(res.data));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leagueId, matchupId]);

  useEffect(() => {
    loadMatchup();
  }, [loadMatchup]);

  useEffect(() => {
    const unsubscribe = subscribeToScoreFeed(leagueId, {
      onScores: (event) => {
        const scored = (event && event.scored) || [];
        if (scored.length) {
          setMatchup((prev) => {
            if (!prev) return prev;
            const entry = scored.find((s) => s.matchupId === prev.id);
            return entry ? applyScoreEvent(prev, entry) : prev;
          });
        }
        onScoresRef.current?.(event);
      },
      // A reconnect refetches to recover the deltas missed while offline, but
      // silently: the box score already on screen stays up.
      resync: () => loadMatchup({ silent: true }),
    });
    return unsubscribe;
  }, [leagueId, loadMatchup]);

  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setMatchup((prev) => (prev ? applyIdentityPatch(prev, update) : prev));
  }), [leagueId]);

  return { matchup, detail, loading, error, refetch: loadMatchup };
}

export default useMatchup;
