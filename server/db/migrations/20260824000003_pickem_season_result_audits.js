/**
 * Append-only evidence for explicit operator recovery and correction of an
 * immutable Pick'em season result. Identifiers are snapshots, not foreign
 * keys, so deleting a league or anonymizing an operator cannot erase who
 * changed which historical result.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('pickem_season_result_audits', (table) => {
    table.increments('id').primary();
    table.integer('league_id').notNullable();
    table.integer('season').notNullable();
    table.string('operation', 16).notNullable();
    table.integer('operator_id').notNullable();
    table.text('reason').notNullable();
    table.text('source').notNullable();
    table.jsonb('before_result').notNullable();
    table.jsonb('after_result').notNullable();
    table.string('request_fingerprint', 64).notNullable().unique();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['league_id', 'season', 'id'], 'pickem_result_audits_result_idx');
  });

  await knex.raw(`
    ALTER TABLE "pickem_season_result_audits"
      ADD CONSTRAINT "pickem_result_audits_identity_positive"
        CHECK ("league_id" > 0 AND "season" > 0 AND "operator_id" > 0),
      ADD CONSTRAINT "pickem_result_audits_operation_check"
        CHECK ("operation" IN ('recovery', 'correction')),
      ADD CONSTRAINT "pickem_result_audits_reason_check"
        CHECK (btrim("reason") <> ''),
      ADD CONSTRAINT "pickem_result_audits_source_check"
        CHECK (btrim("source") <> ''),
      ADD CONSTRAINT "pickem_result_audits_snapshots_check"
        CHECK (
          jsonb_typeof("before_result") = 'object'
          AND jsonb_typeof("after_result") = 'object'
        ),
      ADD CONSTRAINT "pickem_result_audits_fingerprint_check"
        CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$')
  `);

  await knex.raw(`
    CREATE FUNCTION "fn_reject_pickem_result_audit_mutation"()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'pickem season result audit is append-only: % is not allowed', TG_OP;
    END;
    $$
  `);
  await knex.raw(`
    CREATE TRIGGER "pickem_result_audits_append_only"
    BEFORE UPDATE OR DELETE OR TRUNCATE ON "pickem_season_result_audits"
    FOR EACH STATEMENT EXECUTE FUNCTION "fn_reject_pickem_result_audit_mutation"()
  `);

  await knex.raw('ALTER TABLE "pickem_season_result_audits" ENABLE ROW LEVEL SECURITY');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('pickem_season_result_audits');
  await knex.raw('DROP FUNCTION IF EXISTS "fn_reject_pickem_result_audit_mutation"()');
};
