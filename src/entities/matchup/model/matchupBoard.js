// The narrow module, not the shared/lib barrel: an eager card reaches this file.
import { matchupWinProbability } from '../../../shared/lib/winProbability';
import { matchupResultLine } from './matchupModel';

/**
 * The one board reading of a Matchup (#2048, ADR 0030): everything a board
 * paints that depends on the Matchup's status, decided here once so a reader
 * lays it out instead of branching on `status` itself.
 *
 *   { chip: { label, variant, dot } | null,
 *     hasStarted, settled, isLive, isFinal, resultLine,
 *     winProbability: { home, away } | null,
 *     home: { score, expectedFinal, playersRemaining }, away: { ...same } }
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
 * - `winProbability` is the one priced figure, for every known status: the
 *   scores decide a settled week, the projections price a scheduled one. Null
 *   only when the status is unknown. A reader shows or hides it under its own
 *   gate (`hasStarted === true`, `isLive`, `settled`).
 * - `matchupPhase(status)` is the status-only part (`chip`, `hasStarted`,
 *   `settled`, `isLive`, `isFinal`) for a caller that holds a status and no
 *   Matchup.
 * - `expectedFinal` is null once settled (the server still prices one, #2008).
 *   Scores and Players remaining pass through raw; the reader formats them.
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

export function matchupBoard(matchup, viewerTeamId) {
  const m = matchup || {};
  const phase = matchupPhase(m.status);
  const { chip, settled } = phase;
  const side = (s = {}) => ({
    score: s.score ?? null,
    expectedFinal: settled ? null : s.expectedFinal ?? null,
    playersRemaining: s.playersRemaining ?? null,
  });
  const home = side(m.home);
  const away = side(m.away);
  return {
    ...phase,
    isFinal: phase.isFinal || (m.status == null && !!m.final),
    resultLine: matchupResultLine(m, viewerTeamId),
    winProbability:
      chip
        ? matchupWinProbability({
            homeScore: home.score,
            awayScore: away.score,
            homeExpectedFinal: home.expectedFinal,
            awayExpectedFinal: away.expectedFinal,
            status: m.status,
          })
        : null,
    home,
    away,
  };
}
