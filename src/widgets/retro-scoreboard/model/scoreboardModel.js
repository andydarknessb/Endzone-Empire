import { matchupStatusView } from '../../../entities/matchup';

/**
 * Pure presentation arithmetic for the retro-scoreboard widget (ADR 0031,
 * #902): every number the LED board, the field and the two cards print is
 * derived here from the Matchup entity, the paired rows and the live game
 * rows, so the renders stay thin and this module is table-testable without a
 * DOM. Nothing here reads the wire; the entity already spelled the Matchup.
 */

// How far into the field (a 0..1 fraction of the playing surface between the
// two end zones) each sprite sits at homeProb 0 and 1, transcribed from the
// design canvas (docs/design/game-center-matchups/build.mjs, retroField()):
// the home runner leads and the away defender trails by eight yards, both
// moving toward the away end zone as the home side's chances rise. Neither
// ever reaches a goal line, so a sprite stays visible in a probability
// blowout.
export const HOME_MIN = 0.08;
export const AWAY_MIN = 0.16;
export const SPAN = 0.76;

/**
 * The home win probability as the widget uses it: clamped to 0..1, and flagged
 * `known` only when the page handed a finite number. An unknown probability
 * (a Matchup the server has not priced) parks the sprites at midfield and
 * blanks the board's WIN row rather than printing a guessed 50-50 (ADR 0030's
 * sibling rule: an unknown is not a value).
 */
export function homeProbability(homeProb) {
  const n = Number(homeProb);
  const known = homeProb != null && homeProb !== '' && Number.isFinite(n);
  return { value: known ? Math.max(0, Math.min(1, n)) : 0.5, known };
}

/** Each sprite's position as a fraction of the playing surface, 0 at the home goal line. */
export function spritePositions(prob) {
  return { home: HOME_MIN + SPAN * prob, away: AWAY_MIN + SPAN * prob };
}

/** A fantasy score for the LED face: always one decimal, a missing score reads 0.0. */
export function ledScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : '0.0';
}

/**
 * A figure for the LED face's second row. Null (the server did not compute
 * it: a final Matchup's Expected final, an unpriced week) reads as a single
 * hyphen, never a zero that would claim a value.
 */
export function ledFigure(value, decimals = 1) {
  if (value == null || value === '') return '-';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : '-';
}

/** Both sides' win percentages for the board's WIN row; the away share is the complement. */
export function ledPercents(homeProb) {
  const { value, known } = homeProbability(homeProb);
  if (!known) return { home: '-', away: '-' };
  const home = Math.round(value * 100);
  return { home: `${home}%`, away: `${100 - home}%` };
}

/** The entity's one status label (ADR 0030), uppercased for the LED face; blank when unknown. */
export function ledStatus(status) {
  return (matchupStatusView(status).chipLabel || '').toUpperCase();
}

/**
 * Whether the Matchup has started, read through the entity's one predicate
 * (ADR 0030) and gated on `hasStarted === true` exactly as the Standard view's
 * scoreboard strip gates its bar (#903 review): a scheduled Matchup (false)
 * and a status the server could not compute (null) both read as not started,
 * so the board prints no WIN digits and the field parks the sprites at the
 * neutral midpoint rather than painting a probability the page cannot stand
 * behind.
 */
export function matchupHasStarted(status) {
  return matchupStatusView(status).hasStarted === true;
}

// The reason an Unavailable player (CONTEXT.md, Roster and lineup) shows in
// place of his projection, in the Lineup page's words; null for an available
// row (or a row that carries no verdict), which shows its projection as ever.
// The same rule as the legacy MatchupExtras.unavailableLabel, copied here
// rather than imported because that page leaves the tree with #903 (ADR 0031)
// and a widget never depends on a page.
const UNAVAILABLE_LABELS = { bye: 'on bye', out: 'out', ir: 'on IR' };
export function unavailableLabel(availability) {
  if (!availability || availability.available !== false) return null;
  return UNAVAILABLE_LABELS[availability.reason] || 'out';
}

