import { useEffect, useRef, useState } from 'react';

/**
 * save-picks feature (ADR 0038, save on tap since ADR 0067 wave 2 Critique 10): choosing a team
 * saves that one pick at once. There is no draft, no dirty state and no batch: each tap sends a
 * one-element `picks` array to `PUT /api/pickem/league/:id/week/:week/picks` (the server upserts per
 * game), and a confidence swap sends the two games in ONE request, because the server excludes the
 * incoming games from the ranks it holds against, so a two-game batch passes uniqueness where two
 * single saves would not.
 *
 * `savePicks` is `entities/pickem-game`'s `usePickemWeek().savePicks`: it never throws, resolves
 * `{ ok: true }` (and has already patched `myPicks`) or `{ ok: false, status, code, gameKeys,
 * message }`. `views` carry `gameKey`, `teams` (away, home) and `lock` for each game on the slate.
 *
 * Each card has a save state, `stateFor(gameKey)`, the words the card shows:
 *   saving   the attempted pick is in flight (the card outlines it, never fills it)
 *   saved    "Pick saved" (or "Swapped with ...") with Undo, which restores the previous pick or
 *            no pick (`pickedTeam: null`); a swap's Undo restores both games in one request. A later
 *            save that touches any game the Undo would restore ends this state: its Undo is stale
 *   undone   the Undo landed
 *   failed   a network error or a 5xx: "Couldn't save this pick." with Retry, which can succeed;
 *            the attempted team stays outlined
 *   refused  not retryable, so no Retry, and `message` says why: the game kicked off first
 *            (PICKEM_LOCKED, on both games of a swap and for an Undo, which then says the pick
 *            stands), a rank taken or held by a kicked-off game, or any other 4xx
 *   busy     confidence mode: another rank is still saving, so this rank change waits (a plain
 *            line, no queue); it hands the card back its earlier state when that save settles
 *   draft    confidence mode only: a team is chosen but has no rank yet, and the server accepts a
 *            confidence pick only with its rank, so nothing is sent until the rank is chosen
 *
 * A settled state carries `focusTeam`, the team whose button now holds the pick (or was attempted),
 * so the card can put focus back where it was when Undo or Retry unmounts under the keyboard.
 *
 * `resetKey` (the selected week) clears every state when it changes, and a result that lands after
 * the change is dropped.
 */
const BUSY_MESSAGE = 'Another rank is still saving. Choose this rank again in a moment.';

// A failure that a second try can fix: the request never got an answer, or the server fell over.
const retryable = (result) => result.status == null || result.status >= 500;

