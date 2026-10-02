/**
 * `player_practice_observations` (#1922, ADR 0056): Practice participation
 * (CONTEXT.md) as an observed fact. The nflverse `injuries_<season>` release
 * carries ONE row per player per week with the latest practice_status and
 * report_status and no date, so the Wed/Thu/Fri sequence only exists if we
 * record each CHANGE with our own clock. One row here is one observed change:
 * `observed_at` is when WE saw it (an approximate practice day, never a
 * guessed one), `source_last_updated` the nflverse `timestamp.json` value the
 * fetch read.
 *
 * `player_id` is OUR players.id, resolved the way the nflverse stats pass
 * does (gsis_id -> players.csv espn_id -> players.external_id); `gsis_id` is
 * kept beside it. `team` is nflverse's own spelling (WAS, LA), unfolded, like
 * the other nflverse-sourced columns. The four practice/report columns are
 * nflverse's text as published, null when the cell was blank.
 *
 * The unique key (player, season, week, observed_at) is the lookup index for a
 * player's week and makes a re-run of one poll a no-op. Every row is kept; no
 * retention job prunes this table.
 *
 * GUARDED down() (ADR 0012): a past day's report cannot be re-fetched, so
 * down() drops the table only while it holds no rows. Recovery past that
 * point is a forward migration. Clean on the empty migration-smoke database.
 *
 * No grant to `anon` (ADR 0009).
 *
 * CARVE-OUT (server/db/migrations/**): applied by Cory as its own knex batch
 * after merge and before the release that needs it, never by an agent.
 */

const TABLE = 'player_practice_observations';

exports.up = async function (knex) {
  await knex.schema.createTable(TABLE, (t) => {
    t.increments('id').primary();
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.string('gsis_id', 20).notNullable();
    t.integer('season').notNullable();
    t.integer('week').notNullable();
    t.string('team', 60);
    t.text('practice_status');
    t.text('practice_primary_injury');
    t.text('report_status');
    t.text('report_primary_injury');
    t.timestamp('observed_at', { useTz: true }).notNullable();
    t.string('source_last_updated', 64);
    t.unique(['player_id', 'season', 'week', 'observed_at']);
  });
};

exports.down = async function (knex) {
  // Lock before counting so a concurrent Sync INSERT cannot commit between the
  // count and the DROP TABLE below.
  await knex.raw(`LOCK TABLE "${TABLE}" IN ACCESS EXCLUSIVE MODE`);
  const [{ count }] = await knex(TABLE).count({ count: '*' });
  if (Number(count) !== 0) {
    throw new Error(
      `Refusing to drop "${TABLE}": it holds ${count} row(s) of nflverse injury-report ` +
        'observations that cannot be re-fetched (ADR 0012 guarded rollback). ' +
        'Recovery is a forward migration, not a destructive down().'
    );
  }
  await knex.schema.dropTable(TABLE);
};
