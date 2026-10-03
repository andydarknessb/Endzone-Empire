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
 * optimistic patch back to the exact snapshot taken before it, the same
 * rollback contract swap-players and drop-player both already give a
 * manager today.
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
 * refusal rolls back to the moved lineup through the same catch.
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

  // `restoreRaw` is set only by an Undo's own run: the moved lineup it rolls
  // back to when refused (#1964), and the mark that it carries no Undo itself.
  const runMoves = async (moves, restoreRaw) => {
    const snapshot = raw;
    const slotByPlayer = new Map(moves.map((m) => [m.playerId, m.slot]));
    const patch = (prev) =>
      prev
        ? { ...prev, entries: prev.entries.map((e) => (slotByPlayer.has(e.id) ? { ...e, slot: slotByPlayer.get(e.id) } : e)) }
        : prev;
    setRaw(patch);
    try {
      const result = await saveLineup({ leagueId: Number(leagueId), week: raw?.week, moves });
      if (!result.queued) onLanded?.();
      if (result.queued) {
        notify('Lineup change saved offline. It will sync when you reconnect', { severity: 'info' });
        return;
      }
      if (restoreRaw) {
        notify('Lineup restored', { severity: 'success' });
        return;
      }
      // #1964: each moved player back to the slot the pre-move snapshot held.
      const inverse = moves
        .map((m) => ({ playerId: m.playerId, slot: snapshot?.entries?.find((e) => e.id === m.playerId)?.slot }))
        .filter((m) => m.slot != null);
      notify('Lineup saved', {
        severity: 'success',
        ...(inverse.length > 0 && { actionLabel: 'Undo', onAction: () => runMoves(inverse, patch(snapshot)) }),
      });
    } catch (err) {
      setRaw(restoreRaw ?? snapshot);
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
