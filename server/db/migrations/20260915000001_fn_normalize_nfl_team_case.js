/**
 * #1405: fn_normalize_nfl_team as ONE CASE expression instead of a CTE with
 * two VALUES subselects.
 *
 * Same name, same signature, same IMMUTABLE PARALLEL SAFE contract and the
 * SAME result for every input (the 32 full names, the 13 legacy/alternate
 * abbreviations, pass-through of anything else, NULL for NULL), so the
 * expression indexes that reference it (`idx_players_nfl_team_normalized`,
 * `nfl_games_season_week_team_code_unique`) and `view_matchup_nfl_games`
 * stay valid as they are; nothing is rebuilt.
 *
 * Why: the old body cost ~70 us per call (each call planned and ran two
 * subselects over inline VALUES), and the Players list evaluates it several
 * times per row - the `player_identities` window partition, the identity
 * self-join on both sides, the bye lookup, the live-game view. Measured on
 * the production database: 3,702 calls 261 ms -> 14 ms; the identity join
 * over the full pool 1,106 ms -> 99 ms; the view=cards list query for the
 * Upgrade sort 425 ms -> 168 ms.
 *
 * The full-name branch still mirrors NFL_TEAM_NAME_TO_ABBR in
 * server/services/scoring.service.js (the JS twin used at live-scoring
 * time): if a team is renamed or relocated, update both.
 * server/test/normalizeNflTeam.pg.test.js pins the mapping and that the body
 * carries no subselect.
 */
const CASE_BODY = `
      CREATE OR REPLACE FUNCTION fn_normalize_nfl_team(raw_team text)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      AS $$
        SELECT CASE upper(trim(raw_team))
          WHEN 'ARIZONA CARDINALS' THEN 'ARI'
          WHEN 'ATLANTA FALCONS' THEN 'ATL'
          WHEN 'BALTIMORE RAVENS' THEN 'BAL'
          WHEN 'BUFFALO BILLS' THEN 'BUF'
          WHEN 'CAROLINA PANTHERS' THEN 'CAR'
          WHEN 'CHICAGO BEARS' THEN 'CHI'
          WHEN 'CINCINNATI BENGALS' THEN 'CIN'
          WHEN 'CLEVELAND BROWNS' THEN 'CLE'
          WHEN 'DALLAS COWBOYS' THEN 'DAL'
          WHEN 'DENVER BRONCOS' THEN 'DEN'
          WHEN 'DETROIT LIONS' THEN 'DET'
          WHEN 'GREEN BAY PACKERS' THEN 'GB'
          WHEN 'HOUSTON TEXANS' THEN 'HOU'
          WHEN 'INDIANAPOLIS COLTS' THEN 'IND'
          WHEN 'JACKSONVILLE JAGUARS' THEN 'JAX'
          WHEN 'KANSAS CITY CHIEFS' THEN 'KC'
          WHEN 'LAS VEGAS RAIDERS' THEN 'LV'
          WHEN 'LOS ANGELES CHARGERS' THEN 'LAC'
          WHEN 'LOS ANGELES RAMS' THEN 'LAR'
          WHEN 'MIAMI DOLPHINS' THEN 'MIA'
          WHEN 'MINNESOTA VIKINGS' THEN 'MIN'
          WHEN 'NEW ENGLAND PATRIOTS' THEN 'NE'
          WHEN 'NEW ORLEANS SAINTS' THEN 'NO'
          WHEN 'NEW YORK GIANTS' THEN 'NYG'
          WHEN 'NEW YORK JETS' THEN 'NYJ'
          WHEN 'PHILADELPHIA EAGLES' THEN 'PHI'
          WHEN 'PITTSBURGH STEELERS' THEN 'PIT'
          WHEN 'SAN FRANCISCO 49ERS' THEN 'SF'
          WHEN 'SEATTLE SEAHAWKS' THEN 'SEA'
          WHEN 'TAMPA BAY BUCCANEERS' THEN 'TB'
          WHEN 'TENNESSEE TITANS' THEN 'TEN'
          WHEN 'WASHINGTON COMMANDERS' THEN 'WAS'
          -- Washington has cycled through several Tank01/legacy codes
          WHEN 'WSH' THEN 'WAS'
          WHEN 'WFT' THEN 'WAS'
          WHEN 'GNB' THEN 'GB'
          WHEN 'KAN' THEN 'KC'
          WHEN 'JAC' THEN 'JAX'
          WHEN 'NWE' THEN 'NE'
          WHEN 'NOR' THEN 'NO'
          WHEN 'TAM' THEN 'TB'
          WHEN 'SFO' THEN 'SF'
          -- pre-relocation abbreviations that may still linger in stale rows
          WHEN 'SD' THEN 'LAC'
          WHEN 'OAK' THEN 'LV'
          WHEN 'STL' THEN 'LAR'
          WHEN 'LA' THEN 'LAR'
          -- already-canonical abbreviation (or unknown input): pass through rather than fail silently
          ELSE upper(trim(raw_team))
        END
      $$;
`;

// The body 20260719000003_view_matchup_nfl_games.js installed, restored on down.
const CTE_BODY = `
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
            ('WSH','WAS'), ('WFT','WAS'),
            ('GNB','GB'), ('KAN','KC'), ('JAC','JAX'), ('NWE','NE'),
            ('NOR','NO'), ('TAM','TB'), ('SFO','SF'),
            ('SD','LAC'), ('OAK','LV'), ('STL','LAR'), ('LA','LAR')
        )
        SELECT COALESCE(
          (SELECT abbr FROM full_names WHERE team_name = normalized.v),
          (SELECT abbr FROM aliases WHERE alias = normalized.v),
          normalized.v
        )
        FROM normalized;
      $$;
`;

exports.up = async function (knex) {
  await knex.raw(CASE_BODY);
};

exports.down = async function (knex) {
  await knex.raw(CTE_BODY);
};
