const pool = require('../modules/pool');
const { awardPickemChampions } = require('./trophy.service');

const OUTCOME = Object.freeze({
  CHAMPIONS: 'champions',
  NO_CHAMPION: 'no_champion',
  MISSING: 'missing',
});
const SCORING_MODES = new Set(['straight', 'confidence']);

class PickemSeasonResultError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function pickemChampions(standings) {
  const rows = standings || [];
  if (rows.length === 0) return [];
  const leader = rows[0];
  if (!(Number(leader.points) > 0) && !(Number(leader.correct) > 0)) return [];
  return rows.filter(
    (row) => Number(row.points) === Number(leader.points) && Number(row.correct) === Number(leader.correct)
  );
}

function scoringSnapshot(row) {
  const rawPoints = row && row.points;
  const rawCorrect = row && row.correct;
  const points = Number(rawPoints);
  const correct = Number(rawCorrect);
  if (
    rawPoints == null || rawCorrect == null
    || (typeof rawPoints === 'string' && !rawPoints.trim())
    || (typeof rawCorrect === 'string' && !rawCorrect.trim())
    || (typeof rawPoints !== 'number' && typeof rawPoints !== 'string')
    || (typeof rawCorrect !== 'number' && typeof rawCorrect !== 'string')
    || !Number.isInteger(points) || points < 0
    || !Number.isInteger(correct) || correct < 0
  ) {
    throw new PickemSeasonResultError(
      409,
      'PICKEM_SEASON_RESULT_INVALID',
      "Pick'em standings are missing valid points or correct-picks values"
    );
  }
  return { points, correct };
}

function snapshotChampion(row, mode) {
  const teamId = Number(row.teamId);
  const { points, correct } = scoringSnapshot(row);
  if (
    !Number.isInteger(teamId) || teamId <= 0
    || typeof row.teamName !== 'string' || !row.teamName.trim()
  ) {
    throw new PickemSeasonResultError(
      409,
      'PICKEM_SEASON_RESULT_IDENTITY_REQUIRED',
      "Pick'em champion is missing required historical Team identity"
    );
  }
  return {
    teamId,
    teamName: row.teamName,
    avatarUrl: row.avatarUrl ?? null,
    avatarStaticUrl: row.avatarStaticUrl ?? null,
    points,
    correct,
    mode,
  };
}

function fromRow(row) {
  if (!row) return null;
  const champions = Array.isArray(row.champions) ? row.champions : JSON.parse(row.champions || '[]');
  const declaredAt = row.declared_at instanceof Date
    ? row.declared_at.toISOString()
    : row.declared_at;
  return {
    leagueId: Number(row.league_id),
    season: Number(row.season),
    outcome: row.outcome,
    mode: row.scoring_mode,
    champions,
    declaredAt,
  };
}

function sameChampions(left, right) {
  if (left.length !== right.length) return false;
  return left.every((champion, index) => {
    const other = right[index];
    return other
      && Number(champion.teamId) === Number(other.teamId)
      && champion.teamName === other.teamName
      && (champion.avatarUrl ?? null) === (other.avatarUrl ?? null)
      && (champion.avatarStaticUrl ?? null) === (other.avatarStaticUrl ?? null)
      && Number(champion.points) === Number(other.points)
      && Number(champion.correct) === Number(other.correct)
      && champion.mode === other.mode;
  });
}

async function resultOf({ db = pool, leagueId, season }) {
  const result = await db.query(
    `SELECT "league_id", "season", "outcome", "scoring_mode", "champions", "declared_at"
       FROM "pickem_season_results"
      WHERE "league_id" = $1 AND "season" = $2`,
    [leagueId, season]
  );
  return fromRow(result.rows[0]) || {
    leagueId,
    season,
    outcome: OUTCOME.MISSING,
    mode: null,
    champions: [],
    declaredAt: null,
  };
}

async function declare({ db, leagueId, season, standings, mode }) {
  if (!SCORING_MODES.has(mode)) {
    throw new PickemSeasonResultError(
      409,
      'PICKEM_SEASON_RESULT_INVALID',
      `Unsupported Pick'em scoring mode: ${mode}`
    );
  }
  for (const row of standings || []) scoringSnapshot(row);
  const champions = pickemChampions(standings).map((row) => snapshotChampion(row, mode));
  const outcome = champions.length > 0 ? OUTCOME.CHAMPIONS : OUTCOME.NO_CHAMPION;
  const inserted = await db.query(
    `INSERT INTO "pickem_season_results"
       ("league_id", "season", "outcome", "scoring_mode", "champions")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("league_id", "season") DO NOTHING
     RETURNING "league_id", "season", "outcome", "scoring_mode", "champions", "declared_at"`,
    [leagueId, season, outcome, mode, JSON.stringify(champions)]
  );
  const result = fromRow(inserted.rows[0]);
  if (!result) {
    const existing = await resultOf({ db, leagueId, season });
    if (
      existing.outcome === outcome
      && existing.mode === mode
      && sameChampions(existing.champions, champions)
    ) {
      return { ...existing, awarded: [] };
    }
    throw new PickemSeasonResultError(
      409,
      'PICKEM_SEASON_RESULT_CONFLICT',
      `Pick'em season result already declared for league ${leagueId}, season ${season}`
    );
  }
  const awarded = await awardPickemChampions({
    client: db, leagueId, season, champions, mode,
  });
  return { ...result, awarded };
}

module.exports = { PickemSeasonResultError, OUTCOME, pickemChampions, declare, resultOf };
