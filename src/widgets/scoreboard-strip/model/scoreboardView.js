import { matchupFace } from '../../../entities/matchup';

/**
 * The scoreboard strip's view model (widget `scoreboard-strip`, ADR 0031,
 * #898): everything the strip paints, derived from the Matchup entity model
 * and the `matchupBoard` reading alone, with no render. The component below reads this
 * object and nothing else, so the display rules (how a score, an Expected
 * final and a Players remaining count are written, which side is the viewer,
 * when the bar shows, which chip variant a status takes) are table-testable
 * here without a DOM.
 *
 * The win probability, the side order (viewer first), the score, figure, record and Players
 * remaining text and the margin are `matchupFace`'s (entities/matchup, ADR 0029 amendment
 * 2026-10-24); nothing here prices or picks.
 */

/**
 * @param {object} matchup the Matchup entity model (`entities/matchup`)
 * @param {object} [options]
 * @param {*} [options.viewerTeamId] the viewer's own Team id; the matching side is marked `isViewer`
 * @param {object|function} [options.records] Team record lookup by teamId (`{ [teamId]: '2-0' }` or `(teamId) => '2-0'`)
 */
export function scoreboardView(matchup, { viewerTeamId, records } = {}) {
  // A settled (played or final) Matchup states its result instead (#2007): the bar and the
  // Expected final and Players remaining figures give way to `result`. A status the server could
  // not state prices nothing, so it never paints a bar.
  const { first, second, game } = matchupFace(matchup || {}, { viewerTeamId, records });
  // The strip's own bar policy (#2007): a settled Matchup states its result instead, and the
  // board's share is drawn even when one Expected final is missing (the hero's priced rule is
  // stricter). This is the one policy the face leaves to the surface.
  const showBar = game.resultLine == null && game.firstShare != null;
  // No bar, no split: the sides print 0 and 100, as the strip always has.
  const firstShare = showBar ? game.firstShare : 0;
  const firstPct = showBar ? game.firstPct : 0;

  const side = (s, winPct) => ({
    teamId: s.teamId,
    name: s.name || (s.origin === 'home' ? 'Home' : 'Away'),
    avatarUrl: s.avatarUrl,
    avatarStaticUrl: s.avatarStaticUrl,
    origin: s.origin,
    isViewer: s.isViewer,
    record: s.record,
    score: s.scoreLabel,
    // The figure a side prints big: its score once the matchup has started, else its Proj (the Expected final).
    figure: s.figure,
    expectedFinal: s.expectedFinalLabel,
    playersRemaining: s.playersRemainingLabel,
    winPct,
  });

  return {
    first: side(first, firstPct),
    second: side(second, 100 - firstPct),
    firstShare,
    showBar,
    result: game.resultLine,
    started: game.hasStarted === true,
    isLive: game.isLive,
    // 'first', 'second' or null.
    leader: game.leader,
    // "{Leader} by {x}", "Tied" on an even figure, null when a side has no figure.
    marginText: game.marginText,
    // The entity's chip: null for an unknown status, never a guessed one.
    chip: game.chip,
  };
}
