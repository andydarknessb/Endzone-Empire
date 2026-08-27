/**
 * Backfill legacy Chat and Picks into the combined feed, with a cutover
 * boundary and no rolling-deploy gap (#436, ADR 0012).
 *
 * ADR 0012's "Legacy cutover" consequence: surviving chat messages and Picks
 * are backfilled as legacy observable facts that preserve their source IDs and
 * timestamps and are MARKED LEGACY, with equal timestamps ordered
 * deterministically by a record-type tie-breaker and source ID; an explicit
 * cutover BOUNDARY entry is inserted after the legacy set to mark where
 * authoritative shared ordering begins; and historical pause/resume/correction/
 * reset/autopick facts absent from stored data are left UNSTATED rather than
 * fabricated. This migration is that cutover.
 *
 * WHAT ALREADY EXISTS, AND WHAT THIS ADDS.
 *   #434 (20260826000002) gave chat_messages a `feed_seq`, numbered legacy chat
 *        1..N per league by (created_at, id), and a per-league counter.
 *   #435 (20260826000004) added the `draft_activity` store on the SAME counter
 *        and a BEFORE INSERT allocator that RAISES on an explicit feed_seq - a
 *        deliberate tripwire so no runtime writer ever names a position.
 *   #471 (20260827000001) made the per-league position namespace structural: a
 *        `league_feed_positions` registry with PK (league_id, feed_seq) across
 *        BOTH kinds, claimed by an AFTER INSERT trigger that also holds the
 *        counter at or above every reserved position. ADR 0015 states the
 *        reservation contract this migration uses.
 *
 * This migration:
 *   1. Marks legacy rows (`chat_messages.is_legacy`, `draft_activity.is_legacy`)
 *      and records the SOURCE draft_pick id of every Pick entry, legacy or live,
 *      in `draft_activity.source_pick_id` (AC1). That id is the ONE thing
 *      coverage and reconciliation match a Pick to its feed entry by - never the
 *      pick_number, which an undo + re-pick reuses.
 *   2. RE-DERIVES one combined per-league legacy order over chat AND non-keeper
 *      Picks by (created_at, record-type tie-breaker, source id), so a Pick sorts
 *      chronologically among the chat around it. #434's chat-only 1..N is refined
 *      into that interleaving; a chat-only league is unchanged.
 *   3. Inserts one `kind = 'cutover'` BOUNDARY per league that had legacy
 *      content, at the position just after its legacy high-water (AC3), and
 *      seeds the counter to it so live entries continue strictly past it.
 *
 * WHY KEEPERS ARE EXCLUDED. A keeper is pre-inserted into `draft_picks` at draft
 * start, NOT through the live Pick path (draft.service.draftPlayer), so the live
 * feed writes no Draft activity for a keeper. Backfilling keepers as legacy Pick
 * entries would show, in the legacy feed, events the live feed omits, and would
 * make reconciliation flag every keeper as an uncovered Pick forever. So the
 * backfill, capture and reconciliation all skip `is_keeper` rows - the feed's
 * "Picks" are the ones a manager committed live, exactly as #435 records them.
 *
 * WHY RE-DERIVE CHAT RATHER THAN APPEND PICKS AFTER IT. feed_seq is a dense
 * integer chronology; #434 packed chat 1..N with no room between neighbours, so
 * a Pick committed BETWEEN two messages has no position to take without moving
 * chat. ADR 0012 requires "one chronological position" with "equal timestamps
 * ordered by record-type tie-breaker" - a cross-kind tie-breaker only has
 * meaning if the two kinds are sorted TOGETHER. So chat is re-sequenced. It is
 * safe: nothing is live yet (up() REFUSES if it is; see the precondition below),
 * so no client holds a mid-draft cursor, and the #434 positions were themselves
 * synthetic legacy positions this refines.
 *
 * THE TIE-BREAKER (AC2). Within a league the legacy order is
 *     (created_at ASC, record kind [Pick before chat], source id ASC).
 * At an equal instant a Pick precedes a chat message; kind is compared BEFORE
 * source id because chat ids and draft_pick ids come from different sequences and
 * could coincide, so ordering by kind first makes the whole order total.
 *
 * WHY is_autopick IS false AND pause/resume/correction ARE ABSENT. ADR 0012
 * leaves absent historical facts unstated rather than fabricated. draft_picks
 * stores no autopick flag, so a legacy Pick is `is_autopick = false` - "not known
 * to be an autopick", never a claim. No legacy lifecycle rows are invented.
 *
 * WHY THE ALLOCATE TRIGGER IS DISABLED, NOT REDEFINED. The legacy Picks and the
 * boundary name explicit positions, which #435's allocator RAISES on. That guard
 * is still worth keeping for RUNTIME (no live writer supplies an explicit
 * feed_seq - both appendPickActivity and captureLegacyPicks insert NULL and let
 * the counter allocate), so rather than lift it globally, up() DISABLES the
 * BEFORE INSERT allocate trigger around its own explicit-position inserts and
 * re-enables it before commit. The registrar AFTER INSERT trigger stays enabled,
 * so each explicit position is still claimed in the shared registry and advances
 * the counter (ADR 0015). The whole of up() is one knex transaction under the
 * table locks the ADD COLUMNs take, so no concurrent insert sees the trigger
 * disabled.
 *
 * PRECONDITION (checked in SQL). The backfill's premise is that no authoritative
 * live ordering exists yet - it re-sequences chat and reserves explicit
 * positions, which is only safe on a feed that has not gone live. up() RAISES if
 * any `draft_activity` row is a live event (not legacy, not the boundary),
 * mirroring 20260827000001's reconciliation precondition, so the safety rests on
 * a checked fact rather than an assumption a reader of the diff cannot verify.
 *
 * ROLLBACK (AC7). down() is LOSSLESS while activity is only legacy + boundary
 * (all re-derivable) and REFUSES once any authoritative live event exists,
 * because dropping those would erase append-only history (ADR 0012). On a fresh
 * CI database the guards pass and up()/down() are near no-ops.
 *
 * MIGRATIONS ARE A CARVE-OUT (fleet policy): written here, applied and verified
 * by the maintainer against `knex_migrations`. An IC does not run it. Apply it
 * when NO draft is live and ideally at low traffic: `ALTER TABLE ... ADD COLUMN`
 * takes an ACCESS EXCLUSIVE lock on chat_messages and draft_activity - which
 * blocks reads as well as writes - and that lock is held for the WHOLE of up()
 * (the re-sequence and backfill run inside the same transaction), on every
 * league at once.
 */

