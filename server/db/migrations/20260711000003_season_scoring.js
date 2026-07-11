/**
 * Phase 3: per-league scoring settings and a real season structure.
 *
 * - leagues.scoring_rules: per-league point values (null = built-in standard
 *   rules). Presets (standard / half-PPR / PPR) are just prefilled rule sets.
 * - regular_season_weeks / playoff_teams / playoff_consolation configure the
 *   season shape; season_status tracks regular -> playoffs -> complete.
 * - matchups learn about playoffs (is_playoff, playoff_round, is_consolation)
 *   and get a `final` flag set when a week is closed out, so standings and
 *   streaks only count finished games.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('leagues', (t) => {
    t.jsonb('scoring_rules'); // null = default standard rules
    t.integer('regular_season_weeks').notNullable().defaultTo(14);
    t.integer('playoff_teams').notNullable().defaultTo(4);
    t.boolean('playoff_consolation').notNullable().defaultTo(false);
    t.string('season_status', 12).notNullable().defaultTo('regular'); // regular|playoffs|complete
  });

  await knex.schema.alterTable('matchups', (t) => {
    t.boolean('is_playoff').notNullable().defaultTo(false);
    t.integer('playoff_round'); // 1 = first playoff round, 2 = next, ...
    t.boolean('is_consolation').notNullable().defaultTo(false);
    t.boolean('final').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('matchups', (t) => {
    t.dropColumn('is_playoff');
    t.dropColumn('playoff_round');
    t.dropColumn('is_consolation');
    t.dropColumn('final');
  });
  await knex.schema.alterTable('leagues', (t) => {
    t.dropColumn('scoring_rules');
    t.dropColumn('regular_season_weeks');
    t.dropColumn('playoff_teams');
    t.dropColumn('playoff_consolation');
    t.dropColumn('season_status');
  });
};
