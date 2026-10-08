// The narrow module, not the shared/lib barrel: an eager card reaches this file.
import { matchupWinProbability } from '../../../shared/lib/winProbability';
import { matchupResultLine } from './matchupModel';

/**
 * The one board reading of a Matchup (#2048, ADR 0030): everything a board
 * paints that depends on the Matchup's status, decided here once so a reader
 * lays it out instead of branching on `status` itself.
 *
 *   { chip: { label, variant, dot } | null,
 *     hasStarted, settled, resultLine, winProbability: { home, away } | null,
 *     home: { score, expectedFinal, playersRemaining }, away: { ...same } }
 *
 * - `chip` is null for an unknown status (null, absent, unrecognised): "the
 *   server could not say" draws no chip, never a guessed "Scheduled". The
 *   variant is the canvas's statusChip(); the dot is LIVE alone.
 * - `hasStarted` is true for live, played and final, false for scheduled and
 *   null when unknown (asserting neither state).
 * - `settled` is played or final: the week is decided, so the result line
 *   stands in for the win bar and the Expected final figures.
 * - `winProbability` is live only; a scheduled, settled or unknown Matchup
 *   prices none.
 * - `expectedFinal` is null once settled (the server still prices one, #2008).
 *   Scores and Players remaining pass through raw; the reader formats them.
 */
const CHIP_VARIANTS = {
  scheduled: { label: 'Scheduled', variant: 'neutral', dot: false },
  live: { label: 'LIVE', variant: 'danger', dot: true },
  played: { label: 'Awaiting final', variant: 'warning', dot: false },
  final: { label: 'Final', variant: 'success', dot: false },
};

export function matchupBoard(matchup, viewerTeamId) {
  const m = matchup || {};
  const chip = Object.prototype.hasOwnProperty.call(CHIP_VARIANTS, m.status) ? { ...CHIP_VARIANTS[m.status] } : null;
  const hasStarted = chip ? m.status !== 'scheduled' : null;
  const settled = m.status === 'played' || m.status === 'final';
  const side = (s = {}) => ({
    score: s.score ?? null,
    expectedFinal: settled ? null : s.expectedFinal ?? null,
    playersRemaining: s.playersRemaining ?? null,
  });
  const home = side(m.home);
  const away = side(m.away);
  return {
    chip,
    hasStarted,
    settled,
    resultLine: matchupResultLine(m, viewerTeamId),
    winProbability:
      m.status === 'live'
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
