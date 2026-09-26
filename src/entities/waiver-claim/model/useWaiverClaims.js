import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEndpoint } from '../../../shared/lib';
import { moveClaim as putClaimOrder } from './claimWrites';
import { readHttpFailure } from '../../../lib/httpFailure';
import { claimsFromResponse } from './claimsModel';

/**
 * A manager's waiver claims as a read model (ADR 0029: the thin hook on the
 * entity's index), over `shared/lib`'s `useEndpoint`. A null `leagueId` binds
 * no URL (`useEndpoint`'s idle shape).
 *
 * `refreshKey` re-reads after a caller's action: a new value binds a new URL
 * (`&r=`, ignored by the server), which `useEndpoint` fetches afresh.
 *
 * `moveClaim(claimId, delta)` is the #1579 Claim-order reorder: it swaps the
 * claim with its neighbour optimistically (every consumer of `claims.pending`
 * sees the new order at once), PUTs the FULL id list, and reverts on refusal
 * with the refusal in `orderError`; `orderSettled` ticks when each PUT ends. `orderAnnouncement` is the live-region
 * text for a successful move. A fresh read supersedes the optimistic order.
 *
 * BELOW-ISLAND EDGES (ADR 0029, #874): `lib/httpFailure`, for the
 * reorder's refusal text (the write itself is `claimWrites`).
 *
 * @param {{ leagueId?: number|string|null, refreshKey?: number }} [params]
 */
export function useWaiverClaims({ leagueId, refreshKey = 0 } = {}) {
  const url =
    leagueId != null ? `/api/waivers?leagueId=${leagueId}${refreshKey ? `&r=${refreshKey}` : ''}` : null;
  const { status, data } = useEndpoint(url);
  // A refresh (`refreshKey`) parks `useEndpoint` on null data until the read
  // lands; the last body stays on screen meanwhile, so rows keep their nodes
  // (and their focus) instead of flashing "No claims yet" (#1616).
  // Only within one league: a different league never shows the last one's rows.
  const lastDataRef = useRef({ leagueId, data: null });
  if (data) lastDataRef.current = { leagueId, data };
  const shown = data ?? (lastDataRef.current.leagueId === leagueId ? lastDataRef.current.data : null);
  const base = useMemo(() => claimsFromResponse(shown), [shown]);

  // The optimistic id order, dropped when a newer read lands.
  const [order, setOrder] = useState(null);
  const [orderError, setOrderError] = useState(null);
  const [orderAnnouncement, setOrderAnnouncement] = useState('');
  // Counts settled moves (success or refusal): the one signal a consumer can
  // trust that a PUT is over, unlike `orderError`, which also resets to null
  // when the next move starts.
  const [orderSettled, setOrderSettled] = useState(0);
  useEffect(() => {
    setOrder(null);
  }, [data]);

  const claims = useMemo(() => {
    if (!order) return base;
    const byId = new Map(base.pending.map((c) => [c.id, c]));
    if (order.length !== byId.size || !order.every((id) => byId.has(id))) return base;
    return { ...base, pending: order.map((id, index) => ({ ...byId.get(id), claimOrder: index + 1 })) };
  }, [base, order]);

  const pendingRef = useRef(claims.pending);
  pendingRef.current = claims.pending;
  const orderRef = useRef(order);
  orderRef.current = order;

  const moveClaim = useCallback(
    async (claimId, delta) => {
      const pending = pendingRef.current;
      const from = pending.findIndex((c) => c.id === claimId);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= pending.length) return;
      const ids = pending.map((c) => c.id);
      [ids[from], ids[to]] = [ids[to], ids[from]];
      const previous = orderRef.current;
      setOrderError(null);
      setOrder(ids);
      try {
        await putClaimOrder({ leagueId, claimIds: ids });
        setOrderAnnouncement(`${pending[from].playerName} moved to Claim order #${to + 1}`);
      } catch (err) {
        setOrderAnnouncement('');
        setOrder(previous);
        setOrderError(readHttpFailure(err).message || err.message);
      } finally {
        setOrderSettled((n) => n + 1);
      }
    },
    [leagueId],
  );

  const loaded = shown != null;

  return { status, claims, loaded, moveClaim, orderError, orderAnnouncement, orderSettled };
}

export default useWaiverClaims;
