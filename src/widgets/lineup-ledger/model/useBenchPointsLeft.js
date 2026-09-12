import { useEndpoint, formatPoints } from '../../../shared/lib';

/**
 * AC5: "the bench points left on the table line reads the existing
 * hindsight endpoint" - `GET /api/team/hindsight`, restated from
 * LineupScreen.jsx's own `fetchSeasonBenchTotal`. A plain read (this widget
 * is the read's only mount), gated on all three of `leagueId`/`teamId`/
 * `season` being known - the null-url-never-fetches contract `shared/lib`'s
 * `useEndpoint` already gives every other reader in this island.
 */
export function useBenchPointsLeft({ leagueId, teamId, season }) {
  const url =
    leagueId != null && teamId != null && season != null
      ? `/api/team/hindsight?leagueId=${leagueId}&teamId=${teamId}&season=${season}`
      : null;
  const { status, data } = useEndpoint(url);
  const total =
    status === 'ready' && typeof data?.totalPointsLeftOnBench === 'number'
      ? data.totalPointsLeftOnBench
      : null;
  return { text: total != null ? `Bench points this season: ${formatPoints(total)}` : null };
}

export default useBenchPointsLeft;
