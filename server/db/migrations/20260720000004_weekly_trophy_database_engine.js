const fs = require('node:fs');
const path = require('node:path');

const migrationSql = fs.readFileSync(
  path.join(__dirname, '..', 'sql', '2026-07-20-weekly-trophy-engine.sql'),
  'utf8'
);

exports.up = async function (knex) {
  await knex.raw(migrationSql);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP FUNCTION IF EXISTS public.award_weekly_trophies(integer, integer, integer);
    DROP INDEX IF EXISTS public.uq_trophies_league_season_week_team_type;

    -- Restoring the legacy key cannot represent two closest-game recipients.
    -- Keep the lowest-id row per old key if this migration is rolled back.
    DELETE FROM public.trophies AS duplicate
    USING public.trophies AS keeper
    WHERE duplicate.league_id = keeper.league_id
      AND duplicate.season = keeper.season
      AND duplicate.week = keeper.week
      AND duplicate.type = keeper.type
      AND duplicate.id > keeper.id;

    ALTER TABLE public.trophies
      ADD CONSTRAINT trophies_league_id_season_week_type_unique
      UNIQUE (league_id, season, week, type);
  `);
};
