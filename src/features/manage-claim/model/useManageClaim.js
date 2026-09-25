import { useRef, useState } from 'react';
import {
  submitClaim,
  editClaim as editClaimRequest,
  cancelClaim as cancelClaimRequest,
  moveClaim,
} from '../../../entities/waiver-claim';
import { readHttpFailure } from '../../../lib/httpFailure';
import { useSnackbar } from '../../../components/Snackbar/SnackbarProvider';

/**
 * #1645: after Undo the restored row remounts under a new id, so focus goes to
 * its first enabled control (id set by `WaiverClaims`). The row appears after
 * the refresh renders, so retry for a few frames rather than assume it is there.
 */
function focusRestoredClaim(claimId, tries = 20) {
  // Never steal focus the user has since moved elsewhere; the Undo click leaves it on <body> or the closing toast.
  const active = document.activeElement;
  if (active && active !== document.body && !active.closest('[role="alert"]')) return;
  const group = document.getElementById(`waiver-claim-${claimId}-controls`);
  const target = group?.querySelector('button:not(:disabled)');
  if (target) target.focus();
  else if (tries > 0) requestAnimationFrame(() => focusRestoredClaim(claimId, tries - 1));
}

/**
 * manage-claim feature (#1616, ADR 0049): the writes on a pending waiver
 * claim other than the reorder (which stays in the `waiver-claim` entity).
 *
 * - `editClaim(claim, { bid, dropPlayerId })` PATCHes the bid and drop; the
 *   server never changes `claim_order` on an edit.
 * - `cancelClaim(claim, position)` DELETEs the claim and toasts with Undo.
 *   `position` is the claim's 0-based place in the Claim order. Undo re-files
 *   the same player, drop and bid (the server appends it last), then PUTs the
 *   FULL id list with the new claim back at `position`. A failed Undo says so.
 *
 * `pendingIds` is the caller's current pending claim ids in Claim order; it is
 * read at Undo time, after the refresh that `onDone` triggers.
 *
 * The requests are the `waiver-claim` entity's writes.
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment): `lib/httpFailure` and
 * `components/Snackbar/SnackbarProvider`, the same edges `claim-player`
 * names, for the identical reasons.
 */
export function useManageClaim({ leagueId, pendingIds = [], onDone }) {
  const notify = useSnackbar();
  const [pending, setPending] = useState(false);
  const idsRef = useRef(pendingIds);
  idsRef.current = pendingIds;

  const failure = (err) => readHttpFailure(err).message || err.message;

  const editClaim = async (claim, { bid, dropPlayerId }) => {
    setPending(true);
    try {
      await editClaimRequest({ claimId: claim.id, bid, dropPlayerId });
      notify('Waiver claim updated');
      await onDone?.();
      return { ok: true };
    } catch (err) {
      const message = failure(err);
      notify(message, { severity: 'error' });
      return { ok: false, message };
    } finally {
      setPending(false);
    }
  };

  const undoCancel = async (claim, position) => {
    let created;
    try {
      const restored = await submitClaim({
        leagueId,
        playerId: claim.playerId,
        dropPlayerId: claim.dropPlayerId ?? null,
        bid: claim.bid,
      });
      created = restored?.id;
    } catch (err) {
      notify(`Could not undo the cancel: ${failure(err)}`, { severity: 'error' });
      return;
    }
    try {
      if (created != null) {
        const ids = idsRef.current.filter((id) => id !== created);
        ids.splice(Math.min(position, ids.length), 0, created);
        await moveClaim({ leagueId, claimIds: ids });
      }
      notify(`Claim on ${claim.playerName} restored`);
    } catch (err) {
      notify(`Claim on ${claim.playerName} was restored but at the end of your Claim order: ${failure(err)}`, {
        severity: 'error',
      });
    }
    await onDone?.();
    if (created != null) focusRestoredClaim(created);
  };

  const cancelClaim = async (claim, position) => {
    setPending(true);
    try {
      await cancelClaimRequest({ leagueId, claimId: claim.id });
    } catch (err) {
      notify(failure(err), { severity: 'error' });
      return { ok: false };
    } finally {
      setPending(false);
    }
    notify(`Claim on ${claim.playerName} cancelled`, {
      actionLabel: 'Undo',
      onAction: () => undoCancel(claim, position),
    });
    await onDone?.();
    return { ok: true };
  };

  return { editClaim, cancelClaim, pending };
}

export default useManageClaim;
