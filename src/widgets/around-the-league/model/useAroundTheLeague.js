import { useMemo } from 'react';
import { useLeague } from '../../../hooks/useLeague';
import { useLeagueMatchups } from '../../../entities/matchup';
import { useLeagueStandings } from '../../../entities/standings';
import { isPickemOnly } from '../../../shared/lib';
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
// Rival games shown on game day.
const RIVAL_TILES = 3;

export function useAroundTheLeague(leagueId) {
  const {
    league,
    viewerTeamId,
    loading: leagueLoading,
    error: leagueError,
  } = useLeague(leagueId);
  const {
    matchups, loading: matchupsLoading, error: matchupsError, refetch,
  } = useLeagueMatchups(leagueId);

  const pickemOnly = isPickemOnly(league);
  const currentWeek = league?.current_week ?? null;
  // Standing positions, only to pick the viewer's rivals on game day. The read is the standings
  // table's own shared cache entry, and a failed one just leaves the matchups in their own order.
  const { rows: standingRows } = useLeagueStandings(pickemOnly ? null : leagueId, currentWeek);

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
  // status never flips the headline on its own. That is game day.
  const gameDay = tiles.some((tile) => tile.started);

  // The viewer's own matchup is the page's Matchup panel, so this strip is "the other matchups"
  // (a viewer with no Team of their own sees every one). On game day it folds to the three rival
  // games: the matchups whose teams stand nearest the viewer, ties going to the higher standing.
  const others = useMemo(() => {
    const rest = tiles.filter((tile) => !tile.isViewer);
    if (!gameDay || viewerTeamId == null) return rest;
    const position = new Map(standingRows.map((row) => [row.teamId, row.position]));
    const mine = position.get(viewerTeamId);
    if (mine == null) return rest.slice(0, RIVAL_TILES);
    const near = (tile) => Math.min(
      ...[tile.first.teamId, tile.second.teamId].map((id) => (position.has(id) ? Math.abs(position.get(id) - mine) : Infinity)),
    );
    const high = (tile) => Math.min(...[tile.first.teamId, tile.second.teamId].map((id) => position.get(id) ?? Infinity));
    return [...rest].sort((a, b) => near(a) - near(b) || high(a) - high(b)).slice(0, RIVAL_TILES);
  }, [tiles, gameDay, viewerTeamId, standingRows]);

  return {
    status,
    tiles: others,
    count: others.length,
    gameDay,
    tailLabel: gameDay ? 'Live' : 'Projected',
    refetch,
  };
}

export default useAroundTheLeague;
