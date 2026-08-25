const express = require('express');
const crypto = require('crypto');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { createRateLimiter } = require('../modules/rateLimit');
const projectionService = require('../services/projection.service');
const {
  VALID_SCORING_PRESETS,
  VALID_DISCOVER_SORTS,
  validateCreateOptions,
  discoverLeagues,
  previewLeagueByInviteCode,
  VALID_DISCOVER_TYPES,
  joinPublicLeague,
  listJoinRequests,
  decideJoinRequest,
} = require('../services/discovery.service');
const { resolveMinTeams, createSizeError } = require('../services/leagueSize');
const { resolveNflSeasonPointer } = require('../services/pickemSeason.service');
const {
  commissionerPredicate,
  isLeagueCommissioner,
  listCoCommissioners,
  serializeCoCommissioners,
  coCommissionerTeamIds,
  grantCoCommissioner,
  revokeCoCommissioner,
} = require('../services/leagueRole.service');
const { isMember, joinLeague } = require('../services/leagueMembership.service');
const { teamIdentityColumns, teamIdentityJoin, viewerTeamIdOf } = require('../services/teamIdentity');
const { assertFantasyLeague } = require('../services/leagueType');
const { parseSettingsPatch, updateLeagueSettings, LeagueSettingsError } = require('../services/leagueSettings.service');

const router = express.Router();
router.use(requireAuth);

function intParam(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

/**
 * Body for a service error: the message, plus the joinability reason
 * ('draft-started' | 'season-complete') when the refusal has one, so a
 * client can choose its copy from the reason rather than the message text.
 */
function serviceErrorBody(error) {
  return error.reason ? { error: error.message, reason: error.reason } : { error: error.message };
}

// POST /api/league — create a private league (plus the owner's team) atomically
router.post('/', async (req, res) => {
  const {
    name, maxTeams, minTeams, teamName,
    isPublic, joinApproval, bestBall, scoringPreset, draftDate, draftTimezone,
    leagueType, pickemMode,
  } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'league name is required' });
  }
  // Format options first: the size checks below need to know whether this is
  // a pick'em-only league, whose member cap is looser than the fantasy one.
  const optionsResult = validateCreateOptions({
    isPublic, joinApproval, bestBall, scoringPreset, draftDate, draftTimezone, leagueType, pickemMode,
  });
  if (optionsResult.error) return res.status(400).json({ error: optionsResult.error });
  const options = optionsResult.value;
  const teams = maxTeams === undefined ? 10 : Number(maxTeams);
  // Default the floor to a sensible 8 (2 for pick'em-only), but never above
  // the league's own cap.
  const minimum = resolveMinTeams(minTeams, teams, { pickemOnly: options.pickemOnly });
  const sizeError = createSizeError({ minTeams: minimum, maxTeams: teams, pickemOnly: options.pickemOnly });
  if (sizeError) return res.status(400).json({ error: sizeError });

  // roster_limit/roster_slots/bench_slots/ir_slots are left to their column
  // defaults here (a standard 9-starter/5-bench/1-IR roster, summing to the
  // roster_limit default) — a commissioner customizes roster construction via
  // the Roster Settings tab after creation, any time before the draft starts.
  const inviteCode = crypto.randomBytes(4).toString('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `INSERT INTO "leagues" (
         "name", "owner_id", "invite_code", "max_teams", "min_teams",
         "is_public", "join_approval", "best_ball", "scoring_preset", "scoring_rules", "draft_date",
         "draft_timezone", "pickem_only"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        name, req.user.id, inviteCode, teams, minimum,
        options.isPublic, options.joinApproval, options.bestBall,
        options.scoringPreset, options.scoringRules ? JSON.stringify(options.scoringRules) : null,
        options.draftDate, options.draftTimezone, options.pickemOnly,
      ]
    );
    let league = leagueResult.rows[0];
    // The creator's Team is written by the one membership write, like every
    // other join path: the league is fresh, so the count is 0 and the creator
    // takes draft_position 1.
    await joinLeague(client, { leagueId: league.id, userId: req.user.id, teamName });
    if (options.pickemEnabled) {
      // Direct insert on the SAME client, not pickem.putSettings: that helper
      // opens its own pool connection and transaction, which would escape
      // this rollback and could leave settings for a league that was never
      // created.
      await client.query(
        `INSERT INTO "pickem_settings" ("league_id", "enabled", "mode")
         VALUES ($1, true, $2)`,
        [league.id, options.pickemMode]
      );
    }
    if (options.pickemOnly) {
      // A pick'em-only league follows the NFL calendar, not the commissioner
      // advance-week action (which requires matchups and can never run here).
      // Seed season/week from the schedule so a league created in NFL week 7
      // starts at week 7, and one created in a later year does not inherit
      // the stale current_season column default. The derivation is SHARED
      // with the pick'em season lifecycle job (pickemSeason.service:
      // newest season on file, smallest week still open under the rollover
      // grace, every week closed means week 18), so a league's week cannot
      // jump at its first tick. An empty schedule table keeps the column
      // defaults.
      const seed = await resolveNflSeasonPointer({ db: client });
      if (seed) {
        const seededResult = await client.query(
          `UPDATE "leagues" SET "current_season" = $1, "current_week" = $2
           WHERE "id" = $3 RETURNING *`,
          [seed.season, seed.week, league.id]
        );
        league = seededResult.rows[0];
      }
    }
    await client.query('COMMIT');
    res.status(201).json(league);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.statusCode) return res.status(error.statusCode).json(serviceErrorBody(error));
    console.error('Error creating league', error);
    res.status(500).json({ error: 'failed to create league' });
  } finally {
    client.release();
  }
});

