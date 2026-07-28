/**
 * The 2026 prospective-holdout ledger: append-only, pre-kickoff projection
 * snapshots the model can be honestly evaluated against once outcomes exist.
 *
 * Why the cache tables cannot serve this purpose: `projection_runs` /
 * `player_week_projections` are MUTABLE by design (regenerated on cache
 * completion, deleted by post-correction invalidation) and traffic-dependent
 * (only requested players get rows). An evaluation ledger needs the opposite
 * properties: cohort-complete, captured before outcomes were knowable, and
 * physically incapable of being rewritten afterwards.
 *
 * 1. `projection_snapshots` — one immutable header per captured
 *    (season, week, scoring profile, model version, capture kind). The
 *    UNIQUE identity is what makes capture retries idempotent: the writer
 *    INSERTs ON CONFLICT DO NOTHING, never updates. `first_kickoff_at` is
 *    the week's earliest kickoff AS KNOWN AT CAPTURE TIME, and the CHECK
 *    constraint is the database-enforced pre-kickoff cutoff: a capture at or
 *    after that instant must either fail or arrive explicitly labeled
 *    `is_late = true`, which marks it non-holdout.
 *
 * 2. `projection_snapshot_players` — one immutable row per (snapshot,
 *    player) carrying the projection, its factors and its provenance.
 *    Outcomes are NEVER written here: evaluation joins `player_stats` at
 *    read time, so the prediction rows stay exactly what the model said
 *    before kickoff.
 *
 * 3. `fn_reject_holdout_mutation` + triggers — UPDATE, DELETE and TRUNCATE
 *    raise on both tables, for every role including the table owner. This is
 *    what "append-only" means here: not a convention in the service layer,
 *    a property of the schema. Corrections, cache invalidation, and any
 *    future cleanup job hit the same wall.
 *
 * RLS is enabled with no policies (house style for server-only tables): the
 * Supabase client roles cannot touch these tables at all; the server
 * connects as owner and is subject to the triggers like everyone else.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('projection_snapshots', (t) => {
    t.increments('id').primary();
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('scoring_profile', 40).notNullable(); // predeclared name: standard | half_ppr | ppr
    t.string('scoring_hash', 64).notNullable();
    t.string('model_version', 64).notNullable();
    t.string('constants_hash', 64).notNullable();
    t.string('release_sha', 64); // null when the env does not expose it
    t.string('cohort_hash', 64).notNullable();
    t.integer('cohort_size').notNullable();
    t.string('capture_kind', 20).notNullable().defaultTo('scheduled'); // scheduled | supplemental
    t.timestamp('captured_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('first_kickoff_at', { useTz: true }).notNullable();
    t.timestamp('input_cutoff', { useTz: true });
    t.boolean('is_late').notNullable().defaultTo(false);
    t.jsonb('source_coverage');
    t.unique(['season', 'week', 'scoring_hash', 'model_version', 'capture_kind']);
    t.index(['season', 'week']);
  });
  // The pre-kickoff cutoff, enforced where the service layer cannot reach:
  // an unlabeled row must have been captured strictly before the week's
  // first kickoff, or the INSERT itself fails.
  await knex.raw(
    `ALTER TABLE "projection_snapshots"
     ADD CONSTRAINT "projection_snapshots_pre_kickoff_check"
     CHECK ("is_late" OR "captured_at" < "first_kickoff_at")`
  );

  await knex.schema.createTable('projection_snapshot_players', (t) => {
    t.increments('id').primary();
    t.integer('snapshot_id').notNullable().references('projection_snapshots.id');
    t.integer('player_id').notNullable().references('players.id');
    t.decimal('mean', 8, 2);
    t.decimal('median', 8, 2);
    t.decimal('p10', 8, 2);
    t.decimal('p25', 8, 2);
    t.decimal('p75', 8, 2);
    t.decimal('p90', 8, 2);
    t.decimal('active_probability', 5, 4);
    t.string('confidence', 12);
    t.integer('sample_size').notNullable().defaultTo(0);
    t.jsonb('factors');
    t.unique(['snapshot_id', 'player_id']);
  });

  // Append-only, physically. Row triggers cover UPDATE/DELETE; the statement
  // trigger covers TRUNCATE, which row triggers never see.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_reject_holdout_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'holdout ledger is append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
    END $$ LANGUAGE plpgsql;
  `);
  for (const table of ['projection_snapshots', 'projection_snapshot_players']) {
    await knex.raw(
      `CREATE TRIGGER "${table}_no_mutation"
       BEFORE UPDATE OR DELETE ON "${table}"
       FOR EACH ROW EXECUTE FUNCTION fn_reject_holdout_mutation()`
    );
    await knex.raw(
      `CREATE TRIGGER "${table}_no_truncate"
       BEFORE TRUNCATE ON "${table}"
       FOR EACH STATEMENT EXECUTE FUNCTION fn_reject_holdout_mutation()`
    );
  }

  await knex.raw('ALTER TABLE "projection_snapshots" ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE "projection_snapshot_players" ENABLE ROW LEVEL SECURITY');
};

exports.down = async function (knex) {
  for (const table of ['projection_snapshot_players', 'projection_snapshots']) {
    await knex.raw(`DROP TRIGGER IF EXISTS "${table}_no_mutation" ON "${table}"`);
    await knex.raw(`DROP TRIGGER IF EXISTS "${table}_no_truncate" ON "${table}"`);
  }
  await knex.schema.dropTableIfExists('projection_snapshot_players');
  await knex.schema.dropTableIfExists('projection_snapshots');
  await knex.raw('DROP FUNCTION IF EXISTS fn_reject_holdout_mutation()');
};
