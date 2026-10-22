import { matchupBoard } from '../../../entities/matchup';
import { formatKickoff, formatPoints, finite } from '../../../shared/lib';
import { lookupRecord } from '../lib/records';

/**
 * The per-tile view of one Matchup for the League matchups grid (ticket #894, restyled for ADR 0067
 * wave 2): everything a tile or a phone row prints, derived once from the entity model so the two
 * layouts read the same numbers and copy and the UI stays a thin presenter. Pure: no render, no fetch.
 *
 * `state` is the server's status fact through the entity's `matchupBoard` (ADR 0030): 'live' (Board
 * black), 'scheduled' (the framed tile with "Proj" figures), 'played' (every starter done, "Awaiting
 * final") or 'final' (the winner in ink, no bar), and 'unknown' for a status the entity does not know,
 * which asserts neither a score state nor a probability: the stored scores show and nothing else.
 *
 * Win probability is the entity board's (#2142): the live figure while started, the projections-only
 * figure before kickoff. A final tile prints no probability (its score is the result). `favourite` is
 * the side the bar favours, for the phone row's "62% Blitz Brigade".
 *
 * Players remaining is the server's count (RULINGS Critique 9, spec #2334 AC 6l: starters whose game is
 * not final, Out starters and empty slots excluded), the same field the hero reads, so a team prints one
 * number wherever it appears. Before kickoff the line reads "{n} starters set to play".
 */

/** Players remaining as a whole number, or a dash when unknown. */
export function formatCount(value) {
  const n = finite(value);
  return n != null ? String(n) : '-';
}

const remainingLine = (n, scheduled) => {
  const c = finite(n);
  if (c == null) return '';
  if (scheduled) return `${c} ${c === 1 ? 'starter' : 'starters'} set to play`;
  return `${c} ${c === 1 ? 'player' : 'players'} remaining`;
};

export function matchupCardView(matchup, { records, timeZone, locale, viewerTeamId } = {}) {
  const m = matchup || {};
  const board = matchupBoard(m, viewerTeamId);
  const { first, second } = board;
  const { chip, settled } = board;
  const started = board.hasStarted === true;
  const scheduled = board.hasStarted === false;
  const state = board.isLive ? 'live' : scheduled ? 'scheduled' : board.isFinal ? 'final' : settled ? 'played' : 'unknown';

  const firstScore = Number(first.score) || 0;
  const secondScore = Number(second.score) || 0;
  const firstLeads = started && firstScore > secondScore;
  const secondLeads = started && secondScore > firstScore;

  // No bar without both Expected finals: the forecast has nothing to price from (QA ruling, spec #2334).
  const priced = finite(first.expectedFinal) != null && finite(second.expectedFinal) != null;
  const probability = !priced || state === 'final' || state === 'played' || state === 'unknown'
    ? null
    : (board.winProbability ?? board.projectedWinProbability);
  const firstPct = probability ? Math.round(probability.first * 100) : null;
  const secondPct = probability ? 100 - firstPct : null;
  const favourite = probability ? (firstPct >= 50 ? 'first' : 'second') : null;

  const kickoff = scheduled ? formatKickoff(m.firstKickoffAt, { timeZone, locale }) : null;

  const side = (s, leads) => {
    const ef = formatPoints(s.expectedFinal);
    return {
      teamId: s.teamId ?? null,
      name: s.name ?? '',
      avatarUrl: s.avatarUrl ?? null,
      avatarStaticUrl: s.avatarStaticUrl ?? null,
      record: lookupRecord(records, s.teamId),
      // The big number: the score once started (and on an unknown status, a stored fact), the projected
      // total before kickoff (the column is headed "Proj").
      figure: scheduled ? ef : formatPoints(s.score),
      // Line two while live ("Exp final 118.0"), then the players remaining line; a settled game has a
      // score, not a forecast.
      expectedLine: state === 'live' ? `Exp final ${ef}` : '',
      remainingLine: state === 'live' || scheduled ? remainingLine(s.playersRemaining, scheduled) : '',
      leads,
      // A final tile's winner in ink; every other side of a settled tile is dim.
      winner: state === 'final' && leads,
    };
  };

  return {
    id: m.id ?? null,
    week: m.week ?? null,
    status: m.status ?? null,
    state,
    chipLabel: chip?.label ?? null,
    started,
    scheduled,
    kickoff,
    kickoffAt: scheduled ? (m.firstKickoffAt ?? null) : null,
    firstShare: probability ? probability.first : null,
    firstPct,
    secondPct,
    favourite,
    first: side(first, firstLeads),
    second: side(second, secondLeads),
  };
}

export default matchupCardView;