// POST /api/league/join — join a league by invite code (creates your team)
router.post('/join', async (req, res) => {
  const { inviteCode, teamName } = req.body || {};
  if (!inviteCode) return res.status(400).json({ error: 'inviteCode is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "invite_code" = $1 FOR UPDATE`,
      [inviteCode]
    );
    const league = leagueResult.rows[0];
    if (!league) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'no league with that invite code' });
    }
    // The code is this path's only gate; admission (joinable, not already a
    // member, not full) and the Team write belong to the membership module.
    const { team } = await joinLeague(client, { leagueId: league.id, userId: req.user.id, teamName });
    await client.query('COMMIT');
    res.status(201).json({ league, team });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.statusCode) return res.status(error.statusCode).json(serviceErrorBody(error));
    console.error('Error joining league', error);
    res.status(500).json({ error: 'failed to join league' });
  } finally {
    client.release();
  }
});

// POST /api/league/:id/join-public — join a public league without an invite
// code. When the league requires approval this files a join_requests row
// instead of creating a team immediately.
router.post('/:id/join-public', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const { teamName } = req.body || {};
  try {
    const result = await joinPublicLeague({
      leagueId, userId: req.user.id, username: req.user.username, teamName,
    });
    if (result.pending) return res.status(202).json({ status: 'pending' });
    res.status(201).json({ league: result.league, team: result.team });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json(serviceErrorBody(error));
    console.error('Error joining public league', error);
    res.status(500).json({ error: 'failed to join league' });
  }
});

// GET /api/league/:id/join-requests — commissioner queue of pending public joins
router.get('/:id/join-requests', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    const rows = await listJoinRequests({ leagueId, ownerId: req.user.id });
    res.json(rows);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching join requests', error);
    res.status(500).json({ error: 'failed to fetch join requests' });
  }
});

// POST /api/league/:id/join-requests/:requestId/decide — owner approves/denies
router.post('/:id/join-requests/:requestId/decide', async (req, res) => {
  const leagueId = intParam(req.params.id);
  const requestId = intParam(req.params.requestId);
  if (!leagueId || !requestId) {
    return res.status(400).json({ error: 'league id and request id must be positive integers' });
  }
  const { approve } = req.body || {};
  if (typeof approve !== 'boolean') return res.status(400).json({ error: 'approve must be a boolean' });
  try {
    const result = await decideJoinRequest({ leagueId, ownerId: req.user.id, requestId, approve });
    res.status(200).json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json(serviceErrorBody(error));
    console.error('Error deciding join request', error);
    res.status(500).json({ error: 'failed to decide join request' });
  }
});

