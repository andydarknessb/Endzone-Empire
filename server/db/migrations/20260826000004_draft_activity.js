/**
 * The Draft-activity store, sharing League chat's per-league feed sequence
 * (#435, ADR 0012).
 *
 * ADR 0012 keeps League chat and Draft activity as SEPARATE record types
 * presented as ONE chronologically ordered feed over "one transactional,
 * per-league chronological position". #434 installed that position for chat
 * (`chat_messages.feed_seq`, allocated from the per-league counter
 * `league_feed_sequences` by a BEFORE INSERT trigger). This migration adds the
 * Draft-activity half against the SAME counter, so one ordered read can
 * interleave a Pick with the chat around it without inventing a fake chat
 * author for a Draft event.
 *
 * WHY THE SAME COUNTER, THROUGH THIS MIGRATION'S OWN TRIGGER FUNCTION. The
 * coordination point of the shared sequence is the COUNTER TABLE
 * (`league_feed_sequences`, created by 20260826000002), not the trigger
 * function. This migration's `fn_allocate_draft_activity_feed_seq()` bumps the
 * one counter row for the league under its row lock, exactly as chat's
 * `fn_allocate_league_feed_seq()` does, so a chat insert and an activity insert
 * for the same league SERIALIZE on that lock and draw one contiguous per-league
 * run - the order the counter hands out agrees with commit visibility (the lock
 * is held to COMMIT), which is what makes the feed order deterministic for every
 * client and every reconnect (#435 AC4). Allocation stays at the DATABASE
 * boundary, not in application code, for the reason #434 spells out and ADR 0006
 * (roster_tenures) set the precedent for: a fact every write path must maintain
 * belongs in a trigger a caller cannot forget. Owning the function here (rather
 * than reusing chat's) keeps this migration's rollback independent of chat's -
 * see the CREATE TRIGGER below and exports.down for why that matters.
 *
 * WHY THE SNAPSHOT COLUMNS. Draft activity must survive later Draft mutations
 * (#435): a commissioner correction or reset reverses a `draft_picks` row, and
 * an activity entry that cascaded from that row would lose the very facts the
 * feed recorded. So the Pick's Team, player, position, NFL team, round and
 * overall Pick number are SNAPSHOT here, and the `team_id` / `player_id`
 * references are ON DELETE SET NULL rather than CASCADE so the append-only entry
 * outlives even a deleted team or player (CONTEXT.md: Draft activity, append-only
 * through correction).
 *
 * WHY NO BACKFILL AND NO nullable-then-NOT-NULL DANCE. This table starts empty;
 * backfilling surviving Picks as legacy activity and inserting the cutover
 * boundary is #436's job, not this slice's. Because the trigger runs BEFORE
 * INSERT and populates `feed_seq` before the NOT NULL check, every row lands
 * with a position from its first insert, so the column is NOT NULL from the
 * start with no gap to fill.
 *
 * WHY down() REFUSES WHEN THE TABLE IS NONEMPTY. ADR 0012's guarded-rollback
 * consequence: once Draft activity exists, a destructive schema rollback would
 * erase authoritative append-only history, so recovery is a forward migration
 * or the rollout flag, never this down(). The guard lives HERE rather than in
 * 20260826000002's down() (whose header anticipated it): a full reverse rollback
 * runs this down() FIRST, so refusing here stops the rollback before it can
 * reach the shared counter and the chat column. On an empty table (a fresh CI
 * database, the migrate/rollback/migrate smoke) the guard passes and the drop
 * is clean. This migration does NOT drop `fn_allocate_league_feed_seq` or
 * `league_feed_sequences`: chat still owns and uses them.
 *
 * MIGRATIONS ARE A CARVE-OUT (ADR 0012): written here, applied and verified by
 * the maintainer against `knex_migrations`. An IC does not run it.
 */

const ACTIVITY = 'draft_activity';

