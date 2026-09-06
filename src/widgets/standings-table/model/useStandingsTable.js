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
 * PF, PA, PCT and STRK cells render a placeholder mark rather than 0-0-0, zero
 * points and a bare dash, and the card shows a note that those values populate
 * after Week 1.
 *
 * STREAK, WIN PCT and PLAYOFF SEED are read off the same response, not derived
 * here: season.service.js computes the trailing streak and the win percentage,
 * and scoring.router.js stamps `playoffSeed` from the league's `playoff_teams`.
 * Rank stays index + 1 (the #617 ruling) even though the row also carries the
 * server's own `rank`, so the column and the row order cannot disagree.
 */

// The server writes a bare '-' for a Team with no finished games (week 1, or a
// Team added mid-season). That is its placeholder, not a streak, so it becomes
// null here and the cell renders the card's own Placeholder mark, which carries
// a screen-reader "Not available" the raw dash would not.
const streakLabel = (value) =>
  typeof value === 'string' && value.trim() !== '' && value.trim() !== '-' ? value.trim() : null;

// Win percentage is a 0-1 fraction on the wire. Standings convention prints it
// to three decimals with no leading zero (".750"), which is also what keeps the
// column narrow enough to earn its place at sm and up.
const winPctLabel = (value) => {
  const pct = Number(value);
  if (!Number.isFinite(pct)) return null;
  const fixed = pct.toFixed(3);
  return fixed.startsWith('0.') ? fixed.slice(1) : fixed;
};

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
      streak: streakLabel(row.streak),
      winPct: winPctLabel(row.winPct),
      // The seed the bracket gives this Team, or null for a Team outside it.
      // Nothing recomputes it: the server owns the cutoff.
      playoffSeed: row.playoffSeed ?? null,
      gamesPlayed: wins + losses + ties,
    };
  });

  const phase = deriveLeaguePhase(league);
  const phaseBeforeSeason = phase === LEAGUE_PHASE.PRE_DRAFT || phase === LEAGUE_PHASE.DRAFTING;
  const allZeroGames = rows.length > 0 && rows.every((row) => row.gamesPlayed === 0);
  const preseason = phaseBeforeSeason || allZeroGames;

  // Where the table draws its playoff cut: the index of the first Team outside
  // the bracket. The LEAGUE's own playoff_teams is what admits the rule at all,
  // and both halves of that read matter:
  //   - with no bracket size (a league that has not set one, or a standings
  //     payload that carries no seeds) every row's seed is null, so "the first
  //     row with no seed" would be row 1 and the rule would land above the
  //     league leader;
  //   - a bracket that takes the whole league states there is no cut, so the
  //     seeds are not consulted at all.
  // Preseason is excluded for the same reason the record cells are masked: the
  // server still seeds by rank, but with every Team 0-0-0 that order is a
  // tiebreak artefact, and a rule across it would claim a standing nobody has.
  const playoffTeams = Number(standings.data?.league?.playoff_teams);
  const bracketSplits = !preseason && playoffTeams > 0 && playoffTeams < rows.length;
  const cutIndex = bracketSplits ? rows.findIndex((row) => row.playoffSeed == null) : -1;

  return { status, rows, preseason, teamCount, cutIndex };
}

export default useStandingsTable;