// GET /api/league/discover — public league browser (must precede GET /:id)
router.get('/discover', async (req, res) => {
  const { search, scoring, openSlots, sort, type } = req.query;
  if (scoring !== undefined && !VALID_SCORING_PRESETS.includes(scoring)) {
    return res.status(400).json({ error: `scoring must be one of ${VALID_SCORING_PRESETS.join(', ')}` });
  }
  // type + scoring is allowed to combine into an always-empty result (a
  // pick'em-only league has no preset): a filter is a query, not a command,
  // and the client never sends that pair anyway.
  if (type !== undefined && !VALID_DISCOVER_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of ${VALID_DISCOVER_TYPES.join(', ')}` });
  }
  if (sort !== undefined && !VALID_DISCOVER_SORTS.includes(sort)) {
    return res.status(400).json({ error: `sort must be one of ${VALID_DISCOVER_SORTS.join(', ')}` });
  }
  try {
    const rows = await discoverLeagues({
      userId: req.user.id,
      search: typeof search === 'string' && search.length > 0 ? search : undefined,
      scoring,
      openSlots: openSlots === 'true',
      sort,
      type,
    });
    res.json(rows);
  } catch (error) {
    console.error('Error discovering leagues', error);
    res.status(500).json({ error: 'failed to discover leagues' });
  }
});

// Invite codes are 8 hex chars and POST /join has no limiter of its own, so
// a cheap read-only lookup must not make them enumerable: 30 previews per
// caller per 10 minutes covers hand-typing several codes (the client previews
// each plausible prefix as you type) while making a sweep pointless.
const previewRateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });

// GET /api/league/preview?code= — what an invite link reveals before joining.
// Registered ahead of /:id so the path is not read as a league id.
router.get('/preview', previewRateLimiter, async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!code) return res.status(400).json({ error: 'code query param is required' });
  try {
    const preview = await previewLeagueByInviteCode({ code, userId: req.user.id });
    if (!preview) return res.status(404).json({ error: 'no league with that invite code' });
    res.json(preview);
  } catch (error) {
    console.error('Error previewing league', error);
    res.status(500).json({ error: 'failed to preview league' });
  }
});

// GET /api/league — leagues the caller belongs to
router.get('/', async (req, res) => {
  try {
    // `is_owner` and `is_commissioner` are the viewer's role on each league,
    // answered here so no card has to rebuild it from `leagues.owner_id` and
    // the signed-in account id (#188). `is_owner` is the creator-alone half,
    // covering the powers leagueRole.service's header keeps owner-shaped
    // (deleting the league, granting or revoking co-commissioners);
    // `is_commissioner` is the half a co-commissioner holds too. Both are
    // per-viewer, evaluated against $1, and this response is the list's only
    // per-viewer channel, so they belong on the row.
    const result = await pool.query(
      `SELECT "leagues".*, "teams"."id" AS "my_team_id", "teams"."name" AS "my_team_name",
              "teams"."avatar_url" AS "my_team_avatar_url",
              "teams"."avatar_static_url" AS "my_team_avatar_static_url",
              "teams"."waiver_priority" AS "my_team_waiver_priority",
              "teams"."faab_remaining" AS "my_team_faab_remaining",
              (SELECT COUNT(*)::int FROM "teams" "t" WHERE "t"."league_id" = "leagues"."id") AS "team_count",
              ("leagues"."owner_id" = $1) AS "is_owner",
              ${commissionerPredicate(1)} AS "is_commissioner"
       FROM "leagues"
       JOIN "teams" ON "teams"."league_id" = "leagues"."id"
       WHERE "teams"."owner_id" = $1
       ORDER BY "leagues"."created_at" DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching leagues', error);
    res.status(500).json({ error: 'failed to fetch leagues' });
  }
});

// GET /api/league/:id — league detail: teams, owners, roster counts
router.get('/:id', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    // The league is a shared surface, so a consumer names the creator by Team
    // identity alone (#112, parent #108, contracted by #115). The account
    // username the EXPAND step served beside it (`owner_username`) is gone, and
    // with it the users JOIN that supplied it; `leagues.owner_id` (the
    // creator's OWN account id) stays on `leagues.*` because it is the caller's
    // own on this surface, never another manager's. LEFT JOIN for Team identity
    // because a creator removed from their own league leaves no team behind.
    const leagueResult = await pool.query(
      `SELECT "leagues".*,
              ${teamIdentityColumns('owner_team', 'owner')}
         FROM "leagues"
         ${teamIdentityJoin('"leagues"."id"', '"leagues"."owner_id"', 'owner_team')}
        WHERE "leagues"."id" = $1`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) return res.status(404).json({ error: 'league not found' });

    if (!(await isMember(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this league' });
    }

    const teamsResult = await pool.query(
      `SELECT "teams"."id", "teams"."name", "teams"."draft_position",
              "teams"."faab_remaining", "teams"."locked", "teams"."draft_ready",
              "teams"."avatar_url", "teams"."avatar_static_url",
              -- owner_id rides here only so viewerTeamIdOf() can pick out the
              -- caller's own team off the raw rows below; it is account identity
              -- and is stripped from the serialized teams[] entry (#343, #115).
              "teams"."owner_id",
              ${teamIdentityColumns()},
              COUNT("team_players"."id")::int AS "roster_count",
              COALESCE(SUM(CASE WHEN "matchups"."home_team_id" = "teams"."id" THEN "matchups"."home_score"
                                WHEN "matchups"."away_team_id" = "teams"."id" THEN "matchups"."away_score"
                                ELSE 0 END), 0) AS "total_points"
       FROM "teams"
       LEFT JOIN "team_players" ON "team_players"."team_id" = "teams"."id"
       LEFT JOIN "matchups" ON "matchups"."league_id" = "teams"."league_id"
         AND ("matchups"."home_team_id" = "teams"."id" OR "matchups"."away_team_id" = "teams"."id")
       WHERE "teams"."league_id" = $1
       GROUP BY "teams"."id"
       ORDER BY "total_points" DESC, "teams"."draft_position"`,
      [leagueId]
    );
    // is_commissioner is the viewer's effective role (owner or co-commissioner)
    // — every client-side commissioner gate reads it.
    //
    // Who holds commissioner power stays visible to every member: knowing who
    // can rule on your trade isn't sensitive, and it saves a second request.
    // What changed in #324 is how that fact is told. CONTEXT.md's Team
    // identity rule admits no exception for role disclosure, so power is a
    // property of the TEAM and never an account handed over with it. The two
    // kinds of commissioner are told apart on the same terms: the creator is
    // `league.ownerTeamId` / `ownerTeamName`, already here, and a GRANT is
    // `teams[].is_co_commissioner` below. The flag is deliberately the grant
    // alone - the creator's team is not flagged, because the creator is named
    // on the league itself and conflating them would lose which is which.
    // The account ids grant and revoke need ride commissioner-conditionally,
    // stripped by the same `is_commissioner` check as `invite_code` two lines
    // below, which is the precedent this follows rather than a new mechanism.
    league.is_commissioner = await isLeagueCommissioner(pool, leagueId, req.user.id);
    const coCommissionerRows = await listCoCommissioners(pool, leagueId);
    league.co_commissioners = serializeCoCommissioners(coCommissionerRows, {
      isCommissioner: league.is_commissioner,
    });
    // Only a commissioner should see the invite code
    if (!league.is_commissioner) delete league.invite_code;
    // Derived from the ROWS rather than from what this viewer was served, so
    // the flag says the same thing to a member as to a commissioner: a team is
    // flagged exactly when a grant names it. Team identity on both sides of
    // the match, so there is nothing to explain about which column is which.
    const grantedTeamIds = coCommissionerTeamIds(coCommissionerRows);
    const teams = teamsResult.rows.map((team) => {
      // A teams[] entry names its manager by Team identity only. `owner_id`
      // rode on the raw row so viewerTeamIdOf() could resolve the caller's team
      // (below); strip it from the serialization so no member reads another
      // manager's account id (#343, #115). `owner` (the username) is no longer
      // selected; the delete is defensive against a raw row that still carries
      // one.
      const entry = { ...team, is_co_commissioner: grantedTeamIds.has(team.teamId) };
      delete entry.owner_id;
      delete entry.owner;
      return entry;
    });
    // viewerTeamId is how a consumer answers "which of these is me" without
    // holding another manager's account ID (#112): teamId === viewerTeamId.
    res.json({
      viewerTeamId: viewerTeamIdOf(teamsResult.rows, req.user.id),
      league,
      teams,
    });
  } catch (error) {
    console.error('Error fetching league details', error);
    res.status(500).json({ error: 'failed to fetch league details' });
  }
});

