import { formatKickoff, unavailableLabel } from '../../../shared/lib';

/**
 * The Ledger row's Game cell (CONTEXT.md's Game cell; ADR 0037; #1237 AC2):
 * "where the player's NFL game stands this week: before kickoff the opponent
 * and kickoff [...]; during the game the clock, score and situation; after
 * it the final score. An Unavailable player's Game cell carries the reason
 * instead."
 *
 * This ticket ships the pre-kickoff and final states plus a PLACEHOLDER live
 * state (clock and score only, no Situation - the down/distance/red-zone
 * columns ADR 0037 adds to `live_game_states` are ticket 9's). `liveRow` is
 * one row of that table, read by the widget's model through the Matchup
 * entity's `useLiveGameStates` (keyed by the entry's own `gameKey`, #1235);
 * a null/absent row (the poll has not landed yet, or Supabase is
 * unreachable) degrades to the pre-kickoff view rather than blocking on it.
 *
 * Returns one of:
 *   - `{ kind: 'unavailable', reason }` - entry.availability.available is
 *     false (on bye, out, on IR). Takes priority over every other state: an
 *     unavailable player's own game state is not the point of this cell.
 *   - `{ kind: 'pre', opponent, kickoff }` - opponent is a Team code or
 *     null (a bye or an unsynced slate, CONTEXT.md's opponent), kickoff is
 *     already formatted ("Sun 1:00 PM") or null.
 *   - `{ kind: 'live', trailing, teamScore, opponentScore, possession,
 *     downDistance, redZone, lastPlay }` - trailing is "Q3 6:42" when both
 *     are known, else "Live"; either score is null when the row cannot be
 *     matched to the entry's own NFL team. The four Situation fields
 *     (CONTEXT.md's Situation; ADR 0037's `live_game_states` columns added
 *     for this ticket) are passed through exactly as `home_team`/`away_team`
 *     already are: `possession` arrives already folded to a Team code by
 *     the same server-side normalisation (never re-derived here, AC4),
 *     `downDistance` and `lastPlay` are the feed's own text or null, and
 *     `redZone` always coerces to a real boolean.
 *   - `{ kind: 'final', teamScore, opponentScore }`.
 */
export function gameCellView(entry, liveRow) {
  if (!entry) return null;
  if (entry.availability && entry.availability.available === false) {
    return { kind: 'unavailable', reason: entry.availability.reason, reasonLabel: unavailableLabel(entry.availability.reason) };
  }

  const status = liveRow ? liveRow.game_status : null;
  if (status === 'final') {
    const { teamScore, opponentScore } = scoresFor(entry, liveRow);
    return { kind: 'final', teamScore, opponentScore };
  }
  if (status === 'in_progress') {
    const trailing = `${liveRow.quarter || ''} ${liveRow.time_remaining || ''}`.trim() || 'Live';
    const { teamScore, opponentScore } = scoresFor(entry, liveRow);
    return {
      kind: 'live',
      trailing,
      teamScore,
      opponentScore,
      possession: liveRow.possession ?? null,
      downDistance: liveRow.down_distance ?? null,
      redZone: Boolean(liveRow.is_red_zone),
      lastPlay: liveRow.last_play ?? null,
    };
  }
  return { kind: 'pre', opponent: entry.opponent, kickoff: formatKickoff(entry.kickoff) };
}

// A finite score, or null (an absent row, a non-numeric value, or a team
// code that matches neither side - never a guess).
function scoresFor(entry, row) {
  const home = Number(row.current_score_home);
  const away = Number(row.current_score_away);
  if (row.home_team === entry.nflTeam) {
    return { teamScore: numOrNull(home), opponentScore: numOrNull(away) };
  }
  if (row.away_team === entry.nflTeam) {
    return { teamScore: numOrNull(away), opponentScore: numOrNull(home) };
  }
  return { teamScore: null, opponentScore: null };
}

function numOrNull(n) {
  return Number.isFinite(n) ? n : null;
}

export default gameCellView;