exports.up = async function (knex) {
  await knex.schema.createTable(ACTIVITY, (t) => {
    t.increments('id').primary();
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    // The Draft-event discriminator. #435 writes only 'pick'; #437 adds the
    // rest of the lifecycle (draft_start, pause, resume, correction) as further
    // kinds against this same sequence.
    t.string('kind', 32).notNullable();

    // Team identity is SNAPSHOT so the entry is self-describing and append-only.
    // SET NULL, not CASCADE: a later team removal must not erase the record of
    // what that team drafted (teams are only Removable pre-draft today, so this
    // is defensive - but the append-only contract is the point).
    t.integer('team_id').references('teams.id').onDelete('SET NULL');
    t.string('team_name', 255).notNullable();

    // The Pick facts, snapshot so a correction or reset of draft_picks cannot
    // rewrite what the feed recorded happened (#435 AC2).
    t.integer('player_id').references('players.id').onDelete('SET NULL');
    t.string('player_name', 255).notNullable();
    t.string('player_position', 16); // nullable: not every player carries one
    t.string('player_nfl_team', 60); // nullable: mirrors players.nfl_team
    t.integer('round').notNullable();
    t.integer('pick_number').notNullable();
    // Labeled only when the authoritative write knows it (#435 AC3); a manual
    // Pick is not an autopick.
    t.boolean('is_autopick').notNullable().defaultTo(false);

    // The shared per-league chronological position. The trigger below fills it
    // BEFORE INSERT, so it is NOT NULL from the first row with no backfill.
    t.bigInteger('feed_seq').notNullable();

    // The event's own timestamp (#435 AC2). Defaulted so the append path need
    // not supply it; it is the instant the transaction wrote the activity.
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Allocate the shared per-league position from the SAME counter chat uses
  // (league_feed_sequences), through this migration's OWN trigger function.
  //
  // WHY A SEPARATE FUNCTION rather than reusing chat's fn_allocate_league_feed_seq.
  // The coordination point of the shared sequence is the COUNTER TABLE, not the
  // trigger function: both functions bump the one league_feed_sequences row for
  // the league under its row lock, so a chat insert and an activity insert still
  // serialize and still draw one contiguous per-league run. Sharing the function
  // instead made this migration's trigger DEPEND on chat's function, and chat's
  // applied down() (20260826000002, immutable) does an unqualified
  // `DROP FUNCTION IF EXISTS fn_allocate_league_feed_seq()` with no CASCADE - so
  // a TARGETED rollback of the chat migration while draft_activity still exists
  // (what leagueChatFeed.pg.test.js does, and a case a full reverse-order
  // rollback hides) fails with "trigger ... depends on function". Owning the
  // function here breaks that dependency: chat's function has no dependents but
  // its own trigger, and this migration depends only on the counter TABLE (a
  // plpgsql body referencing it by name is not a hard drop-blocking dependency).
  //
  // The body diverges from chat's in one deliberate way: where chat LEAVES an
  // explicitly-supplied feed_seq untouched, this function RAISES on one. That
  // makes "draft_activity.feed_seq is always counter-allocated" an enforced
  // per-league invariant this table can state and test, not merely a convention
  // the caller is trusted to keep - every #435 write path inserts NULL, so the
  // guard never fires in practice and AC1's Pick transaction is unaffected.
  //
  // WHAT THE GUARD IS NOT. It does NOT close the cross-table gap tracked by
  // #471: chat and draft_activity share one counter but each has its OWN
  // (league_id, feed_seq) unique index, so nothing forbids a chat row and an
  // activity row in a league from holding the same position. The counter keeps
  // them apart in practice because every writer allocates; the day a writer
  // supplies an explicit position (legacy backfill is #436's job) that guarantee
  // is only as strong as this guard on this table and whatever chat grows on
  // its side. The guard's real value is a TRIPWIRE: #436 cannot introduce an
  // explicit draft_activity position by accident - it must lift this guard in
  // its own migration, which forces the #471 question at exactly the moment it
  // becomes reachable, rather than letting it slip in silent as Finding 1 did.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_allocate_draft_activity_feed_seq() RETURNS trigger AS $$
    BEGIN
      IF NEW."feed_seq" IS NOT NULL THEN
        RAISE EXCEPTION 'draft_activity.feed_seq is trigger-allocated from league_feed_sequences and must not be supplied explicitly (see #471 before lifting this guard)';
      END IF;
      INSERT INTO "league_feed_sequences" AS s ("league_id", "last_seq")
      VALUES (NEW."league_id", 1)
      ON CONFLICT ("league_id") DO UPDATE SET "last_seq" = s."last_seq" + 1
      RETURNING s."last_seq" INTO NEW."feed_seq";
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
  `);

  await knex.raw(
    `CREATE TRIGGER "draft_activity_allocate_feed_seq"
     BEFORE INSERT ON "${ACTIVITY}"
     FOR EACH ROW EXECUTE FUNCTION fn_allocate_draft_activity_feed_seq()`
  );

  // One index does double duty: it forbids a league handing the same position
  // to two activity rows, and it serves the combined feed read's activity leg
  // (WHERE league_id = $ [AND feed_seq < $] ORDER BY feed_seq DESC).
  await knex.raw(
    `CREATE UNIQUE INDEX "draft_activity_league_feed_seq"
     ON "${ACTIVITY}" ("league_id", "feed_seq")`
  );

  // Defense in depth on the shared Supabase project, mirroring chat's sequence
  // table and roster_tenures (#240): the app connects as the table owner and
  // bypasses RLS, so enabling it costs nothing here while denying anon /
  // authenticated PostgREST access by default.
  await knex.raw(`ALTER TABLE "${ACTIVITY}" ENABLE ROW LEVEL SECURITY`);
};

exports.down = async function (knex) {
  // ADR 0012 guarded rollback: refuse to erase append-only Draft history.
  const present = await knex.raw(`SELECT EXISTS (SELECT 1 FROM "${ACTIVITY}") AS present`);
  if (present.rows[0].present) {
    throw new Error(
      'refusing to drop draft_activity: it holds append-only Draft history (ADR 0012). ' +
        'Recover with a forward migration or the rollout flag, never a destructive rollback.'
    );
  }
  await knex.raw(`DROP TRIGGER IF EXISTS "draft_activity_allocate_feed_seq" ON "${ACTIVITY}"`);
  await knex.raw('DROP FUNCTION IF EXISTS fn_allocate_draft_activity_feed_seq()');
  // Drops the unique index with it. Leaves chat's fn_allocate_league_feed_seq and
  // the shared league_feed_sequences counter in place: chat still owns them.
  await knex.schema.dropTableIfExists(ACTIVITY);
};
