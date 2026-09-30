import { useCallback, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { useSnackbar } from '../../../components/Snackbar/SnackbarProvider';
import { readHttpFailure } from '../../../lib/httpFailure';

/**
 * The Lineup page's called-shot actions (#1856): call a shot on a start/sit
 * suggestion (keep its current starter over the player the Forecast would
 * start) and withdraw it again. Both hit the team router's
 * `/api/team/lineup/called-shot`, then `onChanged` re-reads the advice, because
 * the server pins or releases the pair and the suggestions change with it.
 * Kept at the page level beside `useAdvice`, which owns the read, and handed to
 * the start-sit-panel widget as plain callbacks (a widget never imports a
 * feature, ADR 0020).
 *
 * `callShot` and `withdrawShot` resolve true when the server accepted and false
 * when it refused, so the card can announce and move focus only on success.
 *
 * A refusal (a locked player, a tossup, a pair the advice no longer names)
 * reads its server reason into a snackbar; nothing changes on screen.
 */
export function useCalledShot({ leagueId, week, onChanged }) {
  const notify = useSnackbar();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (request, success) => {
    setBusy(true);
    try {
      await request();
      notify(success);
      onChanged?.();
      return true;
    } catch (err) {
      notify(readHttpFailure(err).message || err.message, { severity: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }, [notify, onChanged]);

  const callShot = useCallback((view) => run(
    () => apiClient.post('/api/team/lineup/called-shot', {
      leagueId: Number(leagueId),
      week,
      starterId: view.sit.playerId,
      benchedId: view.start.playerId,
    }),
    `Shot called: ${view.sit.name} over ${view.start.name}`
  ), [run, leagueId, week]);

  const withdrawShot = useCallback(() => run(
    () => apiClient.delete(`/api/team/lineup/called-shot?leagueId=${Number(leagueId)}&week=${week}`),
    'Shot withdrawn'
  ), [run, leagueId, week]);

  return { callShot, withdrawShot, busy };
}

export default useCalledShot;
