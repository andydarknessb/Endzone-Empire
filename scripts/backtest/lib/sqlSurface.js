'use strict';

/**
 * The production read surface: the 8 SQL texts `generateProjections` issues,
 * their whitespace-normalized signatures, and the parameter shape each one
 * carries.
 *
 * This lives in its own module because two very different things need the SAME
 * definition, and a copy in each would be a copy that can drift:
 *
 *   - the EXTRACTION (Phase 1) observes it. Its recording client refuses any
 *     SQL whose signature is not in this table, so the surface is proven by
 *     what production actually issued rather than merely declared;
 *   - the SNAPSHOT CLIENT (Phase 2) serves it. It dispatches on the same
 *     signatures and answers each query offline.
 *
 * If those two disagreed about what the surface is, the extraction could
 * capture a query the client cannot answer, or the client could answer one
 * production never issues. Sharing the table makes that impossible.
 *
 * WHY A NORMALIZED SIGNATURE. Re-indenting a query in production is not a
 * behaviour change and must not read as one; changing a column, a predicate or
 * a join IS, and does. Whitespace normalization is exactly that distinction.
 *
 * These texts are pinned copies of production, and a copy can drift. A test
 * reads `server/services/projectionFeatures.js` and `server/services/
 * bye.service.js` as TEXT (never requiring them, which would drag the pool in)
 * and asserts each normalized text below still appears in the file it names.
 */

const crypto = require('crypto');

/**
 * `binding` describes where the target season and week appear in each query's
 * parameter list, so the snapshot client can prove a query was parameterized
 * for the exact `{season, week}` it was constructed for. A client built for
 * 2024 W5 must refuse a 2025 W3 query rather than quietly answering it from the
 * wrong slice - that mistake would produce a plausible number, not an error.
 *
 *   - `season` / `week`: parameter index carrying the target season/week
 *   - `firstSeason`: index carrying `season - HISTORY_SEASONS`
 *   - `ids`: index carrying the player-id array
 *   - `weekIsExclusiveUpperBound`: the query reads `week < $n` rather than
 *     `week = $n`, which is what makes it a prior-weeks read
 */
const SQL_SURFACE = Object.freeze([
  {
    name: 'playersById',
    source: 'server/services/projectionFeatures.js:443',
    binding: { ids: 0 },
    text: `SELECT "id", "name", "position", "nfl_team", "injury_status", "injury_detail", "adp",
                fn_normalize_nfl_team("nfl_team") AS "team_key"
         FROM "players" WHERE "id" = ANY($1::int[])`,
  },
  {
    name: 'priorPlayerStats',
    source: 'server/services/projectionFeatures.js:451',
    binding: { ids: 0, firstSeason: 1, season: 2, week: 3, weekIsExclusiveUpperBound: true },
    text: `SELECT "player_id", "season", "week", "stats"
         FROM "player_stats"
         WHERE "player_id" = ANY($1::int[])
           AND "season" >= $2
           AND ("season" < $3 OR ("season" = $3 AND "week" < $4))
         ORDER BY "season" DESC, "week" DESC`,
  },
  {
    name: 'priorPlayerSeasonStats',
    source: 'server/services/projectionFeatures.js:460',
    binding: { ids: 0, season: 1 },
    text: `SELECT "player_id", "season", "games_played", "stats", "fantasy_points"
         FROM "player_season_stats"
         WHERE "player_id" = ANY($1::int[]) AND "season" < $2`,
  },
  {
    name: 'targetWeekSchedule',
    source: 'server/services/projectionFeatures.js:466',
    binding: { season: 0, week: 1 },
    text: `SELECT fn_normalize_nfl_team("nfl_team") AS "team_key",
                fn_normalize_nfl_team("opponent") AS "opponent_key",
                "nfl_team", "opponent", "kickoff_at", "game_key", "home_away",
                "neutral_site", "venue", "roof", "surface", "latitude", "longitude", "rest_days"
         FROM "nfl_games" WHERE "season" = $1 AND "week" = $2`,
  },
  {
    name: 'historyWindowSchedule',
    source: 'server/services/projectionFeatures.js:479',
    binding: { firstSeason: 0, season: 1, week: 2, weekIsExclusiveUpperBound: true },
    text: `SELECT "season", "week", fn_normalize_nfl_team("nfl_team") AS "team_key",
                fn_normalize_nfl_team("opponent") AS "opponent_key", "home_away", "neutral_site"
         FROM "nfl_games"
         WHERE "season" >= $1
           AND ("season" < $2 OR ("season" = $2 AND "week" < $3))`,
  },
  {
    name: 'leagueScan',
    source: 'server/services/projectionFeatures.js:544',
    conditional: 'scanPositions.length > 0 && Number(week) > 1',
    binding: { season: 0, week: 1, positions: 2, limit: 3, weekIsExclusiveUpperBound: true },
    text: `SELECT "ps"."player_id", "ps"."week", "ps"."stats", "p"."position",
              fn_normalize_nfl_team("ng"."opponent") AS "defense",
              "ng"."home_away", "ng"."neutral_site"
       FROM "player_stats" "ps"
       JOIN "players" "p" ON "p"."id" = "ps"."player_id"
       LEFT JOIN "nfl_games" "ng" ON "ng"."season" = "ps"."season" AND "ng"."week" = "ps"."week"
         AND fn_normalize_nfl_team("ng"."nfl_team") = fn_normalize_nfl_team("p"."nfl_team")
       WHERE "ps"."season" = $1 AND "ps"."week" < $2 AND "p"."position" = ANY($3::text[])
       ORDER BY "ps"."player_id", "ps"."week"
       LIMIT $4`,
  },
  {
    name: 'defenseGameCount',
    source: 'server/services/projectionFeatures.js:568',
    conditional: 'currentSeasonScheduleRows.length > 0',
    binding: { season: 0, week: 1, weekIsExclusiveUpperBound: true },
    text: `SELECT fn_normalize_nfl_team("nfl_team") AS "team", COUNT(*)::int AS "games"
       FROM "nfl_games" WHERE "season" = $1 AND "week" < $2
       GROUP BY 1`,
  },
  {
    name: 'byeWeeks',
    source: 'server/services/bye.service.js:47',
    // `byeWeeks` reads the WHOLE regular season (weeks 1..18), including weeks
    // at and after the target: a bye is a gap in the schedule, not a result, so
    // reading week 18 while projecting week 3 leaks nothing. The absence of a
    // `week` binding here is therefore deliberate and is asserted by test.
    binding: { season: 0, teams: 1, regSeasonWeeks: 2 },
    text: `SELECT "t"."nfl_team", "ng"."week"
     FROM "nfl_games" "ng"
     JOIN unnest($2::text[]) AS "t"("nfl_team")
       ON fn_normalize_nfl_team("ng"."nfl_team") = fn_normalize_nfl_team("t"."nfl_team")
     WHERE "ng"."season" = $1 AND "ng"."week" BETWEEN 1 AND $3`,
  },
]);

