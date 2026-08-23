/**
 * `roster_tenures`: roster tenure as a recorded fact (#228, ADR 0006).
 *
 * A Tenure is one team's continuous holding of one player, from the move that
 * brought him onto the roster to the move that took him off. A player who
 * leaves and returns has two tenures.
 *
 * WHY A TABLE. Every rule that needed "did team T hold player P at kickoff K"
 * previously read a proxy: `team_players.created_at`, which cannot tell a
 * re-acquisition from an acquisition, or `lineup_entries.created_at`, which
 * records when a week happened to be materialized rather than when anyone
 * joined a roster. Both describe MUTABLE PRESENT STATE, and no arrangement of
 * reads over the present reconstructs the past: a post-kickoff pickup who is
 * later cut loses his `team_players` row, so a rule that reads the current
 * roster stops firing and his points come back on the next correction sweep.
 * The fact is recorded instead.
 *
 * WHY A TRIGGER RATHER THAN CALL-SITE WRITES. Six paths insert into
 * `team_players` and eight delete from it, and one of the deletes - the draft
 * reset's `DELETE FROM "team_players" WHERE "league_id" = $1`
 * (draft.router.js) - bypasses the `removeLineupEntries` chokepoint entirely.
 * Call-site writes are correct only while every caller remembers. A row
 * trigger cannot be forgotten by a caller that does not know it exists, and a
 * bulk DELETE fires it once per affected row.
 *
 * Verified at the time of writing: there is NO `UPDATE "team_players"`
 * anywhere in the codebase and no TRUNCATE of it, so INSERT and DELETE are
 * between them the whole of the write surface. The BEFORE UPDATE guard below
 * keeps that true rather than trusting it to stay true.
 *
 * TIMESTAMPS are `now()`, which in Postgres is TRANSACTION START, not
 * statement time. That is the point, not an accident: a trade's
 * delete-and-insert releases one tenure and opens another at one instant, so
 * there is no sliver in which the player was held by nobody and none in which
 * he was held by both.
 *
 * "Held at kickoff K" is `acquired_at <= K AND (released_at IS NULL OR
 * released_at > K)`. Both bounds are deliberate: a tenure that began exactly
 * at kickoff counts, and one that ended exactly at kickoff does not.
 *
 * HISTORY STARTS HERE. The backfill opens one tenure per existing
 * `team_players` row with `acquired_at = created_at`. Tenures that had already
 * CLOSED before this migration are unknown and are NOT reconstructed from
 * `transactions`: trades log no players and the draft logs nothing, so the
 * result would be a proxy with a new name (ADR 0006). The first week the fact
 * is complete is the first week that starts after deploy.
 */

const TENURES = 'roster_tenures';

