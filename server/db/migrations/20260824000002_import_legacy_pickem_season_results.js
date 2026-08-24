const MODES = new Set(['straight', 'confidence']);
const ARCHIVED_SOURCE = 'legacy_league_history_awards';
const LIVE_SOURCE = 'legacy_live_trophies';

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonnegativeInteger(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function historicalTeamIdentity(row) {
  if (!row || typeof row !== 'object') return null;
  const teamId = positiveInteger(row.teamId);
  const names = [row.teamName, row.name]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
  if (!teamId || names.length === 0 || new Set(names).size > 1) return null;
  if (row.avatarUrl != null && typeof row.avatarUrl !== 'string') return null;
  if (row.avatarStaticUrl != null && typeof row.avatarStaticUrl !== 'string') return null;
  return {
    teamId,
    teamName: names[0],
    avatarUrl: row.avatarUrl ?? null,
    avatarStaticUrl: row.avatarStaticUrl ?? null,
  };
}

function championSnapshot({ awards, season, identityFor }) {
  if (!Array.isArray(awards) || awards.length === 0) return null;
  const coChampions = awards.length > 1;
  const expectedLabel = `${season} Pick'em ${coChampions ? 'Co-Champion' : 'Champion'}`;
  const teamIds = new Set();
  let points;
  let correct;
  let mode;
  const champions = [];

  for (const award of awards) {
    if (
      !award || typeof award !== 'object'
      || positiveInteger(award.season) !== season
      || nonnegativeInteger(award.week) !== 0
      || award.type !== 'pickem_champion'
      || award.label !== expectedLabel
    ) return null;
    const teamId = positiveInteger(award.team_id);
    if (!teamId || teamIds.has(teamId)) return null;
    teamIds.add(teamId);

    const data = award.data;
    const awardPoints = data && nonnegativeInteger(data.points);
    const awardCorrect = data && nonnegativeInteger(data.correct);
    const awardMode = data && data.mode;
    if (awardPoints == null || awardCorrect == null || !MODES.has(awardMode)) return null;
    if (points === undefined) {
      points = awardPoints;
      correct = awardCorrect;
      mode = awardMode;
    } else if (points !== awardPoints || correct !== awardCorrect || mode !== awardMode) {
      return null;
    }

    const identity = identityFor(teamId);
    if (!identity || identity.teamId !== teamId) return null;
    champions.push({ ...identity, points, correct, mode });
  }

  return { champions, mode, teamIds };
}

function archivedCandidate(row) {
  if (!Array.isArray(row.awards)) return { hasEvidence: true, candidate: null };
  const awards = row.awards.filter((award) => award && award.type === 'pickem_champion');
  if (awards.length === 0) return { hasEvidence: false, candidate: null };
  if (!Array.isArray(row.standings)) return { hasEvidence: true, candidate: null };

  const identityByTeamId = new Map();
  for (const standing of row.standings) {
    const identity = historicalTeamIdentity(standing);
    if (!identity) continue;
    if (identityByTeamId.has(identity.teamId)) return { hasEvidence: true, candidate: null };
    identityByTeamId.set(identity.teamId, identity);
  }
  const snapshot = championSnapshot({
    awards,
    season: Number(row.season),
    identityFor: (teamId) => identityByTeamId.get(teamId),
  });
  if (!snapshot) return { hasEvidence: true, candidate: null };
  const singularChampion = row.champion_team_id == null
    ? null
    : positiveInteger(row.champion_team_id);
  if (row.champion_team_id != null && (!singularChampion || !snapshot.teamIds.has(singularChampion))) {
    return { hasEvidence: true, candidate: null };
  }

  return {
    hasEvidence: true,
    candidate: {
      league_id: Number(row.league_id),
      season: Number(row.season),
      outcome: 'champions',
      scoring_mode: snapshot.mode,
      champions: JSON.stringify(snapshot.champions),
      provenance: JSON.stringify({ source: ARCHIVED_SOURCE, leagueHistoryId: Number(row.history_id) }),
      declared_at: row.created_at,
    },
  };
}

function liveCandidate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const season = Number(rows[0].season);
  if (!Number.isInteger(season) || rows.some((row) => Number(row.season) !== season)) return null;
  const snapshot = championSnapshot({
    awards: rows,
    season,
    identityFor: (teamId) => {
      const row = rows.find((candidate) => Number(candidate.team_id) === teamId);
      return historicalTeamIdentity(row);
    },
  });
  if (!snapshot) return null;
  const declaredAt = rows.reduce((latest, row) => {
    const awardedAt = new Date(row.awarded_at);
    return !latest || awardedAt > latest ? awardedAt : latest;
  }, null);
  if (!declaredAt || Number.isNaN(declaredAt.getTime())) return null;
  return {
    league_id: Number(rows[0].league_id),
    season,
    outcome: 'champions',
    scoring_mode: snapshot.mode,
    champions: JSON.stringify(snapshot.champions),
    provenance: JSON.stringify({
      source: LIVE_SOURCE,
      trophyIds: rows.map((row) => Number(row.trophy_id)),
    }),
    declared_at: declaredAt,
  };
}

