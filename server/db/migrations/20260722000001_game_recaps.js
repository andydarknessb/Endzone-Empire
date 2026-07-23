/**
 * Versioned, server-only NFL game recap storage.
 *
 * This migration is intentionally self-contained: its version defaults are
 * frozen here so a future application-version bump cannot change the schema
 * produced when a fresh database replays historical migrations.
 */
const PRIVATE_SCHEMA = 'private';
const RECAPS_TABLE = 'game_recaps';
const INITIAL_DATA_VERSION = 1;
const INITIAL_GENERATOR_VERSION = '1.0.0';

exports.up = async function (knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS ??', [PRIVATE_SCHEMA]);

  await knex.schema.withSchema(PRIVATE_SCHEMA).createTable(RECAPS_TABLE, (table) => {
    table.increments('id').primary();
    table.string('tank01_game_id', 40).notNullable().unique();
    table.integer('season').notNullable();
    table.integer('week').notNullable();
    table.string('home_team', 60).notNullable();
    table.string('away_team', 60).notNullable();
    table.integer('home_score').notNullable().defaultTo(0);
    table.integer('away_score').notNullable().defaultTo(0);
    table.timestamp('final_at', { useTz: true });
    table.jsonb('data').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.integer('data_version').notNullable().defaultTo(INITIAL_DATA_VERSION);
    table.string('generator_version', 40).notNullable().defaultTo(INITIAL_GENERATOR_VERSION);
    table.timestamp('generated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(
    `ALTER TABLE ??.??
       ADD CONSTRAINT "game_recaps_season_positive" CHECK ("season" > 0),
       ADD CONSTRAINT "game_recaps_week_positive" CHECK ("week" > 0),
       ADD CONSTRAINT "game_recaps_home_score_nonnegative" CHECK ("home_score" >= 0),
       ADD CONSTRAINT "game_recaps_away_score_nonnegative" CHECK ("away_score" >= 0),
       ADD CONSTRAINT "game_recaps_data_object" CHECK (jsonb_typeof("data") = 'object')`,
    [PRIVATE_SCHEMA, RECAPS_TABLE]
  );
  await knex.raw(
    'CREATE INDEX "game_recaps_season_week_final_at_idx" ON ??.?? ("season", "week", "final_at" DESC)',
    [PRIVATE_SCHEMA, RECAPS_TABLE]
  );
  await knex.raw(
    'CREATE INDEX "game_recaps_final_at_idx" ON ??.?? ("final_at" DESC)',
    [PRIVATE_SCHEMA, RECAPS_TABLE]
  );

  await knex.raw('ALTER TABLE ??.?? ENABLE ROW LEVEL SECURITY', [PRIVATE_SCHEMA, RECAPS_TABLE]);

  const roleResult = await knex.raw('SELECT current_user AS "role"');
  const appRole = roleResult.rows[0].role;

  // Supabase exposes `public` through its Data API by default. The private
  // schema closes that surface structurally; RLS and explicit revocations are
  // defense in depth against accidental future grants or schema exposure.
  await knex.raw('REVOKE ALL ON SCHEMA ?? FROM PUBLIC', [PRIVATE_SCHEMA]);
  await knex.raw('REVOKE ALL ON TABLE ??.?? FROM PUBLIC', [PRIVATE_SCHEMA, RECAPS_TABLE]);
  await knex.raw('REVOKE ALL ON SEQUENCE ??.?? FROM PUBLIC', [PRIVATE_SCHEMA, `${RECAPS_TABLE}_id_seq`]);

  const clientRoles = await knex('pg_roles')
    .select('rolname')
    .whereIn('rolname', ['anon', 'authenticated']);
  for (const { rolname } of clientRoles) {
    await knex.raw('REVOKE ALL ON SCHEMA ?? FROM ??', [PRIVATE_SCHEMA, rolname]);
    await knex.raw('REVOKE ALL ON TABLE ??.?? FROM ??', [PRIVATE_SCHEMA, RECAPS_TABLE, rolname]);
    await knex.raw('REVOKE ALL ON SEQUENCE ??.?? FROM ??', [PRIVATE_SCHEMA, `${RECAPS_TABLE}_id_seq`, rolname]);
  }

  await knex.raw('GRANT USAGE ON SCHEMA ?? TO ??', [PRIVATE_SCHEMA, appRole]);
  await knex.raw('GRANT SELECT, INSERT, UPDATE ON TABLE ??.?? TO ??', [PRIVATE_SCHEMA, RECAPS_TABLE, appRole]);
  await knex.raw('GRANT USAGE, SELECT ON SEQUENCE ??.?? TO ??', [PRIVATE_SCHEMA, `${RECAPS_TABLE}_id_seq`, appRole]);

  await knex.raw(
    'CREATE POLICY "game_recaps_app_select" ON ??.?? FOR SELECT TO ?? USING (true)',
    [PRIVATE_SCHEMA, RECAPS_TABLE, appRole]
  );
  await knex.raw(
    'CREATE POLICY "game_recaps_app_insert" ON ??.?? FOR INSERT TO ?? WITH CHECK (true)',
    [PRIVATE_SCHEMA, RECAPS_TABLE, appRole]
  );
  await knex.raw(
    'CREATE POLICY "game_recaps_app_update" ON ??.?? FOR UPDATE TO ?? USING (true) WITH CHECK (true)',
    [PRIVATE_SCHEMA, RECAPS_TABLE, appRole]
  );

  await knex.raw(
    `COMMENT ON TABLE ??.?? IS
       'Server-only public NFL recap data. The private schema, RLS, and revoked client-role grants prevent accidental Supabase Data API exposure.'`,
    [PRIVATE_SCHEMA, RECAPS_TABLE]
  );
};

exports.down = async function (knex) {
  await knex.schema.withSchema(PRIVATE_SCHEMA).dropTableIfExists(RECAPS_TABLE);
};