exports.up = async function (knex) {
  await knex.schema.createTable(TENURES, (t) => {
    t.increments('id').primary();
    // Cascades mirror `team_players` exactly: a tenure is meaningless once
    // its league, team or player is gone.
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.integer('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.integer('player_id').notNullable().references('players.id').onDelete('CASCADE');
    t.timestamp('acquired_at', { useTz: true }).notNullable();
    t.timestamp('released_at', { useTz: true }); // null while the tenure is open
    // The read every consumer makes: this team's tenures for this player.
    t.index(['team_id', 'player_id']);
    // Postgres indexes no foreign key automatically. Both of these exist for
    // the CASCADE side rather than for any query: without them, deleting a
    // league or a player sequentially scans this table.
    t.index('league_id');
    t.index('player_id');
  });

  // At most one OPEN tenure per (team, player), enforced by the database
  // rather than by the trigger that maintains it. A team holding the same
  // player twice at once is not a state any code should have to consider.
  await knex.raw(
    `CREATE UNIQUE INDEX "roster_tenures_one_open_per_team_player"
     ON "${TENURES}" ("team_id", "player_id")
     WHERE "released_at" IS NULL`
  );

  // A tenure never ends before it begins. `>=` rather than `>` because a
  // trade's release and acquisition share one `now()`.
  await knex.raw(
    `ALTER TABLE "${TENURES}"
     ADD CONSTRAINT "roster_tenures_released_at_or_after_acquired"
     CHECK ("released_at" IS NULL OR "released_at" >= "acquired_at")`
  );

  // Backfill: one OPEN tenure per current roster row. COALESCE because a row
  // written before `created_at` carried a default would otherwise violate the
  // NOT NULL, and an unknown acquisition is better recorded as "since the
  // migration" than not recorded at all.
  await knex.raw(
    `INSERT INTO "${TENURES}" ("league_id", "team_id", "player_id", "acquired_at")
     SELECT "league_id", "team_id", "player_id", COALESCE("created_at", now())
       FROM "team_players"`
  );

  /*
   * Opening a tenure. Nothing here reads a parent row, so it cannot fail on
   * account of one being absent.
   *
   * ONE CALLER DEPENDS ON A DETAIL OF ITS OWN STATEMENT, from a file that
   * never mentions tenures. `draftStart.service.js`'s keeper seeding inserts
   * with `ON CONFLICT DO NOTHING`. On a conflict that performs NO insert, so
   * this trigger does not fire and no second tenure opens for a player who
   * already has one - which is exactly why the partial unique index above
   * does not blow up on keeper seeding.
   *
   * Changing that statement to `ON CONFLICT ... DO UPDATE` would be silently
   * worse rather than noisily broken: an upsert's UPDATE path fires no INSERT
   * trigger either, so the roster row would move while its tenure stayed
   * exactly where it was. Leave it DO NOTHING, or open the tenure explicitly.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_open_roster_tenure() RETURNS trigger AS $$
    BEGIN
      INSERT INTO "${TENURES}" ("league_id", "team_id", "player_id", "acquired_at")
      VALUES (NEW."league_id", NEW."team_id", NEW."player_id", now());
      RETURN NULL;
    END $$ LANGUAGE plpgsql;
  `);

  /*
   * Closing a tenure. THE CASE THIS FUNCTION IS SHAPED AROUND: a cascade from
   * `leagues`, `teams` or `players` fires it while those rows are going away,
   * and `roster_tenures` rows for the same league may already have been
   * cascade-deleted by the time it runs. So:
   *
   *   - it reads OLD only, never a parent table, so there is nothing to be
   *     missing;
   *   - it touches no foreign-key column, so Postgres re-validates no
   *     constraint against a parent that is mid-delete;
   *   - it does NOT raise when it updates zero rows. A missing open tenure is
   *     exactly what a cascade leaves behind, and a league delete must not
   *     fail because the tenures it was about to destroy were destroyed first.
   *
   * That last one is a deliberate silence in a migration otherwise built on
   * loud failure. It is safe because the partial unique index above, the
   * backfill, and the open trigger together mean an open tenure exists for
   * every roster row; the only way to reach the trigger with none is the
   * cascade, where it is correct to do nothing.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_close_roster_tenure() RETURNS trigger AS $$
    BEGIN
      UPDATE "${TENURES}"
         SET "released_at" = now()
       WHERE "team_id" = OLD."team_id"
         AND "player_id" = OLD."player_id"
         AND "released_at" IS NULL;
      RETURN NULL;
    END $$ LANGUAGE plpgsql;
  `);

  /*
   * There is no `UPDATE "team_players"` in the codebase today, and this keeps
   * it that way rather than hoping. Moving a roster row to another team by
   * UPDATE would fire neither trigger, so the tenure would silently credit the
   * whole period to the losing team - the exact class of quiet wrongness #228
   * exists to end. An `updated_at` touch still works: only a change to the
   * identity columns raises.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_reject_team_player_identity_update() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        'team_players identity is immutable: change (league_id, team_id, player_id) by DELETE and INSERT so roster_tenures records it (#228)';
    END $$ LANGUAGE plpgsql;
  `);

  await knex.raw(
    `CREATE TRIGGER "team_players_open_tenure"
     AFTER INSERT ON "team_players"
     FOR EACH ROW EXECUTE FUNCTION fn_open_roster_tenure()`
  );
  await knex.raw(
    `CREATE TRIGGER "team_players_close_tenure"
     AFTER DELETE ON "team_players"
     FOR EACH ROW EXECUTE FUNCTION fn_close_roster_tenure()`
  );
  await knex.raw(
    `CREATE TRIGGER "team_players_identity_immutable"
     BEFORE UPDATE ON "team_players"
     FOR EACH ROW
     WHEN (OLD."league_id" IS DISTINCT FROM NEW."league_id"
        OR OLD."team_id"   IS DISTINCT FROM NEW."team_id"
        OR OLD."player_id" IS DISTINCT FROM NEW."player_id")
     EXECUTE FUNCTION fn_reject_team_player_identity_update()`
  );

  // Defense in depth on the shared Supabase project: the app connects as the
  // table's owner and bypasses RLS, so enabling it costs nothing here while
  // denying anon/authenticated PostgREST access by default.
  await knex.raw(`ALTER TABLE "${TENURES}" ENABLE ROW LEVEL SECURITY`);
};

/*
 * A real rollback, because CI runs migrate/rollback/migrate. Unlike the
 * holdout ledger this drops freely rather than refusing on a nonempty table:
 * open tenures are re-derived by the backfill on the next `up()`, and closed
 * ones are operational history rather than captured evidence. Rolling back
 * and forward therefore loses closed tenures - the same "history starts at
 * the migration" property ADR 0006 already accepts, arrived at a second way.
 */
exports.down = async function (knex) {
  await knex.raw('DROP TRIGGER IF EXISTS "team_players_open_tenure" ON "team_players"');
  await knex.raw('DROP TRIGGER IF EXISTS "team_players_close_tenure" ON "team_players"');
  await knex.raw('DROP TRIGGER IF EXISTS "team_players_identity_immutable" ON "team_players"');
  await knex.raw('DROP FUNCTION IF EXISTS fn_open_roster_tenure()');
  await knex.raw('DROP FUNCTION IF EXISTS fn_close_roster_tenure()');
  await knex.raw('DROP FUNCTION IF EXISTS fn_reject_team_player_identity_update()');
  await knex.schema.dropTableIfExists(TENURES);
};