const CHAT = 'chat_messages';
const ACTIVITY = 'draft_activity';
const REGISTRY = 'league_feed_positions';
const SEQUENCES = 'league_feed_sequences';
const PICKS = 'draft_picks';

const CHAT_KIND = 'league_chat';
const PICK = 'pick';
const CUTOVER = 'cutover';
const ALLOCATE_TRIGGER = 'draft_activity_allocate_feed_seq';

exports.up = async function (knex) {
  // 1. LEGACY MARKERS + SOURCE IDENTITY. is_legacy defaults false so future live
  //    rows are not legacy; the backfill sets the existing rows true.
  //    source_pick_id records the draft_picks id a Pick entry represents - set by
  //    this backfill for a legacy Pick and by appendPickActivity for a live one -
  //    so "is this Pick in the feed" is answered by identity, not by a reused
  //    pick_number. It carries no FK: the source Pick is hard-deleted by a later
  //    correction, undo or reset, and the append-only entry must keep the id.
  //    This composes with the precondition (step 2): because up() REFUSES over
  //    any live draft_activity, there are NO pre-existing live Pick entries at
  //    cutover, so no live row's source_pick_id needs backfilling here - only the
  //    legacy Picks below set it, and every later live Pick sets its own through
  //    appendPickActivity. The two guarantees are linked, not coincidental.
  await knex.schema.alterTable(CHAT, (t) => {
    t.boolean('is_legacy').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable(ACTIVITY, (t) => {
    t.boolean('is_legacy').notNullable().defaultTo(false);
    t.integer('source_pick_id');
  });
  // A source_pick_id belongs only to a Pick (legacy or live); never on the
  // boundary, a lifecycle event or a correction. Stating it as a CHECK keeps the
  // marker honest the same way draft_activity's other kind-scoped CHECKs do.
  await knex.raw(`ALTER TABLE "${ACTIVITY}"
    ADD CONSTRAINT "draft_activity_source_pick_id_shape" CHECK (
      "source_pick_id" IS NULL OR "kind" = '${PICK}'
    )`);
  // One feed entry per source Pick. A re-pick after an undo is a NEW draft_picks
  // row with a new id, so it does not collide with the reversed Pick's entry.
  await knex.raw(
    `CREATE UNIQUE INDEX "draft_activity_source_pick_id"
     ON "${ACTIVITY}" ("source_pick_id")
     WHERE "source_pick_id" IS NOT NULL`
  );

  // 2. PRECONDITION (Blocker 2 / ADR 0015 posture): refuse to run over a feed
  //    that already holds authoritative live activity. The backfill re-sequences
  //    chat and reserves explicit positions, which is only safe before go-live.
  //    A boundary (kind='cutover') and legacy Picks (is_legacy=true) are this
  //    migration's own rows, so a re-run does not trip it; a genuine live event
  //    does.
  await knex.raw(`
    DO $$
    DECLARE live_count bigint;
    BEGIN
      SELECT count(*) INTO live_count FROM "${ACTIVITY}"
       WHERE "is_legacy" = false AND "kind" <> '${CUTOVER}';
      IF live_count > 0 THEN
        RAISE EXCEPTION
          'refusing to backfill the legacy feed: draft_activity already holds % authoritative live event(s); the cutover must run before any live Draft ordering exists (#436, ADR 0012)',
          live_count;
      END IF;
    END $$;
  `);

  // 3. THE COMBINED LEGACY ORDER. One row per surviving chat message and per
  //    surviving NON-KEEPER Pick, numbered 1..M per league by the documented
  //    tie-breaker. Built only for leagues without a cutover boundary yet, so a
  //    re-run touches nothing already backfilled. ON COMMIT DROP.
  await knex.raw(`
    CREATE TEMP TABLE "_legacy_feed_order" ON COMMIT DROP AS
    WITH combined AS (
      SELECT "league_id", '${CHAT_KIND}'::text AS record_kind, "id" AS source_id, "created_at"
        FROM "${CHAT}"
      UNION ALL
      SELECT "league_id", 'draft_pick'::text AS record_kind, "id" AS source_id, "created_at"
        FROM "${PICKS}"
       WHERE "is_keeper" = false
    )
    SELECT "league_id", "record_kind", "source_id", "created_at",
           row_number() OVER (
             PARTITION BY "league_id"
             ORDER BY "created_at",
                      CASE "record_kind" WHEN 'draft_pick' THEN 0 ELSE 1 END,
                      "source_id"
           ) AS "new_seq"
      FROM combined
     WHERE "league_id" NOT IN (SELECT "league_id" FROM "${ACTIVITY}" WHERE "kind" = '${CUTOVER}')
  `);

  const pending = await knex.raw('SELECT count(*)::int AS n FROM "_legacy_feed_order"');
  if (pending.rows[0].n === 0) return;

  // 4. CLEAR THE REGISTRY for every affected league. Its chat rows are about to
  //    be re-positioned (an UPDATE the registrar trigger does not see) and its
  //    Pick rows do not exist yet; the trigger repopulates Picks and the boundary
  //    as they INSERT below, and this migration re-inserts chat. The namespace is
  //    emptied, then refilled with one contiguous partition per league, so no
  //    cross-kind PK conflict can arise.
  await knex.raw(`
    DELETE FROM "${REGISTRY}"
     WHERE "league_id" IN (SELECT DISTINCT "league_id" FROM "_legacy_feed_order")
  `);

  // 5. VACATE chat positions out of the target range so the re-number cannot
  //    transiently collide on the (league_id, feed_seq) unique index. Negating
  //    moves every position to a value the new 1..M targets never reuse.
  await knex.raw(`
    UPDATE "${CHAT}"
       SET "feed_seq" = -"feed_seq"
     WHERE "league_id" IN (SELECT DISTINCT "league_id" FROM "_legacy_feed_order")
       AND "feed_seq" > 0
  `);

  // Disable the BEFORE INSERT allocator so the explicit legacy/boundary positions
  // pass through untouched; the registrar AFTER INSERT trigger stays on and claims
  // each. Re-enabled before commit (step 9a), so runtime keeps the RAISE guard.
  await knex.raw(`ALTER TABLE "${ACTIVITY}" DISABLE TRIGGER "${ALLOCATE_TRIGGER}"`);

  // 6. BACKFILL LEGACY PICKS (non-keeper) as draft_activity 'pick' rows at their
  //    combined position, snapshotting the facts the append-only entry must keep
  //    and preserving the ORIGINAL timestamp and source id (AC1). round is derived
  //    from the league's team count exactly as the live path does. is_autopick is
  //    false: the fact was never stored, so it is left unstated (ADR 0012). The
  //    NOT EXISTS on source_pick_id makes a re-run insert nothing already present.
  await knex.raw(`
    INSERT INTO "${ACTIVITY}"
      ("league_id", "kind", "team_id", "team_name",
       "player_id", "player_name", "player_position", "player_nfl_team",
       "round", "pick_number", "is_autopick", "is_legacy", "source_pick_id",
       "feed_seq", "created_at")
    SELECT dp."league_id", '${PICK}', dp."team_id", t."name",
           dp."player_id", p."name", p."position", p."nfl_team",
           -- integer division truncates, which is floor for a 1-based pick number
           ((dp."pick_number" - 1) / tc."team_count" + 1)::int,
           dp."pick_number", false, true, dp."id",
           m."new_seq", dp."created_at"
      FROM "${PICKS}" dp
      JOIN "_legacy_feed_order" m
        ON m."record_kind" = 'draft_pick' AND m."source_id" = dp."id" AND m."league_id" = dp."league_id"
      LEFT JOIN "teams" t ON t."id" = dp."team_id"
      LEFT JOIN "players" p ON p."id" = dp."player_id"
      -- team_count is never zero here: draft_picks.team_id is NOT NULL with an
      -- ON DELETE CASCADE FK to teams, so a league that still has a Pick still
      -- has that Pick's team. The inner JOIN therefore drops no surviving Pick.
      JOIN (SELECT "league_id", count(*) AS "team_count" FROM "teams" GROUP BY "league_id") tc
        ON tc."league_id" = dp."league_id"
     WHERE NOT EXISTS (
       SELECT 1 FROM "${ACTIVITY}" a WHERE a."source_pick_id" = dp."id"
     )
  `);

  // 7. SET FINAL CHAT POSITIONS and mark them legacy. Targets are the 1..M
  //    combined positions; current chat values are the vacated negatives, so no
  //    row being updated lands on an occupied position. No trigger fires on an
  //    UPDATE, which is why step 8 re-registers chat by hand.
  await knex.raw(`
    UPDATE "${CHAT}" c
       SET "feed_seq" = m."new_seq", "is_legacy" = true
      FROM "_legacy_feed_order" m
     WHERE m."record_kind" = '${CHAT_KIND}' AND m."source_id" = c."id" AND m."league_id" = c."league_id"
  `);

  // 8. RE-REGISTER CHAT positions. Positions are disjoint from the Pick positions
  //    in the same league (one contiguous partition), so no PK conflict.
  await knex.raw(`
    INSERT INTO "${REGISTRY}" ("league_id", "feed_seq", "record_kind", "source_id")
    SELECT c."league_id", c."feed_seq", '${CHAT_KIND}', c."id"
      FROM "${CHAT}" c
     WHERE c."league_id" IN (SELECT DISTINCT "league_id" FROM "_legacy_feed_order")
  `);

  // 9. THE CUTOVER BOUNDARY (AC3): one 'cutover' row per affected league at the
  //    position just past its legacy high-water. is_legacy is false - the boundary
  //    is where authoritative live ordering begins. It carries no Team or Pick
  //    facts. The registrar trigger claims it and advances the counter to it.
  await knex.raw(`
    INSERT INTO "${ACTIVITY}" ("league_id", "kind", "is_legacy", "feed_seq", "created_at")
    SELECT "league_id", '${CUTOVER}', false, max("new_seq") + 1, now()
      FROM "_legacy_feed_order"
     GROUP BY "league_id"
  `);

  // 9a. Re-enable the allocator so runtime inserts keep the explicit-feed_seq
  //     RAISE guard. (Enabled at commit; the disable never escaped this txn.)
  await knex.raw(`ALTER TABLE "${ACTIVITY}" ENABLE TRIGGER "${ALLOCATE_TRIGGER}"`);

  // 10. SEED THE COUNTER to each affected league's registry high-water (#471 AC5).
  await knex.raw(`
    INSERT INTO "${SEQUENCES}" AS s ("league_id", "last_seq")
    SELECT "league_id", max("feed_seq") FROM "${REGISTRY}"
     WHERE "league_id" IN (SELECT DISTINCT "league_id" FROM "_legacy_feed_order")
     GROUP BY "league_id"
    ON CONFLICT ("league_id") DO UPDATE SET "last_seq" = GREATEST(s."last_seq", EXCLUDED."last_seq")
  `);
};

exports.down = async function (knex) {
  // AC7 guarded rollback: refuse once authoritative live activity exists. A live
  // event is any draft_activity row that is neither legacy nor the boundary.
  const live = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM "${ACTIVITY}" WHERE "is_legacy" = false AND "kind" <> '${CUTOVER}'
     ) AS present`
  );
  if (live.rows[0].present) {
    throw new Error(
      'refusing to roll back the legacy feed backfill: draft_activity holds ' +
        'authoritative live events (ADR 0012 append-only). Recover with a forward ' +
        'migration or the rollout flag, never a destructive rollback.'
    );
  }

  // Only legacy + boundary remain. They are synthetic: re-derived from the CURRENT
  // chat_messages and draft_picks by the next up(). So the reverse is faithful to
  // the SOURCES, not to a snapshot - a Pick undone or reset between the backfill
  // and this rollback (its draft_picks row hard-deleted) is correctly absent after
  // the next up() re-derives, rather than resurrected. The append-only contract
  // that must never be lost is LIVE activity, and the guard above refuses the
  // rollback while any exists; legacy rows are always reproducible from the
  // sources that remain.
  //
  // Capture the affected leagues (those carrying a boundary) before deleting the
  // boundary rows, and drive every step off it (no array bindings, so the whole
  // reverse is set-based SQL).
  await knex.raw(`
    CREATE TEMP TABLE "_affected_leagues" ON COMMIT DROP AS
    SELECT DISTINCT "league_id" FROM "${ACTIVITY}" WHERE "kind" = '${CUTOVER}'
  `);
  const affected = await knex.raw('SELECT count(*)::int AS n FROM "_affected_leagues"');

  // Remove the legacy Picks and the boundary; draft_activity is now empty of
  // everything this migration wrote, so its own guarded down() passes.
  await knex.raw(`DELETE FROM "${ACTIVITY}" WHERE "is_legacy" = true OR "kind" = '${CUTOVER}'`);

  if (affected.rows[0].n > 0) {
    await knex.raw(`DELETE FROM "${REGISTRY}" WHERE "league_id" IN (SELECT "league_id" FROM "_affected_leagues")`);

    await knex.raw(`
      CREATE TEMP TABLE "_chat_only_order" ON COMMIT DROP AS
      SELECT "id", "league_id",
             row_number() OVER (PARTITION BY "league_id" ORDER BY "created_at", "id") AS "new_seq"
        FROM "${CHAT}"
       WHERE "league_id" IN (SELECT "league_id" FROM "_affected_leagues")
    `);

    await knex.raw(`UPDATE "${CHAT}" SET "feed_seq" = -"feed_seq" WHERE "league_id" IN (SELECT "league_id" FROM "_affected_leagues") AND "feed_seq" > 0`);
    await knex.raw(`
      UPDATE "${CHAT}" c
         SET "feed_seq" = o."new_seq"
        FROM "_chat_only_order" o
       WHERE o."id" = c."id"
    `);
    await knex.raw(`
      INSERT INTO "${REGISTRY}" ("league_id", "feed_seq", "record_kind", "source_id")
      SELECT "league_id", "feed_seq", '${CHAT_KIND}', "id" FROM "${CHAT}"
       WHERE "league_id" IN (SELECT "league_id" FROM "_affected_leagues")
    `);
    await knex.raw(`
      INSERT INTO "${SEQUENCES}" AS s ("league_id", "last_seq")
      SELECT "league_id", COALESCE(max("feed_seq"), 0) FROM "${CHAT}"
       WHERE "league_id" IN (SELECT "league_id" FROM "_affected_leagues")
       GROUP BY "league_id"
      ON CONFLICT ("league_id") DO UPDATE SET "last_seq" = EXCLUDED."last_seq"
    `);
  }

  // Drop the markers. The allocate trigger's function was never modified (up()
  // only disabled and re-enabled the trigger), so there is nothing to restore.
  await knex.raw(`DROP INDEX IF EXISTS "draft_activity_source_pick_id"`);
  await knex.raw(`ALTER TABLE "${ACTIVITY}" DROP CONSTRAINT IF EXISTS "draft_activity_source_pick_id_shape"`);
  await knex.schema.alterTable(ACTIVITY, (t) => {
    t.dropColumn('is_legacy');
    t.dropColumn('source_pick_id');
  });
  await knex.schema.alterTable(CHAT, (t) => {
    t.dropColumn('is_legacy');
  });
};
