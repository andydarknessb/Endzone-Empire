/**
 * `espn_event_id` on live_game_states (#1182, ADR 0035).
 *
 * The Live box is read from ESPN's summary endpoint, which is keyed by ESPN's
 * event id. The scoreboard normaliser (modules/espnScoreboard.js) carries the
 * id through and the engine's upsert writes it; a Tank01 fallback row has no
 * ESPN id and leaves the stored value in place (COALESCE in the upsert), so the
 * column survives a worker restart mid-game and a fallback is debuggable from
 * the table. Nullable: a row minted by the Tank01 clock path has none until
 * ESPN next reports the game.
 *
 * live_game_states is the anon-readable Realtime surface (ADR 0009); this is a
 * public id on an existing relation and adds nothing to that surface.
 *
 * MIGRATIONS ARE A CARVE-OUT: applied and verified against knex_migrations in
 * its own batch before the ESPN adapter that reads the column ships.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('live_game_states', (t) => {
    t.string('espn_event_id', 20);
    t.index('espn_event_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('live_game_states', (t) => {
    t.dropIndex('espn_event_id');
    t.dropColumn('espn_event_id');
  });
};
