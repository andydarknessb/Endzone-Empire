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
 * succeeds does the add POST run.
 *
 * Formal review round 1 (f2): a failed add after a successful drop used to
 * leave the manager one player down with only an error toast - the drop had
 * already committed and nothing reversed it. `POST
 * /api/team/roster/:dropPlayerId/undo-drop` exists for exactly this (bypasses
 * the waiver hold a plain re-add would hit, team.router.js), so a failed add
 * now calls it before reporting the original failure; the undo call's own
 * failure is swallowed (best-effort - the original add error is what the
 * manager needs to see, not a second one about the recovery attempt).
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment): `api/apiClient` (the app's HTTP
 * client, not a domain concept), `lib/httpFailure` (the shared refusal-
 * envelope reader, #970's shape (b): a machine code and a manager-facing
 * message), and `components/Snackbar/SnackbarProvider` (`useSnackbar`, the
 * app-wide toast, the same plumbing `drop-player` already reaches for the
 * identical reason).
 */
export function useAddPlayer({ leagueId, onDone }) {
  const notify = useSnackbar();
  const [pending, setPending] = useState(false);

  const addPlayer = async ({ playerId, playerName, dropPlayerId }) => {
    setPending(true);
    try {
      if (dropPlayerId != null) {
        await apiClient.delete(`/api/team/roster/${dropPlayerId}?leagueId=${leagueId}`);
      }
      try {
        await apiClient.post(`/api/team/roster/${playerId}`, { leagueId: Number(leagueId) });
      } catch (addErr) {
        if (dropPlayerId != null) {
          await apiClient
            .post(`/api/team/roster/${dropPlayerId}/undo-drop`, { leagueId: Number(leagueId) })
            .catch(() => {}); // best-effort recovery; the add's own failure is what gets reported
        }
        throw addErr;
      }
      notify(playerName ? `Added ${playerName} to your roster` : 'Added to your roster');
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

  return { addPlayer, pending };
}

export default useAddPlayer;