/** Pure: the whitespace-normalized form the dispatch and the signature use. */
function normalizeSql(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/** Pure: the SHA-256 of a SQL text's normalized form. */
function sqlSignature(text) {
  return crypto.createHash('sha256').update(normalizeSql(text), 'utf8').digest('hex');
}

/**
 * Fail loud if two entries normalize to the same signature.
 *
 * Dispatch is BY signature, so a collision would silently make one query
 * unreachable - the client would answer both with whichever entry won the map.
 * Extracted as a function rather than left as a bare load-time `if` so the
 * guard itself can be exercised by a test; a check that can only fire on a
 * codebase that is already broken is a check nobody has ever seen work.
 */
function assertUniqueSignatures(entries) {
  const byySignature = new Map();
  for (const entry of entries) {
    const signature = sqlSignature(entry.text);
    if (byySignature.has(signature)) {
      throw new Error(
        `SQL surface collision: "${entry.name}" and "${byySignature.get(signature).name}" normalize ` +
        'to the same signature, so dispatch could not tell them apart'
      );
    }
    byySignature.set(signature, entry);
  }
  return byySignature;
}

/** Signature -> surface entry, built once. */
const SQL_BY_SIGNATURE = assertUniqueSignatures(SQL_SURFACE);

/** Name -> surface entry. */
const SQL_BY_NAME = new Map(SQL_SURFACE.map((entry) => [entry.name, entry]));

/** The signed surface, for the manifest. */
function sqlSurfaceSignatures() {
  return SQL_SURFACE.map((entry) => ({
    name: entry.name,
    source: entry.source,
    signature: sqlSignature(entry.text),
    normalizedLength: normalizeSql(entry.text).length,
    conditional: entry.conditional || null,
  }));
}

/**
 * Pure: which surface entry a SQL text is, or null.
 *
 * Returning null rather than throwing keeps the decision at the CALL SITE: the
 * extraction's recording client refuses an unknown query with one message, the
 * snapshot client with another, and each says the thing its own operator needs
 * to hear.
 */
function surfaceEntryFor(sql) {
  return SQL_BY_SIGNATURE.get(sqlSignature(sql)) || null;
}

module.exports = {
  SQL_SURFACE,
  SQL_BY_SIGNATURE,
  SQL_BY_NAME,
  normalizeSql,
  sqlSignature,
  sqlSurfaceSignatures,
  surfaceEntryFor,
  assertUniqueSignatures,
};
