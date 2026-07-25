/**
 * Postgres-backed Tank01 (RapidAPI) quota accounting.
 *
 * Both Render services call Tank01 — the web process (news, admin syncs) and
 * the worker (liveGameEngine, scheduler) — so an in-process counter can never
 * see the real spend. These tables are the shared source of truth:
 *
 *  - api_usage            one row per (provider, endpoint, UTC day), incremented
 *                         per attempted call. Summed from the billing-cycle
 *                         anchor to get local usage.
 *  - api_quota_snapshots  the provider's own view, lifted from RapidAPI's
 *                         `x-ratelimit-requests-limit` / `-remaining` response
 *                         headers. Authoritative for the billing cycle when
 *                         fresh; local sums are the fallback.
 *
 * Also adds live_game_states.final_stats_synced_at so a finalized game's box
 * score is fetched exactly once (see scoring.syncWeekStats /
 * gameRecap.generateForGame) instead of being re-pulled every 30 minutes for
 * the rest of the afternoon.
 *
 * Additive only — this runs against a shared Supabase instance.
 */
const PRIVATE_SCHEMA = 'private';
const USAGE_TABLE = 'api_usage';
const SNAPSHOT_TABLE = 'api_quota_snapshots';

exports.up = async function (knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS ??', [PRIVATE_SCHEMA]);

  await knex.schema.withSchema(PRIVATE_SCHEMA).createTable(USAGE_TABLE, (table) => {
    table.increments('id').primary();
    table.text('provider').notNullable().defaultTo('tank01');
    table.text('endpoint').notNullable();
    table.date('day').notNullable();
    table.integer('calls').notNullable().defaultTo(0);
    table.timestamps(true, true);
    table.unique(['provider', 'endpoint', 'day'], { indexName: 'api_usage_provider_endpoint_day_uniq' });
    table.index(['provider', 'day'], 'api_usage_provider_day_idx');
  });

  await knex.raw(
    `ALTER TABLE ??.?? ADD CONSTRAINT "api_usage_calls_nonnegative" CHECK ("calls" >= 0)`,
    [PRIVATE_SCHEMA, USAGE_TABLE]
  );

  await knex.schema.withSchema(PRIVATE_SCHEMA).createTable(SNAPSHOT_TABLE, (table) => {
    table.text('provider').primary();
    table.integer('requests_limit');
    table.integer('requests_remaining');
    table.timestamp('seen_at', { useTz: true });
    table.timestamps(true, true);
  });

  // One fetch per finalized game: stamped when a final's box score has been
  // ingested into player_stats, so later passes skip it entirely.
  await knex.raw(
    'ALTER TABLE "live_game_states" ADD COLUMN IF NOT EXISTS "final_stats_synced_at" timestamptz NULL'
  );

  for (const table of [USAGE_TABLE, SNAPSHOT_TABLE]) {
    await knex.raw('ALTER TABLE ??.?? ENABLE ROW LEVEL SECURITY', [PRIVATE_SCHEMA, table]);
  }

  const roleResult = await knex.raw('SELECT current_user AS "role"');
  const appRole = roleResult.rows[0].role;

  // Same defense-in-depth as game_recaps: the private schema keeps these out of
  // Supabase's Data API structurally; RLS plus explicit revocations guard
  // against a future accidental grant or schema exposure.
  await knex.raw('REVOKE ALL ON SCHEMA ?? FROM PUBLIC', [PRIVATE_SCHEMA]);
  await knex.raw('REVOKE ALL ON TABLE ??.?? FROM PUBLIC', [PRIVATE_SCHEMA, USAGE_TABLE]);
  await knex.raw('REVOKE ALL ON TABLE ??.?? FROM PUBLIC', [PRIVATE_SCHEMA, SNAPSHOT_TABLE]);
  await knex.raw('REVOKE ALL ON SEQUENCE ??.?? FROM PUBLIC', [PRIVATE_SCHEMA, `${USAGE_TABLE}_id_seq`]);

  const clientRoles = await knex('pg_roles')
    .select('rolname')
    .whereIn('rolname', ['anon', 'authenticated']);
  for (const { rolname } of clientRoles) {
    await knex.raw('REVOKE ALL ON SCHEMA ?? FROM ??', [PRIVATE_SCHEMA, rolname]);
    await knex.raw('REVOKE ALL ON TABLE ??.?? FROM ??', [PRIVATE_SCHEMA, USAGE_TABLE, rolname]);
    await knex.raw('REVOKE ALL ON TABLE ??.?? FROM ??', [PRIVATE_SCHEMA, SNAPSHOT_TABLE, rolname]);
    await knex.raw('REVOKE ALL ON SEQUENCE ??.?? FROM ??', [PRIVATE_SCHEMA, `${USAGE_TABLE}_id_seq`, rolname]);
  }

  await knex.raw('GRANT USAGE ON SCHEMA ?? TO ??', [PRIVATE_SCHEMA, appRole]);
  await knex.raw('GRANT USAGE, SELECT ON SEQUENCE ??.?? TO ??', [PRIVATE_SCHEMA, `${USAGE_TABLE}_id_seq`, appRole]);
  for (const table of [USAGE_TABLE, SNAPSHOT_TABLE]) {
    await knex.raw('GRANT SELECT, INSERT, UPDATE ON TABLE ??.?? TO ??', [PRIVATE_SCHEMA, table, appRole]);
    await knex.raw(
      'CREATE POLICY ?? ON ??.?? FOR SELECT TO ?? USING (true)',
      [`${table}_app_select`, PRIVATE_SCHEMA, table, appRole]
    );
    await knex.raw(
      'CREATE POLICY ?? ON ??.?? FOR INSERT TO ?? WITH CHECK (true)',
      [`${table}_app_insert`, PRIVATE_SCHEMA, table, appRole]
    );
    await knex.raw(
      'CREATE POLICY ?? ON ??.?? FOR UPDATE TO ?? USING (true) WITH CHECK (true)',
      [`${table}_app_update`, PRIVATE_SCHEMA, table, appRole]
    );
  }

  await knex.raw(
    `COMMENT ON TABLE ??.?? IS
       'Per-endpoint, per-day count of attempted upstream API calls (shared across the web and worker processes). Server-only.'`,
    [PRIVATE_SCHEMA, USAGE_TABLE]
  );
  await knex.raw(
    `COMMENT ON TABLE ??.?? IS
       'Latest quota headers reported by the provider (RapidAPI x-ratelimit-requests-limit/-remaining). Server-only.'`,
    [PRIVATE_SCHEMA, SNAPSHOT_TABLE]
  );
};

exports.down = async function (knex) {
  await knex.schema.withSchema(PRIVATE_SCHEMA).dropTableIfExists(SNAPSHOT_TABLE);
  await knex.schema.withSchema(PRIVATE_SCHEMA).dropTableIfExists(USAGE_TABLE);
  await knex.raw('ALTER TABLE "live_game_states" DROP COLUMN IF EXISTS "final_stats_synced_at"');
};
