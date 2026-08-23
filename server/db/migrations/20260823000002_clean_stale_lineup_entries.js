/**
 * One-shot cleanup of the stale lineup rows the defect left behind (#197).
 *
 * Six paths removed a player from a team and none of them touched
 * `lineup_entries`, for the life of the table. Every row they stranded is
 * still there. The code change stops new ones appearing; this removes the
 * ones already written, by exactly the same rule the runtime operation
 * (`lineup.service.removeLineupEntries`) applies from now on.
 *
 * A row is deleted when ALL of these hold:
 *   - the team no longer holds that player (no `team_players` row);
 *   - the row is in the league's CURRENT season;
 *   - and either it is in a week AFTER the league's current week, or it is
 *     in the current week and that week is still open for him, meaning his
 *     NFL game has not kicked off (no game row that week counts as not
 *     kicked off) and his team's matchup for the week is not final.
 *
 * What it deliberately does NOT delete:
 *   - ANY past week, in any season. Those rows are the record of the week as
 *     played (#106) and a settled score reads them.
 *   - a current-week row whose game has kicked off. He was on the roster at
 *     kickoff, and that row carries his points for the week.
 *   - a current-week row in a week the team's matchup has already settled.
 *   - anything for a player still on the roster.
 *
 * Measured effect on the production database, checked read-only at design
 * time on 2026-08-23: ZERO rows. `lineup_entries` holds no rows at all there
 * (nor does `team_players`), across 15 leagues, so this deletes nothing. It
 * is written anyway because the defect predates every environment: a
 * developer's local database, a restored backup or any future environment
 * may well carry stale rows, and there is no cheap way to tell from here.
 *
 * Irreversible by nature, so `down` is a no-op rather than a lie: the rows
 * are gone and a rollback cannot invent them. Nothing depends on their
 * absence, so re-running the rollback/migrate smoke is safe.
 */
exports.up = async function (knex) {
  await knex.raw(`
    DELETE FROM "lineup_entries" AS "stale"
     USING "teams", "leagues"
     WHERE "teams"."id" = "stale"."team_id"
       AND "leagues"."id" = "teams"."league_id"
       AND "stale"."season" = "leagues"."current_season"
       AND "stale"."week" >= "leagues"."current_week"
       AND NOT EXISTS (
             SELECT 1 FROM "team_players"
              WHERE "team_players"."team_id" = "stale"."team_id"
                AND "team_players"."player_id" = "stale"."player_id"
           )
       AND ("stale"."week" > "leagues"."current_week"
            OR (NOT EXISTS (
                  SELECT 1 FROM "players"
                    JOIN "nfl_games" ON "nfl_games"."season" = "stale"."season"
                     AND "nfl_games"."week" = "stale"."week"
                     AND "nfl_games"."nfl_team" = "players"."nfl_team"
                   WHERE "players"."id" = "stale"."player_id"
                     AND "nfl_games"."kickoff_at" <= now()
                )
                AND NOT EXISTS (
                  SELECT 1 FROM "matchups"
                   WHERE "matchups"."league_id" = "leagues"."id"
                     AND "matchups"."season" = "stale"."season"
                     AND "matchups"."week" = "stale"."week"
                     AND "matchups"."final" = true
                     AND ("matchups"."home_team_id" = "stale"."team_id"
                          OR "matchups"."away_team_id" = "stale"."team_id")
                )))
  `);
};

exports.down = async function () {
  // Deleted rows cannot be restored. Intentionally empty so the standard
  // migrate/rollback/migrate smoke still passes.
};
