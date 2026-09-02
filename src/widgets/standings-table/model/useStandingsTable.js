import { useLeague } from '../../../hooks/useLeague';
import { useStandings } from '../../../hooks/useStandings';
import { teamNameLabel, teamRowKey } from '../../../lib/teamIdentity';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../../lib/leaguePhase';

/**
 * Data model for the standings-table widget (League Dashboard main grid,
 * ticket #641). The widget owns its read; this hook is where it lives so the UI
 * stays a thin presenter.
 *
 * Two sources:
 *   - Row order, rank and the record/points values come from the scoring
 *     standings read (useStandings / ADR 0004). That read is the card's SPINE:
 *     its loading state drives the skeletons and its failure drives the compact
 *     error, so a failed table never touches the rest of the page. It is a
 *     SHARED-cache read keyed by the league's current week: my-team-summary
 *     reads the same key, so the two dedupe onto one request, and a week advance
 *     is a fresh read for both.
 *   - Each row's Team NAME and AVATAR come from the shared league cache
 *     (useLeague), matched by id (`teamId`): the standings row leaks a raw
 *     `name` column beside identity, but the canonical Team identity is
 *     `teamName` on teams[] (teamIdentity.js, #343), so the display name is read
 *     there and never off the standings row. The viewer's own row is the one
 *     whose Team id equals `viewerTeamId`, never an account identifier (#112).
 *
 * Row order IS the standings endpoint's order and the rank column is that
 * position (index + 1): there is no re-sort and no projected-finish tail here
 * (the #617 cut ruling). The header team count is read from the league
 * membership (teams[]), so it renders even while the standings read is still in
 * flight or has failed.
 *
 * PRESEASON is the honest empty state: the League phase is before in season
 * (pre-draft or drafting), or every row has zero games played. Then the record,
 * PF and PA cells render a placeholder mark rather than 0-0-0 and zero points,
 * and the card shows a note that those values populate after Week 1.
 */

export function useStandingsTable(leagueId) {
  const { league, teams, viewerTeamId } = useLeague(leagueId);
  const standings = useStandings(leagueId, league?.current_week);

  // useResource's { data, loading, error } maps to the card's three spine
  // states, the same mapping my-team-summary uses.
  const status = standings.loading ? 'loading' : standings.error ? 'error' : 'ready';

  const teamList = Array.isArray(teams) ? teams : [];
  const teamsById = new Map(teamList.map((t) => [t.teamId, t]));
  const teamCount = teamList.length;

  const rawRows = Array.isArray(standings.data?.standings) ? standings.data.standings : [];
  const rows = rawRows.map((row, index) => {
    const team = teamsById.get(row.teamId) || null;
    const wins = Number(row.wins) || 0;
    const losses = Number(row.losses) || 0;
    const ties = Number(row.ties) || 0;
    return {
      key: teamRowKey(row.teamId, index),
      // The rank column is the position in the standings order, not a re-derived
      // number, so the two cannot disagree.
      rank: index + 1,
      teamId: row.teamId,
      teamName: teamNameLabel(team?.teamName),
      avatarUrl: team?.avatar_url ?? null,
      avatarStaticUrl: team?.avatar_static_url ?? null,
      isViewer: row.teamId != null && row.teamId === viewerTeamId,
      // Record as hyphen-joined W-L-T; points to one decimal. Masked in the UI
      // during preseason.
      record: `${wins}-${losses}-${ties}`,
      pointsFor: (Number(row.pf) || 0).toFixed(1),
      pointsAgainst: (Number(row.pa) || 0).toFixed(1),
      gamesPlayed: wins + losses + ties,
    };
  });

  const phase = deriveLeaguePhase(league);
  const phaseBeforeSeason = phase === LEAGUE_PHASE.PRE_DRAFT || phase === LEAGUE_PHASE.DRAFTING;
  const allZeroGames = rows.length > 0 && rows.every((row) => row.gamesPlayed === 0);
  const preseason = phaseBeforeSeason || allZeroGames;

  return { status, rows, preseason, teamCount };
}

export default useStandingsTable;
