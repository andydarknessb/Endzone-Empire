/**
 * Freeze the declared Pick'em result into the season archive. The JSON has no
 * Team or account foreign keys, so later membership and profile changes cannot
 * rewrite championship history. Existing archives inherit the result imported
 * by the preceding legacy-result migration.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('league_history', (table) => {
    table.jsonb('pickem_result');
  });

  await knex.raw(`
    ALTER TABLE "league_history"
      ADD CONSTRAINT "league_history_pickem_result_check"
        CHECK (
          "pickem_result" IS NULL
          OR COALESCE(
            jsonb_typeof("pickem_result") = 'object'
            AND ("pickem_result" ->> 'outcome') IN ('champions', 'no_champion')
            AND ("pickem_result" ->> 'mode') IN ('straight', 'confidence')
            AND jsonb_typeof("pickem_result" -> 'champions') = 'array'
            AND (
              (("pickem_result" ->> 'outcome') = 'champions'
                AND jsonb_array_length("pickem_result" -> 'champions') > 0)
              OR (("pickem_result" ->> 'outcome') = 'no_champion'
                AND jsonb_array_length("pickem_result" -> 'champions') = 0)
            ),
            false
          )
        )
  `);

  await knex.raw(`
    UPDATE "league_history" AS "history"
       SET "pickem_result" = jsonb_build_object(
         'leagueId', "result"."league_id",
         'season', "result"."season",
         'outcome', "result"."outcome",
         'mode', "result"."scoring_mode",
         'champions', "result"."champions",
         'provenance', "result"."provenance",
         'declaredAt', to_jsonb("result"."declared_at")
       )
      FROM "pickem_season_results" AS "result"
     WHERE "result"."league_id" = "history"."league_id"
       AND "result"."season" = "history"."season"
       AND "history"."pickem_result" IS NULL
  `);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('league_history', (table) => {
    table.dropColumn('pickem_result');
  });
};
