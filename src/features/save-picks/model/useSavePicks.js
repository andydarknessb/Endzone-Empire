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
 * `{ ok: true }` (and has already patched `myPicks`) or `{ ok: false, code, gameKeys, message }`.
 * `views` carry `gameKey`, `teams` (away, home) and `lock` for each game on the slate.
 *
 * Each card has a save state, `stateFor(gameKey)`, the words the card shows:
 *   saving   the attempted pick is in flight (the card outlines it, never fills it)
 *   saved    "Pick saved" (or "Swapped with ...") with Undo, which restores the previous pick or
 *            no pick (`pickedTeam: null`); a swap's Undo restores both games in one request
 *   undone   the Undo landed
 *   failed   "Couldn't save this pick." with Retry; the attempted team stays outlined
 *   refused  not retryable: the game kicked off first (PICKEM_LOCKED), or the rank belongs to a
 *            kicked-off game; `message` says which
 *   draft    confidence mode only: a team is chosen but has no rank yet, and the server accepts a
 *            confidence pick only with its rank, so nothing is sent until the rank is chosen
 *
 * `resetKey` (the selected week) clears every state when it changes, and a result that lands after
 * the change is dropped.
 */
export function useSavePicks({ mode = 'straight', myPicks, views, savePicks, resetKey }) {
  const [states, setStates] = useState({});
  const epochRef = useRef(0);

  useEffect(() => {
    epochRef.current += 1;
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

  // `entries` are sent in one request; `previous` is what Undo restores; `swapWith` maps a game to
  // the label of the game it traded ranks with; `kind` 'undo' lands as "undone" instead of "saved".
  const send = async ({ entries, previous, swapWith = null, kind = 'save' }) => {
    const epoch = epochRef.current;
    const attempting = {};
    for (const entry of entries) attempting[entry.gameKey] = { status: 'saving', attempted: entry };
    patchStates(attempting);

    const result = await savePicks(entries);
    if (epoch !== epochRef.current) return result;

    const settled = {};
    for (const entry of entries) {
      const { gameKey } = entry;
      if (result?.ok) {
        settled[gameKey] = kind === 'undo'
          ? { status: 'undone' }
          : { status: 'saved', attempted: entry, undoEntries: previous, swap: swapWith ? swapWith[gameKey] : null };
      } else if (result?.code === 'PICKEM_LOCKED' && (result.gameKeys || []).includes(gameKey)) {
        settled[gameKey] = {
          status: 'refused',
          message: `This pick wasn't saved: ${labelOf(gameKey)} had already kicked off. Your other picks are saved.`,
        };
      } else {
        settled[gameKey] = {
          status: 'failed',
          attempted: entry,
          retry: { entries, previous, swapWith, kind },
          message: "Couldn't save this pick.",
        };
      }
    }
    patchStates(settled);
    return result;
  };

  const retry = (gameKey) => {
    const failed = states[gameKey];
    if (failed?.status === 'failed' && failed.retry) send(failed.retry);
  };

  const undo = (gameKey) => {
    const saved = states[gameKey];
    if (saved?.status !== 'saved' || !saved.undoEntries) return;
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
    // "Confidence: none" is not a save: a confidence pick cannot exist without its rank.
    if (!view || view.lock || value == null || state?.status === 'saving') return;
    const current = pickOf(gameKey);
    const team = state?.status === 'draft' ? state.attempted.pickedTeam : current?.pickedTeam;
    if (!team || (current?.pickedTeam === team && current?.confidence === value)) return;

    const holder = (myPicks || []).find((pick) => pick.gameKey !== gameKey && pick.confidence === value);
    if (!holder) {
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
    if (current?.confidence == null) return;
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
