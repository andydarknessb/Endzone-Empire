/**
 * Initial schema. Replaces the old manual database.sql (which only defined "user").
 * A player may belong to at most one team per league (unique league_id+player_id
 * on team_players and draft_picks) — the draft transaction relies on this.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username', 80).notNullable().unique();
    t.string('email', 255).notNullable().unique();
    t.string('password', 1000).notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('leagues', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.integer('owner_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('invite_code', 12).notNullable().unique();
    t.integer('roster_limit').notNullable().defaultTo(15);
    t.integer('max_teams').notNullable().defaultTo(10);
    t.enu('draft_status', ['pending', 'active', 'complete'], {
      useNative: true,
      enumName: 'draft_status_type',
    }).notNullable().defaultTo('pending');
    t.integer('current_pick').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('teams', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('owner_id').notNullable().references('users.id').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.integer('draft_position');
    t.timestamps(true, true);
    t.unique(['league_id', 'owner_id']); // one team per user per league
  });

  await knex.schema.createTable('players', (t) => {
    t.increments('id').primary();
    t.integer('external_id').unique(); // RapidAPI player id
    t.string('name', 120).notNullable();
    t.string('position', 10).notNullable();
    t.string('nfl_team', 60);
    t.index('position');
  });

  await knex.schema.createTable('team_players', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.timestamps(true, true);
    t.unique(['league_id', 'player_id']); // a player is rostered once per league
    t.index('team_id');
  });

  await knex.schema.createTable('draft_picks', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.integer('pick_number').notNullable();
    t.timestamps(true, true);
    t.unique(['league_id', 'player_id']);
    t.unique(['league_id', 'pick_number']);
  });

  await knex.schema.createTable('player_stats', (t) => {
    t.increments('id').primary();
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.jsonb('stats').notNullable().defaultTo('{}');
    t.decimal('fantasy_points', 8, 2).notNullable().defaultTo(0);
    t.unique(['player_id', 'season', 'week']);
  });

  await knex.schema.createTable('matchups', (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.integer('home_team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('away_team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.decimal('home_score', 8, 2).notNullable().defaultTo(0);
    t.decimal('away_score', 8, 2).notNullable().defaultTo(0);
    t.unique(['league_id', 'season', 'week', 'home_team_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('matchups');
  await knex.schema.dropTableIfExists('player_stats');
  await knex.schema.dropTableIfExists('draft_picks');
  await knex.schema.dropTableIfExists('team_players');
  await knex.schema.dropTableIfExists('players');
  await knex.schema.dropTableIfExists('teams');
  await knex.schema.dropTableIfExists('leagues');
  await knex.schema.dropTableIfExists('users');
  await knex.raw('DROP TYPE IF EXISTS draft_status_type');
};