// Position -> `pos-*` palette key for the headshot ring (design canvas
// headshot(): every 28px headshot wears a 2px ring in its position's color),
// the same map the app's PositionChip uses for its fills, so the ring and the
// avatar's own initials fill always agree. Unknown reads as the neutral DEF
// gray, exactly as PlayerAvatar's fallback fill does; the slot-comparison
// widget rings its headshots by the same table.
const POSITION_KEYS = {
  QB: 'qb', RB: 'rb', WR: 'wr', TE: 'te', K: 'k', DEF: 'def', 'D/ST': 'def', DST: 'def',
  DL: 'idp', DE: 'idp', DT: 'idp', NT: 'idp',
  LB: 'idp', ILB: 'idp', OLB: 'idp',
  DB: 'idp', CB: 'idp', S: 'idp', FS: 'idp', SS: 'idp',
};

/** The `pos-*` palette key for a lineup headshot's ring. */
export function positionRingKey(position) {
  return POSITION_KEYS[String(position || '').toUpperCase()] || 'def';
}

/**
 * The parts of a lineup row's second line: the player's points to one
 * decimal, then EITHER his projection ("proj 19.2") or, for an Unavailable
 * player, the reason ("on bye"). A player with no projection priced has
 * neither. The card joins the parts on a middot (house style).
 */
export function lineupNoteParts(player) {
  const points = ledScore(player.points);
  const reason = unavailableLabel(player.availability);
  if (reason) return { points, reason, projected: null };
  if (player.projected == null) return { points, reason: null, projected: null };
  return { points, reason: null, projected: ledScore(player.projected) };
}

/** The second line of a lineup row as one string: "18.6 · proj 19.2", "0.0 · on bye", or "4.2". */
export function lineupNote(player) {
  const { points, reason, projected } = lineupNoteParts(player);
  if (reason) return `${points} · ${reason}`;
  if (projected != null) return `${points} · proj ${projected}`;
  return points;
}

/**
 * A live_game_states row's state in the widget's vocabulary. `game_status` is
 * one of `scheduled`, `in_progress` or `final` (the `game_status_type` enum);
 * a value outside it (null, a skewed server) reads as `scheduled`, the one
 * state that asserts nothing about a score.
 */
export function gameState(game) {
  if (!game) return 'scheduled';
  if (game.game_status === 'in_progress') return 'live';
  if (game.game_status === 'final') return 'final';
  return 'scheduled';
}

/**
 * The score line for one game row: "DEN 10 - 17 KC" once it has started (away
 * first, the order the wire and the nfl-game-strip widget both use; a hyphen
 * scores, house style), "DEN @ KC" before kickoff, when a score would be a
 * false zero.
 */
export function gameLine(game) {
  const away = game.away_team || '';
  const home = game.home_team || '';
  if (gameState(game) === 'scheduled') return `${away} @ ${home}`;
  const as = game.current_score_away ?? 0;
  const hs = game.current_score_home ?? 0;
  return `${away} ${as} - ${hs} ${home}`;
}

/**
 * A kickoff instant as a clock time in the viewer's own zone ("7:20 PM", the
 * design's Games tile and the nfl-game-strip widget's format); null when the
 * row carries no usable start time. `timeZone` exists so a test can pin a zone.
 */
export function formatKickoff(iso, timeZone) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const options = { hour: 'numeric', minute: '2-digit' };
  if (timeZone) options.timeZone = timeZone;
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

/**
 * The clock cell for one game row: quarter and time while in progress ("Q3
 * 6:42", or LIVE before the feed has a clock), FINAL once over, and the
 * kickoff time before it starts (the row's `kickoff_at`, else the table's own
 * `start_time`; TBD when it carries neither).
 */
export function gameClock(game) {
  const state = gameState(game);
  if (state === 'live') {
    return `${game.quarter || ''} ${game.time_remaining || ''}`.trim() || 'LIVE';
  }
  if (state === 'final') return 'FINAL';
  return formatKickoff(game.kickoff_at ?? game.start_time) || 'TBD';
}

/** How many of the rows are in progress, for the Games tile's count. */
export function liveCount(games) {
  return (games || []).filter((g) => gameState(g) === 'live').length;
}
