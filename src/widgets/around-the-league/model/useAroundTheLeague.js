import { useMemo } from 'react';
import { useLeague } from '../../../hooks/useLeague';
import { useLeagueMatchups } from '../../../entities/matchup';
import { isPickemOnly } from '../../../lib/leagueType';
import { aroundLeagueTileView } from './tileView';

/**
 * Data model for the around-the-league widget (League Dashboard, #1103): six
 * compact matchup tiles for the league's current week. The widget owns its
 * own reads; this hook is where they live so the UI stays a thin presenter.
 *
 * Two sources:
 *
 *   - The league, for `current_week` (the week this widget shows) and
 *     `viewerTeamId` (#112: which of the week's Matchups is the viewer's
 *     own), through the shared league cache (useLeague / ADR 0004).
 *   - The league's Matchups as entity models (entities/matchup's
 *     `useLeagueMatchups`, ADR 0029), with the live score feed and the Team
 *     identity feed composed inside that hook. It fetches every week, not
 *     just the current one (no week param), so this hook filters down to
 *     `current_week` itself - the same client-side filter Game Center's own
 *     page model applies (useGameCenter.js's `inWeek`).
 *
 * A pick'em-only league has no fantasy Matchups (CONTEXT.md: League type),
 * so the widget never mounts one: `status` reads 'hidden' the moment the
 * league resolves as pick'em-only, before the loading state ever shows a
 * skeleton for a fetch this league will never answer.
 */
export function useAroundTheLeague(leagueId) {
  const {
    league,
    viewerTeamId,
    loading: leagueLoading,
    error: leagueError,
  } = useLeague(leagueId);
  const { matchups, loading: matchupsLoading, error: matchupsError } = useLeagueMatchups(leagueId);

  const pickemOnly = isPickemOnly(league);
  const currentWeek = league?.current_week ?? null;

  const weekMatchups = useMemo(() => {
    if (currentWeek == null) return [];
    return matchups.filter((m) => m && Number(m.week) === Number(currentWeek));
  }, [matchups, currentWeek]);

  const tiles = useMemo(
    () => weekMatchups.map((m) => aroundLeagueTileView(m, { viewerTeamId })),
    [weekMatchups, viewerTeamId]
  );

  let status;
  if (pickemOnly) status = 'hidden';
  else if (leagueLoading && !league) status = 'loading';
  else if (matchupsLoading) status = 'loading';
  else if (leagueError || matchupsError) status = 'error';
  else status = 'ready';

  // "Live" replaces "Projected" the moment any tile's own Matchup has
  // started (the entity's `hasStarted === true`, ADR 0030); an unknown
  // status never flips the headline on its own.
  const anyStarted = tiles.some((tile) => tile.started);

  return {
    status,
    tiles,
    count: tiles.length,
    tailLabel: anyStarted ? 'Live' : 'Projected',
  };
}

export default useAroundTheLeague;
