import { matchupStatusView } from '../../../entities/matchup';
import { matchupWinProbability } from '../../../lib/winProbability';

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
 *     entity's one predicate (ADR 0030), never inferred here. `started` is
 *     true only once the predicate says `hasStarted === true`; every other
 *     value (false, or the unknown-status null) reads the projected total,
 *     matching matchup-grid's own `scheduled ? ef : score` convention.
 *   - The win probability is the same arithmetic the hero and matchup-grid
 *     use (src/lib/winProbability, a sanctioned reach below the island per
 *     ADR 0031), computed from whatever the two sides carry: before kickoff
 *     that is a projections-only split (each side's score reads 0), once
 *     live it moves with the score. The tile's SplitBar is never gated on
 *     `started`, unlike matchup-grid's hairline-before-kickoff divider: the
 *     design source (docs/design/league-dashboard-v2/build.mjs,
 *     aroundLeague()) paints every tile's bar unconditionally.
 *   - `isViewer` answers "is one side of this Matchup the viewer's own Team"
 *     by comparing each side's Team id against `viewerTeamId` (#112,
 *     CONTEXT.md Team identity) - never by which side (home/away) a Team
 *     happens to sit on, which is the red-tell a home/away shortcut would
 *     fail: a viewer seated away would then never ring.
 */

/** A finite number from a wire value (pg DECIMAL strings included), else null. */
function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A points figure to one decimal ("92.1"), or a dash when unknown. */
export function formatPoints(value) {
  const n = finite(value);
  return n != null ? n.toFixed(1) : '-';
}

export function aroundLeagueTileView(matchup, { viewerTeamId } = {}) {
  const m = matchup || {};
  const home = m.home || {};
  const away = m.away || {};
  const { hasStarted } = matchupStatusView(m.status ?? null);
  const started = hasStarted === true;
  // Matches matchup-grid's matchupCardView: the projected total shows unless
  // the server's status fact says the Matchup has started. An unknown status
  // (`hasStarted === null`) reads the score, exactly as matchup-grid's figure
  // does, because a started week's stored score is a fact even when the
  // server could not say how far along it is.
  const scheduled = hasStarted === false;

  const probability = matchupWinProbability({
    homeScore: finite(home.score) ?? 0,
    awayScore: finite(away.score) ?? 0,
    homeExpectedFinal: home.expectedFinal,
    awayExpectedFinal: away.expectedFinal,
  });

  const side = (s) => ({
    teamId: s.teamId ?? null,
    name: s.name ?? '',
    avatarUrl: s.avatarUrl ?? null,
    avatarStaticUrl: s.avatarStaticUrl ?? null,
    figure: scheduled ? formatPoints(s.expectedFinal) : formatPoints(s.score),
  });

  const isViewer =
    viewerTeamId != null && (home.teamId === viewerTeamId || away.teamId === viewerTeamId);

  return {
    id: m.id ?? null,
    week: m.week ?? null,
    status: m.status ?? null,
    started,
    isViewer,
    homeShare: probability.home,
    home: side(home),
    away: side(away),
  };
}

export default aroundLeagueTileView;
