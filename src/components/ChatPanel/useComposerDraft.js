import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * The unsent composer text, preserved per league for the current browser
 * session (#442 AC5/AC6). A manager who checks Players or Board, changes tabs
 * or briefly disconnects should find their half-written message waiting; a
 * successful send, a logout or an account change must clear it so a draft never
 * leaks across sessions or accounts.
 *
 * Persistence is `sessionStorage` on purpose: it is per browser session (the
 * spec's scope), never synced to the server before send, and gone when the
 * session ends. The record is keyed by league AND stamped with the account that
 * wrote it, so:
 *  - a different league reads a different key (no cross-league leak);
 *  - a different account (or a logout, account id absent) finds a stamp that
 *    does not match and the draft is dropped rather than inherited.
 *
 * The hook owns the composer's `text` state either way. Persistence is only
 * engaged when both a league and an account are known; without them (a caller
 * that passes neither, or a logged-out view) the composer still works, it just
 * keeps nothing between mounts. Every storage access is guarded because a
 * private-mode or storage-disabled browser makes it throw, and a composer that
 * cannot save a draft must still let the manager type and send.
 */
const KEY_PREFIX = 'endzone:composerDraft:';

const keyFor = (leagueId) => `${KEY_PREFIX}${leagueId}`;

function readDraft(leagueId, userId) {
  if (leagueId == null || userId == null) return '';
  try {
    const raw = window.sessionStorage.getItem(keyFor(leagueId));
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    // Only the account that wrote the draft may read it back; anyone else
    // (a switched account, a logout) gets nothing.
    if (parsed && parsed.ownerId === userId && typeof parsed.text === 'string') {
      return parsed.text;
    }
  } catch {
    // Unreadable or unavailable storage: behave as if there were no draft.
  }
  return '';
}

function writeDraft(leagueId, userId, text) {
  if (leagueId == null || userId == null) return;
  try {
    if (text) {
      window.sessionStorage.setItem(keyFor(leagueId), JSON.stringify({ ownerId: userId, text }));
    } else {
      window.sessionStorage.removeItem(keyFor(leagueId));
    }
  } catch {
    // Storage unavailable: the composer still works, it just cannot persist.
  }
}

function removeDraft(leagueId) {
  if (leagueId == null) return;
  try {
    window.sessionStorage.removeItem(keyFor(leagueId));
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

export default function useComposerDraft({ leagueId = null, userId = null } = {}) {
  const [text, setTextState] = useState(() => readDraft(leagueId, userId));

  // Re-seed the composer whenever the league or the account changes: restore
  // this account's draft for the new league, or empty it. An account change
  // (including a logout, userId null) that leaves a mismatched stamp behind
  // also drops that stale draft so the next account cannot inherit it.
  const seededRef = useRef(`${leagueId}:${userId}`);
  useEffect(() => {
    const restored = readDraft(leagueId, userId);
    setTextState(restored);
    if (!restored) removeDraft(leagueId);
    seededRef.current = `${leagueId}:${userId}`;
  }, [leagueId, userId]);

  // Every edit persists (or clears when emptied) for this league and account.
  const setText = useCallback(
    (next) => {
      setTextState(next);
      writeDraft(leagueId, userId, next);
    },
    [leagueId, userId]
  );

  // A successful send discards the draft entirely.
  const clearDraft = useCallback(() => {
    setTextState('');
    removeDraft(leagueId);
  }, [leagueId]);

  return [text, setText, clearDraft];
}
