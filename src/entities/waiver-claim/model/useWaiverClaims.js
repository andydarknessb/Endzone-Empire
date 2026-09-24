import { useMemo } from 'react';
import { useEndpoint } from '../../../shared/lib';
import { claimsFromResponse } from './claimsModel';

/**
 * A manager's waiver claims as a read model (ADR 0029: the thin hook on the
 * entity's index), over `shared/lib`'s `useEndpoint`. A null `leagueId` binds
 * no URL (`useEndpoint`'s idle shape).
 *
 * @param {{ leagueId?: number|string|null }} [params]
 */
export function useWaiverClaims({ leagueId } = {}) {
  const url = leagueId != null ? `/api/waivers?leagueId=${leagueId}` : null;
  const { status, data } = useEndpoint(url);
  const claims = useMemo(() => claimsFromResponse(data), [data]);
  return { status, claims };
}

export default useWaiverClaims;
