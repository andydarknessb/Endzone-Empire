/**
 * Phase 2: waiver wire, trades, transaction log, notifications.
 *
 * - leagues gain waiver configuration (priority vs. FAAB, waiver period,
 *   budget) and trade configuration (deadline week, review window, veto
 *   threshold). waivers_clear_at covers ALL unrostered players right after
 *   the draft; individually dropped players get waiver_players rows.
 * - teams gain waiver_priority (1 = first claim) and faab_remaining.
 * - waiver_claims are resolved by a scheduled processor; trades execute
 *   after their review window unless vetoed or force-approved.
 * - transactions is the league-wide activity log; notifications are
 *   per-user in-app messages.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.string('waiver_type', 10).notNullable().defaultTo('priority'); // 'priority' | 'faab'
    t.integer('waiver_period_hours').notNullable().defaultTo(24);
    t.integer('faab_budget').notNullable().defaultTo(100);
    t.timestamp('waivers_clear_at', { useTz: true }); // post-draft blanket waiver window
    t.integer('trade_deadline_week'); // null = no deadline
    t.integer('trade_review_hours').notNullable().defaultTo(24);
    t.integer('trade_veto_votes').notNullable().defaultTo(4); // 0 = vetoes disabled
  });

  await knex.schema.alterTable('teams', (t) => {
    t.integer('waiver_priority');
    t.integer('faab_remaining').notNullable().defaultTo(100);
  });

  await knex.schema.createTable('waiver_players', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.timestamp('available_at', { useTz: true }).notNullable(); // waivers clear at this time
    t.timestamps(true, true);
    t.unique(['league_id', 'player_id']);
  });

  await knex.schema.createTable('waiver_claims', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.integer('drop_player_id').references('players.id').onDelete('SET NULL');
    t.integer('bid').notNullable().defaultTo(0);
    t.string('status', 12).notNullable().defaultTo('pending'); // pending|won|lost|invalid|cancelled
    t.string('note', 255);
    t.timestamp('processed_at', { useTz: true });
    t.timestamps(true, true);
    t.index(['league_id', 'status']);
  });

  await knex.schema.createTable('trades', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('proposing_team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('receiving_team_id').notNullable().references('teams.id').onDelete('CASCADE');
    // pending|accepted|rejected|cancelled|countered|vetoed|executed
    t.string('status', 12).notNullable().defaultTo('pending');
    t.integer('counter_of').references('trades.id').onDelete('SET NULL');
    t.timestamp('review_ends_at', { useTz: true });
    t.timestamps(true, true);
    t.index(['league_id', 'status']);
  });

  await knex.schema.createTable('trade_items', (t) => {
    t.increments('id').primary();
    t.integer('trade_id').notNullable().references('trades.id').onDelete('CASCADE');
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.integer('from_team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('to_team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.unique(['trade_id', 'player_id']);
  });

  await knex.schema.createTable('trade_votes', (t) => {
    t.increments('id').primary();
    t.integer('trade_id').notNullable().references('trades.id').onDelete('CASCADE');
    t.integer('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.timestamps(true, true);
    t.unique(['trade_id', 'team_id']);
  });

  await knex.schema.createTable('transactions', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('team_id').references('teams.id').onDelete('SET NULL');
    t.string('type', 16).notNullable(); // add|drop|waiver|trade|commissioner
    t.jsonb('detail').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['league_id', 'created_at']);
  });

  await knex.schema.createTable('notifications', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.integer('league_id').references('leagues.id').onDelete('CASCADE');
    t.string('type', 24).notNullable(); // trade_offer|trade_result|waiver_result|lineup_warning|...
    t.string('message', 500).notNullable();
    t.jsonb('data').notNullable().defaultTo('{}');
    t.boolean('read').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'read']);
  });

  // Reverse draft order is the initial waiver priority (last pick claims first)
  await knex.raw(`
    UPDATE "teams" SET "waiver_priority" = sub.rank
    FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY league_id ORDER BY draft_position DESC NULLS LAST, id DESC
      ) AS rank
      FROM "teams"
    ) AS sub
    WHERE "teams".id = sub.id
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('transactions');
  await knex.schema.dropTableIfExists('trade_votes');
  await knex.schema.dropTableIfExists('trade_items');
  await knex.schema.dropTableIfExists('trades');
  await knex.schema.dropTableIfExists('waiver_claims');
  await knex.schema.dropTableIfExists('waiver_players');
  await knex.schema.alterTable('teams', (t) => {
    t.dropColumn('waiver_priority');
    t.dropColumn('faab_remaining');
  });
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('waiver_type');
    t.dropColumn('waiver_period_hours');
    t.dropColumn('faab_budget');
    t.dropColumn('waivers_clear_at');
    t.dropColumn('trade_deadline_week');
    t.dropColumn('trade_review_hours');
    t.dropColumn('trade_veto_votes');
  });
};
