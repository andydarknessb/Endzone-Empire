/**
 * `waiver_claims.claim_order` (#1578, ADR 0048): a team's own ranking of its
 * pending claims, dense 1..N over that team's `pending` claims when written by
 * the reorder endpoint or the insert (max+1). Gaps left by a cancelled or
 * resolved claim are fine; processing sorts on it, never reads it as a count.
 *
 * Backfill: each team's existing pending claims are numbered by submission
 * time (created_at, id), the order the Waiver wire showed them oldest-first;
 * every other row keeps the default 0, which nothing reads (claim_order only
 * orders pending claims). The default stays, so an insert path that predates
 * the column cannot fail on NOT NULL; the service always writes a real value.
 *
 * down() drops the column: it is a preference, re-derivable from created_at.
 *
 * CARVE-OUT (server/db/migrations/**): applied by Cory as its own knex batch
 * after merge, never by an agent.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('waiver_claims', (t) => {
    t.integer('claim_order').notNullable().defaultTo(0);
  });
  await knex.raw(`
    UPDATE "waiver_claims"
    SET "claim_order" = "ranked"."rank"
    FROM (
      SELECT "id", ROW_NUMBER() OVER (PARTITION BY "team_id" ORDER BY "created_at", "id") AS "rank"
      FROM "waiver_claims" WHERE "status" = 'pending'
    ) AS "ranked"
    WHERE "waiver_claims"."id" = "ranked"."id"
  `);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('waiver_claims', (t) => {
    t.dropColumn('claim_order');
  });
};
