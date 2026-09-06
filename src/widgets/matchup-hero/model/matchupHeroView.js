import { matchupStatusView } from '../../../entities/matchup';
import { matchupWinProbability } from '../../../lib/winProbability';

/**
 * The matchup-hero widget's view model, pure (ticket #893, ADR 0031). Given
 * the one Matchup shape from `entities/matchup` and the viewer's Team id, it
 * answers everything the card paints that is not a straight field read, so
 * the UI stays a presenter:
 *
 *   - which side is the viewer's (`viewerSide`), matched on Team id and never
 *     on home/away (#112: the You pill follows the viewer's Team, the layout
 *     stays home-left / away-right the way SplitBar encodes it);
 *   - the status chip and `hasStarted`, straight from the entity predicate
 *     (ADR 0030: status is a server fact, never inferred here), with the
 *     chip's Badge variant (danger / success / warning / neutral for live /
 *     final / played / scheduled) and whether it carries the live dot;
 *   - the per-side win probability percentages, rounded the same way SplitBar
 *     rounds its segments so the numbers beside the bar equal the bar's own
 *     accessible name (`homePct` rounded, `awayPct` its complement);
 *   - the one plain sentence under the bar ("Ahead now, projected to trail by
 *     13.4 with 6 of theirs still to play"), written from the viewer's side;
 *   - the kickoff line for a Matchup that has not started, formatted from
 *     `firstKickoffAt` (#892) with Intl, weekday short plus time.
 *
 * `winProbability`, `sentence` and `kickoff` are each null when the status
 * does not call for them: a started Matchup has the first two and no kickoff,
 * a scheduled one has the kickoff alone, and an unknown status (null, or a
 * value the entity does not know) has none, so the card asserts neither state
 * (the entity's `hasStarted === null` contract).
 *
 * The arithmetic reaches below the island for `src/lib/winProbability`, the
 * sanctioned reach ADR 0031 names for the helpers only these pages used.
 */

const KICKOFF_FORMAT = { weekday: 'short', hour: 'numeric', minute: '2-digit' };

// The status chip's Badge variant per server status, the canvas's statusChip():
// `.chip.live` is the danger red with the dot, `.chip.final` the success
// green, `.chip.warn` for Awaiting final, the plain chip for Scheduled. The
// label is the entity predicate's; an unknown status has no chip at all.
const CHIP_VARIANTS = { live: 'danger', final: 'success', played: 'warning', scheduled: 'neutral' };

/** A finite number from a wire value (pg DECIMAL strings included), else null. */
function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A difference rounded to a tenth, so "by 0.0" never reads as a lead. */
function tenth(value) {
  return Math.round(value * 10) / 10;
}

/**
 * "Sun 7:20 PM" from an ISO timestamp, in the viewer's locale and time zone;
 * null when the value is missing or not a date.
 */
export function formatKickoff(iso) {
  if (iso == null || iso === '') return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, KICKOFF_FORMAT).format(date);
}

/**
 * English ordinal for a positive integer rank (1 -> "1st", 3 -> "3rd",
 * 11 -> "11th"); null for anything else so a caller renders no rank rather
 * than "0th" or "NaNth". The my-team-summary widget carries its own copy; a
 * widget never imports another widget (ADR 0020), and a third consumer is what
 * earns the helper a `shared/lib` home.
 */
export function ordinal(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return null;
  const value = Math.trunc(n);
  const mod100 = value % 100;
  let suffix = 'th';
  if (mod100 < 11 || mod100 > 13) {
    const unit = value % 10;
    if (unit === 1) suffix = 'st';
    else if (unit === 2) suffix = 'nd';
    else if (unit === 3) suffix = 'rd';
  }
  return `${value}${suffix}`;
}

