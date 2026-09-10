import { useMemo } from 'react';
import { useEndpoint } from '../../../shared/lib';
import { lineupModel } from './lineupModel';

/**
 * A team's weekly Lineup as a read model (ADR 0029: the thin hook on the
 * entity's index, following the Matchup and Standings slices' shape). It is a
 * plain `useEndpoint` read of `GET /api/team/lineup?leagueId=<id>&week=<week>`
 * (shared/lib, #669), mapped through `lineupModel` - no live feed, no socket:
 * a lineup changes on a manager's own save, never on someone else's action.
 *
 * A null `leagueId` or `week` binds no URL, so no request fires: the caller
 * is expected to withhold both until the league and week are known, exactly
 * as the Matchup entity's chained reads withhold their own URL (the shared
 * hook's null-url contract, src/shared/lib/useEndpoint.js).
 *
 * @param {number|string|null} leagueId
 * @param {number|string|null} week
 * @returns {{ lineup: object|null, loading: boolean, error: boolean, httpStatus: number|null }}
 */
export function useTeamLineup(leagueId, week) {
  const url =
    leagueId != null && week != null
      ? `/api/team/lineup?leagueId=${leagueId}&week=${week}`
      : null;
  const { status, data, httpStatus } = useEndpoint(url);

  const lineup = useMemo(
    () => (status === 'ready' && data ? lineupModel(data) : null),
    [status, data]
  );

  return { lineup, loading: status === 'loading', error: status === 'error', httpStatus };
}

export default useTeamLineup;
