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
 *
 * `allTime` (#1212) is the League's all-time Team roster: `championships`
 * plus the all-time Record (CONTEXT.md "Record" — a Team's all-time Record
 * is the sum of its archived season Records) drawn from every archived
 * season this same read already fetched. Its one extra ingredient is current
 * Team identity (CONTEXT.md "Team identity"): the `team_identity_agg` lateral
 * below `array_agg`s every current `teams` row for the league, correlated
 * only on `league_id` (not on the season), so it rides on every returned row
 * unchanged and costs this module a second lateral join rather than a
 * second `pool.query`. buildAllTime() then sums in JS across every season's
 * already-decoded `standings` and `champions` — never a second read of
 * either.
 */

/** One league's archived seasons (newest first) and its all-time Team roster. */
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
       "draft_grades"."grades" AS "draft_grades",
       "team_identity_agg"."ids" AS "all_team_ids",
       "team_identity_agg"."names" AS "all_team_names",
       "team_identity_agg"."avatar_urls" AS "all_team_avatar_urls"
     FROM "league_history"
     JOIN "leagues" ON "leagues"."id" = "league_history"."league_id"
     LEFT JOIN "teams" AS "champion_team" ON "champion_team"."id" = "league_history"."champion_team_id"
     LEFT JOIN LATERAL (
       SELECT
         array_agg("teams"."id") AS "ids",
         array_agg("teams"."name") AS "names",
         array_agg("teams"."avatar_url") AS "avatar_urls"
       FROM "teams"
       WHERE "teams"."league_id" = "league_history"."league_id"
     ) AS "team_identity_agg" ON true
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

  const seasons = result.rows.map(buildSeason);
  const allTime = buildAllTime(seasons, buildTeamIdentity(result.rows));
  return { seasons, allTime };
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

/**
 * Current Team identity for every Team in the league, keyed by teamId
 * (CONTEXT.md "Team identity"): the row set an allTime Team may draw a name
 * and avatar from. Every returned `result.rows` row carries the identical
 * `all_team_*` arrays (the lateral is correlated on league_id only), so the
 * first row is enough; with zero archived seasons there is no row to read
 * and no teamId that would need one, so an empty map is correct there too.
 */
function buildTeamIdentity(rows) {
  const identity = new Map();
  const first = rows[0];
  if (!first || !Array.isArray(first.all_team_ids)) return identity;
  first.all_team_ids.forEach((teamId, i) => {
    identity.set(teamId, {
      name: first.all_team_names[i],
      avatarUrl: first.all_team_avatar_urls[i],
    });
  });
  return identity;
}

/**
 * The League's all-time Team roster (#1212): `championships` plus the
 * all-time Record (CONTEXT.md "Record"), for every teamId that appears in
 * any archived season's `standings` or `champions` — never for a current
 * Team with no archived season (row set rule).
 *
 * Record (R2): a Team whose archived standings rows never carry a numeric
 * `wins` (a pick'em Team — CONTEXT.md "Record" is drawn from finalized
 * regular-season Matchups, which a pick'em League has none of) keeps
 * `wins`/`losses`/`ties` at `null`. It is never coerced to `0`, because a
 * pick'em Team going 0-0 would invent a Record that never happened. A Team
 * that does have a numeric Record sums it across every season with one.
 *
 * Championships (R3): `seasonArchive` has already decided each season's
 * `champions` (co-champions each own array element); every teamId in it
 * gets +1. `champions: []` (no champion) or `champions: null` (undeclared
 * pick'em) contributes nothing.
 *
 * Identity (R4): a teamId with no current `teams` row still gets its row,
 * with `name: null, avatarUrl: null` — the same convention `seasonArchive`
 * already follows for a fantasy champion whose Team is gone. It never falls
 * back to an archived `name`.
 *
 * Order (R5): `championships` desc, then `wins` desc (`null` sorts as `0`),
 * then `teamId` asc.
 */
function buildAllTime(seasons, identity) {
  const totals = new Map();

  const totalFor = (teamId) => {
    if (!totals.has(teamId)) {
      totals.set(teamId, { championships: 0, wins: null, losses: null, ties: null });
    }
    return totals.get(teamId);
  };

  for (const season of seasons) {
    if (Array.isArray(season.standings)) {
      for (const row of season.standings) {
        if (row == null || row.teamId == null) continue;
        if (typeof row.wins !== 'number') continue;
        const total = totalFor(row.teamId);
        total.wins = (total.wins ?? 0) + row.wins;
        total.losses = (total.losses ?? 0) + (row.losses ?? 0);
        total.ties = (total.ties ?? 0) + (row.ties ?? 0);
      }
    }
    if (Array.isArray(season.champions)) {
      for (const champion of season.champions) {
        if (champion == null || champion.teamId == null) continue;
        totalFor(champion.teamId).championships += 1;
      }
    }
  }

  const rows = Array.from(totals, ([teamId, total]) => {
    const teamIdentity = identity.get(teamId);
    return {
      teamId,
      name: teamIdentity ? teamIdentity.name : null,
      avatarUrl: teamIdentity ? teamIdentity.avatarUrl : null,
      championships: total.championships,
      wins: total.wins,
      losses: total.losses,
      ties: total.ties,
    };
  });

  rows.sort((a, b) => (
    b.championships - a.championships
    || (b.wins ?? 0) - (a.wins ?? 0)
    || a.teamId - b.teamId
  ));

  return rows;
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
