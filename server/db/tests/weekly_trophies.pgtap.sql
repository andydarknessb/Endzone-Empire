-- Run only against an isolated migrated test database:
--   pg_prove --dbname "$TEST_DATABASE_URL" server/db/tests/weekly_trophies.pgtap.sql
--
-- Production contract under test:
--   public.award_weekly_trophies(league_id integer, season integer, week integer)
--   public.trophies (the repository's persisted Trophy Case table)

\set ON_ERROR_STOP 1

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(18);

SELECT has_table(
  'public',
  'trophies',
  'the Trophy Case is persisted in public.trophies'
);

SELECT has_function(
  'public',
  'award_weekly_trophies',
  ARRAY['integer', 'integer', 'integer'],
  'weekly trophy generation is exposed as a database function'
);

INSERT INTO public.users (id, username, email, password)
VALUES
  (-8811, 'pgtap_trophy_owner', 'pgtap-trophy-owner@example.test', 'not-a-real-password'),
  (-8812, 'pgtap_top_scorer', 'pgtap-top-scorer@example.test', 'not-a-real-password'),
  (-8813, 'pgtap_top_opponent', 'pgtap-top-opponent@example.test', 'not-a-real-password'),
  (-8814, 'pgtap_close_home', 'pgtap-close-home@example.test', 'not-a-real-password'),
  (-8815, 'pgtap_close_away', 'pgtap-close-away@example.test', 'not-a-real-password'),
  (-8816, 'pgtap_third_home', 'pgtap-third-home@example.test', 'not-a-real-password'),
  (-8817, 'pgtap_third_away', 'pgtap-third-away@example.test', 'not-a-real-password');

INSERT INTO public.leagues (
  id,
  name,
  owner_id,
  invite_code,
  current_season,
  current_week
)
VALUES (-8801, 'pgTAP Weekly Trophy League', -8811, 'PGTAPTRPHY01', 2026, 7);

INSERT INTO public.teams (id, league_id, owner_id, name, draft_position)
VALUES
  (-8821, -8801, -8812, 'Top Scorer Team', 1),
  (-8822, -8801, -8813, 'Blowout Opponent', 2),
  (-8823, -8801, -8814, 'Closest Winner', 3),
  (-8824, -8801, -8815, 'Closest Runner-up', 4),
  (-8825, -8801, -8816, 'Third Matchup Winner', 5),
  (-8826, -8801, -8817, 'Third Matchup Runner-up', 6);

-- Week 7 is complete. Matchup two deliberately differs by exactly 0.01.
INSERT INTO public.matchups (
  league_id,
  season,
  week,
  home_team_id,
  away_team_id,
  home_score,
  away_score,
  final
)
VALUES
  (-8801, 2026, 7, -8821, -8822, 150.00, 90.00, true),
  (-8801, 2026, 7, -8823, -8824, 110.01, 110.00, true),
  (-8801, 2026, 7, -8825, -8826, 120.00, 100.00, true);

SELECT lives_ok(
  $$SELECT public.award_weekly_trophies(-8801, 2026, 7)$$,
  'the cron-compatible weekly trophy function processes a completed week'
);

SELECT is(
  (SELECT count(*)::integer FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'top_scorer'),
  1,
  'Top Scorer produces exactly one trophy'
);

SELECT is(
  (SELECT team_id FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'top_scorer'),
  -8821,
  'Top Scorer belongs to the team with 150.00 points'
);

SELECT is(
  (SELECT label FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'top_scorer'),
  'Top Scorer',
  'Top Scorer uses the canonical label'
);

SELECT is(
  (SELECT (data ->> 'points')::numeric FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'top_scorer'),
  150.00::numeric,
  'Top Scorer records the winning points-for value'
);

SELECT is(
  (SELECT count(*)::integer FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'closest_game'),
  2,
  'Closest Game awards both participating teams'
);

SELECT is(
  (SELECT array_agg(team_id ORDER BY team_id) FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'closest_game'),
  ARRAY[-8824, -8823]::integer[],
  'Closest Game selects exactly the two teams from the 0.01 matchup'
);

SELECT ok(
  (SELECT bool_and((data ->> 'margin')::numeric = 0.01::numeric) FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'closest_game'),
  'Closest Game preserves a 0.01 margin for both recipients'
);

SELECT ok(
  (SELECT bool_and(label = 'Closest Game') FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'closest_game'),
  'Closest Game uses the canonical label for both recipients'
);

SELECT is(
  (SELECT count(*)::integer FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'biggest_blowout'),
  1,
  'Biggest Blowout produces exactly one trophy'
);

SELECT is(
  (SELECT team_id FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'biggest_blowout'),
  -8821,
  'Biggest Blowout belongs to the winner of the 60-point matchup'
);

SELECT is(
  (SELECT label FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'biggest_blowout'),
  'Biggest Blowout',
  'Biggest Blowout uses the canonical label'
);

SELECT is(
  (SELECT (data ->> 'margin')::numeric FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7 AND type = 'biggest_blowout'),
  60.00::numeric,
  'Biggest Blowout records the largest victory margin'
);

SELECT lives_ok(
  $$SELECT public.award_weekly_trophies(-8801, 2026, 7)$$,
  're-running the cron job is idempotent'
);

SELECT is(
  (SELECT count(*)::integer FROM public.trophies
   WHERE league_id = -8801 AND season = 2026 AND week = 7),
  4,
  'a repeated run leaves one Top Scorer, two Closest Game, and one Biggest Blowout row'
);

CREATE OR REPLACE FUNCTION pg_temp.duplicate_weekly_trophy_is_rejected()
RETURNS boolean
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.trophies (
    league_id,
    team_id,
    season,
    week,
    type,
    label,
    data
  )
  VALUES (
    -8801,
    -8821,
    2026,
    7,
    'top_scorer',
    'Top Scorer',
    '{"points": 150.00}'::jsonb
  );
  RETURN false;
EXCEPTION
  WHEN unique_violation THEN
    RETURN true;
END;
$function$;

SELECT ok(
  pg_temp.duplicate_weekly_trophy_is_rejected(),
  'the table constraint rejects duplicate team/type trophies for one matchup week'
);

SELECT * FROM finish();

ROLLBACK;