function resultKey(leagueId, season) {
  return `${Number(leagueId)}:${Number(season)}`;
}

async function importLegacyPickemSeasonResults(knex) {
  const archived = await knex.raw(`
    SELECT "league_history"."id" AS "history_id",
           "league_history"."league_id", "league_history"."season",
           "league_history"."champion_team_id", "league_history"."standings",
           "league_history"."awards", "league_history"."created_at"
      FROM "league_history"
      JOIN "leagues" ON "leagues"."id" = "league_history"."league_id"
     WHERE "leagues"."pickem_only" = true
     ORDER BY "league_history"."league_id", "league_history"."season"
  `);
  const candidates = [];
  const archivedEvidence = new Set();
  for (const row of archived.rows) {
    const { hasEvidence, candidate } = archivedCandidate(row);
    if (hasEvidence) archivedEvidence.add(resultKey(row.league_id, row.season));
    if (candidate) candidates.push(candidate);
  }

  const live = await knex.raw(`
    SELECT "trophies"."id" AS "trophy_id",
           "trophies"."league_id", "trophies"."team_id",
           "trophies"."season", "trophies"."week", "trophies"."type",
           "trophies"."label", "trophies"."data", "trophies"."awarded_at",
           "teams"."id" AS "teamId", "teams"."name" AS "teamName",
           "teams"."avatar_url" AS "avatarUrl",
           "teams"."avatar_static_url" AS "avatarStaticUrl"
      FROM "trophies"
      JOIN "leagues" ON "leagues"."id" = "trophies"."league_id"
      JOIN "teams" ON "teams"."id" = "trophies"."team_id"
     WHERE "leagues"."pickem_only" = true
       AND "trophies"."type" = 'pickem_champion'
     ORDER BY "trophies"."league_id", "trophies"."season", "trophies"."id"
  `);
  const liveByResult = new Map();
  for (const row of live.rows) {
    const key = resultKey(row.league_id, row.season);
    if (!liveByResult.has(key)) liveByResult.set(key, []);
    liveByResult.get(key).push(row);
  }
  for (const [key, rows] of liveByResult) {
    if (archivedEvidence.has(key)) continue;
    const candidate = liveCandidate(rows);
    if (candidate) candidates.push(candidate);
  }

  if (candidates.length > 0) {
    await knex('pickem_season_results')
      .insert(candidates)
      .onConflict(['league_id', 'season'])
      .ignore();
  }
}

exports.up = async function (knex) {
  await knex.schema.alterTable('pickem_season_results', (table) => {
    table.jsonb('provenance').notNullable().defaultTo(
      knex.raw(`'{"source":"season_completion"}'::jsonb`)
    );
  });
  await knex.raw(`
    ALTER TABLE "pickem_season_results"
      ADD CONSTRAINT "pickem_season_results_provenance_check"
      CHECK (
        jsonb_typeof("provenance") = 'object'
        AND jsonb_typeof("provenance"->'source') = 'string'
        AND btrim("provenance"->>'source') <> ''
      )
  `);
  await importLegacyPickemSeasonResults(knex);
};

exports.down = async function (knex) {
  await knex('pickem_season_results')
    .whereRaw(`"provenance"->>'source' IN (?, ?)`, [ARCHIVED_SOURCE, LIVE_SOURCE])
    .delete();
  await knex.raw(`
    ALTER TABLE "pickem_season_results"
      DROP CONSTRAINT "pickem_season_results_provenance_check"
  `);
  await knex.schema.alterTable('pickem_season_results', (table) => {
    table.dropColumn('provenance');
  });
};

exports.importLegacyPickemSeasonResults = importLegacyPickemSeasonResults;
