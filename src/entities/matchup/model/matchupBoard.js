// The sibling module, not the shared/lib barrel: an eager card reaches this file.
import { matchupWinProbability } from './winProbability';
import { matchupResultLine } from './matchupModel';

/**
 * The one board reading of a Matchup (#2048, ADR 0030): everything a board
 * paints that depends on the Matchup's status, decided here once so a reader
 * lays it out instead of branching on `status` itself.
 *
 *   { chip: { label, variant, dot } | null,
 *     hasStarted, settled, isLive, isFinal, viewerSide, resultLine, liveLine,
 *     winProbability: { home, away } | null,
 *     projectedWinProbability: { home, away } | null,
 *     home: { score, scoreLabel, expectedFinal, playersRemaining, playersRemainingLabel },
 *     away: { ...same } }
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
 * - `viewerSide` is 'home' or 'away' when the viewer's Team is one of the two
 *   (matched on Team id, never on name or position, #112), else null.
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
 *   say. `liveLine` is the sentence under the win bar while live, null
 *   otherwise (a settled week states `resultLine`).
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

// A difference rounded to a tenth, so "by 0.0" never reads as a lead.
const tenth = (value) => Math.round(value * 10) / 10;

/**
 * The live sentence, from `me`'s side: "<Ahead|Behind|Tied> now, projected to
 * <lead|trail> by N with K of <theirs|yours> still to play". The projection
 * clause needs both Expected finals; the remaining clause names the opponent's
 * Players remaining when they have any (the threat to the lead), else the
 * viewer's own, and is dropped when neither side has anyone left.
 */
function liveLineOf(me, them) {
  const lead = tenth((finite(me.score) ?? 0) - (finite(them.score) ?? 0));
  const now = lead > 0 ? 'Ahead now' : lead < 0 ? 'Behind now' : 'Tied now';
  const myFinal = finite(me.expectedFinal);
  const theirFinal = finite(them.expectedFinal);
  let projection = null;
  if (myFinal != null && theirFinal != null) {
    const gap = tenth(myFinal - theirFinal);
    const by = Math.abs(gap).toFixed(1);
    if (gap > 0) projection = `projected to lead by ${by}`;
    else if (gap < 0) projection = `projected to trail by ${by}`;
    else projection = 'projected to finish even';
  }
  const theirLeft = finite(them.playersRemaining) ?? 0;
  const myLeft = finite(me.playersRemaining) ?? 0;
  let remaining = '';
  if (theirLeft > 0) remaining = ` with ${theirLeft} of theirs still to play`;
  else if (myLeft > 0) remaining = ` with ${myLeft} of yours still to play`;
  return projection ? `${now}, ${projection}${remaining}` : `${now}${remaining}`;
}

export function matchupBoard(matchup, viewerTeamId) {
  const m = matchup || {};
  const phase = matchupPhase(m.status);
  const side = (s = {}) => {
    const remaining = finite(s.playersRemaining);
    return {
      score: s.score ?? null,
      scoreLabel: matchup ? (finite(s.score) ?? 0).toFixed(1) : null,
      expectedFinal: phase.settled ? null : s.expectedFinal ?? null,
      playersRemaining: s.playersRemaining ?? null,
      playersRemainingLabel: remaining == null ? null : String(remaining),
    };
  };
  const home = side(m.home);
  const away = side(m.away);
  const viewerSide =
    viewerTeamId == null ? null
      : m.home?.teamId === viewerTeamId ? 'home'
        : m.away?.teamId === viewerTeamId ? 'away' : null;
  const price = () =>
    matchupWinProbability({
      homeScore: home.score,
      awayScore: away.score,
      homeExpectedFinal: home.expectedFinal,
      awayExpectedFinal: away.expectedFinal,
      status: m.status,
    });
  return {
    ...phase,
    isFinal: phase.isFinal || (m.status == null && !!m.final),
    viewerSide,
    resultLine: matchupResultLine(m, viewerTeamId),
    liveLine: phase.isLive
      ? viewerSide === 'away'
        ? liveLineOf(m.away || {}, m.home || {})
        : liveLineOf(m.home || {}, m.away || {})
      : null,
    winProbability: phase.hasStarted === true ? price() : null,
    projectedWinProbability: phase.hasStarted === false ? price() : null,
    home,
    away,
  };
}
