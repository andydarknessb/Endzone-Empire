import { useCallback, useMemo, useState } from 'react';

/**
 * The toggle-matchup-view feature's model (ADR 0031, #903): which of the two
 * Matchup views a manager is looking at, remembered per viewer in
 * localStorage so the choice survives a reload and a return to the page.
 *
 * The storage key carries the viewer (`viewerKey`, the page's own spelling of
 * "who is looking": the viewer's Team id, or the user id for a viewer with no
 * Team), so two managers on one browser never share a choice: what one picks
 * is read back for that one alone. Until the viewer is known (`viewerKey`
 * null) nothing is read or written and the view is the default. Every
 * localStorage access is wrapped: a private window, cleared site data or a
 * browser set to block storage throws on the accessor, and the page must
 * render with the default rather than crash.
 *
 * @param {string|number|null} viewerKey  who is looking; null while unknown
 * @param {{ defaultView?: 'standard'|'scoreboard' }} [options]
 * @returns {['standard'|'scoreboard', (view: string) => void]}
 */
export const VIEW_STANDARD = 'standard';
export const VIEW_SCOREBOARD = 'scoreboard';
export const VIEWS = [VIEW_STANDARD, VIEW_SCOREBOARD];

const STORAGE_PREFIX = 'endzone.matchupView.';

/** The localStorage key for a viewer's remembered view; null while the viewer is unknown. */
export function matchupViewStorageKey(viewerKey) {
  return viewerKey == null || viewerKey === '' ? null : `${STORAGE_PREFIX}${viewerKey}`;
}

function readStored(storageKey) {
  if (!storageKey) return null;
  try {
    const value = window.localStorage.getItem(storageKey);
    return VIEWS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(storageKey, view) {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, view);
  } catch {
    // Storage unavailable: the choice lives for this mount only.
  }
}

export function useMatchupView(viewerKey, { defaultView = VIEW_STANDARD } = {}) {
  const storageKey = matchupViewStorageKey(viewerKey);
  // The remembered choice for THIS viewer, re-read whenever the viewer changes
  // (a page mounted before the viewer was known reads it once the key lands).
  const stored = useMemo(() => readStored(storageKey), [storageKey]);
  // A pick made on this mount, kept with the key it was made under so a pick
  // never leaks onto another viewer's key.
  const [picked, setPicked] = useState(null);

  const view = picked && picked.key === storageKey
    ? picked.view
    : (stored || defaultView);

  const setView = useCallback((next) => {
    if (!VIEWS.includes(next)) return;
    setPicked({ key: storageKey, view: next });
    writeStored(storageKey, next);
  }, [storageKey]);

  return [view, setView];
}

export default useMatchupView;
