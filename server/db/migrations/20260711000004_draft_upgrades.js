/**
 * Phase 4: draft upgrades.
 *
 * - leagues.pick_time_seconds: per-pick clock (0 = untimed);
 *   pick_deadline_at: when the current pick auto-picks; draft_paused:
 *   commissioner pause switch.
 * - players.default_rank: fallback auto-pick ordering (backfilled from id,
 *   which follows the seed's rough quality order; a stats sync can refine it).
 * - draft_queue: each team's pre-draft player queue; auto-pick drains it
 *   before falling back to best-available.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.integer('pick_time_seconds').notNullable().defaultTo(90);
    t.boolean('draft_paused').notNullable().defaultTo(false);
    t.timestamp('pick_deadline_at', { useTz: true });
  });

  await knex.schema.alterTable('players', (t) => {
    t.integer('default_rank');
  });
  await knex.raw(`UPDATE "players" SET "default_rank" = "id" WHERE "default_rank" IS NULL`);

  await knex.schema.createTable('draft_queue', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.integer('rank').notNullable();
    t.timestamps(true, true);
    t.unique(['team_id', 'player_id']);
    t.index(['team_id', 'rank']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('draft_queue');
  await knex.schema.alterTable('players', (t) => {
    t.dropColumn('default_rank');
  });
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('pick_time_seconds');
    t.dropColumn('draft_paused');
    t.dropColumn('pick_deadline_at');
  });
};
