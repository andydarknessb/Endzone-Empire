/**
 * The per-league feed sequence for League chat (#434, ADR 0012).
 *
 * ADR 0012 keeps League chat and Draft activity as SEPARATE record types
 * presented as ONE chronologically ordered feed through "one transactional,
 * per-league chronological position". This migration installs that position
 * for League chat: a `feed_seq` on `chat_messages`, allocated from a per-league
 * counter (`league_feed_sequences`). Draft activity will share the same counter
 * in a later slice, so one ordered read can interleave the two kinds without
 * inventing a fake chat author for a Draft event.
 *
 * WHY A COUNTER TABLE RATHER THAN A POSTGRES SEQUENCE. The chronology is
 * PER LEAGUE, and it must be transactional and contiguous so it can serve as a
 * reconnect cursor. A single global SEQUENCE is neither per-league nor
 * gap-free (a rolled-back INSERT burns a value), and one sequence per league is
 * unbounded DDL. A counter row per league, bumped under its own row lock,
 * gives a per-league monotonic integer that is contiguous on success and whose
 * only gaps come from a later DELETE (retention, account deletion) - which is
 * exactly ADR 0012's "leaving sequence gaps rather than retained copies".
 *
 * WHY A TRIGGER RATHER THAN APP-SIDE ALLOCATION. The allocation has to hold
 * across a ROLLING DEPLOY: while both old and new server code run, an old
 * INSTANCE still inserts a chat row that names no `feed_seq`. A BEFORE INSERT
 * trigger allocates for BOTH - the boundary is the database, not any one
 * deployment - so no insert during the rollout fails the NOT NULL and none
 * lands without a sequence position (ADR 0012: "database-boundary capture
 * before backfill so active Drafts and rolling application deployments cannot
 * create an unobserved gap"). The trigger is installed BEFORE the backfill for
 * the same reason. This mirrors roster_tenures (ADR 0006): a fact every write
 * path must maintain belongs in a trigger a caller cannot forget.
 *
 * DETERMINISTIC BACKFILL. Existing messages are legacy entries; each league's
 * are numbered 1..N by `(created_at, id)`, a total order even when two rows
 * share a `created_at` (ADR 0012: "equal-time legacy entries receive
 * deterministic synthetic ordering"). The counter is then seeded to each
 * league's high-water mark so the next live insert continues the run.
 *
 * WHY THE TRIGGER-BEFORE-BACKFILL ORDERING IS SAFE. On its face this ordering
 * has a race: an insert landing after the backfill but before the counter seed
 * would take `feed_seq = 1` from a fresh counter row, collide with a
 * backfilled row, and the unique `(league_id, feed_seq)` index at the end
 * would abort the migration on production. It cannot happen, but the reason is
 * NOT local to this file: knex runs each migration inside ONE transaction (no
 * `disableTransactions` is set anywhere in this repo), and the `ADD COLUMN`
 * above takes an ACCESS EXCLUSIVE lock on `chat_messages` that is held for the
 * whole of `up()`. No insert can interleave with the backfill and the seed;
 * they are one atomic unit. This safety is a property of the RUNNER, so it
 * rots silently the day someone sets `disableTransactions` on this migration -
 * if you ever do, allocate the seed and backfill so no gap between them can
 * exist, or this ordering becomes the race it looks like.
 *
 * APPLYING IT: that same ACCESS EXCLUSIVE lock blocks every chat insert for the
 * duration of `up()`, and that duration is set by the backfill: one UPDATE that
 * touches EVERY existing row of `chat_messages`, so the lock scales with row
 * count - a table scan, not a metadata-only change. Measured at 7 rows on
 * 2026-08-27 (#520). Check the current row count before applying, and apply
 * when no draft is live, so no manager's `chat:send` is blocked mid-draft.
 */

const CHAT = 'chat_messages';
const SEQUENCES = 'league_feed_sequences';

