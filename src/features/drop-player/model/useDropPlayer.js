import { useState } from 'react';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { useSnackbar } from '../../../components/Snackbar/SnackbarProvider';

/**
 * drop-player feature (#1237, ADR 0019): drop with a confirmation dialog and
 * an Undo toast, restated from LineupScreen.jsx's own
 * `dropPlayer`/`undoDrop`/`confirmDrop`. Every outcome routes through the
 * app-wide Snackbar (`useSnackbar`) - the one live region ADR 0037 permits
 * on this page (AC6) - so Undo, a drop confirmation, and a failure all
 * surface the same way the swap result already does.
 *
 * `refresh` is called after a successful drop or undo so the page's own
 * lineup read (and roster-derived counts elsewhere on the page) reflect the
 * roster change; this feature owns no lineup state of its own.
 */
export function useDropPlayer({ leagueId, refresh }) {
  const notify = useSnackbar();
  const [dropCandidate, setDropCandidate] = useState(null);

  const undoDrop = async (entry) => {
    try {
      await apiClient.post(`/api/team/roster/${entry.playerId}/undo-drop`, { leagueId: Number(leagueId) });
      await refresh?.();
    } catch (err) {
      notify(readHttpFailure(err).message || err.message, { severity: 'error' });
    }
  };

  const dropPlayer = async (entry) => {
    try {
      await apiClient.delete(`/api/team/roster/${entry.playerId}?leagueId=${leagueId}`);
      await refresh?.();
      notify(`Dropped ${entry.name}`, {
        severity: 'info',
        actionLabel: 'Undo',
        onAction: () => undoDrop(entry),
      });
    } catch (err) {
      notify(readHttpFailure(err).message || err.message, { severity: 'error' });
    }
  };

  const confirmDrop = async () => {
    const entry = dropCandidate;
    setDropCandidate(null);
    if (entry) await dropPlayer(entry);
  };

  return {
    dropCandidate,
    requestDrop: setDropCandidate,
    closeDropConfirmation: () => setDropCandidate(null),
    confirmDrop,
  };
}

export default useDropPlayer;
