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
 * `apply(movePlan)` takes the advice response's own `movePlan`
 * (`[{ playerId, fromSlot, toSlot }]`, `server/services/decision.service.js`)
 * verbatim and converts it to the write endpoint's `moves` shape
 * (`[{ playerId, slot }]`) with no re-derivation of its own: it never
 * re-assigns a slot the advice did not name (AC2), because the only slots it
 * ever writes are the ones `movePlan` already names. A refused write rolls
 * the optimistic patch back to the exact snapshot taken before it, the same
 * rollback contract swap-players and drop-player both already give a
 * manager today.
 */
export function useApplyAdvice({ leagueId, raw, setRaw }) {
  const notify = useSnackbar();
  const { saveLineup } = useResilientLineupMutation({ onReplaySuccess: () => notify('Lineup saved') });

  const apply = async (movePlan) => {
    const moves = (movePlan || [])
      .filter((m) => m && m.playerId != null && m.toSlot != null)
      .map((m) => ({ playerId: m.playerId, slot: m.toSlot }));
    if (moves.length === 0) return;

    const snapshot = raw;
    const slotByPlayer = new Map(moves.map((m) => [m.playerId, m.slot]));
    setRaw((prev) =>
      prev
        ? { ...prev, entries: prev.entries.map((e) => (slotByPlayer.has(e.id) ? { ...e, slot: slotByPlayer.get(e.id) } : e)) }
        : prev
    );
    try {
      const result = await saveLineup({ leagueId: Number(leagueId), week: raw?.week, moves });
      notify(
        result.queued ? 'Lineup change saved offline. It will sync when you reconnect' : 'Lineup saved',
        { severity: result.queued ? 'info' : 'success' }
      );
    } catch (err) {
      setRaw(snapshot);
      notify(readHttpFailure(err).message || err.message, { severity: 'error' });
    }
  };

  return { apply };
}

export default useApplyAdvice;
