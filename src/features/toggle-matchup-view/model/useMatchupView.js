import { useCallback, useMemo, useState } from 'react';

/**
 * The toggle-matchup-view feature's model (ADR 0031, #903): which of the two
 * Matchup views a manager is looking at, remembered per viewer in
 * localStorage so the choice survives a reload and a return to the page.
 *
 * The storage key carries the viewer, and ONE stable spelling of the viewer
 * per browser session (#903 review): the signed-in user's id (`user:<id>`),
 * the one fact the page can read before its own data lands, so the key never
 * flips after first paint. A viewer with no user id (the page mounted before
 * sign-in state exists) falls back to a per-browser `anon` key. The viewer's
 * Team id is deliberately NOT part of the key: it arrives with the Matchup
 * detail body, after first paint, and a key that lands later would re-read
 * the memory under a different name and flip the view the viewer was already
 * looking at. Two managers on one browser still never share a choice: what
 * one signed-in user picks is read back for that user alone. Every
 * localStorage access is wrapped: a private window, cleared site data or a
 * browser set to block storage throws on the accessor, and the page must
 * render with the default rather than crash.
 *
 * @param {string|number|null} userId  the signed-in user's id; null for the anon key
 * @param {{ defaultView?: 'standard'|'scoreboard' }} [options]
 * @returns {['standard'|'scoreboard', (view: string) => void]}
 */
export const VIEW_STANDARD = 'standard';
export const VIEW_SCOREBOARD = 'scoreboard';
export const VIEWS = [VIEW_STANDARD, VIEW_SCOREBOARD];

const STORAGE_PREFIX = 'endzone.matchupView.';
export const ANON_VIEWER = 'anon';

/** The viewer half of the key: `user:<id>` for a signed-in user, else the per-browser `anon`. */
export function viewerKeyFor(userId) {
  return userId == null || userId === '' ? ANON_VIEWER : `user:${userId}`;
}

/** The localStorage key for a viewer's remembered view (never null: an unknown user keys `anon`). */
export function matchupViewStorageKey(userId) {
  return `${STORAGE_PREFIX}${viewerKeyFor(userId)}`;
}

function readStored(storageKey) {
  try {
    const value = window.localStorage.getItem(storageKey);
    return VIEWS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(storageKey, view) {
  try {
    window.localStorage.setItem(storageKey, view);
  } catch {
    // Storage unavailable: the choice lives for this mount only.
  }
}

export function useMatchupView(userId, { defaultView = VIEW_STANDARD } = {}) {
  const storageKey = matchupViewStorageKey(userId);
  // The remembered choice for THIS viewer, read once per key: the key is the
  // user id (or anon), known at first paint, so it does not change under a
  // mounted page.
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
