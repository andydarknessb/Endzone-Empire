/**
 * Real-time NFL game clock/status (quarter, time remaining, live score) —
 * distinct from:
 *  - nfl_games: schedule only (one row per NFL team per week, no live state)
 *  - matchups: fantasy head-to-head scoring (home_team_id/away_team_id are
 *    this app's own `teams`, not NFL teams)
 * Populated by server/modules/liveGameEngine.js, an adaptive-cadence worker
 * polling Tank01. Also the first table in this app read directly by the
 * browser via Supabase Realtime (`postgres_changes`) rather than the
 * Express API — see server/db/sql/2026-07-19-live-game-states-rls-realtime.sql
 * for the RLS policy and publication change that makes that possible.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('live_game_states', (t) => {
    t.increments('id').primary();
    t.string('tank01_game_id', 40).notNullable().unique(); // Tank01's own gameID
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('home_team', 60).notNullable(); // free-text NFL abbreviation
    t.string('away_team', 60).notNullable();
    t.enu('game_status', ['scheduled', 'in_progress', 'final'], {
      useNative: true,
      enumName: 'game_status_type',
    }).notNullable().defaultTo('scheduled');
    t.timestamp('start_time', { useTz: true });
    t.integer('current_score_home').notNullable().defaultTo(0);
    t.integer('current_score_away').notNullable().defaultTo(0);
    t.string('quarter', 10); // Tank01's own vocabulary, stored as-is
    t.string('time_remaining', 10); // clock string as Tank01 reports it, not parsed
    t.timestamp('last_updated', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
    t.index(['season', 'week']);
    t.index('game_status');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('live_game_states');
  await knex.raw('DROP TYPE IF EXISTS "game_status_type"');
};
