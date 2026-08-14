/**
 * League discovery & public-join flow (Phase 4: league formats & discovery).
 * Pure validation/query-builder helpers are exported alongside the DB-backed
 * functions so they can be unit tested without a database.
 */
const pool = require('../modules/pool');
const { notify } = require('./activity.service');
const { SCORING_PRESETS } = require('./scoring.service');
const { MODES: PICKEM_MODES } = require('./pickem.service');
const { commissionerPredicate } = require('./leagueRole.service');

class DiscoveryError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const VALID_SCORING_PRESETS = Object.keys(SCORING_PRESETS); // ['standard', 'half_ppr', 'ppr']
const VALID_DISCOVER_SORTS = ['newest', 'draft_date', 'open_slots'];
const VALID_LEAGUE_TYPES = ['fantasy', 'pickem', 'both'];

/**
 * Pure: validate & normalize the optional format fields on league create.
 * Returns { value } with every field defaulted, or { error } (400-worthy).
 *
 * `leagueType` defaults to 'fantasy' so existing callers are unaffected. The
 * returned value carries the derived flags the create handler acts on:
 * `pickemOnly` (type 'pickem': the league has no fantasy side), and
 * `pickemEnabled` (type 'pickem' or 'both': write the pickem_settings row at
 * creation). Flat wire fields rather than a sub-object, so no invalid
 * combination is representable on the wire.
 */
function validateCreateOptions({
  isPublic, joinApproval, bestBall, scoringPreset, draftDate, leagueType, pickemMode,
} = {}) {
  if (leagueType !== undefined && !VALID_LEAGUE_TYPES.includes(leagueType)) {
    return { error: `leagueType must be one of ${VALID_LEAGUE_TYPES.join(', ')}` };
  }
  const type = leagueType === undefined ? 'fantasy' : leagueType;
  if (pickemMode !== undefined && pickemMode !== null && !PICKEM_MODES.includes(pickemMode)) {
    return { error: `pickemMode must be one of: ${PICKEM_MODES.join(', ')}` };
  }
  // A pick'em league has no draft, rosters or fantasy scoring, so the
  // fantasy-only fields are rejected outright rather than silently dropped:
  // a payload carrying one signals a stale or confused client, and each
  // field's presence test matches the one its validator below uses.
  if (type === 'pickem') {
    if (bestBall !== undefined) {
      return { error: 'bestBall is not allowed when leagueType is pickem' };
    }
    if (scoringPreset !== undefined && scoringPreset !== null) {
      return { error: 'scoringPreset is not allowed when leagueType is pickem' };
    }
    if (draftDate !== undefined && draftDate !== null) {
      return { error: 'draftDate is not allowed when leagueType is pickem' };
    }
  }

  const value = {
    isPublic: false,
    joinApproval: false,
    bestBall: false,
    scoringPreset: null,
    scoringRules: null,
    draftDate: null,
    pickemOnly: type === 'pickem',
    pickemEnabled: type !== 'fantasy',
    pickemMode: pickemMode == null ? 'straight' : pickemMode,
  };

  if (isPublic !== undefined) {
    if (typeof isPublic !== 'boolean') return { error: 'isPublic must be a boolean' };
    value.isPublic = isPublic;
  }
  if (joinApproval !== undefined) {
    if (typeof joinApproval !== 'boolean') return { error: 'joinApproval must be a boolean' };
    value.joinApproval = joinApproval;
  }
  if (bestBall !== undefined) {
    if (typeof bestBall !== 'boolean') return { error: 'bestBall must be a boolean' };
    value.bestBall = bestBall;
  }
  if (scoringPreset !== undefined && scoringPreset !== null) {
    if (!VALID_SCORING_PRESETS.includes(scoringPreset)) {
      return { error: `scoringPreset must be one of ${VALID_SCORING_PRESETS.join(', ')}` };
    }
    value.scoringPreset = scoringPreset;
    value.scoringRules = SCORING_PRESETS[scoringPreset];
  }
  if (draftDate !== undefined && draftDate !== null) {
    const parsed = new Date(draftDate);
    if (Number.isNaN(parsed.getTime())) return { error: 'draftDate must be a valid ISO date string' };
    if (parsed.getTime() <= Date.now()) return { error: 'draftDate must be in the future' };
    value.draftDate = parsed;
  }
  return { value };
}

/**
 * Pure: build the WHERE/HAVING/ORDER BY fragments + params array for the
 * discover query. Every user-supplied value travels through the params
 * array — the fragments themselves are built only from fixed, code-chosen
 * strings, so nothing here string-interpolates request input into SQL.
 */
