import { useMemo } from 'react';
import { useEndpoint } from '../../../shared/lib';
import { claimsFromResponse } from './claimsModel';

/**
 * A manager's waiver claims as a read model (ADR 0029: the thin hook on the
 * entity's index), over `shared/lib`'s `useEndpoint`. A null `leagueId` binds
 * no URL (`useEndpoint`'s idle shape).
 *
 * `refreshKey` re-reads after a caller's action: a new value binds a new URL
 * (`&r=`, ignored by the server), which `useEndpoint` fetches afresh.
 *
 * @param {{ leagueId?: number|string|null, refreshKey?: number }} [params]
 */
export function useWaiverClaims({ leagueId, refreshKey = 0 } = {}) {
  const url =
    leagueId != null ? `/api/waivers?leagueId=${leagueId}${refreshKey ? `&r=${refreshKey}` : ''}` : null;
  const { status, data } = useEndpoint(url);
  const claims = useMemo(() => claimsFromResponse(data), [data]);
  return { status, claims };
}

export default useWaiverClaims;
