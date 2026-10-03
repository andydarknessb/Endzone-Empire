import { useSnackbar } from '../../../components/Snackbar/SnackbarProvider';
import useResilientLineupMutation from '../../../hooks/useResilientLineupMutation';
import { readHttpFailure } from '../../../lib/httpFailure';

/**
 * apply-advice feature (#1238, ADR 0037 AC2): applies the Start/sit advice's
 * own move plan through the existing lineup write endpoint, in one write,
 * restated from swap-players' own `performMove` (the same optimistic-patch
 * / save / rollback shape, ADR 0020's page-composes-widgets/features
 * split - a feature acts, it does not read, so this hook takes the page's
 * own mutable lineup state (`raw`/`setRaw`) exactly as `useSwapPlayers`
 * does, rather than fetching the advice itself).
 *
 * `apply(movePlan)` takes a `movePlan` in the advice response's shape
 * (`[{ playerId, fromSlot, toSlot }]`,
 * `server/services/decision.service.js`) and converts it to the write
 * endpoint's `moves` shape (`[{ playerId, slot }]`) with no re-derivation
 * of its own. The caller may pass the response's plan reduced by the
 * suggestions the manager dismissed;
 * the hook neither knows nor cares, and it never re-assigns a slot the
 * advice did not name (AC2), because the only slots it ever writes are the
 * ones the plan it is given already names. A refused write rolls the
 * optimistic patch back by resetting only the moved ids' slots (and only
 * those still holding the slot this write set), the same contract
 * swap-players gives a manager today.
 *
 * `onLanded` (#1881, optional): called with no arguments once a write has
 * landed on the server, either right after `saveLineup` resolves unqueued or
 * when a queued write replays. Never on a refused or still-queued save. The
 * page supplies it to refresh whatever read the write made stale.
 *
 * Undo (#1964): the "Lineup saved" toast of a save that landed right away
 * carries an Undo action (Snackbar `actionLabel`/`onAction`), never a queued
 * save or an error. It re-runs the write with each moved `playerId` back at
 * the slot the pre-move `raw` held (matched by `id`). The undo is a plain
 * write: its success says "Lineup restored" with no Undo of its own, and a
 * refusal rolls back the moved slots through the same catch.
 * An Undo after leaving and returning to the page restores on the server, but
 * this page shows it only after the next refetch. Undo restores slots only: a
 * called shot the forward save voided, or a cleared IR attestation, is not
 * restored (#1969). Rollbacks (a refused save or Undo) are functional and same-lineup
 * guarded: they reset only the moved ids' slots on the current `raw`.
 */
export function useApplyAdvice({ leagueId, raw, setRaw, onLanded }) {
  const notify = useSnackbar();
  // #1881: a save that lands (now, or when a queued one replays) changes Expected final.
  const { saveLineup } = useResilientLineupMutation({
    onReplaySuccess: () => {
      onLanded?.();
      notify('Lineup saved');
    },
  });

  // `undoOf` is set only by an Undo's own run: the moves it reverses (#1964),
  // which also mark it as carrying no Undo itself. Every patch, rollback
  // included, sets only the moved ids' slots on whatever `prev` is by then,
  // and only while `prev` is still the lineup the move was made on, so a live
  // score tick, a silent refetch or a navigation mid-request is never undone.
  // A rollback also leaves any id that no longer holds the slot this run set.
  // `shotVoided` (Undo runs only): the save being undone voided a called shot.
  const runMoves = async (moves, undoOf, shotVoided) => {
    const snapshot = raw;
    // `owned` (rollbacks only): the moves this run wrote. An id is reset only
    // while it still holds the slot this run set, so a newer write survives.
    // ponytail: two in-flight writes sharing a player, one refused, can still
    // leave client and server apart until the next refetch.
    const setSlots = (slots, owned) => {
      const slotByPlayer = new Map(slots.map((m) => [m.playerId, m.slot]));
      const ownedSlot = owned && new Map(owned.map((m) => [m.playerId, m.slot]));
      const resets = (e) => slotByPlayer.has(e.id) && (!ownedSlot || ownedSlot.get(e.id) === e.slot);
      return (prev) =>
        prev && prev.week === snapshot?.week && prev.teamId === snapshot?.teamId
          ? { ...prev, entries: prev.entries.map((e) => (resets(e) ? { ...e, slot: slotByPlayer.get(e.id) } : e)) }
          : prev;
    };
    // #1964: each moved player back at the slot the pre-move snapshot held.
    const inverse = moves
      .map((m) => ({ playerId: m.playerId, slot: snapshot?.entries?.find((e) => e.id === m.playerId)?.slot }))
      .filter((m) => m.slot != null);
    setRaw(setSlots(moves));
    try {
      const result = await saveLineup({ leagueId: Number(leagueId), week: raw?.week, moves });
      if (!result.queued) onLanded?.();
      if (result.queued) {
        notify('Lineup change saved offline. It will sync when you reconnect', { severity: 'info' });
        return;
      }
      if (undoOf) {
        notify(`Lineup restored${shotVoided ? '. Your called shot is still void' : ''}`, { severity: 'success' });
        return;
      }
      // #1969: the save's answer names what an Undo cannot reverse. An ended
      // commissioner IR override cannot come back from a manager's move, so
      // that save offers no Undo; a voided called shot stays void after one.
      const { attestationCleared = [], calledShotVoided = false } = result.response?.data ?? {};
      if (attestationCleared.length > 0) {
        notify('Lineup saved. This move ended a commissioner IR override and cannot be undone', { severity: 'success' });
        return;
      }
      notify(`Lineup saved${calledShotVoided ? '. Your called shot was voided' : ''}`, {
        severity: 'success',
        ...(inverse.length > 0 && { actionLabel: 'Undo', onAction: () => runMoves(inverse, moves, calledShotVoided) }),
      });
    } catch (err) {
      setRaw(setSlots(undoOf ?? inverse, moves));
      notify(readHttpFailure(err).message || err.message, { severity: 'error' });
    }
  };

  const apply = async (movePlan) => {
    const moves = (movePlan || [])
      .filter((m) => m && m.playerId != null && m.toSlot != null)
      .map((m) => ({ playerId: m.playerId, slot: m.toSlot }));
    if (moves.length === 0) return;
    await runMoves(moves);
  };

  return { apply };
}

export default useApplyAdvice;