function buildDiscoverQuery({ userId, search, scoring, openSlots, sort } = {}) {
  const params = [userId];
  const where = [`"leagues"."is_public" = true`, `"leagues"."draft_status" = 'pending'`];

  if (search) {
    params.push(`%${search}%`);
    where.push(`"leagues"."name" ILIKE $${params.length}`);
  }
  if (scoring) {
    params.push(scoring);
    where.push(`"leagues"."scoring_preset" = $${params.length}`);
  }

  const havingClause = openSlots ? `COUNT(DISTINCT "teams"."id") < "leagues"."max_teams"` : null;

  const orderByOptions = {
    newest: `"leagues"."created_at" DESC`,
    draft_date: `"leagues"."draft_date" ASC NULLS LAST`,
    open_slots: `("leagues"."max_teams" - COUNT(DISTINCT "teams"."id")) DESC`,
  };
  const orderByClause = orderByOptions[sort] || orderByOptions.newest;

  return {
    whereClause: where.join(' AND '),
    havingClause,
    orderByClause,
    params,
  };
}

/** Run the discover query for a caller, applying validated filters. */
async function discoverLeagues({ userId, search, scoring, openSlots, sort }) {
  const { whereClause, havingClause, orderByClause, params } = buildDiscoverQuery({
    userId, search, scoring, openSlots, sort,
  });
  const result = await pool.query(
    `SELECT
       "leagues"."id",
       "leagues"."name",
       "leagues"."max_teams" AS "maxTeams",
       COUNT(DISTINCT "teams"."id")::int AS "teamCount",
       "leagues"."scoring_preset" AS "scoringPreset",
       "leagues"."best_ball" AS "bestBall",
       "leagues"."join_approval" AS "joinApproval",
       "leagues"."draft_date" AS "draftDate",
       "leagues"."created_at" AS "createdAt",
       BOOL_OR("teams"."owner_id" = $1) AS "alreadyMember",
       MAX(CASE WHEN "join_requests"."user_id" = $1 THEN "join_requests"."status" END) AS "myRequestStatus"
     FROM "leagues"
     LEFT JOIN "teams" ON "teams"."league_id" = "leagues"."id"
     LEFT JOIN "join_requests" ON "join_requests"."league_id" = "leagues"."id"
       AND "join_requests"."user_id" = $1
     WHERE ${whereClause}
     GROUP BY "leagues"."id"
     ${havingClause ? `HAVING ${havingClause}` : ''}
     ORDER BY ${orderByClause}`,
    params
  );
  return result.rows.map((row) => ({
    ...row,
    openSlots: row.teamCount < row.maxTeams,
  }));
}

/**
 * Join a public league: either creates the team immediately, or (when the
 * league requires approval) files/refreshes a join_requests row and
 * notifies the owner. Runs inside one transaction with the league row
 * locked, mirroring the invite-code join in league.router.js.
 */
async function joinPublicLeague({ leagueId, userId, username, teamName }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`, [leagueId]);
    const league = leagueResult.rows[0];
    if (!league) throw new DiscoveryError(404, 'league not found');
    if (!league.is_public) throw new DiscoveryError(403, 'this league is not open for public join');
    if (league.draft_status !== 'pending') throw new DiscoveryError(409, 'league draft already started');

    const membership = await client.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, userId]
    );
    if (membership.rows[0]) throw new DiscoveryError(409, 'you already have a team in this league');

    const countResult = await client.query(`SELECT COUNT(*)::int AS n FROM "teams" WHERE "league_id" = $1`, [leagueId]);
    const teamCount = countResult.rows[0].n;
    if (teamCount >= league.max_teams) throw new DiscoveryError(409, 'league is full');

    if (league.join_approval) {
      const upsert = await client.query(
        `INSERT INTO "join_requests" ("league_id", "user_id", "team_name", "status")
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT ("league_id", "user_id")
         DO UPDATE SET "status" = 'pending', "team_name" = EXCLUDED."team_name", "updated_at" = now()
         WHERE "join_requests"."status" = 'denied'
         RETURNING *`,
        [leagueId, userId, teamName || null]
      );
      let joinRequest = upsert.rows[0];
      if (!joinRequest) {
        // Conflict existed but wasn't 'denied' (already pending) — surface as-is
        const existing = await client.query(
          `SELECT * FROM "join_requests" WHERE "league_id" = $1 AND "user_id" = $2`,
          [leagueId, userId]
        );
        joinRequest = existing.rows[0];
        if (!joinRequest || joinRequest.status !== 'pending') {
          throw new DiscoveryError(409, 'unable to submit join request');
        }
      }
      await notify(client, {
        userId: league.owner_id,
        leagueId,
        type: 'join_request',
        message: `${username} requested to join ${league.name}`,
        data: { requestId: joinRequest.id, userId },
      });
      await client.query('COMMIT');
      return { pending: true, joinRequest };
    }

    const teamResult = await client.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [leagueId, userId, teamName || `${username}'s Team`, teamCount + 1]
    );
    await client.query('COMMIT');
    return { pending: false, league, team: teamResult.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new DiscoveryError(409, 'you already have a team in this league');
    throw error;
  } finally {
    client.release();
  }
}

