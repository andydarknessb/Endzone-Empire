import { useState } from 'react';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { useSnackbar } from '../../../components/Snackbar/SnackbarProvider';

/**
 * claim-player feature (#1307, ADR 0040): the waiver-claim submission
 * the old Waiver Wire claim dialog performed (`POST /api/waivers/claim`, the
 * issue's premise-check ruling item 3), extracted here so the Decision card
 * can offer the same claim from any surface that opens it for a `waivers`
 * player: the Players page and the Waivers page (#1613, whose claim sheet
 * arrives in its own ticket). The submission is the one implementation, not
 * two that can drift.
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment): `api/apiClient`, `lib/httpFailure`
 * and `components/Snackbar/SnackbarProvider` - the same three edges
 * `add-player` names, for the identical reasons.
 */
export function useClaimPlayer({ leagueId, onDone }) {
  const notify = useSnackbar();
  const [pending, setPending] = useState(false);

  const submitClaim = async ({ playerId, dropPlayerId, bid }) => {
    setPending(true);
    try {
      await apiClient.post('/api/waivers/claim', {
        leagueId: Number(leagueId),
        playerId,
        dropPlayerId: dropPlayerId == null || dropPlayerId === '' ? null : Number(dropPlayerId),
        bid: bid ? Number(bid) : 0,
      });
      notify('Waiver claim submitted');
      await onDone?.();
      return { ok: true };
    } catch (err) {
      const message = readHttpFailure(err).message || err.message;
      notify(message, { severity: 'error' });
      return { ok: false, message };
    } finally {
      setPending(false);
    }
  };

  return { submitClaim, pending };
}

export default useClaimPlayer;
