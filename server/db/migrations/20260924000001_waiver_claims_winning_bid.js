/**
 * `waiver_claims.winning_team_id` and `waiver_claims.winning_bid` (#1611,
 * ADR 0049): when a player's claims resolve, every resolved claim on him (the
 * won one and each lost one) records the team that won and the Winning bid.
 * Both are nullable and there is no backfill: claims resolved before this
 * change keep nulls, and the Waivers page reads null as "unknown". The bid is
 * also null for a win in a non-FAAB league; an `invalid` claim gets neither.
 *
 * The team is ON DELETE SET NULL so removing a team never blocks on, or
 * deletes, the claim history of the teams that lost to it.
 *
 * down() drops both columns; nothing else reads them.
 *
 * CARVE-OUT (server/db/migrations/**): applied by Cory as its own knex batch
 * after merge, never by an agent.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('waiver_claims', (t) => {
    t.integer('winning_team_id').nullable().references('teams.id').onDelete('SET NULL');
    t.integer('winning_bid').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('waiver_claims', (t) => {
    t.dropColumn('winning_bid');
    t.dropColumn('winning_team_id');
  });
};
