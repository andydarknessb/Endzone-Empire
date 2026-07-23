-- Documentation of what was run against the Supabase project directly (not
-- executed by `knex migrate:latest` — ALTER PUBLICATION needs privileges
-- beyond the app's own runtime DB role). Run the Knex migration
-- (20260719000002_live_game_states.js) first to create the table, then this.
--
-- Scope: only `live_game_states` gets a public-read policy. Every other
-- table's existing RLS deny-all state is untouched by this change.
ALTER TABLE "live_game_states" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read live game states"
  ON "live_game_states"
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- RLS policies alone are not sufficient: Postgres also requires the table-
-- level GRANT itself. Tables created through a Supabase project's own
-- migration tooling get this automatically via that role's default
-- privileges, but this table was created by Knex using the app's own DB
-- role (`endzone_app`), which never inherited that default grant — so an
-- explicit GRANT is required here (discovered live: the policy above was in
-- place but every anon read still 401'd with "permission denied for table
-- live_game_states" until this ran).
GRANT SELECT ON "live_game_states" TO anon, authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE "live_game_states";