// PUT /api/league/:id — a commissioner updates league settings. Shape rules
// live in leagueSettings.service.js; draft-frozen settings refuse once the
// draft starts (League phase), fantasy-only ones refuse for a pick'em-only
// league (league type), administrative ones stay editable all season.
router.put('/:id', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  // Shape validation, the status read, the guards, the write and the
  // after-commit notification all live in the settings module
  // (leagueSettings.service.js, spec #71); this handler only adapts HTTP.
  const parsed = parseSettingsPatch(req.body);
  if (parsed.error !== undefined) return res.status(400).json({ error: parsed.error });
  try {
    const row = await updateLeagueSettings(pool, { leagueId, userId: req.user.id, patch: parsed.value });
    res.json(row);
  } catch (error) {
    if (error instanceof LeagueSettingsError) {
      return res.status(error.statusCode).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    }
    console.error('Error updating league', error);
    res.status(500).json({ error: 'failed to update league' });
  }
});

// POST /api/league/:id/start-draft — owner starts the live draft (once the
// league has reached its minimum team count). Also doubles as the Instant
// Start button on the Draft Settings page — any pre-start confirmation lives
// client-side.
router.post('/:id/start-draft', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    // A pick'em-only league has no draft; refuse before touching the draft
    // machinery (startDraft re-checks under its row lock for the socket and
    // scheduler entry points).
    await assertFantasyLeague(pool, leagueId);
    const { startDraft } = require('../services/draftStart.service');
    await startDraft({ leagueId, userId: req.user.id });
    const result = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
    res.json(result.rows[0]);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
    }
    console.error('Error starting draft', error);
    res.status(500).json({ error: 'failed to start draft' });
  }
});

// DELETE /api/league/:id — owner deletes the league.
//
// Sanctioned direct owner_id comparison, the first of the three
// leagueRole.service's header enumerates: this power does not delegate, so a
// co-commissioner is refused here exactly as a member is. The WHERE clause IS
// the gate rather than a filter in front of one - no row deleted means the
// caller was not the creator - which is why the 403 is decided on rowCount.
router.delete('/:id', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    const result = await pool.query(
      `DELETE FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2 RETURNING "id"`,
      [leagueId, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(403).json({ error: 'league not found or you are not the owner' });
    }
    res.sendStatus(204);
  } catch (error) {
    console.error('Error deleting league', error);
    res.status(500).json({ error: 'failed to delete league' });
  }
});

// POST /api/league/:id/co-commissioners — owner grants commissioner powers to
// a member. Owner-only: a co-commissioner can run the league but can't recruit
// more co-commissioners or unseat the ones the owner picked.
router.post('/:id/co-commissioners', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const targetUserId = intParam(req.body && req.body.userId);
  if (!targetUserId) return res.status(400).json({ error: 'userId must be a positive integer' });
  try {
    res.json(await grantCoCommissioner({ leagueId, userId: req.user.id, targetUserId }));
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error granting co-commissioner', error);
    res.status(500).json({ error: 'failed to grant co-commissioner' });
  }
});

