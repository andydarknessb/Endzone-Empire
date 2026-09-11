const pool = require('../modules/pool');

/**
 * Season archive (CONTEXT.md "Season archive"): a League's completed seasons
 * as they finished, one read that decides champions and outcome for every
 * season instead of the caller re-deriving them. Every column the join needs
 * already exists on `league_history`/`leagues`/`teams`/`trophies`/
 * `league_analytics`; this ticket writes no migration.
 *
 * The trophies join is intentionally NOT `json_agg`: aggregating a `trophies`
 * row into JSON would round-trip its `awarded_at` timestamptz through
 * Postgres's own JSON text encoding, which is not byte-identical to the ISO
 * string node-pg produces from the Date object a plain column select yields
 * (`trophy.service.js`'s `getLeagueTrophies`, the "must not change" trophy
 * shape this module is held to). A `LEFT JOIN LATERAL` that `array_agg`s each
 * scalar column keeps every column typed exactly as a direct SELECT would
 * (`timestamptz[]` still parses to `Date[]`), so the two code paths agree on
 * the wire without a second query.
 */

/** One league's archived seasons, newest season first. */
async function seasonArchive({ leagueId }) {
  const result = await pool.query(
    `SELECT
       "league_history"."season",
       "league_history"."standings",
       "league_history"."pickem_result",
       "leagues"."pickem_only",
       "league_history"."champion_team_id",
       "champion_team"."name" AS "champion_name",
       "champion_team"."avatar_url" AS "champion_avatar_url",
       "champion_team"."avatar_static_url" AS "champion_avatar_static_url",
       "trophy_agg"."ids" AS "trophy_ids",
       "trophy_agg"."league_ids" AS "trophy_league_ids",
       "trophy_agg"."team_ids" AS "trophy_team_ids",
       "trophy_agg"."seasons" AS "trophy_seasons",
       "trophy_agg"."weeks" AS "trophy_weeks",
       "trophy_agg"."types" AS "trophy_types",
       "trophy_agg"."labels" AS "trophy_labels",
       "trophy_agg"."datas" AS "trophy_datas",
       "trophy_agg"."awarded_ats" AS "trophy_awarded_ats",
       "trophy_agg"."team_names" AS "trophy_team_names",
       "draft_grades"."grades" AS "draft_grades"
     FROM "league_history"
     JOIN "leagues" ON "leagues"."id" = "league_history"."league_id"
     LEFT JOIN "teams" AS "champion_team" ON "champion_team"."id" = "league_history"."champion_team_id"
     LEFT JOIN LATERAL (
       SELECT
         array_agg("trophies"."id" ORDER BY "trophies"."awarded_at" DESC, "trophies"."id" DESC) AS "ids",
         array_agg("trophies"."league_id" ORDER BY "trophies"."awarded_at" DESC, "trophies"."id" DESC) AS "league_ids",
         array_agg("trophies"."team_id" ORDER BY "trophies"."awarded_at" DESC, "trophies"."id" DESC) AS "team_ids",
         array_agg("trophies"."season" ORDER BY "trophies"."awarded_at" DESC, "trophies"."id" DESC) AS "seasons",
         array_agg("trophies"."week" ORDER BY "trophies"."awarded_at" DESC, "trophies"."id" DESC) AS "weeks",
         array_agg("trophies"."type" ORDER BY "trophies"."awarded_at" DESC, "trophies"."id" DESC) AS "types",
         array_agg("trophies"."label" ORDER BY "trophies"."awarded_at" DESC, "trophies"."id" DESC) AS "labels",
         array_agg("trophies"."data" ORDER BY "trophies"."awarded_at" DESC, "trophies"."id" DESC) AS "datas",
         array_agg("trophies"."awarded_at" ORDER BY "trophies"."awarded_at" DESC, "trophies"."id" DESC) AS "awarded_ats",
         array_agg("trophy_team"."name" ORDER BY "trophies"."awarded_at" DESC, "trophies"."id" DESC) AS "team_names"
       FROM "trophies"
       JOIN "teams" AS "trophy_team" ON "trophy_team"."id" = "trophies"."team_id"
       WHERE "trophies"."league_id" = "league_history"."league_id"
         AND "trophies"."season" = "league_history"."season"
         AND "trophies"."week" = 0
     ) AS "trophy_agg" ON true
     LEFT JOIN LATERAL (
       SELECT "league_analytics"."data" -> 'grades' AS "grades"
       FROM "league_analytics"
       WHERE "league_analytics"."league_id" = "league_history"."league_id"
         AND "league_analytics"."season" = "league_history"."season"
         AND "league_analytics"."type" = 'draft_grades'
       LIMIT 1
     ) AS "draft_grades" ON true
     WHERE "league_history"."league_id" = $1
     ORDER BY "league_history"."season" DESC`,
    [leagueId]
  );

  return result.rows.map(buildSeason);
}