exports.up = async function (knex) {
  // The per-league counter. `last_seq` is the highest position handed out for
  // the league; the next allocation is `last_seq + 1`. A league gets its row
  // lazily, on its first chat row (backfill for a league with history, the
  // trigger otherwise).
  await knex.schema.createTable(SEQUENCES, (t) => {
    t.integer('league_id').primary().references('leagues.id').onDelete('CASCADE');
    t.bigInteger('last_seq').notNullable().defaultTo(0);
  });

  // Nullable first: existing rows have no position until the backfill sets it,
  // and the trigger fills it for any insert in the gap before NOT NULL lands.
  await knex.schema.alterTable(CHAT, (t) => {
    t.bigInteger('feed_seq');
  });

  // Allocate the next per-league position for a row that names none. The
  // ON CONFLICT DO UPDATE takes the counter row's lock, so concurrent inserts
  // for one league serialize and the run stays contiguous with no duplicates.
  // A row that already carries a feed_seq (a future writer that allocates
  // explicitly) is left untouched.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_allocate_league_feed_seq() RETURNS trigger AS $$
    BEGIN
      IF NEW."feed_seq" IS NULL THEN
        INSERT INTO "${SEQUENCES}" AS s ("league_id", "last_seq")
        VALUES (NEW."league_id", 1)
        ON CONFLICT ("league_id") DO UPDATE SET "last_seq" = s."last_seq" + 1
        RETURNING s."last_seq" INTO NEW."feed_seq";
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
  `);

  await knex.raw(
    `CREATE TRIGGER "chat_messages_allocate_feed_seq"
     BEFORE INSERT ON "${CHAT}"
     FOR EACH ROW EXECUTE FUNCTION fn_allocate_league_feed_seq()`
  );

  // Backfill legacy rows: 1..N per league by (created_at, id). row_number over
  // that total order is deterministic even when two messages share an instant.
  await knex.raw(`
    WITH ordered AS (
      SELECT "id",
             row_number() OVER (PARTITION BY "league_id" ORDER BY "created_at", "id") AS "rn"
        FROM "${CHAT}"
    )
    UPDATE "${CHAT}" AS c
       SET "feed_seq" = ordered."rn"
      FROM ordered
     WHERE ordered."id" = c."id"
  `);

  // Seed each league's counter to its backfilled high-water mark, so the first
  // live insert continues the run rather than colliding at 1.
  await knex.raw(`
    INSERT INTO "${SEQUENCES}" ("league_id", "last_seq")
    SELECT "league_id", MAX("feed_seq")
      FROM "${CHAT}"
     GROUP BY "league_id"
    ON CONFLICT ("league_id") DO UPDATE SET "last_seq" = EXCLUDED."last_seq"
  `);

  // Every row now has a position; hold that.
  await knex.schema.alterTable(CHAT, (t) => {
    t.bigInteger('feed_seq').notNullable().alter();
  });

  // One index does double duty: it enforces that a league never hands the same
  // position out twice, and it serves the feed read
  // (WHERE league_id = $ [AND feed_seq < $] ORDER BY feed_seq DESC).
  await knex.raw(
    `CREATE UNIQUE INDEX "chat_messages_league_feed_seq"
     ON "${CHAT}" ("league_id", "feed_seq")`
  );

  // Defense in depth on the shared Supabase project: the app connects as the
  // table owner and bypasses RLS, so enabling it costs nothing here while
  // denying anon/authenticated PostgREST access by default (mirrors
  // roster_tenures and the anon-surface confinement, #240).
  await knex.raw(`ALTER TABLE "${SEQUENCES}" ENABLE ROW LEVEL SECURITY`);
};

/*
 * A real rollback, because CI runs migrate/rollback/migrate. Dropping is safe
 * while League chat is the ONLY kind on this sequence: feed_seq values are
 * re-derived deterministically by the backfill on the next up(), and no
 * captured evidence lives here. Once Draft activity also allocates from
 * league_feed_sequences, this down() must gain the append-only guard ADR 0012
 * describes (refuse while the activity store is nonempty); it does not yet,
 * because that store does not yet exist.
 */
exports.down = async function (knex) {
  await knex.raw(`DROP TRIGGER IF EXISTS "chat_messages_allocate_feed_seq" ON "${CHAT}"`);
  await knex.raw('DROP FUNCTION IF EXISTS fn_allocate_league_feed_seq()');
  await knex.schema.alterTable(CHAT, (t) => {
    t.dropColumn('feed_seq'); // drops the unique index with it
  });
  await knex.schema.dropTableIfExists(SEQUENCES);
};