// DELETE /api/league/:id/co-commissioners/:userId — owner revokes those powers
router.delete('/:id/co-commissioners/:userId', async (req, res) => {
  const leagueId = intParam(req.params.id);
  const targetUserId = intParam(req.params.userId);
  if (!leagueId || !targetUserId) {
    return res.status(400).json({ error: 'league id and user id must be positive integers' });
  }
  try {
    res.json(await revokeCoCommissioner({ leagueId, userId: req.user.id, targetUserId }));
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error revoking co-commissioner', error);
    res.status(500).json({ error: 'failed to revoke co-commissioner' });
  }
});

// GET /api/league/:id/rosters — every team's roster (for trade building, matchup views)
router.get('/:id/rosters', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    if (!(await isMember(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this league' });
    }

    const leagueRow = await pool.query(
      `SELECT "current_season", "current_week", "regular_season_weeks" FROM "leagues" WHERE "id" = $1`,
      [leagueId]
    );
    const season = leagueRow.rows[0]?.current_season ?? null;
    const week = leagueRow.rows[0]?.current_week ?? null;
    const weeklyByPlayer = await projectionService.getWeekProjections({ season, week });
    const throughWeek = leagueRow.rows[0]?.regular_season_weeks ?? null;
    const rosByPlayer = await projectionService.getRestOfSeasonProjections({
      season,
      fromWeek: week,
      throughWeek,
    });

    const result = await pool.query(
      `SELECT "teams"."id" AS "team_id", "teams"."name" AS "team_name",
              "teams"."avatar_url", "teams"."avatar_static_url",
              "players"."id", "players"."name", "players"."position", "players"."nfl_team"
       FROM "teams"
       LEFT JOIN "team_players" ON "team_players"."team_id" = "teams"."id"
       LEFT JOIN "players" ON "players"."id" = "team_players"."player_id"
       WHERE "teams"."league_id" = $1
       ORDER BY "teams"."id", "players"."position", "players"."name"`,
      [leagueId]
    );
    const teams = new Map();
    for (const row of result.rows) {
      if (!teams.has(row.team_id)) {
        teams.set(row.team_id, {
          // A roster entry names its team by Team identity only; the manager's
          // account id (`ownerId`) is gone (#343, #115). Nothing in this
          // endpoint needs it - there is no viewer-relative field here - so it
          // leaves the SELECT as well as the serialization.
          teamId: row.team_id,
          teamName: row.team_name,
          avatarUrl: row.avatar_url,
          avatarStaticUrl: row.avatar_static_url,
          players: [],
        });
      }
      if (row.id) {
        const projection = weeklyByPlayer.get(row.id);
        row.projected_weekly_points =
          projection && Number.isFinite(Number(projection.points))
            ? Number(projection.points)
            : null;
        const ros = rosByPlayer.get(row.id);
        row.rest_of_season_points = Number.isFinite(Number(ros)) ? Number(ros) : null;
        teams.get(row.team_id).players.push({
          id: row.id, name: row.name, position: row.position, nfl_team: row.nfl_team,
          projected_weekly_points: row.projected_weekly_points,
          rest_of_season_points: row.rest_of_season_points,
        });
      }
    }
    res.json(Array.from(teams.values()));
  } catch (error) {
    console.error('Error fetching league rosters', error);
    res.status(500).json({ error: 'failed to fetch rosters' });
  }
});

