-- Canonical PostgreSQL migration body. Knex executes this file inside its
-- migration transaction (20260720000004_weekly_trophy_database_engine.js);
-- direct administrators should use `psql -1 -f`.
--
-- Repository schema note: the conceptual Trophy Case is public.trophies,
-- league/team identifiers are integer foreign keys, and season is part of the
-- identity so Week 7 awards from different seasons never collide.
--
-- The award_weekly_trophies function this file once created is retired and
-- dropped by 20261109000001_drop_award_weekly_trophies.js (#2767). The unique
-- index below stays.

ALTER TABLE public.trophies
  DROP CONSTRAINT IF EXISTS trophies_league_id_season_week_type_unique;

DROP INDEX IF EXISTS public.trophies_league_id_season_week_type_unique;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trophies_league_season_week_team_type
  ON public.trophies (league_id, season, week, team_id, type);
