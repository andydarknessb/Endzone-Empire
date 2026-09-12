/**
 * Record, Venue, Broadcast, win probability, linescores and headline on
 * `live_game_states` (#1262, ADR 0038: Pick'em joins the island).
 *
 * Ten nullable columns, no new table (#1233 already added Situation to this
 * same row; this widens it further, not who may read it — see that
 * migration's own note on the anon Realtime surface, ADR 0009).
 *
 * Split by writer, per ADR 0038's ruling:
 *  - venue_name/venue_city/is_indoor/is_neutral_site/broadcast/home_record/
 *    away_record: written by the hourly game-context Sync run
 *    (services/gameContextSync.service.js) from `competitions[0].venue`,
 *    `competitions[0].neutralSite`, `competitions[0].broadcasts[]` and
 *    `competitors[].records[]`.
 *  - home_win_probability: folded into Situation (CONTEXT.md) and written by
 *    the thirty-second poll alongside possession/down_distance/is_red_zone/
 *    last_play, from `situation.lastPlay.probability.homeWinPercentage`.
 *  - linescores/headline: also written by the thirty-second poll, but only
 *    once a game is final (`competitors[].linescores[].value`,
 *    `competitions[0].headlines[0].shortLinkText`).
 *
 * home_record/away_record are jsonb `{ total, home, road }` (CONTEXT.md's
 * Record: three cuts, each a "W-L" string) rather than three columns apiece,
 * since they are always read and written together as one team's Record.
 * linescores is one jsonb `{ home: [...], away: [...] }` rather than two
 * columns, for the same reason — the two sides' per-quarter arrays are one
 * Situation-adjacent fact about the game, not two independent ones.
 * home_win_probability is decimal(4,3): CONTEXT.md's Situation puts it in
 * 0..1, and 3 decimal places matches ESPN's own precision (weekly_projection_
 * engine.js's active_probability sets the same precedent for a 0..1 field).
 *
 * ADR 0035's boundary holds: nothing here reads a box score or play-by-play,
 * only the free scoreboard both existing writers already poll.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('live_game_states', (t) => {
    t.text('venue_name');
    t.text('venue_city');
    t.boolean('is_indoor');
    t.boolean('is_neutral_site');
    t.text('broadcast');
    t.jsonb('home_record');
    t.jsonb('away_record');
    t.decimal('home_win_probability', 4, 3);
    t.jsonb('linescores');
    t.text('headline');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('live_game_states', (t) => {
    t.dropColumn('venue_name');
    t.dropColumn('venue_city');
    t.dropColumn('is_indoor');
    t.dropColumn('is_neutral_site');
    t.dropColumn('broadcast');
    t.dropColumn('home_record');
    t.dropColumn('away_record');
    t.dropColumn('home_win_probability');
    t.dropColumn('linescores');
    t.dropColumn('headline');
  });
};