// GET /api/league/:id/transactions — league-wide activity log (adds, drops, waivers, trades)
router.get('/:id/transactions', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    if (!(await isMember(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this league' });
    }

    const result = await pool.query(
      `SELECT "transactions".*, "teams"."name" AS "team_name",
              "teams"."avatar_url" AS "team_avatar_url",
              "teams"."avatar_static_url" AS "team_avatar_static_url",
              "players"."name" AS "player_name",
              "dropped_player"."name" AS "dropped_player_name"
       FROM "transactions"
       LEFT JOIN "teams" ON "teams"."id" = "transactions"."team_id"
       LEFT JOIN "players" ON "players"."id" = ("transactions"."detail"->>'playerId')::int
       LEFT JOIN "players" AS "dropped_player"
         ON "dropped_player"."id" = ("transactions"."detail"->>'droppedPlayerId')::int
       WHERE "transactions"."league_id" = $1
       ORDER BY "transactions"."created_at" DESC
       LIMIT 100`,
      [leagueId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching transactions', error);
    res.status(500).json({ error: 'failed to fetch transactions' });
  }
});

// GET /api/league/:id/matchups?week=N — head-to-head results
router.get('/:id/matchups', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const week = req.query.week === undefined ? null : intParam(req.query.week);
  if (req.query.week !== undefined && !week) {
    return res.status(400).json({ error: 'week must be a positive integer' });
  }
  try {
    const params = [leagueId];
    let weekSql = '';
    if (week) {
      params.push(week);
      weekSql = `AND "matchups"."week" = $2`;
    }
    const result = await pool.query(
      `SELECT "matchups".*,
              home."name" AS "home_team_name", away."name" AS "away_team_name",
              home."avatar_url" AS "home_team_avatar_url", away."avatar_url" AS "away_team_avatar_url",
              home."avatar_static_url" AS "home_team_avatar_static_url",
              away."avatar_static_url" AS "away_team_avatar_static_url"
       FROM "matchups"
       JOIN "teams" home ON home."id" = "matchups"."home_team_id"
       JOIN "teams" away ON away."id" = "matchups"."away_team_id"
       WHERE "matchups"."league_id" = $1 ${weekSql}
       ORDER BY "matchups"."season" DESC, "matchups"."week" DESC, "matchups"."id"`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching matchups', error);
    res.status(500).json({ error: 'failed to fetch matchups' });
  }
});

// GET /api/league/:id/chat — last 50 chat messages, oldest first
// Chat authors are identified by Team identity ALONE (#112, parent #108,
// contracted by #343): the author's account id and username no longer ride on
// the history, and the users JOIN that supplied the username is gone. The Team
// identity join is LEFT so a message from a manager who has since left the
// league still reads back rather than dropping out of the history; its Team
// identity is simply null. `chat_messages.user_id` is still read INSIDE the
// query (the block filter below) but is not projected onto the wire. This
// response is a bare array with no root to carry `viewerTeamId`, so a viewer
// takes theirs from the `league:join` acknowledgement the chat panel already
// makes, and compares `message.teamId` against it.
router.get('/:id/chat', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    if (!(await isMember(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this league' });
    }
    const result = await pool.query(
      `SELECT * FROM (
         SELECT "chat_messages"."id", "chat_messages"."message", "chat_messages"."created_at",
                ${teamIdentityColumns()}
         FROM "chat_messages"
         ${teamIdentityJoin('"chat_messages"."league_id"', '"chat_messages"."user_id"')}
         WHERE "chat_messages"."league_id" = $1
           AND NOT EXISTS (
             SELECT 1 FROM "user_blocks"
             WHERE "user_blocks"."blocker_id" = $2
               AND "user_blocks"."blocked_id" = "chat_messages"."user_id"
           )
         ORDER BY "chat_messages"."created_at" DESC
         LIMIT 50
       ) recent ORDER BY "created_at" ASC`,
      [leagueId, req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching chat', error);
    res.status(500).json({ error: 'failed to fetch chat' });
  }
});

// GET /api/league/:id/chat/unread — how many of OTHER members' messages are
// newer than the caller's last-read marker. Blocked users are excluded with
// the same predicate as the history endpoint, so the badge never counts a
// message the user will never see. A user with no marker yet counts all of it.
router.get('/:id/chat/unread', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    if (!(await isMember(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this league' });
    }
    const result = await pool.query(
      `SELECT COUNT(*)::int AS "unread"
       FROM "chat_messages"
       WHERE "chat_messages"."league_id" = $1
         AND "chat_messages"."user_id" <> $2
         AND "chat_messages"."created_at" > COALESCE(
           (SELECT "last_read_at" FROM "chat_reads"
            WHERE "league_id" = $1 AND "user_id" = $2),
           to_timestamp(0)
         )
         AND NOT EXISTS (
           SELECT 1 FROM "user_blocks"
           WHERE "user_blocks"."blocker_id" = $2
             AND "user_blocks"."blocked_id" = "chat_messages"."user_id"
         )`,
      [leagueId, req.user.id]
    );
    res.json({ unread: result.rows[0].unread });
  } catch (error) {
    console.error('Error fetching chat unread count', error);
    res.status(500).json({ error: 'failed to fetch unread count' });
  }
});

// POST /api/league/:id/chat/read — move the caller's read marker to now.
router.post('/:id/chat/read', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    if (!(await isMember(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this league' });
    }
    await pool.query(
      `INSERT INTO "chat_reads" ("league_id", "user_id", "last_read_at")
       VALUES ($1, $2, now())
       ON CONFLICT ("league_id", "user_id") DO UPDATE SET "last_read_at" = now()`,
      [leagueId, req.user.id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error updating chat read marker', error);
    res.status(500).json({ error: 'failed to update read marker' });
  }
});

// GET /api/league/:id/matchups/:matchupId — matchup detail: both starting
// lineups with per-player points under the league's scoring rules
router.get('/:id/matchups/:matchupId', async (req, res) => {
  const leagueId = intParam(req.params.id);
  const matchupId = intParam(req.params.matchupId);
  if (!leagueId || !matchupId) {
    return res.status(400).json({ error: 'league id and matchup id must be positive integers' });
  }
  const client = await pool.connect();
  try {
    if (!(await isMember(client, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this league' });
    }

    const matchupResult = await client.query(
      `SELECT "matchups".*,
              home."name" AS "home_team_name", away."name" AS "away_team_name",
              home."owner_id" AS "home_owner_id", away."owner_id" AS "away_owner_id",
              home."avatar_url" AS "home_team_avatar_url", away."avatar_url" AS "away_team_avatar_url",
              home."avatar_static_url" AS "home_team_avatar_static_url",
              away."avatar_static_url" AS "away_team_avatar_static_url"
       FROM "matchups"
       JOIN "teams" home ON home."id" = "matchups"."home_team_id"
       JOIN "teams" away ON away."id" = "matchups"."away_team_id"
       WHERE "matchups"."id" = $1 AND "matchups"."league_id" = $2`,
      [matchupId, leagueId]
    );
    const matchup = matchupResult.rows[0];
    if (!matchup) return res.status(404).json({ error: 'matchup not found in this league' });

    const leagueResult = await client.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
    const { rulesForLeague, calculateFantasyPoints } = require('../services/scoring.service');
    const { materializeLineup } = require('../services/lineup.service');
    const { getWeekProjections } = require('../services/projection.service');
    const rules = rulesForLeague(leagueResult.rows[0]);

    // Per-week projections power the pace bars and the live win-probability bar.
    // Read-only, cached — a miss just leaves projections null, never an error.
    let projById = new Map();
    try {
      projById = await getWeekProjections({ season: matchup.season, week: matchup.week });
    } catch (projErr) {
      console.error('matchup projections unavailable', projErr.message);
    }
    // This week's real-game opponents, for the cutscene's chasing defender.
    const scheduleRows = await client.query(
      `SELECT "nfl_team", "opponent" FROM "nfl_games" WHERE "season" = $1 AND "week" = $2`,
      [matchup.season, matchup.week]
    );
    const opponentByTeam = new Map(scheduleRows.rows.map((r) => [r.nfl_team, r.opponent]));

    await client.query('BEGIN');
    const toPlayer = (row) => {
      const projection = projById.get(row.id);
      return {
        id: row.id,
        name: row.name,
        position: row.position,
        nfl_team: row.nfl_team,
        injury_status: row.injury_status,
        slot: row.slot,
        // Full stat line for the expandable row; safe to expose (public NFL data).
        stats: row.stats || null,
        points: row.stats ? calculateFantasyPoints(row.stats, rules) : 0,
        projected: projection ? Math.round(projection.points * 100) / 100 : null,
        opponent: opponentByTeam.get(row.nfl_team) || null,
      };
    };
    const teamLineup = async (teamId) => {
      await materializeLineup(client, {
        leagueId, teamId, season: matchup.season, week: matchup.week,
      });
      const lineupRows = await client.query(
        `SELECT "players"."id", "players"."name", "players"."position",
                "players"."nfl_team", "players"."injury_status",
                "lineup_entries"."slot", "player_stats"."stats"
         FROM "lineup_entries"
         JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
           AND "team_players"."player_id" = "lineup_entries"."player_id"
         JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
         LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
           AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
         WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
           AND "lineup_entries"."week" = $3
           AND "lineup_entries"."slot" = $4
         ORDER BY "lineup_entries"."slot", "players"."name"`,
        [teamId, matchup.season, matchup.week, 'BENCH']
      );
      const starterRows = await client.query(
        `SELECT "players"."id", "players"."name", "players"."position",
                "players"."nfl_team", "players"."injury_status",
                "lineup_entries"."slot", "player_stats"."stats"
         FROM "lineup_entries"
         JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
           AND "team_players"."player_id" = "lineup_entries"."player_id"
         JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
         LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
           AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
         WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
           AND "lineup_entries"."week" = $3
           AND "lineup_entries"."slot" NOT IN ('BENCH', 'IR')
         ORDER BY "lineup_entries"."slot", "players"."name"`,
        [teamId, matchup.season, matchup.week]
      );
      const starters = starterRows.rows.map(toPlayer);
      const bench = lineupRows.rows.map(toPlayer);
      const projectedTotal = Math.round(
        starters.reduce((sum, s) => sum + (s.projected || 0), 0) * 100
      ) / 100;
      return { starters, bench, projectedTotal };
    };
    const homeTeam = await teamLineup(matchup.home_team_id);
    const awayTeam = await teamLineup(matchup.away_team_id);
    await client.query('COMMIT');

    // Live bench what-if for the viewer, but only when they own one of the two
    // teams in this matchup. Read-only, best-effort — never fails the request.
    let viewerWhatIf = null;
    let viewerTeamId = null;
    if (matchup.home_owner_id === req.user.id) viewerTeamId = matchup.home_team_id;
    else if (matchup.away_owner_id === req.user.id) viewerTeamId = matchup.away_team_id;
    if (viewerTeamId) {
      try {
        const { liveWhatIf } = require('../services/decision.service');
        viewerWhatIf = await liveWhatIf({
          leagueId, teamId: viewerTeamId, season: matchup.season, week: matchup.week,
        });
      } catch (whatIfErr) {
        console.error('live what-if unavailable', whatIfErr.message);
      }
    }

    res.json({
      viewerTeamId: viewerTeamId || null,
      viewerWhatIf,
      matchup,
      home: {
        teamId: matchup.home_team_id,
        name: matchup.home_team_name,
        starters: homeTeam.starters,
        bench: homeTeam.bench,
        projectedTotal: homeTeam.projectedTotal,
      },
      away: {
        teamId: matchup.away_team_id,
        name: matchup.away_team_name,
        starters: awayTeam.starters,
        bench: awayTeam.bench,
        projectedTotal: awayTeam.projectedTotal,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error fetching matchup detail', error);
    res.status(500).json({ error: 'failed to fetch matchup detail' });
  } finally {
    client.release();
  }
});

// GET /api/league/:id/trophies?season= — the league's trophy case
router.get('/:id/trophies', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const season = req.query.season !== undefined ? intParam(req.query.season) : null;
  if (req.query.season !== undefined && !season) {
    return res.status(400).json({ error: 'season must be a positive integer' });
  }
  try {
    if (!(await isMember(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this league' });
    }
    const trophies = require('../services/trophy.service');
    res.json(await trophies.getLeagueTrophies({ leagueId, season }));
  } catch (error) {
    console.error('Error fetching trophies', error);
    res.status(500).json({ error: 'failed to fetch trophies' });
  }
});

// GET /api/league/:id/draft-grades — A–F per team (computed lazily post-draft)
router.get('/:id/draft-grades', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    if (!(await isMember(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this league' });
    }
    const draftgrade = require('../services/draftgrade.service');
    const grades = await draftgrade.getOrComputeDraftGrades({ leagueId });
    if (!grades) return res.status(404).json({ error: 'draft grades not available yet' });
    res.json(grades);
  } catch (error) {
    console.error('Error fetching draft grades', error);
    res.status(500).json({ error: 'failed to fetch draft grades' });
  }
});

// GET /api/league/:id/history — archived seasons: standings, champion,
// trophies, and draft grades per completed season
router.get('/:id/history', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    if (!(await isMember(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this league' });
    }
    const historyResult = await pool.query(
      `SELECT "league_history"."season", "league_history"."standings",
              "league_history"."pickem_result",
              "leagues"."pickem_only",
              "league_history"."champion_team_id", "teams"."name" AS "champion_name",
              "teams"."avatar_url" AS "champion_avatar_url",
              "teams"."avatar_static_url" AS "champion_avatar_static_url"
       FROM "league_history"
       JOIN "leagues" ON "leagues"."id" = "league_history"."league_id"
       LEFT JOIN "teams" ON "teams"."id" = "league_history"."champion_team_id"
       WHERE "league_history"."league_id" = $1
       ORDER BY "league_history"."season" DESC`,
      [leagueId]
    );
    const trophies = require('../services/trophy.service');
    const seasons = [];
    for (const row of historyResult.rows) {
      const pickemResult = row.pickem_result && typeof row.pickem_result === 'string'
        ? JSON.parse(row.pickem_result)
        : row.pickem_result;
      const champions = pickemResult && Array.isArray(pickemResult.champions)
        ? pickemResult.champions
        : null;
      const firstPickemChampion = champions && champions[0];
      let seasonTrophies = [];
      let trophiesErrored = false;
      try {
        seasonTrophies = (await trophies.getLeagueTrophies({ leagueId, season: row.season })).filter(
          (t) => t.week === 0
        );
      } catch (error) {
        console.error('Error fetching season trophies for league history', error);
        trophiesErrored = true;
      }

      let draftGrades = null;
      let draftGradesErrored = false;
      try {
        const gradesResult = await pool.query(
          `SELECT "data" FROM "league_analytics"
           WHERE "league_id" = $1 AND "season" = $2 AND "type" = 'draft_grades'`,
          [leagueId, row.season]
        );
        draftGrades = gradesResult.rows[0] ? gradesResult.rows[0].data.grades : null;
      } catch (error) {
        console.error('Error fetching draft grades for league history', error);
        draftGradesErrored = true;
      }

      seasons.push({
        season: row.season,
        outcome: pickemResult ? pickemResult.outcome : null,
        champions,
        // Deprecated compatibility projection. Declaration order has no
        // championship significance; new consumers use `champions`.
        champion: pickemResult
          ? (firstPickemChampion
              ? {
                  teamId: firstPickemChampion.teamId,
                  name: firstPickemChampion.teamName,
                  avatarUrl: firstPickemChampion.avatarUrl,
                  avatarStaticUrl: firstPickemChampion.avatarStaticUrl,
                }
              : null)
          : (!row.pickem_only && row.champion_team_id
              ? {
                  teamId: row.champion_team_id,
                  name: row.champion_name,
                  avatarUrl: row.champion_avatar_url,
                  avatarStaticUrl: row.champion_avatar_static_url,
                }
              : null),
        standings: row.standings,
        trophies: seasonTrophies,
        trophiesErrored,
        draftGrades,
        draftGradesErrored,
      });
    }
    res.json({ seasons });
  } catch (error) {
    console.error('Error fetching league history', error);
    res.status(500).json({ error: 'failed to fetch league history' });
  }
});

module.exports = router;
