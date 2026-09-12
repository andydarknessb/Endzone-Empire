import { useEndpoint, matchupWinProbability, finite } from '../../../shared/lib';
import { matchupFromListRow, applyScoreEvent } from '../../../entities/matchup';

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
 *
 * `week` and `viewerTeamId` are supplied by the page (its own `useLeague`
 * read) rather than fetched again here (formal review finding
 * ac1-widgets-reach-below-the-island): a League is a domain concept, and
 * ADR 0029's below-island exception is for plumbing with no domain meaning,
 * not for a second reach at the same league row the page already holds.
 *
 * `scoreEvent` (#1241 AC2, ADR 0037 ticket 9) is the page's own
 * `useLiveScores` read of the scores socket - the same "value two widgets
 * both need is passed down by the page" rule this widget already follows
 * for `lineup`. It is the whole `scores:updated` payload, applied here
 * through `entities/matchup`'s own `applyScoreEvent` (never re-derived) onto
 * the Matchup this widget already reads from the list, so the live score,
 * Expected final and win probability all move together, the same figures
 * the Ledger's points cell moves with. The list read never polls on its
 * own, so reapplying the latest event on top of a freshly-derived Matchup
 * every render is always safe: `applyScoreEvent` sets each side's absolute
 * score rather than accumulating a delta, so it is idempotent regardless of
 * how many renders replay it.
 */
export function useTeamSummaryStrip({ leagueId, week, viewerTeamId, lineup, scoreEvent }) {
  const listUrl = leagueId != null && week != null ? `/api/league/${leagueId}/matchups?week=${week}` : null;
  const list = useEndpoint(listUrl);

  const rows = Array.isArray(list.data) ? list.data.map(matchupFromListRow) : [];
  const myMatchupFromList =
    viewerTeamId != null
      ? rows.find((m) => m && (m.home.teamId === viewerTeamId || m.away.teamId === viewerTeamId)) || null
      : null;
  const scoredEntry = scoreEvent && myMatchupFromList
    ? (scoreEvent.scored || []).find((s) => s.matchupId === myMatchupFromList.id)
    : null;
  const myMatchup = scoredEntry ? applyScoreEvent(myMatchupFromList, scoredEntry) : myMatchupFromList;
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

  // AC4 asks for win probability unconditionally once the matchup is ready
  // (formal review finding ac4-win-probability-gated-on-kickoff), not only
  // once the game has started: pre-kickoff both scores are 0 and the figure
  // reads purely off the two projected totals, which is exactly what a
  // manager wants to see before kickoff too.
  let winProbability = null;
  if (status === 'ready') {
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
