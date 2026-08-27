/**
 * Legacy feed reconciliation and rollout-window Pick capture (#436, ADR 0012).
 *
 * The one-time mass backfill - re-sequencing legacy chat and Picks into one
 * combined order and inserting the cutover boundary - lives in the migration
 * (20260827000010), which the maintainer applies. This module is the pair of
 * primitives the STAGING step (#447) runs against the applied schema, before it
 * flips the read cutover:
 *
 *   captureLegacyPicks   closes the rolling-deploy gap (AC4). Between the
 *                        migration and the moment every server runs the new
 *                        code, an OLD instance can still commit a Pick as a
 *                        `draft_picks` row with no `draft_activity` entry. This
 *                        appends the missing entry idempotently, so no surviving
 *                        Pick is absent from the feed.
 *
 *   reconcileLegacyFeed  proves, before read cutover (AC5), that the feed is
 *                        whole: every surviving Pick and message is covered by a
 *                        registered position AT THE RIGHT feed_seq, no per-league
 *                        position is owned by two kinds, and no counter sits
 *                        behind its league's high-water. It reports rather than
 *                        mutates, so the staging step can gate on a clean result.
 *
 * COVERAGE IS BY SOURCE-PICK IDENTITY, NOT pick_number. A Pick is represented in
 * the feed when a `draft_activity` row carries its `source_pick_id` - the id of
 * the `draft_picks` row it snapshots, set by the legacy backfill, by the live
 * append path, and by this capture. Matching on pick_number instead would report
 * a re-picked number as covered by the reversed Pick's stale entry (undo hard-
 * deletes a draft_picks row and a re-pick reuses its number), a false all-clear
 * on the very instrument AC5 exists to trust.
 *
 * KEEPERS ARE NOT FEED PICKS. A keeper is pre-inserted into `draft_picks` at
 * draft start, not through the live Pick path, so the live feed writes no
 * activity for it. Capture and reconciliation both skip `is_keeper` rows, exactly
 * as the migration's backfill does, so a keeper is never treated as an uncovered
 * Pick (which would fail reconciliation forever) and never fabricated into the
 * feed.
 */

const { PICK } = require('./draftActivity');

/**
 * A surviving, non-keeper Pick is COVERED when a `draft_activity` row already
 * carries its `source_pick_id`. One identity, so capture and reconciliation
 * agree whether the entry arrived through the backfill, the live path or this
 * capture, and a reused pick_number can never make a different Pick look covered.
 */
const PICK_COVERED = `
  EXISTS (
    SELECT 1 FROM "draft_activity" a WHERE a."source_pick_id" = dp."id"
  )`;

/**
 * Append a `draft_activity` Pick entry for every surviving, non-keeper
 * `draft_picks` row that has none, INSIDE the given executor (a pool or a
 * transaction client), and return how many were captured. Optionally scoped to
 * one league.
 *
 * These are rollout-window stragglers: Picks an old instance committed after the
 * migration without writing activity. They are LIVE (post-cutover) events, so
 * the row names no `feed_seq` - the counter allocator assigns the next position
 * past the boundary and the registrar claims it - and is_legacy is false. It
 * records the source Pick's id in `source_pick_id`, so a second run sees it
 * covered and captures nothing. The original timestamp is preserved. round is
 * derived from the league's team count exactly as the live path and the migration
 * do; if that rule ever changes, all three move together.
 *
 * Idempotent, and it never touches chat, the boundary, a keeper or the
 * already-backfilled legacy set.
 */
async function captureLegacyPicks(db, { leagueId = null } = {}) {
  const params = [];
  let leagueClause = '';
  if (leagueId != null) {
    params.push(leagueId);
    leagueClause = `AND dp."league_id" = $${params.length}`;
  }
  const result = await db.query(
    `INSERT INTO "draft_activity"
       ("league_id", "kind", "team_id", "team_name",
        "player_id", "player_name", "player_position", "player_nfl_team",
        "round", "pick_number", "is_autopick", "is_legacy", "source_pick_id", "created_at")
     SELECT dp."league_id", '${PICK}', dp."team_id", t."name",
            dp."player_id", p."name", p."position", p."nfl_team",
            -- integer division truncates, which is floor for a 1-based pick number
            ((dp."pick_number" - 1) / tc."team_count" + 1)::int,
            dp."pick_number", false, false, dp."id", dp."created_at"
       FROM "draft_picks" dp
       LEFT JOIN "teams" t ON t."id" = dp."team_id"
       LEFT JOIN "players" p ON p."id" = dp."player_id"
       JOIN (SELECT "league_id", count(*) AS "team_count" FROM "teams" GROUP BY "league_id") tc
         ON tc."league_id" = dp."league_id"
      WHERE dp."is_keeper" = false
        AND NOT ${PICK_COVERED}
        ${leagueClause}
      ORDER BY dp."created_at", dp."pick_number"`,
    params
  );
  return result.rowCount;
}

