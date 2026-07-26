/**
 * League Pick'em: a members-only side game inside an existing fantasy league.
 * Everyone picks NFL game winners each week, picks lock at kickoff, and the
 * league gets weekly + season standings.
 *
 * Two tables, deliberately separate from `leagues`:
 *
 * - `pickem_settings` is per-league config. A MISSING ROW MEANS THE FEATURE IS
 *   OFF, so no backfill is needed and a league that never turns Pick'em on
 *   carries zero footprint. Kept off `leagues` because that row is read on
 *   nearly every request — adding two rarely-read columns to it would bloat a
 *   hot row for a feature most leagues won't enable. `mode` is CHECK-
 *   constrained rather than an enum type so future modes are a one-line
 *   migration instead of an ALTER TYPE.
 *
 * - `pickem_picks` is one row per (league, user, season, week, game). The game
 *   is identified by `team_pair` — the two teams' canonical abbreviations,
 *   uppercased, sorted, joined with '|' (e.g. 'BUF|MIA') — because `nfl_games`
 *   stores one row per team per week and carries no game id at all. The same
 *   unordered-pair key already ties ESPN's scoreboard back to our schedule in
 *   modules/espnScoreboard.js (`resolveGameIds`). `live_game_states` supplies
 *   home/away order and scores when it has rows, but it is an OPPORTUNISTIC
 *   overlay only: the slate and the kickoff locks come from `nfl_games`, which
 *   is populated for the whole season well before any live rows exist.
 *   `picked_team` is stored already normalized (validation only accepts values
 *   the derived slate produced, and the slate is normalized in SQL through
 *   fn_normalize_nfl_team), so WSH/WAS and full-name DEF vocabulary can never
 *   land here.
 *
 * `confidence` is NULL in straight-up mode and 1..slateSize in confidence
 * mode. The column stays nullable in both directions so a league can be
 * switched between modes before any picks exist; once the current season has
 * picks, the service refuses a mode change (409 PICKEM_MODE_LOCKED).
 */
exports.up = async function (knex) {
  await knex.schema.createTable('pickem_settings', (t) => {
    t.integer('league_id').primary().references('leagues.id').onDelete('CASCADE');
    t.boolean('enabled').notNullable().defaultTo(false);
    t.string('mode', 12).notNullable().defaultTo('straight');
    t.timestamps(true, true);
  });
  await knex.raw(
    `ALTER TABLE "pickem_settings"
       ADD CONSTRAINT "pickem_settings_mode_check"
       CHECK ("mode" IN ('straight', 'confidence'))`
  );

  await knex.schema.createTable('pickem_picks', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('team_pair', 16).notNullable();
    t.string('picked_team', 6).notNullable();
    t.smallint('confidence'); // NULL in straight-up mode
    t.timestamps(true, true);
    t.unique(['league_id', 'user_id', 'season', 'week', 'team_pair']);
    t.index(['league_id', 'season', 'week']);
  });

  // Defense in depth on the shared Supabase project: the app connects as the
  // tables' owner and bypasses RLS, so enabling it costs nothing here while
  // denying anon/authenticated PostgREST access by default.
  await knex.raw('ALTER TABLE "pickem_settings" ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE "pickem_picks" ENABLE ROW LEVEL SECURITY');
};

exports.down = async function (knex) {
  // Picks first — nothing references them, but keep the drop order the mirror
  // image of the create order.
  await knex.schema.dropTableIfExists('pickem_picks');
  await knex.schema.dropTableIfExists('pickem_settings');
};
