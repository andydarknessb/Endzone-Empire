/**
 * `player_ownership` (#1382, ADR 0041 amendment / PR #1345, cut from #1308
 * Ruling item 3): the table the ESPN facts client's daily Sync run writes
 * ownership snapshots to. The Decision card reads the latest
 * `captured_date` row per player (#1308, out of scope here - this ticket
 * ships the table only, nothing reads or writes it yet).
 *
 * `percent_owned`, `percent_started` and `percent_change` are ESPN's own
 * reported percentages (0-100, `percent_change` signed) and are left
 * nullable like the other reported-fact columns on this pair of tables: ESPN
 * does not guarantee every field on every snapshot. `player_id` and
 * `captured_date` are structural - they are the row's identity (the unique
 * pair) - so those two are NOT NULL.
 *
 * Every daily row is kept (ADR 0041: "every daily row is kept"); no
 * retention job prunes this table.
 *
 * GUARDED down() (ADR 0012, pinned for this ticket by the lead's assignment
 * comment on #1382): a past day's ESPN ownership snapshot cannot be
 * re-fetched, so this table's rows are the same kind of unrecoverable
 * append-only record ADR 0012 guards `draft_activity` for (see
 * 20260826000006_draft_activity_lifecycle.js). down() drops the table only
 * while it holds no rows; once a row exists it throws instead, naming the
 * table and citing ADR 0012, rather than silently erasing history nothing
 * can re-derive. Recovery past that point is a forward migration. Clean on
 * the empty migration-smoke CI database (migrate -> rollback -> migrate).
 *
 * No grant to `anon` (ADR 0009): default privileges for `anon` and
 * `authenticated` are already revoked project-wide, and this migration adds
 * no GRANT, so the table stays reachable only by `endzone_app` and
 * `service_role`.
 *
 * `ON DELETE CASCADE` on `player_id` matches every other player-child table
 * (`team_players`, `player_watchlist`, ...) and is a distinct question from
 * the guarded `down()` above: CASCADE governs what happens when a `players`
 * row is removed (nothing in this app's runtime paths does that today),
 * while the guard governs this migration's own rollback. Unlike
 * `draft_activity`'s `team_id` (ON DELETE SET NULL, ADR 0012), an ownership
 * row has no meaning once its player is gone, so cascading the delete does
 * not strand history the way erasing the row via `down()` would.
 *
 * CARVE-OUT (server/db/migrations/**): written by the IC, applied and
 * verified by Cory as its own knex batch, after
 * 20260913000001_player_watchlist.js applies as batch 56 (#421 cycle rule)
 * - never run by the IC.
 */

const TABLE = 'player_ownership';

exports.up = async function (knex) {
  await knex.schema.createTable(TABLE, (t) => {
    t.increments('id').primary();
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.date('captured_date').notNullable();
    t.decimal('percent_owned', 5, 2);
    t.decimal('percent_started', 5, 2);
    t.decimal('percent_change', 5, 2);
    // The (player_id, captured_date) unique below already serves the card's
    // "latest row for this player" lookup. This second index serves the
    // orthogonal by-date scan (e.g. "did today's Sync run already write?").
    t.unique(['player_id', 'captured_date']);
    t.index('captured_date');
  });
};

exports.down = async function (knex) {
  // Lock before counting so a concurrent Sync INSERT cannot commit between
  // the count and the DROP TABLE below (count() only takes ACCESS SHARE,
  // which would otherwise let a write slip through the guard's window).
  await knex.raw(`LOCK TABLE "${TABLE}" IN ACCESS EXCLUSIVE MODE`);
  const [{ count }] = await knex(TABLE).count({ count: '*' });
  if (Number(count) !== 0) {
    throw new Error(
      `Refusing to drop "${TABLE}": it holds ${count} row(s) of ESPN ownership ` +
        'snapshots that cannot be re-fetched (ADR 0012 guarded rollback). ' +
        'Recovery is a forward migration, not a destructive down().'
    );
  }
  await knex.schema.dropTable(TABLE);
};
