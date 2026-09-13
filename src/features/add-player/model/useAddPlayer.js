import { useState } from 'react';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { useSnackbar } from '../../../components/Snackbar/SnackbarProvider';

/**
 * add-player feature (#1307, ADR 0040): wraps `addToRoster`, the
 * `useCallback` PlayerManagement.jsx carries at :329 (the issue's premise-
 * check ruling item 2 - it was never an importable function), and adds the
 * inline drop pick the Decision card's free-agent context needs when the
 * roster is at capacity (`rosterCount >= rosterCapacity`; today the plain
 * `POST /api/team/roster/:playerId` just fails there, per ADR 0040's Plan).
 * There is no combined add-and-drop endpoint, so a chosen drop runs as its
 * own `DELETE /api/team/roster/:dropPlayerId` FIRST, and only once that
 * succeeds does the add POST run - the same order WaiverWire's claim already
 * effectively achieves server-side in one transaction; here it is two calls
 * because free-agency has no single wire shape for both at once.
 *
 * `roster` is the caller's own roster (the same shape WaiverWire's
 * `sortRosterForDrop` already sorts by), sorted worst weekly projection
 * first here too (the issue's own wording), so the drop-pick list reads a
 * consistent order everywhere this app offers one.
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

export function useAddPlayer({ leagueId, onDone }) {
  const notify = useSnackbar();
  const [pending, setPending] = useState(false);

  const addPlayer = async ({ playerId, playerName, dropPlayerId }) => {
    setPending(true);
    try {
      if (dropPlayerId != null) {
        await apiClient.delete(`/api/team/roster/${dropPlayerId}?leagueId=${leagueId}`);
      }
      await apiClient.post(`/api/team/roster/${playerId}`, { leagueId: Number(leagueId) });
      notify(playerName ? `Added ${playerName} to your roster` : 'Added to your roster');
      await onDone?.();
      return true;
    } catch (err) {
      notify(readHttpFailure(err).message || err.message, { severity: 'error' });
      return false;
    } finally {
      setPending(false);
    }
  };

  return { addPlayer, pending };
}

export default useAddPlayer;
