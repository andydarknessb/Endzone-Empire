import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { classifyPlays } from '../../../lib/scoringEvents';

/**
 * The celebrate-touchdown feature's model (ADR 0031, #903): everything the
 * legacy Matchup Detail page kept for its play-driven celebrations, moved out
 * of the page as one feature. It owns:
 *
 *   - the cutscene queue: one full-screen Tecmo cutscene per touchdown by a
 *     starter of the viewer's own Team, played back to back and capped by
 *     `classifyPlays` (MAX_CUTSCENES), the overflow collapsing into one
 *     summary toast;
 *   - the toasts: an opponent starter's touchdown is a bottom toast, never a
 *     cutscene, and the summary toast above rides the same stack;
 *   - the celebration preference, read once from
 *     `GET /api/notifications/prefs` (`touchdownCelebrations`, opt-out: the
 *     default is on, and a failed read leaves it on). A ref, not state: it
 *     configures the play handler without driving a re-render.
 *
 * The page calls `handlePlays(plays, { myStarterIds, oppStarterIds })` from
 * the entity hook's `onScores` with the event's whole `plays` array; only
 * touchdown plays reach the celebration gate here (a moment play such as a
 * sack has `isTouchdown === false` and belongs to the retro field, not to a
 * cutscene or a toast). The routing itself is `classifyPlays`
 * (src/lib/scoringEvents, the sanctioned reach below the island that ADR 0031
 * names): a play by a player in neither starting lineup is ignored.
 *
 * `handlePlays` is stable across renders, so a page may hand it to a
 * ref-reading feed callback without re-subscribing. The hook reaches below
 * the island for one thing besides the classifier, the plain fetch client
 * the preference is read through (the same module `shared/lib/useEndpoint`
 * reads).
 *
 * @returns {{
 *   cutscene: object|null,        the cutscene at the head of the queue (its `_cid` keys a fresh mount)
 *   dismissCutscene: () => void,  drops the head of the queue (auto-dismiss and tap alike)
 *   toasts: object[],             the visible toasts, each with an `id`
 *   dismissToast: (id) => void,
 *   handlePlays: (plays: object[], sides: { myStarterIds?: Set, oppStarterIds?: Set }) => void,
 * }}
 */
export function useCelebrateTouchdown() {
  const [cutsceneQueue, setCutsceneQueue] = useState([]);
  const [toasts, setToasts] = useState([]);
  const toastSeq = useRef(0);
  const cutsceneSeq = useRef(0);
  const celebrationsRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/api/notifications/prefs')
      .then((res) => {
        if (!cancelled) celebrationsRef.current = res.data?.touchdownCelebrations !== false;
      })
      .catch(() => {
        if (!cancelled) celebrationsRef.current = true;
      });
    return () => { cancelled = true; };
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissCutscene = useCallback(() => {
    setCutsceneQueue((q) => q.slice(1));
  }, []);

  const handlePlays = useCallback((plays, { myStarterIds, oppStarterIds } = {}) => {
    // Cutscenes and toasts are touchdown-only; a non-TD moment play never
    // reaches this gate.
    const tdPlays = (plays || []).filter((p) => p && p.isTouchdown !== false);
    if (!tdPlays.length) return;

    const { cutscenes, summaryToast, toasts: oppToasts } = classifyPlays(tdPlays, {
      myStarterIds: myStarterIds || new Set(),
      oppStarterIds: oppStarterIds || new Set(),
      celebrationsEnabled: celebrationsRef.current,
    });
    if (cutscenes.length) {
      setCutsceneQueue((q) => [
        ...q,
        ...cutscenes.map((c) => ({ ...c, _cid: (cutsceneSeq.current += 1) })),
      ]);
    }
    const batch = [...oppToasts];
    if (summaryToast) batch.push(summaryToast);
    if (batch.length) {
      setToasts((prev) => [
        ...prev,
        ...batch.map((t) => ({ ...t, id: (toastSeq.current += 1) })),
      ]);
    }
  }, []);

  return {
    cutscene: cutsceneQueue[0] || null,
    dismissCutscene,
    toasts,
    dismissToast,
    handlePlays,
  };
}

export default useCelebrateTouchdown;
