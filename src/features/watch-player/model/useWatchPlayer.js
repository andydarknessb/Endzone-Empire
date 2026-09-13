import { useState } from 'react';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { useSnackbar } from '../../../components/Snackbar/SnackbarProvider';

/**
 * watch-player feature (#1312, ADR 0040 follow-up, grill ruling Q6): the
 * `PUT`/`DELETE /api/players/:id/watch?leagueId=` submission the Decision
 * card and any player row share, extracted the same way `claim-player` and
 * `add-player` extract theirs - one implementation, not a copy per caller.
 *
 * `toggleWatch({ playerId, watching })` reads the CURRENT `watching` state
 * (the caller already has it - the card's own payload, or the list row) and
 * issues the write that flips it: `DELETE` when currently watching, `PUT`
 * otherwise. Idempotent either way (the server never errors on a repeat),
 * so a caller racing a stale `watching` value settles on the server's own
 * answer rather than diverging from it.
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment), all reached here: `api/apiClient`,
 * `lib/httpFailure` and `components/Snackbar/SnackbarProvider` - the same
 * three edges `add-player`/`claim-player` name, for the identical reasons.
 */
export function useWatchPlayer({ leagueId, onDone } = {}) {
  const notify = useSnackbar();
  const [pending, setPending] = useState(false);

  const toggleWatch = async ({ playerId, watching }) => {
    setPending(true);
    try {
      if (watching) {
        await apiClient.delete(`/api/players/${playerId}/watch`, { params: { leagueId: Number(leagueId) } });
        notify('Removed from watchlist');
      } else {
        await apiClient.put(`/api/players/${playerId}/watch`, null, { params: { leagueId: Number(leagueId) } });
        notify('Watching player');
      }
      await onDone?.();
      return { ok: true, watching: !watching };
    } catch (err) {
      const message = readHttpFailure(err).message || err.message;
      notify(message, { severity: 'error' });
      return { ok: false, message };
    } finally {
      setPending(false);
    }
  };

  return { toggleWatch, pending };
}

export default useWatchPlayer;
