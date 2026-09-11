/**
 * Situation on live_game_states (#1233, ADR 0037).
 *
 * The 30-second scoreboard poll already reads ESPN's `competitions[].status`
 * for the clock; it now also reads `competitions[].situation` (possession,
 * down and distance text, red zone flag, last play text) into four nullable
 * columns on the same row, so a manager watching a live Game cell on Lineup
 * sees the Situation from the same Realtime push that already carries the
 * clock and score.
 *
 * All four are nullable and cleared together: a game that is final (or any
 * status other than in progress), or an in-progress game whose situation
 * block is momentarily absent (a timeout, halftime), writes all four as
 * null in the same upsert that writes game_status, so a stale down and
 * distance never outlives its play.
 *
 * `possession` is a Team code (server/modules/espnScoreboard.js's own
 * normalisation, the same one applied to home_team/away_team), never ESPN's
 * raw spelling — see #1136 and CONTEXT.md's Team code entry.
 *
 * live_game_states is the anon Realtime surface (ADR 0009); these columns
 * widen what an existing table carries, not who may read it, so no grant,
 * policy or publication change belongs in this migration (the table-level
 * SELECT grant and the whole-table publication already cover them).
 *
 * MIGRATIONS ARE A CARVE-OUT: applied and verified against knex_migrations
 * in its own batch, one migration cycle at a time, by the maintainer.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('live_game_states', (t) => {
    t.string('possession', 10); // Team code, folded through espnAbbrToOurs — never ESPN's raw spelling
    t.string('down_distance', 40); // e.g. '1st & 10' — display text, not parsed further
    t.boolean('is_red_zone');
    t.text('last_play');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('live_game_states', (t) => {
    t.dropColumn('possession');
    t.dropColumn('down_distance');
    t.dropColumn('is_red_zone');
    t.dropColumn('last_play');
  });
};
