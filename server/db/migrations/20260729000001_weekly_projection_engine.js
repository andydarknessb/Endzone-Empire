/**
 * Weekly Start/Sit Projection Engine v2 (`free_baseline_v2`).
 *
 * Everything here is ADDITIVE and reversible. The existing
 * `player_projections` table (a flat player/season/week -> points cache with
 * no scoring or model identity) is deliberately left in place: several
 * consumers still read it through projection.service's backward-compatible
 * adapter, and this migration must not change a single number they see.
 *
 * 1. `projection_runs` + `player_week_projections` are the versioned cache for
 *    the new engine. A run is identified by (season, week, scoring_hash,
 *    model_version) so a projection produced for one league's scoring profile
 *    can never be served to a league scoring the same players differently, and
 *    a model upgrade cannot silently reuse the previous model's numbers.
 *    `input_cutoff` records the wall-clock instant the feature set was frozen
 *    at, so a stored row is auditable against the "no future information"
 *    rule; `source_coverage` records which inputs actually contributed (and
 *    which were unavailable) rather than letting the UI guess.
 *
 * 2. `nfl_games` gains nullable game-context columns. The schedule syncs
 *    already SEE home/away orientation, venue, roof, surface and rest days and
 *    throw them away; storing them costs nothing and unlocks the home/away and
 *    weather factors. Every column is nullable with no backfill: existing rows
 *    stay exactly as they are and fill in naturally on the next sync. Lineup
 *    locks read only `kickoff_at`, which is untouched.
 *
 *    `game_key` is the stable both-perspectives identifier
 *    (`2026_03_BUF_MIA`, nflverse's own game_id spelling, away-then-home) —
 *    the two per-team rows of one game share it, which is what lets a weather
 *    snapshot be fetched once per GAME instead of once per team.
 *
 *    Latitude/longitude are intentionally left null: no authoritative stadium
 *    coordinate source is wired up, and a fabricated coordinate would silently
 *    produce a confident, wrong forecast. Weather stays unavailable until real
 *    coordinates exist (see nwsWeather.service.js).
 *
 * 3. `game_weather_snapshots` caches one NWS hourly forecast period per game
 *    per horizon bucket. Keyed by `game_key` + `horizon_hours` so the forecast
 *    fetched five days out and the one fetched two hours before kickoff are
 *    separate rows rather than one overwriting the other.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('projection_runs', (t) => {
    t.increments('id').primary();
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    // Hex digest of a canonical serialization of the league's effective
    // scoring rules. Fixed width, so a cache lookup is an equality test.
    t.string('scoring_hash', 64).notNullable();
    t.string('model_version', 32).notNullable();
    t.timestamp('input_cutoff', { useTz: true }).notNullable();
    t.jsonb('source_coverage').notNullable().defaultTo('{}');
    t.timestamp('generated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
    t.unique(['season', 'week', 'scoring_hash', 'model_version']);
    t.index(['season', 'week']);
  });

  await knex.schema.createTable('player_week_projections', (t) => {
    t.increments('id').primary();
    t.integer('run_id').notNullable().references('projection_runs.id').onDelete('CASCADE');
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    // Every quantile is nullable: a player with no usable evidence is stored
    // as an explicit "we have no projection" row rather than a fabricated 0,
    // which is also what makes a partial cache detectable (a requested player
    // with NO row at all means the run must be regenerated).
    t.decimal('mean', 8, 2);
    t.decimal('median', 8, 2);
    t.decimal('p10', 8, 2);
    t.decimal('p25', 8, 2);
    t.decimal('p75', 8, 2);
    t.decimal('p90', 8, 2);
    // NULL means "genuinely uncertain" (Questionable/Doubtful with no
    // active-probability data source), not "zero chance of playing".
    t.decimal('active_probability', 4, 3);
    t.string('confidence', 8).notNullable().defaultTo('low');
    t.integer('sample_size').notNullable().defaultTo(0);
    t.jsonb('factors').notNullable().defaultTo('{}');
    t.timestamps(true, true);
    t.unique(['run_id', 'player_id']);
    t.index(['player_id']);
  });

  await knex.schema.alterTable('nfl_games', (t) => {
    t.string('game_key', 32);
    t.string('home_away', 4); // 'home' | 'away' from this row's team's view
    t.boolean('neutral_site');
    t.string('venue', 120);
    t.string('roof', 24); // 'dome' | 'closed' | 'open' | 'outdoors' (source vocabulary)
    t.string('surface', 32);
    t.decimal('latitude', 8, 5);
    t.decimal('longitude', 9, 5);
    t.integer('rest_days');
    t.index(['season', 'week', 'game_key']);
  });

  await knex.schema.createTable('game_weather_snapshots', (t) => {
    t.increments('id').primary();
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('game_key', 32).notNullable();
    // Which forecast-lead-time bucket this snapshot belongs to, so a 5-day-out
    // forecast never overwrites the near-kickoff one.
    t.integer('horizon_hours').notNullable();
    t.timestamp('fetched_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('forecast_time', { useTz: true });
    t.decimal('temperature_f', 6, 2);
    t.decimal('wind_speed_mph', 6, 2);
    t.decimal('wind_gust_mph', 6, 2);
    t.integer('precipitation_probability');
    t.string('short_forecast', 120);
    t.timestamps(true, true);
    t.unique(['game_key', 'horizon_hours']);
    t.index(['season', 'week']);
  });

  // Defense in depth on the shared Supabase project: the app connects as the
  // tables' owner and bypasses RLS, so enabling it costs nothing here while
  // denying anon/authenticated PostgREST access by default.
  await knex.raw('ALTER TABLE "projection_runs" ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE "player_week_projections" ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE "game_weather_snapshots" ENABLE ROW LEVEL SECURITY');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('game_weather_snapshots');
  await knex.schema.alterTable('nfl_games', (t) => {
    t.dropColumn('game_key');
    t.dropColumn('home_away');
    t.dropColumn('neutral_site');
    t.dropColumn('venue');
    t.dropColumn('roof');
    t.dropColumn('surface');
    t.dropColumn('latitude');
    t.dropColumn('longitude');
    t.dropColumn('rest_days');
  });
  await knex.schema.dropTableIfExists('player_week_projections');
  await knex.schema.dropTableIfExists('projection_runs');
};
