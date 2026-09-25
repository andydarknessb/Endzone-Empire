import apiClient from '../../../api/apiClient';

/**
 * Waiver-claim writes (ADR 0029, #1671): one plain request each, with no
 * snackbar, refresh or focus. Callers (the claim and manage features, the
 * order hook) own their copy, Undo toast and focus, and reject-handling: a
 * refused request rejects with the HTTP client's error.
 *
 * BELOW-ISLAND EDGE (ADR 0029, #874): `api/apiClient`.
 */

const dropOf = (dropPlayerId) => (dropPlayerId == null || dropPlayerId === '' ? null : Number(dropPlayerId));
const bidOf = (bid) => (bid ? Number(bid) : 0);

/** POST a new claim; resolves the created claim (with its `id`). */
export async function submitClaim({ leagueId, playerId, dropPlayerId, bid }) {
  const response = await apiClient.post('/api/waivers/claim', {
    leagueId: Number(leagueId),
    playerId,
    dropPlayerId: dropOf(dropPlayerId),
    bid: bidOf(bid),
  });
  return response?.data ?? null;
}

/** PATCH a pending claim's bid and drop; the server leaves `claim_order` alone. */
export async function editClaim({ claimId, bid, dropPlayerId }) {
  await apiClient.patch(`/api/waivers/claim/${claimId}`, {
    bid: bidOf(bid),
    dropPlayerId: dropOf(dropPlayerId),
  });
}

/** DELETE a pending claim. */
export async function cancelClaim({ leagueId, claimId }) {
  await apiClient.delete(`/api/waivers/claim/${claimId}?leagueId=${Number(leagueId)}`);
}

/** PUT the FULL claim id list in its new Claim order. */
export async function moveClaim({ leagueId, claimIds }) {
  await apiClient.put('/api/waivers/claims/order', { leagueId: Number(leagueId), claimIds });
}
