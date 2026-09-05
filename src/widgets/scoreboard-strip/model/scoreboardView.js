import { matchupStatusView } from '../../../entities/matchup';
import { matchupWinProbability } from '../../../lib/winProbability';

/**
 * The scoreboard strip's view model (widget `scoreboard-strip`, ADR 0031,
 * #898): everything the strip paints, derived from the Matchup entity model
 * and the status view alone, with no render. The component below reads this
 * object and nothing else, so the display rules (how a score, an Expected
 * final and a Players remaining count are written, which side is the viewer,
 * when the bar shows, which chip variant a status takes) are table-testable
 * here without a DOM.
 *
 * Reaches below the island for one thing, the win probability arithmetic in
 * `src/lib/winProbability` (ADR 0031: the helpers only these pages used stay
 * where they are and a slice imports them as the entity imports `src/api`).
 */

/** A score as the strip prints it: one decimal, a missing score reading 0.0. */
export function formatScore(value) {
  return Number(value || 0).toFixed(1);
}

/** An Expected final as the strip prints it: one decimal, or null when unknown. */
export function formatExpectedFinal(value) {
  return value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(1) : null;
}

/** Players remaining as the model reports it: the integer count, or null when unknown. */
export function formatPlayersRemaining(value) {
  return value != null && Number.isFinite(Number(value)) ? String(Number(value)) : null;
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

  // Status is the server's fact read through the entity's one predicate (ADR
  // 0030). The bar shows only for `hasStarted === true`: false (scheduled) and
  // null (the server could not say) both show no bar, so an unknown status
  // never paints a probability the page cannot stand behind.
  const status = matchupStatusView(m.status);
  const showBar = status.hasStarted === true;

  const probability = matchupWinProbability({
    homeScore: home.score,
    awayScore: away.score,
    homeExpectedFinal: home.expectedFinal,
    awayExpectedFinal: away.expectedFinal,
  });
  const homeShare = Math.max(0, Math.min(1, Number(probability.home) || 0));
  // Rounded once, with the away side as the complement, so the two printed
  // percentages always sum to 100 and agree with the SplitBar's own rounding.
  const homePct = Math.round(homeShare * 100);

  const side = (s, fallbackName, winPct) => ({
    teamId: s.teamId ?? null,
    name: s.name || fallbackName,
    avatarUrl: s.avatarUrl ?? null,
    avatarStaticUrl: s.avatarStaticUrl ?? null,
    // The same strict, null-guarded id comparison the dashboard widgets use for
    // their viewer row (standings-table, draft-grades): the page passes the
    // viewer's Team id in the model's own type.
    isViewer: viewerTeamId != null && s.teamId != null && s.teamId === viewerTeamId,
    record: recordFor(records, s.teamId),
    score: formatScore(s.score),
    expectedFinal: formatExpectedFinal(s.expectedFinal),
    playersRemaining: formatPlayersRemaining(s.playersRemaining),
    winPct,
  });

  return {
    home: side(home, 'Home', homePct),
    away: side(away, 'Away', 100 - homePct),
    homeShare,
    showBar,
    // The chip is the entity's own label; a null label (unknown status) is no
    // chip at all, never a guessed one. `live` takes the kit's accent state,
    // every other known status the neutral chip.
    chip: status.chipLabel == null
      ? null
      : { label: status.chipLabel, variant: m.status === 'live' ? 'live' : 'neutral' },
  };
}