/**
 * The one plain sentence under the win probability bar, from `me`'s side
 * (`me` and `them` are the entity's per-side objects). Three shapes by status:
 *
 *   - live: "<Ahead|Behind|Tied> now, projected to <lead|trail> by N with K of
 *     <theirs|yours> still to play". The projection clause needs both sides'
 *     Expected final and is dropped when either is unknown; the remaining
 *     clause names the opponent's Players remaining when they still have
 *     starters to play (the threat to the lead), else the viewer's own, and is
 *     dropped when neither side has anyone left.
 *   - played (awaiting the score of record): "<Ahead|Behind> by N, awaiting
 *     the final" or "Tied, awaiting the final".
 *   - final: "Won by N", "Lost by N" or "Tied".
 *
 * Every "by N" is the margin to a tenth; a margin that rounds to zero reads
 * as tied/even rather than "by 0.0".
 */
export function heroSentence({ me, them, status }) {
  const mine = me || {};
  const theirs = them || {};
  const lead = tenth((finite(mine.score) ?? 0) - (finite(theirs.score) ?? 0));
  const by = Math.abs(lead).toFixed(1);

  if (status === 'final') {
    if (lead > 0) return `Won by ${by}`;
    if (lead < 0) return `Lost by ${by}`;
    return 'Tied';
  }
  if (status === 'played') {
    if (lead > 0) return `Ahead by ${by}, awaiting the final`;
    if (lead < 0) return `Behind by ${by}, awaiting the final`;
    return 'Tied, awaiting the final';
  }

  const now = lead > 0 ? 'Ahead now' : lead < 0 ? 'Behind now' : 'Tied now';

  const myFinal = finite(mine.expectedFinal);
  const theirFinal = finite(theirs.expectedFinal);
  let projection = null;
  if (myFinal != null && theirFinal != null) {
    const gap = tenth(myFinal - theirFinal);
    const gapBy = Math.abs(gap).toFixed(1);
    if (gap > 0) projection = `projected to lead by ${gapBy}`;
    else if (gap < 0) projection = `projected to trail by ${gapBy}`;
    else projection = 'projected to finish even';
  }

  const theirLeft = finite(theirs.playersRemaining) ?? 0;
  const myLeft = finite(mine.playersRemaining) ?? 0;
  let remaining = '';
  if (theirLeft > 0) remaining = ` with ${theirLeft} of theirs still to play`;
  else if (myLeft > 0) remaining = ` with ${myLeft} of yours still to play`;

  return projection ? `${now}, ${projection}${remaining}` : `${now}${remaining}`;
}

/**
 * The whole view for one hero card. `viewerSide` is 'home' or 'away' when the
 * viewer's Team is one of the two, else null (no pill, and the sentence falls
 * back to the home side's perspective; the page only renders this card for
 * the viewer's own Matchup, so that fallback is a degrade path, not a state
 * the page produces).
 */
export function matchupHeroView(matchup, viewerTeamId) {
  const m = matchup || {};
  const home = m.home || {};
  const away = m.away || {};
  const viewerSide =
    viewerTeamId != null && home.teamId === viewerTeamId
      ? 'home'
      : viewerTeamId != null && away.teamId === viewerTeamId
        ? 'away'
        : null;

  const status = matchupStatusView(m.status);
  const { hasStarted } = status;

  let winProbability = null;
  let sentence = null;
  if (hasStarted === true) {
    const { home: homeShare } = matchupWinProbability({
      homeScore: finite(home.score) ?? 0,
      awayScore: finite(away.score) ?? 0,
      homeExpectedFinal: home.expectedFinal,
      awayExpectedFinal: away.expectedFinal,
    });
    // Rounded exactly as SplitBar rounds its segments, so the two visible
    // percentages equal the ones the bar announces.
    const clamped = Math.max(0, Math.min(1, Number(homeShare) || 0));
    const homePct = Math.round(clamped * 100);
    winProbability = { homeShare: clamped, homePct, awayPct: 100 - homePct };
    const me = viewerSide === 'away' ? away : home;
    const them = viewerSide === 'away' ? home : away;
    sentence = heroSentence({ me, them, status: m.status });
  }

  const kickoff = hasStarted === false ? formatKickoff(m.firstKickoffAt) : null;

  return {
    viewerSide,
    hasStarted,
    chipLabel: status.chipLabel,
    chipVariant: CHIP_VARIANTS[m.status] ?? 'neutral',
    chipDot: m.status === 'live',
    winProbability,
    sentence,
    kickoff,
  };
}

export default matchupHeroView;