/**
 * Turn the raw problem rows the reconciliation queries return into a verdict.
 * Pure so it can be unit-tested without a database: each argument is the set of
 * rows that FAILED a check (empty means that check passed), and the report is
 * `ok` only when every set is empty.
 *
 *   uncoveredPicks       leagues with a surviving, non-keeper Pick that no
 *                        activity entry carries the source id of (AC5).
 *   crossKindDuplicates  (league_id, feed_seq) positions held by BOTH a chat row
 *                        and an activity row (per-league uniqueness, AC5).
 *   unregisteredRows     chat or activity rows with no registry position AT their
 *                        own feed_seq - missing OR disagreeing (ADR 0015: the
 *                        registry mirrors the record tables' actual positions).
 *   counterLag           leagues whose counter sits BELOW their registered
 *                        high-water, or has no counter row at all (AC5/#471 AC5).
 */
function buildReconciliationReport({
  uncoveredPicks = [],
  crossKindDuplicates = [],
  unregisteredRows = [],
  counterLag = [],
} = {}) {
  const failures = [];
  if (uncoveredPicks.length > 0) {
    failures.push({ check: 'source-coverage', detail: uncoveredPicks });
  }
  if (crossKindDuplicates.length > 0) {
    failures.push({ check: 'per-league-uniqueness', detail: crossKindDuplicates });
  }
  if (unregisteredRows.length > 0) {
    failures.push({ check: 'registry-coverage', detail: unregisteredRows });
  }
  if (counterLag.length > 0) {
    failures.push({ check: 'counter-high-water', detail: counterLag });
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Prove the combined feed is whole and enforceable, before the read cutover
 * (AC5). Runs the four coverage/uniqueness/high-water queries and folds them
 * through buildReconciliationReport. Optionally scoped to one league. Reads only.
 */
async function reconcileLegacyFeed(db, { leagueId = null } = {}) {
  const scope = leagueId != null ? 'AND "league_id" = $1' : '';
  const scopeDp = leagueId != null ? 'AND dp."league_id" = $1' : '';
  const params = leagueId != null ? [leagueId] : [];

  // Source coverage: a surviving, non-keeper Pick that no activity entry carries
  // the source id of.
  const uncovered = await db.query(
    `SELECT dp."league_id", count(*)::int AS "count"
       FROM "draft_picks" dp
      WHERE dp."is_keeper" = false
        AND NOT ${PICK_COVERED}
        ${scopeDp}
      GROUP BY dp."league_id"`,
    params
  );

  // Per-league uniqueness: a position owned by BOTH kinds. The registry PK makes
  // this impossible to create; proving it makes the invariant observable.
  const duplicates = await db.query(
    `SELECT "league_id", "feed_seq" FROM (
       SELECT "league_id", "feed_seq" FROM "chat_messages" WHERE true ${scope}
       INTERSECT
       SELECT "league_id", "feed_seq" FROM "draft_activity" WHERE true ${scope}
     ) shared
     ORDER BY "league_id", "feed_seq"`,
    params
  );

  // Registry coverage: a live chat or activity row with no registered position AT
  // ITS OWN feed_seq. Comparing feed_seq (not just source id) catches a registry
  // that disagrees with the record - the exact hazard of re-sequencing chat by
  // UPDATE (no trigger) and re-registering by hand, or of a mis-disabled trigger.
  const unregistered = await db.query(
    `SELECT 'league_chat' AS "record_kind", c."league_id", c."id" AS "source_id"
       FROM "chat_messages" c
      WHERE NOT EXISTS (
        SELECT 1 FROM "league_feed_positions" pos
         WHERE pos."record_kind" = 'league_chat' AND pos."league_id" = c."league_id"
           AND pos."source_id" = c."id" AND pos."feed_seq" = c."feed_seq"
      ) ${leagueId != null ? 'AND c."league_id" = $1' : ''}
     UNION ALL
     SELECT 'draft_activity' AS "record_kind", a."league_id", a."id" AS "source_id"
       FROM "draft_activity" a
      WHERE NOT EXISTS (
        SELECT 1 FROM "league_feed_positions" pos
         WHERE pos."record_kind" = 'draft_activity' AND pos."league_id" = a."league_id"
           AND pos."source_id" = a."id" AND pos."feed_seq" = a."feed_seq"
      ) ${leagueId != null ? 'AND a."league_id" = $1' : ''}`,
    params
  );

  // Counter high-water agreement: a counter that sits BELOW its league's highest
  // registered position, OR is wholly absent (maximally behind). Driven from the
  // registry with a LEFT JOIN so a league with positions but no counter row is
  // caught, not silently excluded by an inner join.
  const scopePos = leagueId != null ? 'AND pos."league_id" = $1' : '';
  const counterLag = await db.query(
    `SELECT pos."league_id",
            COALESCE(s."last_seq"::text, 'absent') AS "last_seq",
            max(pos."feed_seq")::text AS "high_water"
       FROM "league_feed_positions" pos
       LEFT JOIN "league_feed_sequences" s ON s."league_id" = pos."league_id"
      WHERE true ${scopePos}
      GROUP BY pos."league_id", s."last_seq"
     HAVING s."last_seq" IS NULL OR s."last_seq" < max(pos."feed_seq")`,
    params
  );

  return buildReconciliationReport({
    uncoveredPicks: uncovered.rows,
    crossKindDuplicates: duplicates.rows,
    unregisteredRows: unregistered.rows,
    counterLag: counterLag.rows,
  });
}

module.exports = {
  captureLegacyPicks,
  reconcileLegacyFeed,
  buildReconciliationReport,
};
