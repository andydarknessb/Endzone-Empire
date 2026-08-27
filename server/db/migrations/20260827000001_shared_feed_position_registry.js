/**
 * One per-league feed-position namespace shared by League chat and Draft
 * activity (#471, ADR 0015; the record-separation decision it enforces is
 * ADR 0012).
 *
 * ADR 0012 keeps League chat and Draft activity as SEPARATE record types
 * presented as ONE chronologically ordered feed over "one transactional,
 * per-league chronological position". #434 installed that position for chat
 * (`chat_messages.feed_seq`), #435 the Draft-activity half
 * (`draft_activity.feed_seq`), both allocated from the SAME per-league counter
 * `league_feed_sequences`. But each table enforces uniqueness ONLY within
 * itself - `chat_messages` has its own `(league_id, feed_seq)` unique index and
 * `draft_activity` has its own. So the position namespace is shared by
 * CONVENTION (every writer allocates from the one counter) but NOT by
 * STRUCTURE: nothing forbids a chat row and an activity row in one league from
 * holding the same `(league_id, feed_seq)`. PR #470's disposable-Postgres
 * finding proved it - a Draft-activity row and an explicitly-positioned chat
 * row both owned `(league_id = 1, feed_seq = 1)` and the counter stayed at 1.
 *
 * The convention holds today because every write path allocates (the chat and
 * activity BEFORE INSERT triggers), and `draft_activity`'s allocator RAISES on
 * an explicit position (20260826000004) as a deliberate tripwire. But #436 must
 * introduce an EXPLICIT legacy-position path to backfill surviving Chat and
 * Picks, which lifts that tripwire and makes the cross-table collision
 * REACHABLE. This migration closes the gap STRUCTURALLY, before #436 lands, so
 * one position can have at most one owner regardless of insertion order or
 * writer.
 *
 * THE MECHANISM: A SHARED POSITION REGISTRY. Postgres cannot put one unique
 * constraint across two tables, so the authority for the namespace becomes its
 * OWN table, `league_feed_positions`, whose PRIMARY KEY is `(league_id,
 * feed_seq)`. Every chat row and every activity row claims its position there
 * through an AFTER INSERT trigger; a cross-kind duplicate is a primary-key
 * violation that aborts the claiming transaction ATOMICALLY. The registry is
 * the one place the whole per-league chronology is unique, so it is authoritative
 * for BOTH kinds while the record tables stay separate under ADR 0012 (their own
 * per-table indexes remain as defence in depth and to serve the feed reads).
 *
 * WHY A TRIGGER, NOT APP-SIDE REGISTRATION. Same reason #434 gave for
 * allocation and ADR 0006 (roster_tenures) set the precedent for: a fact every
 * write path must maintain belongs at the database boundary a caller cannot
 * forget, so it holds across a rolling deploy where an old instance still
 * inserts a chat row that names no `feed_seq`. AFTER INSERT (not BEFORE) so the
 * row's generated `id` is available to record WHO owns the position, and so the
 * per-table unique index has already accepted the row's own-table position
 * before the registry records it.
 *
 * WHY THE COUNTER HIGH-WATER IS ADVANCED ON EVERY CLAIM. #471 AC5: the counter
 * must never sit behind a reserved position. An ordinary allocation already
 * leaves `last_seq = feed_seq`, so the advance is a no-op there. But an EXPLICIT
 * reservation (the #436 path this migration front-runs) can name a position the
 * counter has not reached; registering it bumps
 * `last_seq = GREATEST(last_seq, feed_seq)` in the SAME transaction, so the next
 * ordinary allocation continues PAST it and can never re-hand-out a reserved
 * position. This is why an explicit chat position and a later activity
 * allocation do not collide even though chat still permits explicit positions:
 * the claim advances the counter before the next allocation reads it.
 *
 * RECONCILIATION BEFORE ENFORCEMENT. #471 AC3: existing feed rows populate the
 * registry idempotently, with one proven owner per position before the
 * constraint is trusted. `up()` first RAISES if any `(league_id, feed_seq)` is
 * already held by both a chat row and an activity row (none is today - the
 * counter kept them apart - but the check makes that a proven precondition, not
 * an assumption), then backfills chat and activity rows into the registry
 * `ON CONFLICT (record_kind, source_id) DO NOTHING` so a re-run is a no-op, then
 * seeds each league's counter to the registry high-water mark.
 *
 * WHY down() IS AN UNGUARDED DROP. The registry holds NO evidence of its own -
 * every row is derivable from `chat_messages` and `draft_activity` by the
 * backfill above - so dropping and re-deriving it is lossless. That is what lets
 * the CI migrate/rollback/migrate smoke run it cleanly. This is unlike
 * `draft_activity`'s own guarded rollback (20260826000004), which refuses
 * because that table IS the append-only history; the registry only MIRRORS
 * positions, so it needs no guard. In a full reverse-order rollback this
 * migration's down() runs FIRST (it is the latest), removing the registry
 * triggers before `draft_activity` and `chat_messages` are themselves rolled
 * back, so no dependency is left dangling.
 *
 * A NOTE ON TARGETED ROLLBACK. Because the registry's triggers read
 * `chat_messages.feed_seq` / `draft_activity.feed_seq` and bump
 * `league_feed_sequences`, a TARGETED rollback of an EARLIER feed migration
 * while THIS one is still applied would orphan those triggers. That is the
 * correct dependency direction: a dependent rolls back first. The disposable-PG
 * suites that target-down an earlier feed migration roll this one back before
 * they do (see leagueChatFeed.pg.test.js). In production, migrations only ever
 * roll forward, so the situation never arises there.
 *
 * MIGRATIONS ARE A CARVE-OUT (fleet policy): written here, applied and verified
 * by the maintainer against `knex_migrations`. An IC does not run it. Apply it
 * when no draft is live: creating the two triggers takes a brief
 * SHARE ROW EXCLUSIVE lock on `chat_messages` and `draft_activity`, blocking
 * inserts for the (millisecond) duration of `up()`.
 */

