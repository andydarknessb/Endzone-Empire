/**
 * `player_nfl_roster_status` (#1766, spec #1764, ADR 0041 amendment): the table
 * the daily ESPN roster-status Sync run (job `'espn-roster-status'`) writes. One
 * row per player per captured day: `roster_status` is `'active'`,
 * `'practice_squad'` or `'reserve'`, read from ESPN's team roster groups. The
 * player card shows the latest row's status as context (#1766); nothing reads
 * it for availability yet.
 *
 * `team_code` spells the NFL team the way `players.nfl_team` does (free text,
 * varchar(60), same as every `nfl_team` column), for the reason
 * `player_depth_chart` documents. `roster_status` is CHECK-constrained to the
 * three values the Sync run writes, so a typo in a later writer fails loudly
 * instead of storing a status nothing understands. `player_id` and
 * `captured_date` are the row's identity (the unique pair) and NOT NULL.
 *
 * Unlike `player_depth_chart`, a second Sync run the same day UPDATES the row
 * when the status changed (the Saturday run after the 4pm ET elevation
 * deadline exists to record a change an earlier run that day did not see), so
 * the table carries `updated_at`, set on that update.
 *
 * Every daily row is kept; no retention job prunes this table.
 *
 * GUARDED down() (ADR 0012, same reasoning as `player_depth_chart`): a past
 * day's ESPN roster snapshot cannot be re-fetched, so down() drops the table
 * only while it holds no rows. Once a row exists it throws, naming the table
 * and citing ADR 0012; recovery past that point is a forward migration. Clean
 * on the empty migration-smoke CI database (migrate -> rollback -> migrate).
 *
 * No grant to `anon` (ADR 0009): default privileges for `anon` and
 * `authenticated` are already revoked project-wide and this migration adds no
 * GRANT. `ON DELETE CASCADE` on `player_id` matches every other player-child
 * table.
 *
 * CARVE-OUT (server/db/migrations/**): written by the IC, applied and verified
 * by Cory as its own knex batch before any release carries it - never run by
 * the IC. This migration adds the table only.
 */

const TABLE = 'player_nfl_roster_status';
const STATUSES = ['active', 'practice_squad', 'reserve'];

exports.up = async function (knex) {
  await knex.schema.createTable(TABLE, (t) => {
    t.increments('id').primary();
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.string('team_code', 60);
    t.string('roster_status', 20).notNullable();
    t.date('captured_date').notNullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // The unique pair serves the card's "latest row for this player" lookup;
    // the second index serves the by-date scan.
    t.unique(['player_id', 'captured_date']);
    t.index('captured_date');
  });
  await knex.raw(
    `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${TABLE}_roster_status_check" ` +
      `CHECK ("roster_status" IN (${STATUSES.map((s) => `'${s}'`).join(', ')}))`
  );
};

exports.down = async function (knex) {
  // Lock before counting so a concurrent Sync INSERT cannot commit between the
  // count and the DROP TABLE below.
  await knex.raw(`LOCK TABLE "${TABLE}" IN ACCESS EXCLUSIVE MODE`);
  const [{ count }] = await knex(TABLE).count({ count: '*' });
  if (Number(count) !== 0) {
    throw new Error(
      `Refusing to drop "${TABLE}": it holds ${count} row(s) of ESPN roster-status ` +
        'snapshots that cannot be re-fetched (ADR 0012 guarded rollback). ' +
        'Recovery is a forward migration, not a destructive down().'
    );
  }
  await knex.schema.dropTable(TABLE);
};
