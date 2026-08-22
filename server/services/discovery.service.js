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
const { assertAdmissible, joinLeague } = require('./leagueMembership.service');
const { joinability, joinableWhereSql } = require('./leaguePhase');
const { pickemOnlyWhereSql, fantasySideWhereSql } = require('./leagueType');
const { isFull, hasOpenSlotsHavingSql } = require('./leagueSize');

/**
 * Coded error for this module, the same shape as MembershipError: `reason`
 * (the joinability reason the invite preview also ships as `joinReason`)
 * rides along when a refusal has one, so the route can ship it.
 */
class DiscoveryError extends Error {
  constructor(statusCode, message, { reason } = {}) {
    super(message);
    this.statusCode = statusCode;
    if (reason) this.reason = reason;
  }
}

const VALID_SCORING_PRESETS = Object.keys(SCORING_PRESETS); // ['standard', 'half_ppr', 'ppr']
const VALID_DISCOVER_SORTS = ['newest', 'draft_date', 'open_slots'];
// League type filter for the browser: a pick'em-only league has no scoring
// preset, so the scoring filter can never find one; this is how it is found.
const VALID_DISCOVER_TYPES = ['fantasy', 'pickem'];
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
  if (pickemMode !== undefined && pickemMode !== null) {
    if (!PICKEM_MODES.includes(pickemMode)) {
      return { error: `pickemMode must be one of: ${PICKEM_MODES.join(', ')}` };
    }
    // Rejected rather than silently discarded, same as the fantasy-only
    // fields below: accepting a mode that no pickem_settings row will ever
    // record would tell the caller confidence pick'em is configured when
    // pick'em is off entirely.
    if (type === 'fantasy') {
      return { error: 'pickemMode is not allowed when leagueType is fantasy' };
    }
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

/** The per-league team count in the Discover aggregate (one row per league). */
const TEAM_COUNT_EXPR = `COUNT(DISTINCT "teams"."id")`;

/**
 * Pure: build the WHERE/HAVING/ORDER BY fragments + params array for the
 * discover query. Every user-supplied value travels through the params
 * array — the fragments themselves are built only from fixed, code-chosen
 * strings, so nothing here string-interpolates request input into SQL.
 */
function buildDiscoverQuery({ userId, search, scoring, openSlots, sort, type } = {}) {
  const params = [userId];
  // Only leagues that will accept a team are listed (a fantasy league while
  // pre-draft, a pick'em-only league until its season completes); the rest
  // are hidden rather than shown disabled.
  const where = [`"leagues"."is_public" = true`, joinableWhereSql('leagues')];

  if (search) {
    params.push(`%${search}%`);
    where.push(`"leagues"."name" ILIKE $${params.length}`);
  }
  if (scoring) {
    params.push(scoring);
    where.push(`"leagues"."scoring_preset" = $${params.length}`);
  }
  // 'pickem' = pick'em-only pools; 'fantasy' = leagues with a fantasy side,
  // which includes a fantasy league that also plays pick'em ("both": that is
  // pickem_only=false plus an enabled pickem_settings row, see the pickemEnabled
  // projection). Anything unvalidated adds no fragment rather than silently
  // meaning "fantasy". A fixed code string, not request input, so it is
  // spliced directly rather than travelling through params.
  if (type === 'pickem') {
    where.push(pickemOnlyWhereSql('leagues'));
  } else if (type === 'fantasy') {
    where.push(fantasySideWhereSql('leagues'));
  }

  // "Open slots" is leagueSize's rule, not a comparison of this query's own.
  const havingClause = openSlots ? hasOpenSlotsHavingSql('leagues', TEAM_COUNT_EXPR) : null;

  const orderByOptions = {
    newest: `"leagues"."created_at" DESC`,
    draft_date: `"leagues"."draft_date" ASC NULLS LAST`,
    open_slots: `("leagues"."max_teams" - ${TEAM_COUNT_EXPR}) DESC`,
  };
  const orderByClause = orderByOptions[sort] || orderByOptions.newest;

  return {
    whereClause: where.join(' AND '),
    havingClause,
    orderByClause,
    params,
  };
}

/**
 * The Discover card projection: one row per league as the client renders it
 * (type chips, n/max teams, the caller's standing). $1 is always the caller's
 * user id; `extraColumns` lets a caller widen the shape without a second copy
 * of the joins. Every clause argument is spliced into the SQL verbatim, so
 * callers pass only code-literal fragments (as buildDiscoverQuery does) and
 * route every request value through `params`.
 */
async function selectLeagueCards({ whereClause, havingClause = '', orderByClause = '"leagues"."id"', params, extraColumns = '' }) {
  const result = await pool.query(
    `SELECT
       "leagues"."id",
       "leagues"."name",
       "leagues"."max_teams" AS "maxTeams",
       ${TEAM_COUNT_EXPR}::int AS "teamCount",
       "leagues"."scoring_preset" AS "scoringPreset",
       "leagues"."best_ball" AS "bestBall",
       "leagues"."pickem_only" AS "pickemOnly",
       COALESCE(BOOL_OR("pickem_settings"."enabled"), false) AS "pickemEnabled",
       "leagues"."join_approval" AS "joinApproval",
       "leagues"."draft_date" AS "draftDate",
       "leagues"."created_at" AS "createdAt",
       BOOL_OR("teams"."owner_id" = $1) AS "alreadyMember",
       MAX(CASE WHEN "join_requests"."user_id" = $1 THEN "join_requests"."status" END) AS "myRequestStatus"${extraColumns}
     FROM "leagues"
     LEFT JOIN "teams" ON "teams"."league_id" = "leagues"."id"
     LEFT JOIN "pickem_settings" ON "pickem_settings"."league_id" = "leagues"."id"
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
    openSlots: !isFull(row.teamCount, row.maxTeams),
  }));
}

/** Run the discover query for a caller, applying validated filters. */
async function discoverLeagues({ userId, search, scoring, openSlots, sort, type }) {
  const { whereClause, havingClause, orderByClause, params } = buildDiscoverQuery({
    userId, search, scoring, openSlots, sort, type,
  });
  return selectLeagueCards({ whereClause, havingClause, orderByClause, params });
}

/**
 * What an invite link reveals before joining: the Discover card for the
 * league behind `code`, plus who runs it, whether it is public, and whether
 * it will accept a team (`joinable`, with `joinReason` naming why not:
 * 'draft-started' | 'season-complete'). Null when no league has that code.
 * Never returns the code itself, and never a computed phase or the raw draft
 * and season statuses: those are the joinability answer's inputs, read here
 * and dropped (the client keys its warning on `joinReason` alone).
 */
async function previewLeagueByInviteCode({ code, userId }) {
  const rows = await selectLeagueCards({
    whereClause: '"leagues"."invite_code" = $2',
    params: [userId, code],
    extraColumns: `,
       "leagues"."is_public" AS "isPublic",
       "leagues"."draft_status" AS "draft_status",
       "leagues"."season_status" AS "season_status",
       "leagues"."pickem_only" AS "pickem_only",
       (SELECT "users"."username" FROM "users" WHERE "users"."id" = "leagues"."owner_id") AS "ownerUsername"`,
  });
  const row = rows[0];
  if (!row) return null;
  const { draft_status, season_status, pickem_only, ...preview } = row;
  const answer = joinability({ draft_status, season_status, pickem_only });
  return { ...preview, joinable: answer.joinable, joinReason: answer.joinable ? null : answer.reason };
}

/**
 * Join a public league: either creates the team immediately, or (when the
 * league requires approval) files/refreshes a join_requests row and
 * notifies the owner. Runs inside one transaction with the league row
 * locked. Being public is this path's gate; admission and the Team itself
 * are the membership module's (leagueMembership.joinLeague), as on every
 * join path.
 */
async function joinPublicLeague({ leagueId, userId, username, teamName }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`, [leagueId]);
    const league = leagueResult.rows[0];
    if (!league) throw new DiscoveryError(404, 'league not found');
    if (!league.is_public) throw new DiscoveryError(403, 'this league is not open for public join');

    if (league.join_approval) {
      // Admission is decided again when the request is approved; asking now
      // keeps a member, or a manager facing a full or closed league, from
      // filing a request that could never be approved.
      await assertAdmissible(client, league, userId);
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

    const { team } = await joinLeague(client, { leagueId, userId, teamName, username });
    await client.query('COMMIT');
    return { pending: false, league, team };
  } catch (error) {
    await client.query('ROLLBACK');
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

    // Admitted against the league as it is now, not as it was when the
    // request was filed: a pending request cannot slip a team into a league
    // that has since stopped being joinable or filled up, nor a second Team
    // to a requester who joined another way meanwhile.
    await joinLeague(client, {
      leagueId, userId: joinRequest.user_id, teamName: joinRequest.team_name, username: joinRequest.username,
    });
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
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  DiscoveryError,
  VALID_SCORING_PRESETS,
  VALID_DISCOVER_SORTS,
  VALID_DISCOVER_TYPES,
  VALID_LEAGUE_TYPES,
  validateCreateOptions,
  buildDiscoverQuery,
  discoverLeagues,
  previewLeagueByInviteCode,
  joinPublicLeague,
  listJoinRequests,
  decideJoinRequest,
};
