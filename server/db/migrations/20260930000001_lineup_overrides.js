/**
 * `lineup_overrides` (spec #1846, #1856): one row records that a Manager kept
 * a starter over the player the Forecast would start, with both Point
 * estimates and the start/sit probability as they stood. A called shot
 * (`called = true`) is declared on the start/sit card; later, automatically
 * captured overrides (`called = false`, no `declared_at`) share the table.
 *
 * One shot per Team per week: the partial unique index allows a single
 * `called` row per (league, season, week, team); the full unique key keeps one
 * row per pair and slot. `outcome` is pending until the week settles, then hit
 * (the starter outscored the benched player), miss, or void (either player
 * never played, or the lineup stopped matching the shot); the two players'
 * points and `resolved_at` are filled when it resolves.
 *
 * Every foreign key cascades, so deleting a league, team or player takes the
 * rows with it. The rows hold player and team ids and numbers, nothing else.
 *
 * down() is guarded (ADR 0012, the same rule Draft activity follows): once any
 * row exists it refuses, because dropping the table would erase Managers'
 * called-shot history. Recovery after that point is a forward migration.
 *
 * No grant to `anon` (ADR 0009).
 *
 * CARVE-OUT (server/db/migrations/**): applied by Cory as its own knex batch
 * after merge and before the release that needs it, never by an agent.
 */

const TABLE = 'lineup_overrides';
const ONE_CALLED_INDEX = 'lineup_overrides_one_called_per_team_week';
const PAIR_UNIQUE = 'lineup_overrides_pair_unique';

exports.up = async function (knex) {
  await knex.schema.createTable(TABLE, (t) => {
    t.increments('id');
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('slot').notNullable();
    t.integer('starter_player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.integer('benched_player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.decimal('starter_point_estimate', 7, 2).notNullable();
    t.decimal('benched_point_estimate', 7, 2).notNullable();
    t.decimal('probability', 5, 4);
    t.string('verdict');
    t.boolean('called').notNullable().defaultTo(false);
    t.timestamp('declared_at', { useTz: true });
    t.timestamp('captured_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('outcome').notNullable().defaultTo('pending');
    t.decimal('starter_points_actual', 7, 2);
    t.decimal('benched_points_actual', 7, 2);
    t.timestamp('resolved_at', { useTz: true });
    t.unique(
      ['league_id', 'season', 'week', 'team_id', 'slot', 'starter_player_id', 'benched_player_id'],
      { indexName: PAIR_UNIQUE }
    );
  });
  await knex.raw(
    `ALTER TABLE "${TABLE}" ADD CONSTRAINT "lineup_overrides_outcome_check"
     CHECK ("outcome" IN ('pending', 'hit', 'miss', 'void'))`
  );
  await knex.raw(
    `CREATE UNIQUE INDEX "${ONE_CALLED_INDEX}"
     ON "${TABLE}" ("league_id", "season", "week", "team_id") WHERE "called"`
  );
};

exports.down = async function (knex) {
  const { rows } = await knex.raw(`SELECT COUNT(*)::int AS "n" FROM "${TABLE}"`);
  if (rows[0].n > 0) {
    throw new Error(
      `refusing to drop ${TABLE}: it holds ${rows[0].n} row(s) of Managers' called-shot history (ADR 0012); recover with a forward migration`
    );
  }
  await knex.schema.dropTable(TABLE);
};
