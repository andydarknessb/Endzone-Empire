import { matchupBoard } from '../../../entities/matchup';
import { formatPoints } from '../../../shared/lib';

/**
 * The per-tile view of one Matchup for the around-the-league widget (#1103):
 * everything one compact tile prints, derived once from the entity model
 * (entities/matchup) so the widget's UI stays a thin presenter. Pure: no
 * render, no fetch. A widget never imports another widget's model (ADR 0020),
 * so this restates matchup-grid's shape rather than reaching for it.
 *
 * What it settles:
 *
 *   - Whether the Matchup has started is the server's status fact through the
 *     entity's `matchupBoard` (ADR 0030), never inferred here. `started` is
 *     true only once the board says `hasStarted === true`; every other
 *     value (false, or the unknown-status null) reads the projected total,
 *     matching matchup-grid's own `scheduled ? ef : score` convention.
 *   - The win probability is the entity board's (#2142), the same figure the
 *     hero and matchup-grid read: before kickoff that is the projections-only
 *     split, once live it moves with the score. The tile's SplitBar
 *     is never gated on `started`, unlike matchup-grid's hairline-before-
 *     kickoff divider: the design source (docs/design/league-dashboard-v2/
 *     build.mjs, aroundLeague()) paints every tile's bar unconditionally.
 *   - `isViewer` answers "is one side of this Matchup the viewer's own Team"
 *     by comparing each side's Team id against `viewerTeamId` (#112,
 *     CONTEXT.md Team identity) - never by which side (home/away) a Team
 *     happens to sit on, which is the red-tell a home/away shortcut would
 *     fail: a viewer seated away would then never ring. It is computed
 *     per side (each side's own `isViewer`) as well as at the tile level
 *     (either side's), so the UI can ring the whole tile AND name WHICH
 *     side is the viewer's own with a visible "You" pill (WCAG 1.4.1: the
 *     ring alone is a colour/border cue, not identifiable to assistive
 *     tech - the same rule Badge.jsx's `you` variant and
 *     StandingsTable's viewer rows already carry).
 */

export function aroundLeagueTileView(matchup, { viewerTeamId } = {}) {
  const m = matchup || {};
  const home = m.home || {};
  const away = m.away || {};
  const board = matchupBoard(m, viewerTeamId);
  const { hasStarted } = board;
  const started = hasStarted === true;
  // Matches matchup-grid's matchupCardView: the projected total shows unless
  // the server's status fact says the Matchup has started. An unknown status
  // (`hasStarted === null`) reads the score, exactly as matchup-grid's figure
  // does, because a started week's stored score is a fact even when the
  // server could not say how far along it is.
  const scheduled = hasStarted === false;

  // The board states no probability for an unknown status: the tile draws no bar.
  const probability = board.winProbability ?? board.projectedWinProbability;

  // Per-side, so the UI can name WHICH side is the viewer's own (the "You"
  // pill sits on that side's row, never on both, and never guessed from
  // home/away position - #112).
  const side = (s, key) => ({
    teamId: s.teamId ?? null,
    name: s.name ?? '',
    avatarUrl: s.avatarUrl ?? null,
    avatarStaticUrl: s.avatarStaticUrl ?? null,
    figure: scheduled ? formatPoints(s.expectedFinal) : formatPoints(s.score),
    isViewer: key === board.viewerSide,
  });

  const homeSide = side(home, 'home');
  const awaySide = side(away, 'away');

  return {
    id: m.id ?? null,
    week: m.week ?? null,
    status: m.status ?? null,
    started,
    // Exposed alongside `started` so a caller can name what the figure IS
    // (its accessible label) using the same three-way ADR 0030 `matchupBoard` reading the
    // figure's own VALUE already uses, rather than `!started` - which
    // collapses the unknown-status case into "not started" and would then
    // print a live score under a "Projected" label (a false accessible
    // name, the same class of defect #872 forbade for SplitBar).
    scheduled,
    // The tile-level ring (#1103): true when either side is the viewer's.
    isViewer: homeSide.isViewer || awaySide.isViewer,
    homeShare: probability ? probability.home : null,
    home: homeSide,
    away: awaySide,
  };
}

export default aroundLeagueTileView;
