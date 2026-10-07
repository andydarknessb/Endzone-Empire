import useResilientLineupMutation from '../../../hooks/useResilientLineupMutation';
import { useSnackbar } from '../../../components/Snackbar/SnackbarProvider';
import { readHttpFailure } from '../../../lib/httpFailure';
import { clearWeekMatchupsCache } from '../../../entities/matchup';
import { describeOutcome } from './describeOutcome';

const CORRECT_WEEK = /\/correct-week$/;

/**
 * The one Lineup write (spec #2042, #1881, #1964, #1969). The Lineup page calls
 * this once and hands `submit` to `useSwapPlayers` and `useApplyAdvice`, which
 * only build move plans. It owns the optimistic patch, the owned-slot rollback,
 * Undo, the toast copy (`describeOutcome`), Matchups cache invalidation, and
 * the one offline-replay subscriber, so a replayed save toasts once.
 *
 * `submit(moves)` takes the write endpoint's `[{ playerId, slot }]`. Every patch,
 * rollback included, sets only the moved ids' slots on whatever `prev` is by
 * then, and only while `prev` is still the lineup the move was made on, so a
 * live score tick, a silent refetch or a navigation mid-request is never undone.
 * A rollback also leaves any id that no longer holds the slot this run set. An
 * Undo re-runs the move with each moved player back at the slot the pre-move
 * `raw` held; it is itself a plain write with no Undo of its own, and a refusal
 * rolls back the moved slots and shows the server's message. An Undo restores
 * slots only: a Called shot the forward save voided, or a cleared IR override,
 * is not restored.
 *
 * A save that lands clears the week's Matchups cache (it changes Expected final,
 * which the cache carries for 30 s); so does a replayed one. A replayed
 * `/correct-week` intent shares the queue and says "Week corrected". A replayed
 * lineup save says what its answer disclosed, with no Undo.
 */
export function useLineupWrite({ leagueId, raw, setRaw }) {
  const notify = useSnackbar();
  const { saveLineup } = useResilientLineupMutation({
    onReplaySuccess: (detail) => {
      clearWeekMatchupsCache(leagueId);
      if (CORRECT_WEEK.test(detail?.intent?.endpoint ?? '')) {
        notify('Week corrected', { severity: 'success' });
        return;
      }
      const { message, severity } = describeOutcome(detail?.data);
      notify(message, { severity });
    },
  });

  // `undoOf` is set only by an Undo's own run: the moves it reverses.
  // `shotVoided` (Undo runs only): the save being undone voided a called shot.
  const submit = async (moves, undoOf, shotVoided) => {
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
    const inverse = moves
      .map((m) => ({ playerId: m.playerId, slot: snapshot?.entries?.find((e) => e.id === m.playerId)?.slot }))
      .filter((m) => m.slot != null);
    setRaw(setSlots(moves));
    try {
      const result = await saveLineup({ leagueId: Number(leagueId), week: raw?.week, moves });
      if (!result.queued) clearWeekMatchupsCache(leagueId);
      const body = result.response?.data;
      const { message, severity, undo } = describeOutcome(body, {
        isUndo: Boolean(undoOf),
        shotVoided,
        queued: result.queued,
      });
      const voided = (body?.irreversible ?? []).includes('called_shot');
      notify(message, {
        severity,
        ...(undo && inverse.length > 0 && { actionLabel: 'Undo', onAction: () => submit(inverse, moves, voided) }),
      });
    } catch (err) {
      setRaw(setSlots(undoOf ?? inverse, moves));
      notify(readHttpFailure(err).message || err.message, { severity: 'error' });
    }
  };

  return { submit };
}

export default useLineupWrite;
