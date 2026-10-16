import { useMemo } from 'react';
import { useLeague } from './useLeague';

const EMPTY = new Set();

/**
 * The Team ids of a league's CPU-managed teams (ADR 0068), read from the shared
 * league resource's `teams[].is_cpu`, so a widget that only holds Team ids can
 * label them without a request of its own.
 */
export function useCpuTeamIds(leagueId) {
  const { teams } = useLeague(leagueId);
  return useMemo(() => {
    const ids = (Array.isArray(teams) ? teams : []).filter((t) => t && t.is_cpu).map((t) => t.teamId);
    return ids.length > 0 ? new Set(ids) : EMPTY;
  }, [teams]);
}
