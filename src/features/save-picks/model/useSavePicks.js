import { useEffect, useState } from 'react';

/**
 * save-picks feature (#1265, ADR 0038 "What to build"): the board's local
 * draft of unsaved edits over the server's own `myPicks`, dirty tracking,
 * the PUT itself, and the flagged gameKeys a rejected save names.
 *
 * The server upserts (server/services/pickem.service.js's `upsertPicks`):
 * a save only has to carry the games actually being changed, so `save()`
 * sends the local overrides alone rather than replaying every pick the
 * manager already has saved.
 *
 * `savePicks` is `entities/pickem-game`'s `usePickemWeek().savePicks`: it
 * never throws, resolving `{ ok: true }` or `{ ok: false, code, gameKeys,
 * message }` (PICKEM_LOCKED when a game kicked off between render and
 * save, PICKEM_BAD_CONFIDENCE when two games in the batch share a number).
 * This hook forwards that shape rather than re-deriving it.
 *
 * `resetKey` clears the local draft when it changes (the board passes the
 * selected week): a draft for week 3 has no business surviving a switch to
 * week 4.
 */
export function useSavePicks({ myPicks, savePicks, saving = false, saveError = null, resetKey }) {
  const [overrides, setOverrides] = useState({});

  useEffect(() => {
    setOverrides({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const serverPickFor = (gameKey) => (myPicks || []).find((pick) => pick.gameKey === gameKey) || null;

  /** The pick a card should show: the local edit if one exists, else the server's own. */
  const draftFor = (gameKey) => {
    if (Object.prototype.hasOwnProperty.call(overrides, gameKey)) return overrides[gameKey];
    const server = serverPickFor(gameKey);
    return server ? { pickedTeam: server.pickedTeam, confidence: server.confidence ?? null } : null;
  };

  const pickWinner = (gameKey, team) => {
    setOverrides((prev) => ({
      ...prev,
      [gameKey]: {
        pickedTeam: team,
        confidence: prev[gameKey]?.confidence ?? serverPickFor(gameKey)?.confidence ?? null,
      },
    }));
  };

  const setConfidence = (gameKey, value) => {
    setOverrides((prev) => ({
      ...prev,
      [gameKey]: {
        pickedTeam: prev[gameKey]?.pickedTeam ?? serverPickFor(gameKey)?.pickedTeam ?? null,
        confidence: value,
      },
    }));
  };

  const dirtyGameKeys = new Set(
    Object.keys(overrides).filter((gameKey) => {
      const draft = overrides[gameKey];
      const server = serverPickFor(gameKey);
      return (
        draft.pickedTeam !== (server?.pickedTeam ?? null) ||
        draft.confidence !== (server?.confidence ?? null)
      );
    })
  );
  const isDirty = dirtyGameKeys.size > 0;

  const flaggedGameKeys = new Set(Array.isArray(saveError?.gameKeys) ? saveError.gameKeys : []);

  const save = async () => {
    const picks = Object.keys(overrides)
      .filter((gameKey) => overrides[gameKey].pickedTeam != null)
      .map((gameKey) => ({
        gameKey,
        pickedTeam: overrides[gameKey].pickedTeam,
        confidence: overrides[gameKey].confidence ?? null,
      }));
    const result = await savePicks(picks);
    if (result?.ok) setOverrides({});
    return result;
  };

  const discard = () => setOverrides({});

  return {
    draftFor,
    pickWinner,
    setConfidence,
    isDirty,
    dirtyGameKeys,
    flaggedGameKeys,
    saving,
    saveError,
    save,
    discard,
  };
}

export default useSavePicks;
