import { useState } from 'react';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { useSnackbar } from '../../../components/Snackbar/SnackbarProvider';

/**
 * claim-player feature (#1307, ADR 0040): wraps the waiver-claim submission
 * WaiverWire.jsx's own dialog already performs (`handleSubmitClaim`,
 * `POST /api/waivers/claim`, the issue's premise-check ruling item 3), so
 * the Decision card can offer the same claim from any surface that opens it
 * for a `waivers` player - starting with PlayerManagement, which has no
 * claim UI of its own today. WaiverWire's own dialog is left in place
 * (out of this ticket's scope: it already implements this identical flow
 * and is covered by its own passing suite); this hook is the one other
 * surfaces reach for.
 */
/**
 * Worst weekly projection first, unprojected last - restated from
 * WaiverWire.jsx's own `sortRosterForDrop` and `add-player`'s copy of the
 * same rule, duplicated here on purpose (FSD: a feature never imports a
 * sibling feature) rather than shared, the same call the server's
 * `availabilityFor` makes about its own duplicated availability logic.
 */
export function sortRosterForDrop(roster) {
  const projectionOf = (p) => (p.projected_weekly_points != null ? Number(p.projected_weekly_points) : null);
  return [...(roster || [])].sort((a, b) => {
    const av = projectionOf(a);
    const bv = projectionOf(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv;
  });
}

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
      return true;
    } catch (err) {
      const message = readHttpFailure(err).message || err.message;
      notify(message, { severity: 'error' });
      return false;
    } finally {
      setPending(false);
    }
  };

  return { submitClaim, pending };
}

export default useClaimPlayer;
