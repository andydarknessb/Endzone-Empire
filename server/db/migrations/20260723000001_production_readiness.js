exports.up = async function (knex) {
  await knex.raw(
    'ALTER TABLE "refresh_tokens" ADD COLUMN "authenticated_at" timestamptz'
  );
  await knex.raw(
    'UPDATE "refresh_tokens" SET "authenticated_at" = "created_at" WHERE "authenticated_at" IS NULL'
  );
  await knex.raw(
    'ALTER TABLE "refresh_tokens" ALTER COLUMN "authenticated_at" SET NOT NULL, ALTER COLUMN "authenticated_at" SET DEFAULT now()'
  );

  await knex.schema.alterTable('users', (table) => {
    table.timestamp('deleted_at', { useTz: true });
  });

  await knex.raw(
    'CREATE UNIQUE INDEX users_username_lower_active_unique ON "users" (lower("username")) WHERE "deleted_at" IS NULL'
  );
  await knex.raw(
    'CREATE UNIQUE INDEX users_email_lower_active_unique ON "users" (lower("email")) WHERE "deleted_at" IS NULL'
  );

  await knex.schema.createTable('data_privacy_requests', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    table.string('request_type', 24).notNullable();
    table.string('status', 24).notNullable().defaultTo('received');
    table.jsonb('details').notNullable().defaultTo('{}');
    table.timestamp('completed_at', { useTz: true });
    table.timestamps(true, true);
    table.index(['user_id', 'created_at']);
  });

  await knex.schema.createTable('worker_heartbeats', (table) => {
    table.string('worker_name', 80).primary();
    table.timestamp('last_seen_at', { useTz: true }).notNullable();
    table.string('last_error', 500);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('user_blocks', (table) => {
    table.integer('blocker_id').notNullable().references('users.id').onDelete('CASCADE');
    table.integer('blocked_id').notNullable().references('users.id').onDelete('CASCADE');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['blocker_id', 'blocked_id']);
    table.check('blocker_id <> blocked_id');
  });

  await knex.schema.createTable('content_reports', (table) => {
    table.increments('id').primary();
    table.integer('reporter_id').notNullable().references('users.id').onDelete('CASCADE');
    table.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    table.integer('message_id').references('chat_messages.id').onDelete('SET NULL');
    table.string('reason', 500).notNullable();
    table.string('status', 24).notNullable().defaultTo('open');
    table.integer('resolved_by').references('users.id').onDelete('SET NULL');
    table.timestamp('resolved_at', { useTz: true });
    table.timestamps(true, true);
    table.index(['league_id', 'status', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('content_reports');
  await knex.schema.dropTableIfExists('user_blocks');
  await knex.schema.dropTableIfExists('worker_heartbeats');
  await knex.schema.dropTableIfExists('data_privacy_requests');
  await knex.raw('DROP INDEX IF EXISTS users_email_lower_active_unique');
  await knex.raw('DROP INDEX IF EXISTS users_username_lower_active_unique');
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('deleted_at');
  });
  await knex.raw(
    'ALTER TABLE "refresh_tokens" DROP COLUMN IF EXISTS "authenticated_at"'
  );
};
