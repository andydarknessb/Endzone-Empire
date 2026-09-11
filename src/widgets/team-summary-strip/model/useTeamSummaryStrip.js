import { useEndpoint, matchupWinProbability, finite } from '../../../shared/lib';
import { useLeague } from '../../../hooks/useLeague';
import { matchupFromListRow, matchupStatusView } from '../../../entities/matchup';

/**
 * Data model for the team-summary-strip widget (#1237 AC4): "live score
 * against projected total, the opponent's, starters yet to play and locked,
 * and win probability from the matchup entity; the advice tile is a
 * placeholder until ticket 6" (the advice tile itself is therefore not
 * built by this widget - ADR 0037 defers it).
 *
 * Reads the week's matchups list (`entities/matchup`'s `matchupFromListRow`,
 * the same wire the matchup-preview widget reads) for the viewer's own
 * Matchup - score, projected total (Expected final) and Players remaining
 * for both sides, plus the win probability computed the same way
 * (`matchupWinProbability`, `shared/lib`, #1120) so this strip and the
 * Dashboard's matchup-preview card can never disagree.
 *
 * Deliberately simpler than matchup-preview's own model: no chained detail
 * fallback for a pre-kickoff week whose list row has no Expected final yet
 * (#670/#688 in that widget) - a null projected total here degrades to a
 * placeholder rather than firing a second read, which this strip can afford
 * since it sits beside the full Ledger (a manager sees each starter's own
 * projection there regardless).
 *
 * `lockedStarters` is this widget's own fact, not the matchup entity's: the
 * count of the page's own lineup starters whose game has kicked off
 * (`entities/roster`'s `locked`, read off the `lineup` prop the page already
 * fetched for the Ledger widget - ADR 0020's "value two widgets both need is
 * passed down by the page").
 */
export function useTeamSummaryStrip({ leagueId, lineup }) {
  const { league, viewerTeamId } = useLeague(leagueId);
  const week = league?.current_week ?? null;

  const listUrl = leagueId != null && week != null ? `/api/league/${leagueId}/matchups?week=${week}` : null;
  const list = useEndpoint(listUrl);

  const rows = Array.isArray(list.data) ? list.data.map(matchupFromListRow) : [];
  const myMatchup =
    viewerTeamId != null
      ? rows.find((m) => m && (m.home.teamId === viewerTeamId || m.away.teamId === viewerTeamId)) || null
      : null;
  const opponentId = myMatchup
    ? myMatchup.home.teamId === viewerTeamId
      ? myMatchup.away.teamId
      : myMatchup.home.teamId
    : null;

  let status;
  if (listUrl == null) status = 'empty';
  else if (list.status === 'loading') status = 'loading';
  else if (list.status === 'error') status = 'error';
  else if (!myMatchup) status = 'empty';
  else status = 'ready';

  const sideOf = (teamId) => {
    if (!myMatchup || teamId == null) return null;
    if (myMatchup.home.teamId === teamId) return myMatchup.home;
    if (myMatchup.away.teamId === teamId) return myMatchup.away;
    return null;
  };

  const sideView = (teamId) => {
    const side = sideOf(teamId);
    return {
      score: finite(side?.score),
      projected: finite(side?.expectedFinal),
      playersRemaining: finite(side?.playersRemaining),
    };
  };

  const viewer = status === 'ready' ? sideView(viewerTeamId) : null;
  const opponent = status === 'ready' ? sideView(opponentId) : null;

  const { hasStarted } = matchupStatusView(myMatchup?.status);

  let winProbability = null;
  if (status === 'ready' && hasStarted === true) {
    const shares = matchupWinProbability({
      homeScore: finite(myMatchup.home.score) ?? 0,
      awayScore: finite(myMatchup.away.score) ?? 0,
      homeExpectedFinal: myMatchup.home.expectedFinal,
      awayExpectedFinal: myMatchup.away.expectedFinal,
    });
    const raw = myMatchup.home.teamId === viewerTeamId ? shares.home : shares.away;
    const clamped = Math.max(0, Math.min(1, Number(raw) || 0));
    winProbability = Math.round(clamped * 100);
  }

  const entries = Array.isArray(lineup?.entries) ? lineup.entries : [];
  const starters = entries.filter((e) => e.slot !== 'BENCH' && e.slot !== 'IR' && !e.spent);
  const lockedStarters = starters.filter((e) => e.locked).length;

  return {
    week,
    status,
    viewer,
    opponent,
    winProbability,
    lockedStarters,
    totalStarters: starters.length,
  };
}

export default useTeamSummaryStrip;
