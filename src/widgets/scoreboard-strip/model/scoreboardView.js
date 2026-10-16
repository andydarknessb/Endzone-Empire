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
 * The win probability, the viewer side and the score and Players remaining
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
  const home = m.home || {};
  const away = m.away || {};

  // Status is the server's fact read through the entity's `matchupBoard` (ADR
  // 0030). A settled (played or final) Matchup states its result instead
  // (#2007): the bar and the Expected final and Players remaining figures give
  // way to `result`. Before kickoff the bar prices the projections; a status
  // the server could not state prices nothing, so it never paints a bar.
  const board = matchupBoard(m, viewerTeamId);
  const result = board.resultLine;
  const probability = result == null ? board.winProbability ?? board.projectedWinProbability : null;
  const showBar = probability != null;
  const homeShare = Math.max(0, Math.min(1, Number(probability?.home) || 0));
  // Rounded once, with the away side as the complement, so the two printed
  // percentages always sum to 100 and agree with the bar's own rounding.
  const homePct = Math.round(homeShare * 100);

  // The figure a side prints big: its score once the matchup has started, else its Proj (the Expected final).
  const started = board.hasStarted === true;
  const side = (s, key, fallbackName, winPct) => ({
    teamId: s.teamId ?? null,
    name: s.name || fallbackName,
    avatarUrl: s.avatarUrl ?? null,
    avatarStaticUrl: s.avatarStaticUrl ?? null,
    isViewer: board.viewerSide === key,
    record: recordFor(records, s.teamId),
    score: board[key].scoreLabel,
    figure: started ? board[key].scoreLabel : formatExpectedFinal(s.expectedFinal),
    expectedFinal: formatExpectedFinal(s.expectedFinal),
    playersRemaining: board[key].playersRemainingLabel,
    winPct,
  });
  const homeSide = side(home, 'home', 'Home', homePct);
  const awaySide = side(away, 'away', 'Away', 100 - homePct);

  const gap = homeSide.figure != null && awaySide.figure != null
    ? Math.round((Number(homeSide.figure) - Number(awaySide.figure)) * 10) / 10
    : null;
  const leader = gap == null || gap === 0 ? null : gap > 0 ? 'home' : 'away';
  const leaderSide = leader === 'home' ? homeSide : awaySide;

  return {
    home: homeSide,
    away: awaySide,
    homeShare,
    showBar,
    result,
    started,
    isLive: board.isLive,
    leader,
    // "{Leader} by {x}", "Tied" on an even figure, null when a side has no figure.
    marginText: gap == null ? null : leader ? `${leaderSide.name} by ${Math.abs(gap).toFixed(1)}` : 'Tied',
    // The entity's chip: null for an unknown status, never a guessed one.
    chip: board.chip,
  };

}
