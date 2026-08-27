import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * The unsent composer draft, preserved per league for the current browser
 * session (#442 AC5/AC6, extended for the GIF composer by #524). A manager who
 * checks Players or Board, changes tabs or briefly disconnects should find their
 * half-written message AND their half-composed GIF waiting; a successful send, a
 * logout or an account change must clear the relevant part so a draft never
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
 * The hook owns BOTH composers' preserved state: the message `text` and the GIF
 * composition `gif` ({ assetId, description, caption }). The two ride one
 * account-stamped record ({ acct, text?, gif? }) but clear INDEPENDENTLY, which
 * is the whole point of #524: a successful text send clears only `text` and
 * leaves a half-composed GIF in place, and a successful GIF send clears only
 * `gif` and leaves the typed message in place. Only when both are empty is the
 * record removed entirely.
 *
 * Persistence is only engaged when both a league and an account are known;
 * without them (a caller that passes neither, or a logged-out view) the composer
 * still works, it just keeps nothing between mounts. Every storage access is
 * guarded because a private-mode or storage-disabled browser makes it throw, and
 * a composer that cannot save a draft must still let the manager type, compose
 * and send.
 *
 * Emoji ride the preserved text string for free (#442 AC5): they are inline
 * Unicode, so no separate state is kept for them. The GIF composition holds only
 * the compose fields; the touched/validation flag is deliberately NOT persisted,
 * so a restored composition never comes back already showing a validation error.
 */
const KEY_PREFIX = 'endzone:composerDraft:';

const keyFor = (leagueId) => `${KEY_PREFIX}${leagueId}`;

const emptyGif = () => ({ assetId: '', description: '', caption: '' });

// A stored gif slice keeps only string fields; anything else reads back as an
// empty string so a malformed record can never crash the composer.
function normalizeGif(gif) {
  if (!gif || typeof gif !== 'object') return emptyGif();
  return {
    assetId: typeof gif.assetId === 'string' ? gif.assetId : '',
    description: typeof gif.description === 'string' ? gif.description : '',
    caption: typeof gif.caption === 'string' ? gif.caption : '',
  };
}

const gifIsEmpty = (gif) => !gif || (!gif.assetId && !gif.description && !gif.caption);

// Read the whole account-stamped record for this league. Only the account that
// wrote the draft may read it back; anyone else (a switched account, a logout)
// gets an empty draft. `acct` is the authoring account id: a local
// draft-ownership stamp, not an authorization or league-owner decision, so it is
// deliberately NOT named ownerId. A legacy record with only { acct, text }
// reads back its text and an empty gif.
function readRecord(leagueId, userId) {
  const empty = { text: '', gif: emptyGif() };
  if (leagueId == null || userId == null) return empty;
  try {
    const raw = window.sessionStorage.getItem(keyFor(leagueId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.acct === userId) {
      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        gif: normalizeGif(parsed.gif),
      };
    }
  } catch {
    // Unreadable or unavailable storage: behave as if there were no draft.
  }
  return empty;
}

// Persist the combined record, storing only the non-empty parts and removing the
// key entirely when both the text and the gif are empty. Guarded because storage
// throws in private modes and under quota pressure.
function writeRecord(leagueId, userId, text, gif) {
  if (leagueId == null || userId == null) return;
  try {
    const hasText = Boolean(text);
    const hasGif = !gifIsEmpty(gif);
    if (hasText || hasGif) {
      const record = { acct: userId };
      if (hasText) record.text = text;
      if (hasGif) record.gif = normalizeGif(gif);
      window.sessionStorage.setItem(keyFor(leagueId), JSON.stringify(record));
    } else {
      window.sessionStorage.removeItem(keyFor(leagueId));
    }
  } catch {
    // Storage unavailable: the composer still works, it just cannot persist.
  }
}

function removeRecord(leagueId) {
  if (leagueId == null) return;
  try {
    window.sessionStorage.removeItem(keyFor(leagueId));
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

export default function useComposerDraft({ leagueId = null, userId = null } = {}) {
  // Read the stored record once at mount; text and gif are then owned as
  // independent state so each composer re-renders only on its own edits.
  const [initial] = useState(() => readRecord(leagueId, userId));
  const [text, setTextState] = useState(initial.text);
  const [gif, setGifState] = useState(initial.gif);

  // The latest text and gif, so a setter for one can persist the combined record
  // without capturing the other as a stale closure value.
  const textRef = useRef(text);
  const gifRef = useRef(gif);
  textRef.current = text;
  gifRef.current = gif;

  // Re-seed both composers whenever the league or the account changes: restore
  // this account's draft for the new league, or empty it. An account change
  // (including a logout, userId null) that leaves a mismatched stamp behind also
  // drops that stale record so the next account cannot inherit it.
  const seededRef = useRef(`${leagueId}:${userId}`);
  useEffect(() => {
    const restored = readRecord(leagueId, userId);
    setTextState(restored.text);
    setGifState(restored.gif);
    textRef.current = restored.text;
    gifRef.current = restored.gif;
    if (!restored.text && gifIsEmpty(restored.gif)) removeRecord(leagueId);
    seededRef.current = `${leagueId}:${userId}`;
  }, [leagueId, userId]);

  // Every text edit persists (or clears when both parts empty) for this league
  // and account, alongside whatever gif composition is currently held.
  const setText = useCallback(
    (next) => {
      setTextState(next);
      textRef.current = next;
      writeRecord(leagueId, userId, next, gifRef.current);
    },
    [leagueId, userId]
  );

  // A successful TEXT send discards only the text draft; the gif composition is
  // left untouched (#524 independence). If the gif is also empty, writeRecord
  // removes the record entirely.
  const clearDraft = useCallback(() => {
    setTextState('');
    textRef.current = '';
    writeRecord(leagueId, userId, '', gifRef.current);
  }, [leagueId, userId]);

  // Every gif edit persists (or clears when both parts empty) for this league and
  // account, alongside whatever message text is currently held.
  const setGif = useCallback(
    (next) => {
      const normalized = normalizeGif(next);
      setGifState(normalized);
      gifRef.current = normalized;
      writeRecord(leagueId, userId, textRef.current, normalized);
    },
    [leagueId, userId]
  );

  // A successful GIF send discards only the gif composition; the text draft is
  // left untouched (#524 independence). If the text is also empty, writeRecord
  // removes the record entirely.
  const clearGif = useCallback(() => {
    const cleared = emptyGif();
    setGifState(cleared);
    gifRef.current = cleared;
    writeRecord(leagueId, userId, textRef.current, cleared);
  }, [leagueId, userId]);

  return [text, setText, clearDraft, gif, setGif, clearGif];
}