/** Zip one league_history row (plus its lateral aggregates) into a season. */
function buildSeason(row) {
  const pickemResult = row.pickem_result && typeof row.pickem_result === 'string'
    ? JSON.parse(row.pickem_result)
    : row.pickem_result;

  const { champions, outcome } = decideChampionsAndOutcome({
    pickemResult,
    pickemOnly: row.pickem_only,
    championTeamId: row.champion_team_id,
    championName: row.champion_name,
    championAvatarUrl: row.champion_avatar_url,
    championAvatarStaticUrl: row.champion_avatar_static_url,
  });

  return {
    season: row.season,
    outcome,
    champions,
    standings: row.standings,
    trophies: zipTrophies(row),
    draftGrades: row.draft_grades != null ? row.draft_grades : null,
  };
}

/**
 * A pick'em season's champions/outcome come from its declared
 * `pickem_result` (absent for a season with no declared result, which the
 * legacy `champion_team_id` pointer never disambiguates on its own — so
 * `champions` stays `null` rather than promoting an ambiguous legacy
 * pointer). A fantasy season decides both from `champion_team_id`: a
 * champion, or the explicit `no_champion` outcome this ticket introduces.
 */
function decideChampionsAndOutcome({
  pickemResult,
  pickemOnly,
  championTeamId,
  championName,
  championAvatarUrl,
  championAvatarStaticUrl,
}) {
  if (pickemResult) {
    const champions = Array.isArray(pickemResult.champions)
      ? pickemResult.champions.map((champion) => ({
        teamId: champion.teamId,
        name: champion.teamName,
        avatarUrl: champion.avatarUrl,
        avatarStaticUrl: champion.avatarStaticUrl,
      }))
      : null;
    return { champions, outcome: pickemResult.outcome };
  }

  if (pickemOnly) {
    // A pick'em League with no declared result for this season (legacy data
    // predating pickem_result, or not yet declared): neither champions nor
    // outcome can be known.
    return { champions: null, outcome: null };
  }

  if (championTeamId) {
    return {
      champions: [{
        teamId: championTeamId,
        name: championName,
        avatarUrl: championAvatarUrl,
        avatarStaticUrl: championAvatarStaticUrl,
      }],
      outcome: 'champion',
    };
  }

  return { champions: [], outcome: 'no_champion' };
}

/** Parallel array_agg columns -> the same shape getLeagueTrophies() rows. */
function zipTrophies(row) {
  const ids = row.trophy_ids;
  if (!Array.isArray(ids)) return [];
  return ids.map((id, i) => ({
    id,
    league_id: row.trophy_league_ids[i],
    team_id: row.trophy_team_ids[i],
    season: row.trophy_seasons[i],
    week: row.trophy_weeks[i],
    type: row.trophy_types[i],
    label: row.trophy_labels[i],
    data: row.trophy_datas[i],
    awarded_at: row.trophy_awarded_ats[i],
    team_name: row.trophy_team_names[i],
  }));
}

module.exports = { seasonArchive };