/** Commissioner queue: pending join requests for a league the caller owns. */
async function listJoinRequests({ leagueId, ownerId }) {
  const commish = await pool.query(
    `SELECT 1 FROM "leagues" WHERE "id" = $1 AND ${commissionerPredicate(2)}`,
    [leagueId, ownerId]
  );
  if (!commish.rows[0]) throw new DiscoveryError(403, 'league not found or you are not the commissioner');

  const result = await pool.query(
    `SELECT "join_requests"."id", "join_requests"."team_name", "join_requests"."created_at",
            "users"."username"
     FROM "join_requests"
     JOIN "users" ON "users"."id" = "join_requests"."user_id"
     WHERE "join_requests"."league_id" = $1 AND "join_requests"."status" = 'pending'
     ORDER BY "join_requests"."created_at" ASC`,
    [leagueId]
  );
  return result.rows;
}

/** Commissioner approves or denies a pending join request, transactionally. */
async function decideJoinRequest({ leagueId, ownerId, requestId, approve }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 AND ${commissionerPredicate(2)} FOR UPDATE`,
      [leagueId, ownerId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new DiscoveryError(403, 'league not found or you are not the commissioner');

    const requestResult = await client.query(
      `SELECT "join_requests".*, "users"."username" FROM "join_requests"
       JOIN "users" ON "users"."id" = "join_requests"."user_id"
       WHERE "join_requests"."id" = $1 AND "join_requests"."league_id" = $2 AND "join_requests"."status" = 'pending'
       FOR UPDATE OF "join_requests"`,
      [requestId, leagueId]
    );
    const joinRequest = requestResult.rows[0];
    if (!joinRequest) throw new DiscoveryError(404, 'pending join request not found');

    if (!approve) {
      await client.query(
        `UPDATE "join_requests" SET "status" = 'denied', "updated_at" = now() WHERE "id" = $1`,
        [joinRequest.id]
      );
      await notify(client, {
        userId: joinRequest.user_id,
        leagueId,
        type: 'join_request',
        message: `Your request to join ${league.name} was denied.`,
        data: { requestId: joinRequest.id },
      });
      await client.query('COMMIT');
      return { status: 'denied' };
    }

    if (league.draft_status !== 'pending') throw new DiscoveryError(409, 'league draft already started');
    const countResult = await client.query(`SELECT COUNT(*)::int AS n FROM "teams" WHERE "league_id" = $1`, [leagueId]);
    const teamCount = countResult.rows[0].n;
    if (teamCount >= league.max_teams) throw new DiscoveryError(409, 'league is full');

    await client.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position")
       VALUES ($1, $2, $3, $4)`,
      [leagueId, joinRequest.user_id, joinRequest.team_name || `${joinRequest.username}'s Team`, teamCount + 1]
    );
    await client.query(
      `UPDATE "join_requests" SET "status" = 'approved', "updated_at" = now() WHERE "id" = $1`,
      [joinRequest.id]
    );
    await notify(client, {
      userId: joinRequest.user_id,
      leagueId,
      type: 'join_request',
      message: `Your request to join ${league.name} was approved!`,
      data: { requestId: joinRequest.id },
    });
    await client.query('COMMIT');
    return { status: 'approved' };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new DiscoveryError(409, 'that user already has a team in this league');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  DiscoveryError,
  VALID_SCORING_PRESETS,
  VALID_DISCOVER_SORTS,
  VALID_LEAGUE_TYPES,
  validateCreateOptions,
  buildDiscoverQuery,
  discoverLeagues,
  joinPublicLeague,
  listJoinRequests,
  decideJoinRequest,
};
