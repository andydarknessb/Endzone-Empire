import { matchupStatusView } from '../../../entities/matchup';
import { matchupWinProbability } from '../../../lib/winProbability';
import { lookupRecord } from '../lib/records';

/**
 * The per-card view of one Matchup for the League matchups grid (ticket #894):
 * everything a card or a compact row prints, derived once from the entity model
 * so the two layouts read the same numbers and copy and the UI stays a thin
 * presenter. Pure: no render, no fetch.
 *
 * What it settles, from the design source (docs/design/game-center-matchups/
 * build.mjs, matchupCard / matchupRowMobile):
 *
 *   - Whether the Matchup has started is the server's status fact through the
 *     entity's one predicate (ADR 0030). `hasStarted === true` shows the scores
 *     and the win probability bar; `hasStarted === false` shows each side's
 *     projected total in the faint tier, a hairline instead of a bar, and the
 *     kickoff line; an unknown status (`null`) asserts neither: the scores
 *     (stored facts) show, but no bar, no chip and no footer sentence.
 *   - The leader is the side with the higher score, compared numerically (pg
 *     returns DECIMAL scores as strings). The check mark rides the leader once
 *     every starter is done (`played`) or the score is of record (`final`).
 *   - The footer sentence per status: the two win probability percentages
 *     while live, "Waiting on the score of record" once played, "Projected
 *     totals shown until kickoff" before it. A final Matchup has no probability
 *     to print (its score is the result), so its footer reads "Score of
 *     record", the line the played copy is waiting on.
 *   - The header note is the week, or before kickoff the kickoff time from the
 *     model's `firstKickoffAt` (#892) in the viewer's own zone.
 *
 * Win probability is the same arithmetic the hero uses (src/lib/winProbability,
 * a sanctioned reach below the island per ADR 0031): a side whose Expected
 * final is unknown is treated as having nothing left to add.
 */

const KICKOFF_FORMAT = { weekday: 'short', hour: 'numeric', minute: '2-digit' };

/**
 * "Sun 7:20 PM" for an ISO instant, in the viewer's own zone. `timeZone` and
 * `locale` exist only so a test can pin the output; production callers omit
 * them and get the browser's runtime defaults. An absent or unparseable
 * instant reads as null, so a card falls back to its week line.
 */
export function formatKickoff(iso, { timeZone, locale } = {}) {
  if (iso == null || iso === '') return null;
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const options = timeZone ? { ...KICKOFF_FORMAT, timeZone } : KICKOFF_FORMAT;
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/** A points figure to one decimal ("92.1"), or a dash when unknown. */
export function formatPoints(value) {
  const n = value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : '-';
}

/** Players remaining as a whole number, or a dash when unknown. */
export function formatCount(value) {
  const n = value == null ? NaN : Number(value);
  return Number.isFinite(n) ? String(n) : '-';
}

function joinNote(parts) {
  return parts.filter((p) => p != null && p !== '').join(' \u00b7 ');
}

export function matchupCardView(matchup, { records, timeZone, locale } = {}) {
  const m = matchup || {};
  const home = m.home || {};
  const away = m.away || {};
  const status = m.status ?? null;
  const { chipLabel, hasStarted } = matchupStatusView(status);
  const started = hasStarted === true;
  const scheduled = hasStarted === false;
  const settled = status === 'played' || status === 'final';

  const homeScore = Number(home.score) || 0;
  const awayScore = Number(away.score) || 0;
  const homeLeads = started && homeScore > awayScore;
  const awayLeads = started && awayScore > homeScore;

  const probability = started
    ? matchupWinProbability({
        homeScore,
        awayScore,
        homeExpectedFinal: home.expectedFinal,
        awayExpectedFinal: away.expectedFinal,
      })
    : null;
  const homePct = probability ? Math.round(probability.home * 100) : null;
  const awayPct = probability ? 100 - homePct : null;

  const weekNote = m.week != null ? `Week ${m.week}` : '';
  const kickoff = scheduled ? formatKickoff(m.firstKickoffAt, { timeZone, locale }) : null;
  const headerNote = kickoff ? `Kicks off ${kickoff}` : weekNote;

  let footer = '';
  if (status === 'live') footer = `Win probability ${homePct}% \u00b7 ${awayPct}%`;
  else if (status === 'played') footer = 'Waiting on the score of record';
  else if (status === 'final') footer = 'Score of record';
  else if (scheduled) footer = 'Projected totals shown until kickoff';

  const side = (s, leads) => {
    const record = lookupRecord(records, s.teamId);
    const ef = formatPoints(s.expectedFinal);
    const pmr = formatCount(s.playersRemaining);
    const score = formatPoints(s.score);
    return {
      teamId: s.teamId ?? null,
      name: s.name ?? '',
      avatarUrl: s.avatarUrl ?? null,
      avatarStaticUrl: s.avatarStaticUrl ?? null,
      record,
      // The big number: the score once started (and on an unknown status, a
      // stored fact), the projected total in the faint tier before kickoff.
      figure: scheduled ? ef : score,
      figureTier: scheduled ? 'faint' : 'ink',
      // The compact row prints its score column only once started; before
      // kickoff the projection rides the note line instead ("Proj 108.3").
      rowFigure: scheduled ? '' : score,
      // Desktop note: the record, then Expected final and Players remaining
      // until the Matchup is settled (a settled game has a score, not a
      // forecast).
      note: settled ? joinNote([record]) : joinNote([record, `EF ${ef}`, `PMR ${pmr}`]),
      rowNote: settled
        ? joinNote([record])
        : scheduled
          ? joinNote([record, `Proj ${ef}`])
          : joinNote([record, `EF ${ef}`, `PMR ${pmr}`]),
      leads,
      check: leads && settled,
    };
  };

  return {
    id: m.id ?? null,
    week: m.week ?? null,
    status,
    chipLabel,
    chipVariant: status === 'live' ? 'live' : 'neutral',
    started,
    scheduled,
    headerNote,
    footer,
    homeShare: probability ? probability.home : null,
    homePct,
    awayPct,
    home: side(home, homeLeads),
    away: side(away, awayLeads),
  };
}

export default matchupCardView;
