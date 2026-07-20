-- Canonical PostgreSQL migration body. Knex executes this file inside its
-- migration transaction; direct administrators should use `psql -1 -f`.
--
-- Repository schema note: the conceptual Trophy Case is public.trophies,
-- league/team identifiers are integer foreign keys, and season is part of the
-- identity so Week 7 awards from different seasons never collide.

ALTER TABLE public.trophies
  DROP CONSTRAINT IF EXISTS trophies_league_id_season_week_type_unique;

DROP INDEX IF EXISTS public.trophies_league_id_season_week_type_unique;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trophies_league_season_week_team_type
  ON public.trophies (league_id, season, week, team_id, type);

CREATE OR REPLACE FUNCTION public.award_weekly_trophies(
  p_league_id integer,
  p_season integer,
  p_week integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_inserted integer := 0;
  v_row_count integer := 0;
BEGIN
  IF p_league_id IS NULL OR p_season IS NULL OR p_week IS NULL THEN
    RAISE EXCEPTION 'league_id, season, and week are required'
      USING ERRCODE = '22004';
  END IF;
  IF p_season < 1 OR p_week < 1 THEN
    RAISE EXCEPTION 'season and week must be positive integers'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize duplicate cron workers for the same league/season/week. The
  -- unique index remains the final idempotency backstop.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    p_league_id,
    (p_season * 100) + p_week
  );

  -- Top Scorer: aggregate both matchup sides so the query remains correct even
  -- if malformed/imported schedules contain more than one matchup per team.
  WITH team_scores AS (
    SELECT m.home_team_id AS team_id, m.home_score::numeric AS points
    FROM public.matchups AS m
    WHERE m.league_id = p_league_id
      AND m.season = p_season
      AND m.week = p_week
      AND m.final = true
    UNION ALL
    SELECT m.away_team_id AS team_id, m.away_score::numeric AS points
    FROM public.matchups AS m
    WHERE m.league_id = p_league_id
      AND m.season = p_season
      AND m.week = p_week
      AND m.final = true
  ), totals AS (
    SELECT team_id, sum(points)::numeric AS points
    FROM team_scores
    GROUP BY team_id
  ), top_scorer AS (
    SELECT team_id, points
    FROM totals
    ORDER BY points DESC, team_id ASC
    LIMIT 1
  )
  INSERT INTO public.trophies (
    league_id, team_id, season, week, type, label, data
  )
  SELECT
    p_league_id,
    top_scorer.team_id,
    p_season,
    p_week,
    'top_scorer',
    'Top Scorer',
    pg_catalog.jsonb_build_object('points', top_scorer.points)
  FROM top_scorer
  ON CONFLICT (league_id, season, week, team_id, type) DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_inserted := v_inserted + v_row_count;

  -- Closest Game: choose one matchup deterministically, then award both teams.
  WITH closest AS (
    SELECT
      m.id AS matchup_id,
      m.home_team_id,
      m.away_team_id,
      abs(m.home_score::numeric - m.away_score::numeric) AS margin
    FROM public.matchups AS m
    WHERE m.league_id = p_league_id
      AND m.season = p_season
      AND m.week = p_week
      AND m.final = true
    ORDER BY margin ASC, m.id ASC
    LIMIT 1
  ), recipients AS (
    SELECT closest.matchup_id, closest.home_team_id AS team_id, closest.margin
    FROM closest
    UNION ALL
    SELECT closest.matchup_id, closest.away_team_id AS team_id, closest.margin
    FROM closest
  )
  INSERT INTO public.trophies (
    league_id, team_id, season, week, type, label, data
  )
  SELECT
    p_league_id,
    recipients.team_id,
    p_season,
    p_week,
    'closest_game',
    'Closest Game',
    pg_catalog.jsonb_build_object(
      'matchupId', recipients.matchup_id,
      'margin', recipients.margin
    )
  FROM recipients
  ON CONFLICT (league_id, season, week, team_id, type) DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_inserted := v_inserted + v_row_count;

  -- Biggest Blowout: tied matchups have no winner and are excluded.
  WITH blowout AS (
    SELECT
      m.id AS matchup_id,
      CASE
        WHEN m.home_score::numeric > m.away_score::numeric THEN m.home_team_id
        ELSE m.away_team_id
      END AS winner_team_id,
      abs(m.home_score::numeric - m.away_score::numeric) AS margin
    FROM public.matchups AS m
    WHERE m.league_id = p_league_id
      AND m.season = p_season
      AND m.week = p_week
      AND m.final = true
      AND m.home_score::numeric <> m.away_score::numeric
    ORDER BY margin DESC, m.id ASC
    LIMIT 1
  )
  INSERT INTO public.trophies (
    league_id, team_id, season, week, type, label, data
  )
  SELECT
    p_league_id,
    blowout.winner_team_id,
    p_season,
    p_week,
    'biggest_blowout',
    'Biggest Blowout',
    pg_catalog.jsonb_build_object(
      'matchupId', blowout.matchup_id,
      'margin', blowout.margin
    )
  FROM blowout
  ON CONFLICT (league_id, season, week, team_id, type) DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_inserted := v_inserted + v_row_count;

  RETURN v_inserted;
END;
$function$;

COMMENT ON FUNCTION public.award_weekly_trophies(integer, integer, integer)
IS 'Idempotently awards Top Scorer, both Closest Game teams, and the Biggest Blowout winner for one finalized fantasy week.';

REVOKE ALL ON FUNCTION public.award_weekly_trophies(integer, integer, integer) FROM PUBLIC;
