import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { classifyPlays } from './classifyPlays';

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
 *     default is on, and a failed read leaves it on). Held twice: in a ref
 *     the play handler reads (so the handler stays stable), and as state
 *     (`celebrationsEnabled`) so a surface can SHOW it, the read-only
 *     "Celebrations on / off" caption the Matchup page slots into the retro
 *     field (#903 review; `CelebrationsCaption` renders it).
 *
 * The page calls `handlePlays(plays, { myStarterIds, oppStarterIds })` from
 * the entity hook's `onScores` with the event's modelled `plays` array; only
 * touchdown plays reach the celebration gate here (a moment play such as a
 * sack has `isTouchdown === false` and belongs to the retro field, not to a
 * cutscene or a toast). The routing itself is `classifyPlays`, this
 * feature's own private model (`./classifyPlays`, #1137: it and
 * `MAX_CUTSCENES` were `src/lib/scoringEvents` until ADR 0031's below-island
 * clause fired on that module's sixth island consumer; `classifyPlays` has
 * exactly one caller, this feature, so it folded in here rather than
 * becoming public entity surface the way `playLabel` did): a play by a
 * player in neither starting lineup is ignored.
 *
 * `handlePlays` is stable across renders, so a page may hand it to a
 * ref-reading feed callback without re-subscribing. The hook reaches below
 * the island for one thing, the plain fetch client the preference is read
 * through (the same module `shared/lib/useEndpoint` reads).
 *
 * @returns {{
 *   cutscene: object|null,        the cutscene at the head of the queue (its `_cid` keys a fresh mount)
 *   dismissCutscene: () => void,  drops the head of the queue (auto-dismiss and tap alike)
 *   toasts: object[],             the visible toasts, each with an `id`
 *   dismissToast: (id) => void,
 *   handlePlays: (plays: object[], sides: { myStarterIds?: Set, oppStarterIds?: Set }) => void,
 *   celebrationsEnabled: boolean,  the preference as state (true until the read says otherwise)
 * }}
 */
export function useCelebrateTouchdown() {
  const [cutsceneQueue, setCutsceneQueue] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [celebrationsEnabled, setCelebrationsEnabled] = useState(true);
  const toastSeq = useRef(0);
  const cutsceneSeq = useRef(0);
  const celebrationsRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const settle = (enabled) => {
      if (cancelled) return;
      celebrationsRef.current = enabled;
      setCelebrationsEnabled(enabled);
    };
    apiClient
      .get('/api/notifications/prefs')
      .then((res) => settle(res.data?.touchdownCelebrations !== false))
      .catch(() => settle(true));
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
    celebrationsEnabled,
  };
}

export default useCelebrateTouchdown;
