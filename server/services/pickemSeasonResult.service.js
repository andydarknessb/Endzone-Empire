const crypto = require('node:crypto');
const pool = require('../modules/pool');
const { awardPickemChampions, reconcilePickemChampionTrophies } = require('./trophy.service');

const OUTCOME = Object.freeze({
  CHAMPIONS: 'champions',
  NO_CHAMPION: 'no_champion',
  MISSING: 'missing',
});
const SCORING_MODES = new Set(['straight', 'confidence']);

function positiveInteger(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

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
  const teamId = positiveInteger(row.teamId);
  const { points, correct } = scoringSnapshot(row);
  if (
    !teamId
    || typeof row.teamName !== 'string' || !row.teamName.trim()
    || (row.avatarUrl != null && typeof row.avatarUrl !== 'string')
    || (row.avatarStaticUrl != null && typeof row.avatarStaticUrl !== 'string')
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
  const provenance = row.provenance && typeof row.provenance === 'string'
    ? JSON.parse(row.provenance)
    : row.provenance;
  const declaredAt = row.declared_at instanceof Date
    ? row.declared_at.toISOString()
    : row.declared_at;
  return {
    leagueId: Number(row.league_id),
    season: Number(row.season),
    outcome: row.outcome,
    mode: row.scoring_mode,
    champions,
    provenance,
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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestFingerprint({ operation, metadata, expected = null, proposed }) {
  return crypto.createHash('sha256').update(canonicalJson({
    operation,
    leagueId: metadata.leagueId,
    season: metadata.season,
    operatorId: metadata.operatorId,
    reason: metadata.reason,
    source: metadata.source,
    expected,
    proposed,
  })).digest('hex');
}

function sameResult(left, right) {
  return Boolean(left && right)
    && Number(left.leagueId) === Number(right.leagueId)
    && Number(left.season) === Number(right.season)
    && left.outcome === right.outcome
    && left.mode === right.mode
    && sameChampions(left.champions || [], right.champions || [])
    && canonicalJson(left.provenance) === canonicalJson(right.provenance)
    && left.declaredAt === right.declaredAt;
}

function fromAuditRow(row) {
  if (!row) return null;
  const before = typeof row.before_result === 'string'
    ? JSON.parse(row.before_result)
    : row.before_result;
  const after = typeof row.after_result === 'string'
    ? JSON.parse(row.after_result)
    : row.after_result;
  return {
    id: Number(row.id),
    leagueId: Number(row.league_id),
    season: Number(row.season),
    operation: row.operation,
    operatorId: Number(row.operator_id),
    reason: row.reason,
    source: row.source,
    before,
    after,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function requiredOperatorText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PickemSeasonResultError(
      400,
      'PICKEM_SEASON_RESULT_OPERATOR_INPUT_REQUIRED',
      `Pick'em season result ${field} is required`
    );
  }
  return value.trim();
}

function requireApplyFlag(value) {
  if (typeof value !== 'boolean') {
    throw new PickemSeasonResultError(
      400,
      'PICKEM_SEASON_RESULT_OPERATOR_INPUT_REQUIRED',
      "Pick'em season result apply must be true or false"
    );
  }
  return value;
}

function operatorMetadata({ leagueId, season, operatorId, reason, source }) {
  const normalizedLeagueId = positiveInteger(leagueId);
  const normalizedSeason = positiveInteger(season);
  const normalizedOperatorId = positiveInteger(operatorId);
  if (!normalizedLeagueId || !normalizedSeason || !normalizedOperatorId) {
    throw new PickemSeasonResultError(
      400,
      'PICKEM_SEASON_RESULT_OPERATOR_INPUT_REQUIRED',
      "Pick'em season result recovery requires league, season, and operator identity"
    );
  }
  return {
    leagueId: normalizedLeagueId,
    season: normalizedSeason,
    operatorId: normalizedOperatorId,
    reason: requiredOperatorText(reason, 'reason'),
    source: requiredOperatorText(source, 'source'),
  };
}

function operatorResult({ leagueId, season, proposed, provenance, declaredAt = null }) {
  const outcome = proposed && proposed.outcome;
  const mode = proposed && proposed.mode;
  const rows = proposed && proposed.champions;
  if (!SCORING_MODES.has(mode) || !Array.isArray(rows)) {
    throw new PickemSeasonResultError(
      400,
      'PICKEM_SEASON_RESULT_INVALID',
      "Pick'em operator result requires a supported mode and champion array"
    );
  }
  if (rows.some((row) => !row || row.mode !== mode)) {
    throw new PickemSeasonResultError(
      400,
      'PICKEM_SEASON_RESULT_INVALID',
      "Pick'em operator champion modes must match the result mode"
    );
  }
  let champions;
  try {
    champions = rows.map((row) => snapshotChampion(row, mode));
  } catch (error) {
    if (!(error instanceof PickemSeasonResultError)) throw error;
    throw new PickemSeasonResultError(
      400,
      'PICKEM_SEASON_RESULT_INVALID',
      "Pick'em operator result contains an invalid champion snapshot"
    );
  }
  const teamIds = new Set(champions.map((champion) => champion.teamId));
  const tied = champions.length < 2 || champions.every((champion) => (
    champion.points === champions[0].points && champion.correct === champions[0].correct
  ));
  if (teamIds.size !== champions.length || !tied) {
    throw new PickemSeasonResultError(
      400,
      'PICKEM_SEASON_RESULT_INVALID',
      "Pick'em operator co-champions must be unique and tied on points and correct picks"
    );
  }
  if (
    (outcome !== OUTCOME.CHAMPIONS && outcome !== OUTCOME.NO_CHAMPION)
    || (outcome === OUTCOME.CHAMPIONS && champions.length === 0)
    || (outcome === OUTCOME.NO_CHAMPION && champions.length !== 0)
  ) {
    throw new PickemSeasonResultError(
      400,
      'PICKEM_SEASON_RESULT_INVALID',
      "Pick'em operator result outcome does not match its champion set"
    );
  }
  return { leagueId, season, outcome, mode, champions, provenance, declaredAt };
}

async function requirePickemLeague({ db, leagueId, lock = false }) {
  const league = await db.query(
    `SELECT "id", "pickem_only" FROM "leagues" WHERE "id" = $1${lock ? ' FOR UPDATE' : ''}`,
    [leagueId]
  );
  if (!league.rows[0]) {
    throw new PickemSeasonResultError(404, 'PICKEM_SEASON_RESULT_LEAGUE_NOT_FOUND', 'League not found');
  }
  if (!league.rows[0].pickem_only) {
    throw new PickemSeasonResultError(
      409,
      'PICKEM_SEASON_RESULT_INVALID_STATE',
      "Pick'em season result recovery applies only to pick'em-only leagues"
    );
  }
}

function recoveryAfter(metadata, proposed, declaredAt = null) {
  return operatorResult({
    leagueId: metadata.leagueId,
    season: metadata.season,
    proposed,
    provenance: {
      source: 'operator_recovery',
      evidenceSource: metadata.source,
      operatorId: metadata.operatorId,
    },
    declaredAt,
  });
}

function correctionAfter(metadata, proposed, declaredAt) {
  return operatorResult({
    leagueId: metadata.leagueId,
    season: metadata.season,
    proposed,
    provenance: {
      source: 'operator_correction',
      evidenceSource: metadata.source,
      operatorId: metadata.operatorId,
    },
    declaredAt,
  });
}

function ensureMissingForRecovery(before, metadata) {
  if (before.outcome !== OUTCOME.MISSING) {
    throw new PickemSeasonResultError(
      409,
      'PICKEM_SEASON_RESULT_INVALID_STATE',
      `Pick'em season result already exists for league ${metadata.leagueId}, season ${metadata.season}`
    );
  }
}

async function auditForRequest({ db, fingerprint }) {
  const result = await db.query(
    `SELECT "id", "league_id", "season", "operation", "operator_id", "reason", "source",
            "before_result", "after_result", "created_at"
       FROM "pickem_season_result_audits"
      WHERE "request_fingerprint" = $1`,
    [fingerprint]
  );
  return fromAuditRow(result.rows[0]);
}

function operatorOutcome({
  operation,
  dryRun,
  applied = false,
  idempotent = false,
  before,
  after,
  audit = null,
  awarded = [],
}) {
  return { operation, dryRun, applied, idempotent, before, after, audit, awarded };
}

async function repeatedRequest({ db, fingerprint, current, operation, metadata }) {
  const audit = await auditForRequest({ db, fingerprint });
  if (!audit) return null;
  if (!sameResult(current, audit.after)) {
    throw new PickemSeasonResultError(
      409,
      'PICKEM_SEASON_RESULT_STALE',
      `Pick'em season result changed after ${operation} for league ${metadata.leagueId}, season ${metadata.season}`
    );
  }
  return operatorOutcome({
    operation,
    dryRun: false,
    idempotent: true,
    before: audit.before,
    after: current,
    audit,
  });
}

async function inTransaction(db, work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function insertAudit({ db, metadata, operation, before, after, fingerprint }) {
  const inserted = await db.query(
    `INSERT INTO "pickem_season_result_audits"
       ("league_id", "season", "operation", "operator_id", "reason", "source",
        "before_result", "after_result", "request_fingerprint")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING "id", "league_id", "season", "operation", "operator_id", "reason", "source",
               "before_result", "after_result", "created_at"`,
    [
      metadata.leagueId,
      metadata.season,
      operation,
      metadata.operatorId,
      metadata.reason,
      metadata.source,
      JSON.stringify(before),
      JSON.stringify(after),
      fingerprint,
    ]
  );
  return fromAuditRow(inserted.rows[0]);
}

async function resultOf({ db = pool, leagueId, season }) {
  const result = await db.query(
    `SELECT "league_id", "season", "outcome", "scoring_mode", "champions", "provenance", "declared_at"
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
    provenance: null,
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
     RETURNING "league_id", "season", "outcome", "scoring_mode", "champions", "provenance", "declared_at"`,
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

async function auditTrailOf({ db = pool, leagueId, season }) {
  const result = await db.query(
    `SELECT "id", "league_id", "season", "operation", "operator_id", "reason", "source",
            "before_result", "after_result", "created_at"
       FROM "pickem_season_result_audits"
      WHERE "league_id" = $1 AND "season" = $2
      ORDER BY "id"`,
    [leagueId, season]
  );
  return result.rows.map(fromAuditRow);
}

async function recover({ db = pool, apply = false, proposed, ...input }) {
  const shouldApply = requireApplyFlag(apply);
  const metadata = operatorMetadata(input);
  const planned = recoveryAfter(metadata, proposed);
  const fingerprint = requestFingerprint({ operation: 'recovery', metadata, proposed: planned });
  if (!shouldApply) {
    await requirePickemLeague({ db, leagueId: metadata.leagueId });
    const before = await resultOf({ db, leagueId: metadata.leagueId, season: metadata.season });
    ensureMissingForRecovery(before, metadata);
    return operatorOutcome({
      operation: 'recovery',
      dryRun: true,
      before,
      after: planned,
    });
  }

  return inTransaction(db, async (client) => {
    await requirePickemLeague({ db: client, leagueId: metadata.leagueId, lock: true });
    const before = await resultOf({ db: client, leagueId: metadata.leagueId, season: metadata.season });
    const retry = await repeatedRequest({
      db: client,
      fingerprint,
      current: before,
      operation: 'recovery',
      metadata,
    });
    if (retry) return retry;
    ensureMissingForRecovery(before, metadata);
    const inserted = await client.query(
      `INSERT INTO "pickem_season_results"
         ("league_id", "season", "outcome", "scoring_mode", "champions", "provenance")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING "league_id", "season", "outcome", "scoring_mode", "champions", "provenance", "declared_at"`,
      [
        metadata.leagueId,
        metadata.season,
        planned.outcome,
        planned.mode,
        JSON.stringify(planned.champions),
        JSON.stringify(planned.provenance),
      ]
    );
    const after = fromRow(inserted.rows[0]);
    const awarded = await reconcilePickemChampionTrophies({
      client,
      leagueId: metadata.leagueId,
      season: metadata.season,
      champions: after.champions,
      mode: after.mode,
    });
    const audit = await insertAudit({
      db: client,
      metadata,
      operation: 'recovery',
      before,
      after,
      fingerprint,
    });
    return operatorOutcome({
      operation: 'recovery',
      dryRun: false,
      applied: true,
      before,
      after,
      audit,
      awarded,
    });
  });
}

async function correct({ db = pool, apply = false, expected, proposed, ...input }) {
  const shouldApply = requireApplyFlag(apply);
  const metadata = operatorMetadata(input);
  const plannedFromRequest = correctionAfter(metadata, proposed, expected && expected.declaredAt);
  const fingerprint = requestFingerprint({
    operation: 'correction',
    metadata,
    expected,
    proposed: plannedFromRequest,
  });
  const requireExpected = (before) => {
    if (before.outcome === OUTCOME.MISSING) {
      throw new PickemSeasonResultError(
        409,
        'PICKEM_SEASON_RESULT_INVALID_STATE',
        `Pick'em season result is missing for league ${metadata.leagueId}, season ${metadata.season}`
      );
    }
    if (!sameResult(before, expected)) {
      throw new PickemSeasonResultError(
        409,
        'PICKEM_SEASON_RESULT_STALE',
        `Pick'em season result changed before correction for league ${metadata.leagueId}, season ${metadata.season}`
      );
    }
  };

  if (!shouldApply) {
    await requirePickemLeague({ db, leagueId: metadata.leagueId });
    const before = await resultOf({ db, leagueId: metadata.leagueId, season: metadata.season });
    requireExpected(before);
    return operatorOutcome({
      operation: 'correction',
      dryRun: true,
      before,
      after: plannedFromRequest,
    });
  }

  return inTransaction(db, async (client) => {
    await requirePickemLeague({ db: client, leagueId: metadata.leagueId, lock: true });
    const before = await resultOf({ db: client, leagueId: metadata.leagueId, season: metadata.season });
    const retry = await repeatedRequest({
      db: client,
      fingerprint,
      current: before,
      operation: 'correction',
      metadata,
    });
    if (retry) return retry;
    requireExpected(before);
    const planned = plannedFromRequest;
    const updated = await client.query(
      `UPDATE "pickem_season_results"
          SET "outcome" = $1, "scoring_mode" = $2, "champions" = $3, "provenance" = $4
        WHERE "league_id" = $5 AND "season" = $6
      RETURNING "league_id", "season", "outcome", "scoring_mode", "champions", "provenance", "declared_at"`,
      [
        planned.outcome,
        planned.mode,
        JSON.stringify(planned.champions),
        JSON.stringify(planned.provenance),
        metadata.leagueId,
        metadata.season,
      ]
    );
    const after = fromRow(updated.rows[0]);
    const awarded = await reconcilePickemChampionTrophies({
      client,
      leagueId: metadata.leagueId,
      season: metadata.season,
      champions: after.champions,
      mode: after.mode,
    });
    const audit = await insertAudit({
      db: client,
      metadata,
      operation: 'correction',
      before,
      after,
      fingerprint,
    });
    return operatorOutcome({
      operation: 'correction',
      dryRun: false,
      applied: true,
      before,
      after,
      audit,
      awarded,
    });
  });
}

module.exports = {
  PickemSeasonResultError,
  OUTCOME,
  pickemChampions,
  declare,
  resultOf,
  auditTrailOf,
  recover,
  correct,
};