export function useSavePicks({ mode = 'straight', myPicks, views, savePicks, resetKey }) {
  const [states, setStates] = useState({});
  const epochRef = useRef(0);
  // Confidence saves in flight, counted synchronously: two taps in one tick both see the first.
  const rankSavesRef = useRef(0);

  useEffect(() => {
    epochRef.current += 1;
    rankSavesRef.current = 0;
    setStates({});
  }, [resetKey]);

  const confidence = mode === 'confidence';
  const pickOf = (gameKey) => (myPicks || []).find((pick) => pick.gameKey === gameKey) || null;
  const viewOf = (gameKey) => (views || []).find((view) => view.gameKey === gameKey) || null;
  const labelOf = (gameKey) => {
    const teams = viewOf(gameKey)?.teams;
    return teams ? `${teams[0]} @ ${teams[1]}` : gameKey;
  };
  const entryOf = (gameKey, pick) => ({
    gameKey,
    pickedTeam: pick ? pick.pickedTeam : null,
    confidence: pick && pick.confidence != null ? pick.confidence : null,
  });

  const patchStates = (patch) => setStates((prev) => ({ ...prev, ...patch }));

  // The message a refused card shows. `lockedKeys` are the games the server named.
  const refusal = (entry, result, kind, lockedKeys) => {
    const { gameKey } = entry;
    const standing = pickOf(gameKey)?.pickedTeam;
    if (result.code === 'PICKEM_LOCKED') {
      if (lockedKeys.includes(gameKey)) {
        return kind === 'undo'
          ? `Undo didn't go through: ${labelOf(gameKey)} kicked off.${standing ? ` Your pick ${standing} stands.` : ''}`
          : `This pick wasn't saved: ${labelOf(gameKey)} had already kicked off. Your other picks are saved.`;
      }
      // The unlocked half of a refused swap or undo: nothing in the request was saved.
      const named = lockedKeys.map(labelOf).join(' and ');
      return kind === 'undo'
        ? `Undo didn't go through: ${named} kicked off.${standing ? ` Your pick ${standing} stands.` : ''}`
        : `This swap wasn't saved: ${named} had already kicked off.`;
    }
    if (result.code === 'PICKEM_BAD_CONFIDENCE') return 'That rank is already taken. Choose another rank.';
    return kind === 'undo'
      ? "Undo didn't go through. Reload the page and try again."
      : "This pick wasn't saved. Reload the page and try again.";
  };

  // `entries` are sent in one request; `previous` is what Undo restores; `swapWith` maps a game to
  // the label of the game it traded ranks with; `kind` 'undo' lands as "undone" instead of "saved".
  const send = async ({ entries, previous, swapWith = null, kind = 'save' }) => {
    const epoch = epochRef.current;
    const ranked = confidence && entries.some((entry) => entry.confidence != null);
    if (ranked) rankSavesRef.current += 1;
    const touched = new Set(entries.map((entry) => entry.gameKey));
    const removed = {};
    for (const entry of entries) removed[entry.gameKey] = pickOf(entry.gameKey)?.pickedTeam ?? null;

    setStates((prev) => {
      const next = { ...prev };
      // A later save that touches a game another card's Undo would restore makes that Undo stale.
      for (const [gameKey, state] of Object.entries(prev)) {
        if (state?.status === 'saved' && !touched.has(gameKey) && state.undoEntries?.some((entry) => touched.has(entry.gameKey))) {
          next[gameKey] = null;
        }
      }
      for (const entry of entries) next[entry.gameKey] = { status: 'saving', attempted: entry, focusTeam: entry.pickedTeam ?? removed[entry.gameKey] };
      return next;
    });

    const result = await savePicks(entries);
    if (ranked && epoch === epochRef.current) rankSavesRef.current -= 1;
    if (epoch !== epochRef.current) return result;

    const lockedKeys = result?.gameKeys || [];
    const settled = {};
    for (const entry of entries) {
      const { gameKey } = entry;
      const focusTeam = entry.pickedTeam ?? removed[gameKey];
      if (result?.ok) {
        settled[gameKey] = kind === 'undo'
          ? { status: 'undone', focusTeam }
          : {
            status: 'saved', attempted: entry, undoEntries: previous, swap: swapWith ? swapWith[gameKey] : null, focusTeam,
          };
      } else if (retryable(result)) {
        settled[gameKey] = {
          status: 'failed',
          attempted: entry,
          retry: { entries, previous, swapWith, kind },
          message: kind === 'undo' ? "Undo didn't go through." : "Couldn't save this pick.",
          focusTeam,
        };
      } else {
        settled[gameKey] = { status: 'refused', message: refusal(entry, result, kind, lockedKeys), focusTeam };
      }
    }
    // The rank save is over: a rank change that was told to wait can be made again.
    setStates((prev) => {
      const next = { ...prev, ...settled };
      if (rankSavesRef.current === 0) {
        for (const [gameKey, state] of Object.entries(next)) if (state?.status === 'busy') next[gameKey] = state.resume;
      }
      return next;
    });
    return result;
  };

  // In confidence mode one rank save at a time: another rank change while one is in flight is told to
  // wait, in a plain line. There is no queue; the manager chooses again.
  const waitForRankSave = (gameKey, entries) => {
    if (!confidence || rankSavesRef.current === 0 || !entries.some((entry) => entry.confidence != null)) return false;
    // `resume` is what the card said before (a saved pick keeps its Undo once the wait is over).
    patchStates({ [gameKey]: { status: 'busy', message: BUSY_MESSAGE, resume: states[gameKey] || null } });
    return true;
  };

  const retry = (gameKey) => {
    const failed = states[gameKey];
    if (failed?.status !== 'failed' || !failed.retry || waitForRankSave(gameKey, failed.retry.entries)) return;
    send(failed.retry);
  };

  const undo = (gameKey) => {
    const saved = states[gameKey];
    if (saved?.status !== 'saved' || !saved.undoEntries || waitForRankSave(gameKey, saved.undoEntries)) return;
    const current = saved.undoEntries.map((entry) => entryOf(entry.gameKey, pickOf(entry.gameKey)));
    send({ entries: saved.undoEntries, previous: current, kind: 'undo' });
  };

  const pickWinner = (gameKey, team) => {
    const view = viewOf(gameKey);
    const state = states[gameKey];
    if (!view || view.lock || state?.status === 'saving') return;
    if (state?.status === 'failed' && state.attempted?.pickedTeam === team) {
      retry(gameKey);
      return;
    }
    const current = pickOf(gameKey);
    if (current?.pickedTeam === team) {
      // Tapping the saved team again changes nothing; it only clears a stale note on the card.
      if (state && state.status !== 'saved') patchStates({ [gameKey]: null });
      return;
    }
    const rank = current?.confidence ?? null;
    if (confidence && rank == null) {
      patchStates({ [gameKey]: { status: 'draft', attempted: { gameKey, pickedTeam: team, confidence: null } } });
      return;
    }
    send({
      entries: [{ gameKey, pickedTeam: team, confidence: confidence ? rank : null }],
      previous: [entryOf(gameKey, current)],
    });
  };

  const setConfidence = (gameKey, value) => {
    const view = viewOf(gameKey);
    const state = states[gameKey];
    // "Confidence: none" is not offered on a ranked pick, and is not a save: a confidence pick cannot
    // exist without its rank.
    if (!view || view.lock || value == null || state?.status === 'saving') return;
    const current = pickOf(gameKey);
    const team = state?.status === 'draft' ? state.attempted.pickedTeam : current?.pickedTeam;
    if (!team || (current?.pickedTeam === team && current?.confidence === value)) return;

    const holder = (myPicks || []).find((pick) => pick.gameKey !== gameKey && pick.confidence === value);
    if (!holder) {
      if (waitForRankSave(gameKey, [{ confidence: value }])) return;
      send({ entries: [{ gameKey, pickedTeam: team, confidence: value }], previous: [entryOf(gameKey, current)] });
      return;
    }
    if (viewOf(holder.gameKey)?.lock) {
      patchStates({
        [gameKey]: {
          status: 'refused',
          attempted: { gameKey, pickedTeam: team, confidence: value },
          message: `Rank ${value} is locked to ${labelOf(holder.gameKey)}. Choose another rank.`,
        },
      });
      return;
    }
    // A game with no rank has none to give the holder, so the menu does not offer the swap.
    if (current?.confidence == null || waitForRankSave(gameKey, [{ confidence: value }])) return;
    send({
      entries: [
        { gameKey, pickedTeam: team, confidence: value },
        { gameKey: holder.gameKey, pickedTeam: holder.pickedTeam, confidence: current.confidence },
      ],
      previous: [entryOf(gameKey, current), entryOf(holder.gameKey, holder)],
      swapWith: { [gameKey]: labelOf(holder.gameKey), [holder.gameKey]: labelOf(gameKey) },
    });
  };

  return {
    stateFor: (gameKey) => states[gameKey] || null,
    pickWinner,
    setConfidence,
    undo,
    retry,
  };
}

export default useSavePicks;
