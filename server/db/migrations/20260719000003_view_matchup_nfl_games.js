/**
 * Phase 1.5: maps a fantasy `matchups` row to every real NFL game
 * (`live_game_states.tank01_game_id`) either roster has a player in, so the
 * frontend can mount one `<LiveGameStatus>` per real game a matchup actually
 * touches instead of guessing.
 *
 * Deliberately a VIEW, not a materialized cross-reference table: rosters
 * change constantly (waivers, trades, lineup swaps) and a matchup only spans
 * ~2-4 real games, so re-deriving the mapping on every read is cheap and
 * never goes stale — no invalidation code needed anywhere adds/drops/trades
 * touch a roster.
 *
 * Table names assumed here (adjust if your schema has since diverged):
 *   - matchups(id, league_id, season, week, home_team_id, away_team_id)
 *   - lineup_entries(team_id, player_id, season, week, slot)  — week-scoped
 *     roster, materialized lazily by services/lineup.service.js
 *   - team_players(team_id, player_id)                        — current
 *     roster ownership, same join lineup_entries reads elsewhere pair with
 *     (see league.router.js's GET /:id/matchups/:matchupId)
 *   - players(id, nfl_team)                                   — nfl_team is
 *     free text: sometimes a full name ("Kansas City Chiefs"), sometimes
 *     already an abbreviation, depending on how the row was seeded/synced
 *   - live_game_states(tank01_game_id, season, week, home_team, away_team,
 *     game_status) — home_team/away_team are Tank01's own abbreviation
 *     exactly as that API returned it (see modules/liveGameEngine.js)
 */
exports.up = async function (knex) {
  // Collapses both (a) a full NFL team name and (b) known legacy/alternate
  // Tank01 abbreviations (WSH vs WAS, GNB vs GB, KAN vs KC, ...) down to one
  // canonical abbreviation, so `players.nfl_team` and `live_game_states`'s
  // home_team/away_team match regardless of which vocabulary wrote them.
  // IMMUTABLE + PARALLEL SAFE so it can back a functional index and the
  // planner is free to parallelize scans that call it.
  //
  // The full-name branch intentionally mirrors NFL_TEAM_NAME_TO_ABBR in
  // server/services/scoring.service.js (that copy runs in JS at live-scoring
  // time; this one runs in SQL for the view below) — if a team is
  // renamed/relocated, update both.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_normalize_nfl_team(raw_team text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      WITH normalized AS (
        SELECT upper(trim(raw_team)) AS v
      ),
      full_names (team_name, abbr) AS (
        VALUES
          ('ARIZONA CARDINALS','ARI'), ('ATLANTA FALCONS','ATL'), ('BALTIMORE RAVENS','BAL'),
          ('BUFFALO BILLS','BUF'), ('CAROLINA PANTHERS','CAR'), ('CHICAGO BEARS','CHI'),
          ('CINCINNATI BENGALS','CIN'), ('CLEVELAND BROWNS','CLE'), ('DALLAS COWBOYS','DAL'),
          ('DENVER BRONCOS','DEN'), ('DETROIT LIONS','DET'), ('GREEN BAY PACKERS','GB'),
          ('HOUSTON TEXANS','HOU'), ('INDIANAPOLIS COLTS','IND'), ('JACKSONVILLE JAGUARS','JAX'),
          ('KANSAS CITY CHIEFS','KC'), ('LAS VEGAS RAIDERS','LV'), ('LOS ANGELES CHARGERS','LAC'),
          ('LOS ANGELES RAMS','LAR'), ('MIAMI DOLPHINS','MIA'), ('MINNESOTA VIKINGS','MIN'),
          ('NEW ENGLAND PATRIOTS','NE'), ('NEW ORLEANS SAINTS','NO'), ('NEW YORK GIANTS','NYG'),
          ('NEW YORK JETS','NYJ'), ('PHILADELPHIA EAGLES','PHI'), ('PITTSBURGH STEELERS','PIT'),
          ('SAN FRANCISCO 49ERS','SF'), ('SEATTLE SEAHAWKS','SEA'), ('TAMPA BAY BUCCANEERS','TB'),
          ('TENNESSEE TITANS','TEN'), ('WASHINGTON COMMANDERS','WAS')
      ),
      aliases (alias, abbr) AS (
        VALUES
          -- Washington has cycled through several Tank01/legacy codes
          ('WSH','WAS'), ('WFT','WAS'),
          ('GNB','GB'), ('KAN','KC'), ('JAC','JAX'), ('NWE','NE'),
          ('NOR','NO'), ('TAM','TB'), ('SFO','SF'),
          -- pre-relocation abbreviations that may still linger in stale rows
          ('SD','LAC'), ('OAK','LV'), ('STL','LAR'), ('LA','LAR')
      )
      SELECT COALESCE(
        (SELECT abbr FROM full_names WHERE team_name = normalized.v),
        (SELECT abbr FROM aliases WHERE alias = normalized.v),
        normalized.v -- already-canonical abbreviation (or unknown input) — pass through rather than fail silently
      )
      FROM normalized;
    $$;
  `);

  // Explicit index on the raw nfl_team string, as requested — useful for any
  // other query that filters players by nfl_team directly (e.g. the
  // schedule/opponent lookups in league.router.js).
  await knex.schema.alterTable('players', (t) => {
    t.index('nfl_team', 'idx_players_nfl_team');
  });

  // The index that actually backs this view's join predicate: a nested-loop
  // from lineup_entries typically reaches `players` by primary key already,
  // but any planner path that searches players by (normalized) team gets a
  // real index instead of a functional-expression seq scan.
  await knex.raw(`
    CREATE INDEX "idx_players_nfl_team_normalized"
      ON "players" (fn_normalize_nfl_team("nfl_team"))
  `);

  await knex.raw(`
    CREATE OR REPLACE VIEW "view_matchup_nfl_games" AS
    SELECT DISTINCT
      m."id"       AS "fantasy_matchup_id",
      m."league_id",
      m."season",
      m."week",
      lgs."tank01_game_id",
      lgs."game_status",
      lgs."home_team",
      lgs."away_team"
    FROM "matchups" m
    -- Both rosters at once: every lineup_entries row (bench included — a
    -- benched player's real game still matters to the manager watching it)
    -- for either side of this matchup, for its own season/week.
    JOIN "lineup_entries" le
      ON le."team_id" IN (m."home_team_id", m."away_team_id")
     AND le."season" = m."season"
     AND le."week" = m."week"
    -- Confirms the roster slot still reflects a real ownership row, same
    -- pairing league.router.js's matchup-detail endpoint already relies on.
    JOIN "team_players" tp
      ON tp."team_id" = le."team_id"
     AND tp."player_id" = le."player_id"
    JOIN "players" p
      ON p."id" = le."player_id"
    JOIN "live_game_states" lgs
      ON lgs."season" = m."season"
     AND lgs."week" = m."week"
     AND (
          fn_normalize_nfl_team(p."nfl_team") = fn_normalize_nfl_team(lgs."home_team")
       OR fn_normalize_nfl_team(p."nfl_team") = fn_normalize_nfl_team(lgs."away_team")
     )
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP VIEW IF EXISTS "view_matchup_nfl_games"');
  await knex.raw('DROP INDEX IF EXISTS "idx_players_nfl_team_normalized"');
  await knex.schema.alterTable('players', (t) => {
    t.dropIndex('nfl_team', 'idx_players_nfl_team');
  });
  await knex.raw('DROP FUNCTION IF EXISTS fn_normalize_nfl_team(text)');
};