const REGISTRY = 'league_feed_positions';
const CHAT = 'chat_messages';
const ACTIVITY = 'draft_activity';
const SEQUENCES = 'league_feed_sequences';

// The record-kind labels stored in the registry. They match the feed-entry
// `type` vocabulary the read side already uses (leagueFeed.LEAGUE_CHAT and
// draftActivity.DRAFT_ACTIVITY), so one word means the same thing on the write
// and read sides.
const CHAT_KIND = 'league_chat';
const ACTIVITY_KIND = 'draft_activity';

exports.up = async function (knex) {
  // The shared namespace. PRIMARY KEY (league_id, feed_seq) is the one place a
  // per-league position is unique across BOTH kinds; a second claim on a taken
  // position is a PK violation that aborts the claiming transaction. UNIQUE
  // (record_kind, source_id) makes the backfill idempotent and records exactly
  // one registry row per source row. FK to leagues ON DELETE CASCADE so a
  // removed league takes its positions with it, mirroring the record tables.
  await knex.schema.createTable(REGISTRY, (t) => {
    t.integer('league_id').notNullable().references('leagues.id').onDelete('CASCADE');
    t.bigInteger('feed_seq').notNullable();
    t.string('record_kind', 32).notNullable();
    t.bigInteger('source_id').notNullable();
    t.timestamp('reserved_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['league_id', 'feed_seq']);
    t.unique(['record_kind', 'source_id']);
  });
  await knex.raw(
    `ALTER TABLE "${REGISTRY}"
       ADD CONSTRAINT "league_feed_positions_record_kind_check"
       CHECK ("record_kind" IN ('${CHAT_KIND}', '${ACTIVITY_KIND}'))`
  );

  // Register a claimed position, and hold the counter high-water at or above it.
  // The kind is passed as a trigger argument so one function serves both tables.
  // The INSERT throws on a cross-kind PK conflict (the whole point); the counter
  // upsert keeps last_seq >= any reserved position (#471 AC5) - a no-op for an
  // ordinary allocation (last_seq already equals feed_seq), the load-bearing
  // step for an explicit reservation.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_register_feed_position() RETURNS trigger AS $$
    BEGIN
      INSERT INTO "${REGISTRY}" ("league_id", "feed_seq", "record_kind", "source_id")
      VALUES (NEW."league_id", NEW."feed_seq", TG_ARGV[0], NEW."id");

      INSERT INTO "${SEQUENCES}" AS s ("league_id", "last_seq")
      VALUES (NEW."league_id", NEW."feed_seq")
      ON CONFLICT ("league_id")
        DO UPDATE SET "last_seq" = GREATEST(s."last_seq", EXCLUDED."last_seq");

      RETURN NULL;
    END $$ LANGUAGE plpgsql;
  `);

  // Installed FIRST, before the backfill, so the SHARE ROW EXCLUSIVE lock each
  // CREATE TRIGGER takes on its table blocks any concurrent insert for the rest
  // of up(): the backfill and the counter seed then run against a table no
  // writer can slip a row into. Any insert that WAS mid-flight registers itself
  // through the trigger and the backfill's ON CONFLICT DO NOTHING skips it - the
  // same "database boundary before backfill" ordering #434 installed.
  await knex.raw(
    `CREATE TRIGGER "chat_messages_register_feed_position"
     AFTER INSERT ON "${CHAT}"
     FOR EACH ROW EXECUTE FUNCTION fn_register_feed_position('${CHAT_KIND}')`
  );
  await knex.raw(
    `CREATE TRIGGER "draft_activity_register_feed_position"
     AFTER INSERT ON "${ACTIVITY}"
     FOR EACH ROW EXECUTE FUNCTION fn_register_feed_position('${ACTIVITY_KIND}')`
  );

  // Reconciliation: prove one owner per position BEFORE the registry enforces
  // it. If a league already has a position held by BOTH a chat row and an
  // activity row, the backfill's PK insert would abort with an opaque duplicate
  // key; raise a legible error instead and refuse to enforce over an
  // unreconciled feed. None exists today (every writer allocates from the one
  // counter), so this passes - but it makes that a checked precondition.
  await knex.raw(`
    DO $$
    DECLARE collisions bigint;
    BEGIN
      SELECT count(*) INTO collisions FROM (
        SELECT "league_id", "feed_seq" FROM "${CHAT}"
        INTERSECT
        SELECT "league_id", "feed_seq" FROM "${ACTIVITY}"
      ) AS shared;
      IF collisions > 0 THEN
        RAISE EXCEPTION
          'refusing to enforce the shared feed-position namespace: % (league_id, feed_seq) position(s) are held by BOTH a chat row and a draft_activity row; reconcile to one owner per position first (#471)',
          collisions;
      END IF;
    END $$;
  `);

  // Backfill every existing feed row into the registry, chat then activity.
  // ON CONFLICT (record_kind, source_id) DO NOTHING makes a re-run a no-op; the
  // reconciliation above guarantees no (league_id, feed_seq) PK conflict here.
  await knex.raw(`
    INSERT INTO "${REGISTRY}" ("league_id", "feed_seq", "record_kind", "source_id")
    SELECT "league_id", "feed_seq", '${CHAT_KIND}', "id" FROM "${CHAT}"
    ON CONFLICT ("record_kind", "source_id") DO NOTHING
  `);
  await knex.raw(`
    INSERT INTO "${REGISTRY}" ("league_id", "feed_seq", "record_kind", "source_id")
    SELECT "league_id", "feed_seq", '${ACTIVITY_KIND}', "id" FROM "${ACTIVITY}"
    ON CONFLICT ("record_kind", "source_id") DO NOTHING
  `);

  // Hold each league's counter at or above its highest registered position, so
  // the next allocation continues past every reserved position (#471 AC5). The
  // counter was already at each league's chat/activity high-water; this is
  // belt-and-braces and the single point that would matter if a future explicit
  // reservation were ever backfilled ahead of the counter.
  await knex.raw(`
    INSERT INTO "${SEQUENCES}" AS s ("league_id", "last_seq")
    SELECT "league_id", MAX("feed_seq") FROM "${REGISTRY}" GROUP BY "league_id"
    ON CONFLICT ("league_id")
      DO UPDATE SET "last_seq" = GREATEST(s."last_seq", EXCLUDED."last_seq")
  `);

  // Defence in depth on the shared Supabase project, mirroring the record tables
  // and roster_tenures (#240): the app connects as the table owner and bypasses
  // RLS, so enabling it costs nothing here while denying anon / authenticated
  // PostgREST access by default.
  await knex.raw(`ALTER TABLE "${REGISTRY}" ENABLE ROW LEVEL SECURITY`);
};

exports.down = async function (knex) {
  // Unguarded and lossless: the registry mirrors positions the record tables
  // still hold, so the next up() re-derives every row. Runs FIRST in a full
  // reverse rollback (this is the latest migration), so it removes the triggers
  // that read the record tables before those tables are rolled back.
  await knex.raw(`DROP TRIGGER IF EXISTS "chat_messages_register_feed_position" ON "${CHAT}"`);
  await knex.raw(`DROP TRIGGER IF EXISTS "draft_activity_register_feed_position" ON "${ACTIVITY}"`);
  await knex.raw('DROP FUNCTION IF EXISTS fn_register_feed_position()');
  await knex.schema.dropTableIfExists(REGISTRY);
};
