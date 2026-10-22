// The sibling module, not the shared/lib barrel: an eager card reaches this file.
import { matchupWinProbability } from './winProbability';
import { matchupResultLine } from './matchupModel';

/**
 * The one board reading of a Matchup (#2048, ADR 0030): everything a board
 * paints that depends on the Matchup's status, decided here once so a reader
 * lays it out instead of branching on `status` itself.
 *
 *   { chip: { label, variant, dot } | null,
 *     hasStarted, settled, isLive, isFinal, resultLine,
 *     winProbability: { first, second } | null,
 *     projectedWinProbability: { first, second } | null,
 *     first: { isViewer, origin, teamId, name, avatarUrl, avatarStaticUrl, score, scoreLabel,
 *              expectedFinal, playersRemaining, playersRemainingLabel, yetToPlay },
 *     second: { ...same } }
 *
 * - `chip` is null for an unknown status (null, absent, unrecognised): "the
 *   server could not say" draws no chip, never a guessed "Scheduled". The
 *   variant is the canvas's statusChip(); the dot is LIVE alone.
 * - `hasStarted` is true for live, played and final, false for scheduled and
 *   null when unknown (asserting neither state).
 * - `settled` is played or final: the week is decided, so the result line
 *   stands in for the win bar and the Expected final figures.
 * - `isLive` is the exact live status; `isFinal` is the exact final status,
 *   or, for a status the server did not state (null), the body's own `final`
 *   flag, the only finality fact such a body carries (#912).
 * - Viewer first (spec #2402): `first` is the viewer's Team when it is one of the
 *   two (matched on Team id, never on name or position, #112), else the home
 *   Team; `second` is the other. `origin` ('home' | 'away') says where a side
 *   came from and `isViewer` marks the viewer's own. No caller orders the sides.
 * - `winProbability` is the one priced figure, stated once the Matchup has
 *   started (live, played, final): the scores decide a settled week, the
 *   projections price a live one. Null before kickoff and for an unknown
 *   status. `projectedWinProbability` is the same arithmetic before kickoff
 *   (projections only), for the surfaces that show the pre-kickoff split; null
 *   once the Matchup has started and for an unknown status.
 * - `scoreLabel` is 0.0 whenever the Matchup exists (a missing score is a
 *   score of nothing, CONTEXT.md), null only when there is no Matchup at all.
 *   The raw `score` stays null when missing, and `resultLine` stays null with
 *   it: a result is never invented from a score the server did not state.
 * - `playersRemainingLabel` is the whole count, null when the server did not
 *   say. The live sentence under the win bar is the hero's own (widgets/matchup-hero's
 *   `matchupHeroView`: "Ahead now, projected to trail by 7.9 \u00b7 they have 9 players
 *   remaining, 3 yet to play"), built from the server's counts; a settled week states `resultLine`.
 * - `matchupPhase(status)` is the status-only part (`chip`, `hasStarted`,
 *   `settled`, `isLive`, `isFinal`) for a caller that holds a status and no
 *   Matchup.
 * - `expectedFinal` is null once settled (the server still prices one, #2008).
 *   The raw score and Players remaining pass through; a reader formats the
 *   Expected final.
 */
const CHIP_VARIANTS = {
  scheduled: { label: 'Scheduled', variant: 'neutral', dot: false },
  live: { label: 'LIVE', variant: 'danger', dot: true },
  played: { label: 'Awaiting final', variant: 'warning', dot: false },
  final: { label: 'Final', variant: 'success', dot: false },
};

export function matchupPhase(status) {
  const chip = Object.prototype.hasOwnProperty.call(CHIP_VARIANTS, status) ? { ...CHIP_VARIANTS[status] } : null;
  return {
    chip,
    hasStarted: chip ? status !== 'scheduled' : null,
    settled: status === 'played' || status === 'final',
    isLive: status === 'live',
    isFinal: status === 'final',
  };
}

// A finite number, or null: Number(null) is 0, and an absent count is not a zero.
function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function matchupBoard(matchup, viewerTeamId) {
  const m = matchup || {};
  const phase = matchupPhase(m.status);
  const side = (s = {}, origin) => {
    const remaining = finite(s.playersRemaining);
    return {
      origin,
      isViewer: viewerTeamId != null && s.teamId != null && s.teamId === viewerTeamId,
      teamId: s.teamId ?? null,
      name: s.name ?? null,
      avatarUrl: s.avatarUrl ?? null,
      avatarStaticUrl: s.avatarStaticUrl ?? null,
      score: s.score ?? null,
      scoreLabel: matchup ? (finite(s.score) ?? 0).toFixed(1) : null,
      expectedFinal: phase.settled ? null : s.expectedFinal ?? null,
      playersRemaining: s.playersRemaining ?? null,
      yetToPlay: s.yetToPlay ?? null,
      playersRemainingLabel: remaining == null ? null : String(remaining),
    };
  };
  const home = side(m.home, 'home');
  const away = side(m.away, 'away');
  // Viewer first: the viewer's Team leads when it is in the Matchup, else home.
  const flip = away.isViewer && !home.isViewer;
  const [first, second] = flip ? [away, home] : [home, away];
  const keyed = (p) => (p ? (flip ? { first: p.away, second: p.home } : { first: p.home, second: p.away }) : null);
  const price = () =>
    keyed(matchupWinProbability({
      homeScore: home.score,
      awayScore: away.score,
      homeExpectedFinal: home.expectedFinal,
      awayExpectedFinal: away.expectedFinal,
      status: m.status,
    }));
  return {
    ...phase,
    isFinal: phase.isFinal || (m.status == null && !!m.final),
    resultLine: matchupResultLine(m, viewerTeamId),
    winProbability: phase.hasStarted === true ? price() : null,
    projectedWinProbability: phase.hasStarted === false ? price() : null,
    first,
    second,
  };
}
