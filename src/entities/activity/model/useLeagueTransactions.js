import { useEndpoint } from '../../../shared/lib';
import { activitiesFromResponse } from './activityModel';

/**
 * A league's Activity feed as read models (ADR 0029: the thin hook on the
 * entity's index), over `shared/lib`'s `useEndpoint` the same way every other
 * League Dashboard plain read is (#669): one GET of
 * `GET /api/league/:id/transactions`, mapped through `activityFromRow` and
 * sliced to `limit` client-side.
 *
 * A null `leagueId` binds no URL (`useEndpoint`'s idle shape): `status` stays
 * 'loading' and `rows` is empty, so a page mounted before its league resolves
 * never renders another league's feed mid-navigation.
 *
 * `status` ignores `useEndpoint`'s `httpStatus` deliberately: every failure
 * degrades this feed the same way (empty, not a page-breaking error), so the
 * field is not carried here.
 *
 * @param {number|string|null} leagueId
 * @param {{ limit?: number }} [options]
 * @returns {{ status: 'loading'|'ready'|'error', rows: object[] }}
 */
export function useLeagueTransactions(leagueId, { limit } = {}) {
  const { status, data } = useEndpoint(leagueId != null ? `/api/league/${leagueId}/transactions` : null);
  return { status, rows: activitiesFromResponse(data, { limit }) };
}

export default useLeagueTransactions;
