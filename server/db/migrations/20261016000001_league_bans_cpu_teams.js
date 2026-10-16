/**
 * League bans and CPU-managed teams.
 *
 * `league_bans`: a commissioner's Remove & ban. The banned account can never
 * be admitted to the league again (membership.assertAdmissible, every join
 * path). `team_name` is the banned manager's Team name when the ban was made,
 * the only identity a commissioner ever sees for it (Team identity,
 * CONTEXT.md); `user_id` is never served.
 *
 * `teams.owner_id` becomes nullable: a NULL owner is a CPU-managed team. Once
 * the draft has started a banned manager's team cannot be deleted (Removable),
 * so the ban takes the manager off it instead and the team plays out the
 * season with the CPU setting its lineup.
 *
 * Additive only - this runs against a shared Supabase instance (dropping NOT
 * NULL loosens a constraint; no existing row changes). Ships via the release
 * preDeploy (`npm --prefix server run migrate`); applied by Cory, never by the
 * IC.
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS "league_bans" (
      "id" serial PRIMARY KEY,
      "league_id" integer NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "team_name" varchar(120) NOT NULL,
      "banned_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("league_id", "user_id")
    )
  `);
  await knex.raw('ALTER TABLE "teams" ALTER COLUMN "owner_id" DROP NOT NULL');
};

exports.down = async function (knex) {
  // Re-tightening fails while a CPU team exists; that is the correct refusal.
  await knex.raw('ALTER TABLE "teams" ALTER COLUMN "owner_id" SET NOT NULL');
  await knex.raw('DROP TABLE IF EXISTS "league_bans"');
};
