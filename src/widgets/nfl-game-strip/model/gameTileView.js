/**
 * The per-tile read of one `live_game_states` row (ticket #901): a pure
 * function from the row the Matchup entity hands down (`model.games`, #885)
 * to the three-part tile the strip renders. The presenter renders exactly
 * this shape and reads no column name of its own, so the wire's vocabulary
 * (Tank01's `game_status` enum, its quarter and clock strings) lives here.
 *
 * A row's `game_status` is one of `scheduled`, `in_progress` or `final`
 * (the `game_status_type` enum, server/db/migrations/20260719000002). The
 * tile's `state` maps them to `scheduled`, `live` and `final`; a value outside
 * the enum (null, or a skewed server) reads as `scheduled`, the one state that
 * asserts nothing about a score.
 *
 * The three states, as the strip shows them:
 *   - live:      a live dot, "AWAY score - HOME score", then the quarter and
 *                clock as Tank01 reports them ("Q3 6:42"), or LIVE when the row
 *                has no clock yet.
 *   - scheduled: a clock glyph, "AWAY @ HOME" with NO scores (a scheduled
 *                game's 0 - 0 is a column default, not a result), then the
 *                kickoff time when the row carries one.
 *   - final:     no glyph, the final score, then FINAL.
 *
 * A score label is the team code THEN its score on BOTH sides ("GB 17 - TB
 * 20"), the away side first: that is the canvas's shape (build.mjs nflStrip()
 * prints `${g.a} ${g.as}` - `${g.b} ${g.bs}`, and the Scoreboard view's Games
 * tile the same). The legacy per-game status strip this widget replaced
 * mirrored the home side ("GB 17 - 20 TB"); that form is not the kit's and
 * is not rendered here.
 *
 * Kickoff: the row's `kickoff_at` when present, else the table's own
 * `start_time` column (the name the migration gives it; the entity reads the
 * row as `select('*')`, so that is the name a real row arrives under). Either
 * is an ISO timestamp; the tile shows it as a clock time in the viewer's zone.
 */

const TIME_FORMAT_OPTIONS = { hour: 'numeric', minute: '2-digit' };

/**
 * A kickoff instant as a clock time in the viewer's own zone ("7:20 PM"), or
 * null when the value is absent or not a date. `timeZone` is optional and
 * exists so a test can pin a zone; production callers omit it and get the
 * browser's own zone via Intl's runtime default.
 */
export function formatKickoffTime(dateLike, timeZone) {
  if (dateLike == null || dateLike === '') return null;
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const options = timeZone ? { ...TIME_FORMAT_OPTIONS, timeZone } : TIME_FORMAT_OPTIONS;
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function tileState(gameStatus) {
  if (gameStatus === 'in_progress') return 'live';
  if (gameStatus === 'final') return 'final';
  return 'scheduled';
}

// A score as the tile prints it: the number when the row carries one, nothing
// when it does not (the column is NOT NULL DEFAULT 0, so a real row always
// has one; this only keeps a partial fixture from printing "NaN").
function scoreText(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : null;
}

/**
 * @param {object} row  one live_game_states row
 * @param {{ timeZone?: string }} [options]  a zone to pin the kickoff time to (tests)
 * @returns {{
 *   key: string, state: 'live'|'scheduled'|'final',
 *   away: string, home: string,
 *   awayLabel: string, homeLabel: string, separator: '-'|'@',
 *   trailing: string|null, kickoffAt: string|null,
 * }}
 */
export function gameTileView(row, { timeZone } = {}) {
  const r = row || {};
  const state = tileState(r.game_status);
  const away = String(r.away_team ?? '');
  const home = String(r.home_team ?? '');
  const awayScore = scoreText(r.current_score_away);
  const homeScore = scoreText(r.current_score_home);
  const kickoffAt = r.kickoff_at ?? r.start_time ?? null;

  let trailing = null;
  if (state === 'live') {
    trailing = `${r.quarter || ''} ${r.time_remaining || ''}`.trim() || 'LIVE';
  } else if (state === 'final') {
    trailing = 'FINAL';
  } else {
    trailing = formatKickoffTime(kickoffAt, timeZone);
  }

  const showScores = state !== 'scheduled';
  return {
    key: r.tank01_game_id != null ? String(r.tank01_game_id) : `${away}@${home}`,
    state,
    away,
    home,
    awayLabel: showScores && awayScore != null ? `${away} ${awayScore}` : away,
    homeLabel: showScores && homeScore != null ? `${home} ${homeScore}` : home,
    separator: showScores ? '-' : '@',
    trailing,
    kickoffAt,
  };
}

export default gameTileView;
