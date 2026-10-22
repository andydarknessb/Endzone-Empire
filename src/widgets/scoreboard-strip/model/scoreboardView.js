import { matchupBoard } from '../../../entities/matchup';
import { finite } from '../../../shared/lib';

/**
 * The scoreboard strip's view model (widget `scoreboard-strip`, ADR 0031,
 * #898): everything the strip paints, derived from the Matchup entity model
 * and the `matchupBoard` reading alone, with no render. The component below reads this
 * object and nothing else, so the display rules (how a score, an Expected
 * final and a Players remaining count are written, which side is the viewer,
 * when the bar shows, which chip variant a status takes) are table-testable
 * here without a DOM.
 *
 * The win probability, the side order (viewer first) and the score and Players remaining
 * text are the board's (#2142); nothing here prices or picks.
 */

/** An Expected final as the strip prints it: one decimal, or null when unknown. */
export function formatExpectedFinal(value) {
  const n = finite(value);
  return n != null ? n.toFixed(1) : null;
}

// The record lookup the page passes down (ADR 0031: Team record does not join
// the wire). Either an object keyed by teamId or a function of teamId; a miss
// (or no lookup at all) is null and the strip prints no record line.
function recordFor(records, teamId) {
  if (records == null || teamId == null) return null;
  const value = typeof records === 'function' ? records(teamId) : records[teamId];
  return value == null || value === '' ? null : String(value);
}

/**
 * @param {object} matchup the Matchup entity model (`entities/matchup`)
 * @param {object} [options]
 * @param {*} [options.viewerTeamId] the viewer's own Team id; the matching side is marked `isViewer`
 * @param {object|function} [options.records] Team record lookup by teamId (`{ [teamId]: '2-0' }` or `(teamId) => '2-0'`)
 */
export function scoreboardView(matchup, { viewerTeamId, records } = {}) {
  const m = matchup || {};

  // Status is the server's fact read through the entity's `matchupBoard` (ADR
  // 0030). A settled (played or final) Matchup states its result instead
  // (#2007): the bar and the Expected final and Players remaining figures give
  // way to `result`. Before kickoff the bar prices the projections; a status
  // the server could not state prices nothing, so it never paints a bar.
  const board = matchupBoard(m, viewerTeamId);
  const result = board.resultLine;
  const probability = result == null ? board.winProbability ?? board.projectedWinProbability : null;
  const showBar = probability != null;
  const firstShare = Math.max(0, Math.min(1, Number(probability?.first) || 0));
  // Rounded once, with the second side as the complement, so the two printed
  // percentages always sum to 100 and agree with the bar's own rounding.
  const firstPct = Math.round(firstShare * 100);

  // The figure a side prints big: its score once the matchup has started, else its Proj (the Expected final).
  const started = board.hasStarted === true;
  const side = (s, winPct) => ({
    teamId: s.teamId,
    name: s.name || (s.origin === 'home' ? 'Home' : 'Away'),
    avatarUrl: s.avatarUrl,
    avatarStaticUrl: s.avatarStaticUrl,
    origin: s.origin,
    isViewer: s.isViewer,
    record: recordFor(records, s.teamId),
    score: s.scoreLabel,
    figure: started ? s.scoreLabel : formatExpectedFinal(s.expectedFinal),
    expectedFinal: formatExpectedFinal(s.expectedFinal),
    playersRemaining: s.playersRemainingLabel,
    winPct,
  });
  const first = side(board.first, firstPct);
  const second = side(board.second, 100 - firstPct);

  const gap = first.figure != null && second.figure != null
    ? Math.round((Number(first.figure) - Number(second.figure)) * 10) / 10
    : null;
  const leader = gap == null || gap === 0 ? null : gap > 0 ? 'first' : 'second';
  const leaderSide = leader === 'first' ? first : second;



  return {
    first,
    second,
    firstShare,
    showBar,
    result,
    started,
    isLive: board.isLive,
    // 'first', 'second' or null.
    leader,
    // "{Leader} by {x}", "Tied" on an even figure, null when a side has no figure.
    marginText: gap == null ? null : leader ? `${leaderSide.name} by ${Math.abs(gap).toFixed(1)}` : 'Tied',
    // The entity's chip: null for an unknown status, never a guessed one.
    chip: board.chip,
  };
}
