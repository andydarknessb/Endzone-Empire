import { matchupBoard } from '../../../entities/matchup';
import { formatKickoff } from '../../../shared/lib';
// ordinal itself is shared/lib's contract now (#1272 Addendum); MatchupHero
// imports it directly rather than through this view model.

/**
 * The matchup-hero widget's view model, pure (ticket #893, ADR 0031). Given
 * the one Matchup shape from `entities/matchup` and the viewer's Team id, it
 * answers everything the card paints that is not a straight field read, so
 * the UI stays a presenter:
 *
 *   - which side is the viewer's (`viewerSide`), matched on Team id and never
 *     on home/away (#112: the You pill follows the viewer's Team, the layout
 *     stays home-left / away-right the way SplitBar encodes it);
 *   - the status chip and `hasStarted`, straight from the entity's `matchupBoard`
 *     (ADR 0030: status is a server fact, never inferred here), with the
 *     chip's Badge variant (danger / success / warning / neutral for live /
 *     final / played / scheduled) and whether it carries the live dot;
 *   - the per-side win probability percentages, rounded the same way SplitBar
 *     rounds its segments so the numbers beside the bar equal the bar's own
 *     accessible name (`homePct` rounded, `awayPct` its complement);
 *   - the one plain sentence under the bar, the board's `resultLine` once
 *     settled and its `liveLine` while live ("Ahead now, projected to trail by
 *     13.4 with 6 of theirs still to play"), written from the viewer's side;
 *   - the kickoff line for a Matchup that has not started, formatted from
 *     `firstKickoffAt` (#892) with Intl, weekday short plus time.
 *
 * `winProbability`, `sentence` and `kickoff` are each null when the status
 * does not call for them: a started Matchup has the first two and no kickoff,
 * a scheduled one has the kickoff alone, and an unknown status (null, or a
 * value the entity does not know) has none, so the card asserts neither state
 * (the entity's `hasStarted === null` contract).
 *
 * The win probability, the viewer side and both sentences are the board's
 * (#2142); the kickoff format comes from `shared/lib` (ADR 0031, #1120).
 */

/**
 * The whole view for one hero card. `viewerSide` is 'home' or 'away' when the
 * viewer's Team is one of the two, else null (no pill, and the sentence falls
 * back to the home side's perspective; the page only renders this card for
 * the viewer's own Matchup, so that fallback is a degrade path, not a state
 * the page produces).
 */
export function matchupHeroView(matchup, viewerTeamId) {
  const m = matchup || {};
  const board = matchupBoard(m, viewerTeamId);
  const { chip, hasStarted, viewerSide } = board;

  // The hero keeps its bar once settled (the result sentence sits under it).
  let winProbability = null;
  let sentence = null;
  if (hasStarted === true) {
    // Rounded exactly as SplitBar rounds its segments, so the two visible
    // percentages equal the ones the bar announces.
    const clamped = Math.max(0, Math.min(1, Number(board.winProbability.home) || 0));
    const homePct = Math.round(clamped * 100);
    winProbability = { homeShare: clamped, homePct, awayPct: 100 - homePct };
    sentence = board.resultLine ?? board.liveLine;
  }

  const kickoff = hasStarted === false ? formatKickoff(m.firstKickoffAt) : null;

  return {
    viewerSide,
    scoreLabels: { home: board.home.scoreLabel, away: board.away.scoreLabel },
    hasStarted,
    chipLabel: chip?.label ?? null,
    chipVariant: chip?.variant ?? 'neutral',
    chipDot: chip?.dot ?? false,
    winProbability,
    sentence,
    kickoff,
  };
}

export default matchupHeroView;
