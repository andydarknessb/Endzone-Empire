/**
 * Unique index on nfl_games (season, week, fn_normalize_nfl_team(nfl_team)),
 * beside the raw constraint. Decision: ADR 0011 (docs/adr/0011-nfl-games-
 * uniqueness-is-on-the-team-code.md, PR #420). Ticket: #421, parent #320.
 *
 * WHY: `nfl_games` is unique on the Raw team code `(season, week, nfl_team)`,
 * Tank01's own spelling (WSH). Every consumer that joins it to `players` now
 * folds BOTH sides through `fn_normalize_nfl_team` (#227, #287), so a legacy
 * `WAS` row sitting beside a `WSH` row for one team-week would fold into one
 * Team code and double-count at four sites (bye.service, digest.service,
 * projectionFeatures, projection.service) where the raw comparison matched at
 * most one. This index makes that a rejected insert instead of an invariant
 * four call sites trust.
 *
 * THE RAW CONSTRAINT STAYS. `nfl_games_season_week_nfl_team_unique` (created
 * implicitly by `t.unique(['season','week','nfl_team'])` in
 * 20260711000001_lineups_and_schedule.js, so its name appears nowhere in this
 * directory) is the `ON CONFLICT ("season","week","nfl_team")` arbiter both
 * schedule writers upsert against (nflverseSync.service.js, scoring.service.js).
 * The functional index is strictly tighter, so a canonical writer never trips
 * it and the upsert path is unchanged; server/test/nflGamesTeamCode.pg.test.js
 * proves both halves against a real Postgres.
 *
 * SAFE ON EXISTING DATA: production read 2026-08-26 found 1,632 `nfl_games`
 * rows, 0 team-weeks colliding under the fold, and `WSH` the only raw code
 * anywhere in the table that differs from its team code. `fn_normalize_nfl_team`
 * is declared IMMUTABLE PARALLEL SAFE (20260719000003_view_matchup_nfl_games.js),
 * which is what lets Postgres accept it in an index expression; `players`
 * already carries `idx_players_nfl_team_normalized` on the same expression, so
 * the shape is established in this schema.
 *
 * CARVE-OUT: server/db/migrations/** - the maintainer merges, applies
 * (`knex migrate:latest`, its own batch), and verifies `knex_migrations`. Not
 * stacked with another migration on the same night.
 */
const INDEX_NAME = 'nfl_games_season_week_team_code_unique';

exports.up = async function (knex) {
  await knex.raw(`
    CREATE UNIQUE INDEX "${INDEX_NAME}"
      ON "nfl_games" ("season", "week", fn_normalize_nfl_team("nfl_team"))
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS "${INDEX_NAME}"`);
};
