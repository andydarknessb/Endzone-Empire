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
 *   #435 (20260826000004) added the empty `draft_activity` store on the SAME
 *        counter and a BEFORE INSERT allocator that RAISES on an explicit
 *        feed_seq - a deliberate tripwire whose header says lifting it is #436's
 *        job.
 *   #471 (20260827000001) made the per-league position namespace structural: a
 *        `league_feed_positions` registry with PK (league_id, feed_seq) across
 *        BOTH kinds, claimed by an AFTER INSERT trigger that also holds the
 *        counter at or above every reserved position. ADR 0015 states the
 *        reservation contract this migration uses: an explicit legacy or cutover
 *        position reserves through that one namespace and fails atomically on
 *        conflict.
 *
 * This migration:
 *   1. LIFTS the draft_activity explicit-feed_seq tripwire (per #435's header
 *      and ADR 0015) so legacy Picks and the boundary can name their positions;
 *      the registry PK is now the structural protection the tripwire stood in
 *      for.
 *   2. Marks legacy rows: `chat_messages.is_legacy`, `draft_activity.is_legacy`,
 *      and records each legacy Pick's ORIGINAL source id in
 *      `draft_activity.legacy_pick_id` (AC1: preserve source identifiers).
 *   3. RE-DERIVES one combined per-league legacy order over chat AND Picks by
 *      (created_at, record-type tie-breaker, source id), so a Pick sorts
 *      chronologically among the chat around it - not in a block after all chat.
 *      #434's chat-only 1..N is refined into that interleaving; a chat-only
 *      league is unchanged (the tie-breaker never fires without Picks).
 *   4. Inserts one `kind = 'cutover'` BOUNDARY entry per league that had legacy
 *      content, at the position just after its legacy high-water (AC3), and
 *      seeds the counter to it so live entries continue strictly past it.
 *
 * WHY RE-DERIVE CHAT RATHER THAN APPEND PICKS AFTER IT. feed_seq is a dense
 * integer chronology; #434 packed chat 1..N with no room between neighbours, so
 * a Pick committed BETWEEN two messages has no position to take without moving
 * chat. ADR 0012 requires "one chronological position" with "equal timestamps
 * ordered by record-type tie-breaker" - a cross-kind tie-breaker only has
 * meaning if the two kinds are sorted TOGETHER. Appending Picks after chat would
 * put every legacy Pick after every legacy message regardless of when it
 * happened, which is not one chronology. So chat is re-sequenced. It is safe:
 * nothing is live yet (draft_activity is empty of authoritative events until the
 * rollout flag flips, #447), so no client holds a mid-draft cursor, and the
 * #434 positions were themselves synthetic legacy positions this refines.
 *
 * THE TIE-BREAKER (AC2), documented so it is a rule, not an accident. Within a
 * league the legacy order is:
 *     (created_at ASC, record kind [Pick before chat], source id ASC)
 * At an equal instant a Pick precedes a chat message (a Pick is the
 * authoritative event; chat is commentary around it), and within one kind the
 * source id breaks the remaining tie. Kind is compared BEFORE source id because
 * chat ids and draft_pick ids come from different sequences and could coincide;
 * ordering by kind first makes the whole order total and deterministic. This
 * matches the glossary's "Cutover boundary" / "Legacy feed entry" terms.
 *
 * WHY is_autopick IS false AND pause/resume/correction ARE ABSENT. ADR 0012
 * leaves absent historical facts unstated rather than fabricated. draft_picks
 * stores no autopick flag (only the live #435 path knows `auto`), so a legacy
 * Pick is `is_autopick = false` - "not known to be an autopick", never a claim
 * that a manager made it. Historical pause/resume/reset/correction events were
 * never recorded, so no legacy lifecycle rows are invented; only surviving Picks
 * and messages become facts.
 *
 * THE REGISTRY, DURING THE BACKFILL. The re-sequence UPDATEs chat_messages,
 * which fires NO trigger (the allocator and the registrar are both INSERT-only),
 * so the registry's chat rows would go stale. Rather than fight the triggers,
 * this migration clears the registry for every affected league, then lets the
 * registrar trigger claim each legacy Pick and the boundary as they INSERT, and
 * re-inserts the chat positions itself. Chat and Pick positions partition a
 * contiguous 1..M run, so no cross-kind PK conflict is possible. The whole of
 * up() runs in one knex transaction under the table locks the ADD COLUMNs take,
 * so no concurrent insert interleaves (the same runner property #434 relies on).
 *
 * ROLLBACK (AC7). down() is LOSSLESS while activity is only legacy + boundary
 * (all re-derivable) and REFUSES once any authoritative live event exists (a
 * non-legacy row that is not the boundary - a real post-cutover Pick, lifecycle
 * or correction), because dropping those would erase append-only history
 * (ADR 0012's guarded rollback). On a fresh CI database (the migrate ->
 * rollback -> migrate smoke) there is no legacy content, so both up() and down()
 * are near no-ops and the smoke stays clean.
 *
 * MIGRATIONS ARE A CARVE-OUT (fleet policy): written here, applied and verified
 * by the maintainer against `knex_migrations`. An IC does not run it. Apply it
 * when no draft is live: up() briefly holds locks on chat_messages and
 * draft_activity while it re-sequences and backfills.
 */

const CHAT = 'chat_messages';
const ACTIVITY = 'draft_activity';
const REGISTRY = 'league_feed_positions';
const SEQUENCES = 'league_feed_sequences';
const PICKS = 'draft_picks';

const CHAT_KIND = 'league_chat';
const PICK = 'pick';
const CUTOVER = 'cutover';

exports.up = async function (knex) {
  // 1. LIFT THE TRIPWIRE. draft_activity's allocator raised on any explicit
  //    feed_seq (20260826000004) so an accidental explicit position could not
  //    slip in before #471 made the namespace structural. #471 shipped; the
  //    registry PK now rejects a cross-kind collision atomically, so the
  //    explicit legacy/cutover path this migration needs is safe. The function
  //    keeps allocating from the counter for the ordinary (feed_seq IS NULL)
  //    path every live Pick still uses, and now passes an explicit position
  //    through instead of raising - matching chat's allocator (#434).
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_allocate_draft_activity_feed_seq() RETURNS trigger AS $$
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

  // 2. LEGACY MARKERS. is_legacy defaults false so future live rows are not
  //    legacy; the backfill sets the existing rows true. legacy_pick_id records
  //    the ORIGINAL draft_picks id a legacy activity row came from (AC1) and,
  //    through a partial unique index, makes the Pick backfill idempotent - a
  //    Pick cannot be backfilled twice. It carries no FK: the source Pick is
  //    hard-deleted by a later correction or reset, and the append-only legacy
  //    row must keep the id as a historical fact rather than have it nulled.
  await knex.schema.alterTable(CHAT, (t) => {
    t.boolean('is_legacy').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable(ACTIVITY, (t) => {
    t.boolean('is_legacy').notNullable().defaultTo(false);
    t.integer('legacy_pick_id');
  });
  // legacy_pick_id belongs only to a legacy Pick: never on the boundary, a live
  // Pick or a lifecycle/correction row. Stating it as a CHECK keeps the marker
  // honest the same way draft_activity's other kind-scoped CHECKs do.
  await knex.raw(`ALTER TABLE "${ACTIVITY}"
    ADD CONSTRAINT "draft_activity_legacy_pick_id_shape" CHECK (
      "legacy_pick_id" IS NULL OR ("is_legacy" = true AND "kind" = '${PICK}')
    )`);
  await knex.raw(
    `CREATE UNIQUE INDEX "draft_activity_legacy_pick_id"
     ON "${ACTIVITY}" ("legacy_pick_id")
     WHERE "legacy_pick_id" IS NOT NULL`
  );

  // 3. THE COMBINED LEGACY ORDER. One row per surviving chat message and per
  //    surviving Pick, numbered 1..M per league by the documented tie-breaker.
  //    Built ONLY for leagues that have no cutover boundary yet, so a re-run
  //    (defensive; knex runs up() once) touches nothing already backfilled.
  //    ON COMMIT DROP: the temp table lives for this transaction only.
  await knex.raw(`
    CREATE TEMP TABLE "_legacy_feed_order" ON COMMIT DROP AS
    WITH combined AS (
      SELECT "league_id", '${CHAT_KIND}'::text AS record_kind, "id" AS source_id, "created_at"
        FROM "${CHAT}"
      UNION ALL
      SELECT "league_id", 'draft_pick'::text AS record_kind, "id" AS source_id, "created_at"
        FROM "${PICKS}"
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

  // Nothing to do (fresh CI database, or every league already backfilled): the
  // remaining steps are all scoped to _legacy_feed_order, so an empty table
  // makes them no-ops, but returning early keeps the intent obvious.
  const pending = await knex.raw('SELECT count(*)::int AS n FROM "_legacy_feed_order"');
  if (pending.rows[0].n === 0) return;

  // 4. CLEAR THE REGISTRY for every affected league. Its chat rows are about to
  //    be re-positioned (an UPDATE the registrar trigger does not see) and its
  //    Pick rows do not exist yet; the trigger repopulates Picks and the
  //    boundary as they INSERT below, and this migration re-inserts chat. This
  //    is why no cross-kind PK conflict can arise: the namespace is emptied,
  //    then refilled with one contiguous partition per league.
  await knex.raw(`
    DELETE FROM "${REGISTRY}"
     WHERE "league_id" IN (SELECT DISTINCT "league_id" FROM "_legacy_feed_order")
  `);

  // 5. VACATE chat positions out of the target range so the re-number cannot
  //    transiently collide on the (league_id, feed_seq) unique index. Negating
  //    moves every position to a value the new 1..M targets never reuse; the
  //    map back to final positions in step 7 then meets no occupied slot. All
  //    within one transaction, so these negatives are never read by anyone.
  await knex.raw(`
    UPDATE "${CHAT}"
       SET "feed_seq" = -"feed_seq"
     WHERE "league_id" IN (SELECT DISTINCT "league_id" FROM "_legacy_feed_order")
       AND "feed_seq" > 0
  `);

  // 6. BACKFILL LEGACY PICKS as draft_activity 'pick' rows at their combined
  //    position, snapshotting the facts the append-only entry must keep (Team,
  //    player, position, NFL team, round, overall Pick number) and preserving
  //    the ORIGINAL timestamp and source id (AC1). round is derived from the
  //    league's team count exactly as the live path does
  //    (floor((pick_number - 1) / teams) + 1). is_autopick is false: the fact
  //    was never stored, so it is left unstated, not fabricated (ADR 0012). The
  //    explicit feed_seq is now accepted by the lifted allocator, and the
  //    registrar trigger claims each position and advances the counter.
  await knex.raw(`
    INSERT INTO "${ACTIVITY}"
      ("league_id", "kind", "team_id", "team_name",
       "player_id", "player_name", "player_position", "player_nfl_team",
       "round", "pick_number", "is_autopick", "is_legacy", "legacy_pick_id",
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
       SELECT 1 FROM "${ACTIVITY}" a WHERE a."legacy_pick_id" = dp."id"
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

  // 8. RE-REGISTER CHAT positions. Picks (step 6) and the boundary (step 9)
  //    register through the trigger; chat moved by UPDATE, so its registry rows
  //    are inserted here. Positions are disjoint from the Pick positions in the
  //    same league (one contiguous partition), so no PK conflict.
  await knex.raw(`
    INSERT INTO "${REGISTRY}" ("league_id", "feed_seq", "record_kind", "source_id")
    SELECT c."league_id", c."feed_seq", '${CHAT_KIND}', c."id"
      FROM "${CHAT}" c
     WHERE c."league_id" IN (SELECT DISTINCT "league_id" FROM "_legacy_feed_order")
  `);

  // 9. THE CUTOVER BOUNDARY (AC3): one 'cutover' row per affected league at the
  //    position just past its legacy high-water. is_legacy is false - the
  //    boundary is where authoritative live ordering begins, not part of the
  //    legacy set it separates. It carries no Team or Pick facts (it is not a
  //    Draft event); the pick-fields CHECK requires them only for a 'pick', and
  //    the reason CHECK requires reason null for every non-correction kind. Its
  //    created_at is the cutover instant. The registrar trigger claims it and
  //    advances the counter to it.
  await knex.raw(`
    INSERT INTO "${ACTIVITY}" ("league_id", "kind", "is_legacy", "feed_seq", "created_at")
    SELECT "league_id", '${CUTOVER}', false, max("new_seq") + 1, now()
      FROM "_legacy_feed_order"
     GROUP BY "league_id"
  `);

  // 10. SEED THE COUNTER to each affected league's registry high-water (the
  //     boundary position). The registrar trigger already advanced it on every
  //     claim; this is the belt-and-braces guarantee #471 AC5 states - the
  //     counter never sits behind a reserved position, so the next live
  //     allocation continues strictly past the boundary.
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
  // event is any draft_activity row that is neither legacy nor the boundary - a
  // real post-cutover Pick, lifecycle transition or correction. Dropping those
  // would erase append-only history (ADR 0012), so recovery after go-live is a
  // forward migration or the rollout flag, never this down().
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

  // Only legacy + boundary remain, all re-derivable. Undo the backfill so the
  // schema and data return to the pre-#436 state (chat back to #434's chat-only
  // 1..N, draft_activity empty, registry mirroring chat only, counter at chat's
  // high-water). The affected leagues are exactly those that carry a boundary;
  // capture them into a temp table before deleting the boundary rows, and drive
  // every step off it (no array bindings, so the whole reverse is set-based SQL).
  await knex.raw(`
    CREATE TEMP TABLE "_affected_leagues" ON COMMIT DROP AS
    SELECT DISTINCT "league_id" FROM "${ACTIVITY}" WHERE "kind" = '${CUTOVER}'
  `);
  const affected = await knex.raw('SELECT count(*)::int AS n FROM "_affected_leagues"');

  // Remove the legacy Picks and the boundary. draft_activity is now empty of
  // everything this migration wrote (and the live guard proved nothing else is
  // there), so its own guarded down() will pass in a full reverse rollback.
  await knex.raw(`DELETE FROM "${ACTIVITY}" WHERE "is_legacy" = true OR "kind" = '${CUTOVER}'`);

  if (affected.rows[0].n > 0) {
    // Rebuild the registry and chat positions for the affected leagues from the
    // #434 chat-only order. Clear the namespace, restore chat to (created_at,
    // id) 1..N with the same vacate-then-map the up() used, re-register chat,
    // and reset the counter to chat's high-water.
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

  // Drop the markers and restore the explicit-feed_seq tripwire on
  // draft_activity, so the schema matches the pre-#436 shape exactly.
  await knex.raw(`DROP INDEX IF EXISTS "draft_activity_legacy_pick_id"`);
  await knex.raw(`ALTER TABLE "${ACTIVITY}" DROP CONSTRAINT IF EXISTS "draft_activity_legacy_pick_id_shape"`);
  await knex.schema.alterTable(ACTIVITY, (t) => {
    t.dropColumn('is_legacy');
    t.dropColumn('legacy_pick_id');
  });
  await knex.schema.alterTable(CHAT, (t) => {
    t.dropColumn('is_legacy');
  });
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_allocate_draft_activity_feed_seq() RETURNS trigger AS $$
    BEGIN
      IF NEW."feed_seq" IS NOT NULL THEN
        RAISE EXCEPTION 'draft_activity.feed_seq is trigger-allocated from league_feed_sequences and must not be supplied explicitly (see #471 before lifting this guard)';
      END IF;
      INSERT INTO "${SEQUENCES}" AS s ("league_id", "last_seq")
      VALUES (NEW."league_id", 1)
      ON CONFLICT ("league_id") DO UPDATE SET "last_seq" = s."last_seq" + 1
      RETURNING s."last_seq" INTO NEW."feed_seq";
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
  `);
};
