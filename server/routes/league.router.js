const express = require('express');
const crypto = require('crypto');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const {
  VALID_SCORING_PRESETS,
  VALID_DISCOVER_SORTS,
  validateCreateOptions,
  discoverLeagues,
  joinPublicLeague,
  listJoinRequests,
  decideJoinRequest,
} = require('../services/discovery.service');
const {
  resolveMinTeams,
  createSizeError,
  editSizeError,
  meetsMinimum,
} = require('../services/leagueSize');

const router = express.Router();
router.use(requireAuth);

function intParam(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

// POST /api/league — create a private league (plus the owner's team) atomically
router.post('/', async (req, res) => {
  const {
    name, rosterLimit, maxTeams, minTeams, teamName,
    isPublic, joinApproval, bestBall, scoringPreset, draftDate,
  } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'league name is required' });
  }
  const limit = rosterLimit === undefined ? 15 : Number(rosterLimit);
  const teams = maxTeams === undefined ? 10 : Number(maxTeams);
  // Default the floor to a sensible 8, but never above the league's own cap.
  const minimum = resolveMinTeams(minTeams, teams);
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
    return res.status(400).json({ error: 'rosterLimit must be an integer between 1 and 30' });
  }
  const sizeError = createSizeError({ minTeams: minimum, maxTeams: teams });
  if (sizeError) return res.status(400).json({ error: sizeError });
  const optionsResult = validateCreateOptions({ isPublic, joinApproval, bestBall, scoringPreset, draftDate });
  if (optionsResult.error) return res.status(400).json({ error: optionsResult.error });
  const options = optionsResult.value;

  const inviteCode = crypto.randomBytes(4).toString('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `INSERT INTO "leagues" (
         "name", "owner_id", "invite_code", "roster_limit", "max_teams", "min_teams",
         "is_public", "join_approval", "best_ball", "scoring_preset", "scoring_rules", "draft_date"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        name, req.user.id, inviteCode, limit, teams, minimum,
        options.isPublic, options.joinApproval, options.bestBall,
        options.scoringPreset, options.scoringRules ? JSON.stringify(options.scoringRules) : null,
        options.draftDate,
      ]
    );
    const league = leagueResult.rows[0];
    await client.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position")
       VALUES ($1, $2, $3, 1)`,
      [league.id, req.user.id, teamName || `${req.user.username}'s Team`]
    );
    await client.query('COMMIT');
    res.status(201).json(league);
  } catch (error) {
    await client.query('ROLLBACK');
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
    if (league.draft_status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'league draft already started' });
    }
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS n FROM "teams" WHERE "league_id" = $1`,
      [league.id]
    );
    if (countResult.rows[0].n >= league.max_teams) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'league is full' });
    }
    const teamResult = await client.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [league.id, req.user.id, teamName || `${req.user.username}'s Team`, countResult.rows[0].n + 1]
    );
    await client.query('COMMIT');
    res.status(201).json({ league, team: teamResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'you already have a team in this league' });
    }
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
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
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
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error deciding join request', error);
    res.status(500).json({ error: 'failed to decide join request' });
  }
});

// GET /api/league/discover — public league browser (must precede GET /:id)
router.get('/discover', async (req, res) => {
  const { search, scoring, openSlots, sort } = req.query;
  if (scoring !== undefined && !VALID_SCORING_PRESETS.includes(scoring)) {
    return res.status(400).json({ error: `scoring must be one of ${VALID_SCORING_PRESETS.join(', ')}` });
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
    });
    res.json(rows);
  } catch (error) {
    console.error('Error discovering leagues', error);
    res.status(500).json({ error: 'failed to discover leagues' });
  }
});

// GET /api/league — leagues the caller belongs to
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT "leagues".*, "teams"."id" AS "my_team_id", "teams"."name" AS "my_team_name",
              (SELECT COUNT(*)::int FROM "teams" "t" WHERE "t"."league_id" = "leagues"."id") AS "team_count"
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
    const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
    const league = leagueResult.rows[0];
    if (!league) return res.status(404).json({ error: 'league not found' });

    const membership = await pool.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });

    const teamsResult = await pool.query(
      `SELECT "teams"."id", "teams"."name", "teams"."draft_position",
              "users"."username" AS "owner",
              COUNT("team_players"."id")::int AS "roster_count",
              COALESCE(SUM(CASE WHEN "matchups"."home_team_id" = "teams"."id" THEN "matchups"."home_score"
                                WHEN "matchups"."away_team_id" = "teams"."id" THEN "matchups"."away_score"
                                ELSE 0 END), 0) AS "total_points"
       FROM "teams"
       JOIN "users" ON "users"."id" = "teams"."owner_id"
       LEFT JOIN "team_players" ON "team_players"."team_id" = "teams"."id"
       LEFT JOIN "matchups" ON "matchups"."league_id" = "teams"."league_id"
         AND ("matchups"."home_team_id" = "teams"."id" OR "matchups"."away_team_id" = "teams"."id")
       WHERE "teams"."league_id" = $1
       GROUP BY "teams"."id", "users"."username"
       ORDER BY "total_points" DESC, "teams"."draft_position"`,
      [leagueId]
    );
    // Only the owner should see the invite code
    if (league.owner_id !== req.user.id) delete league.invite_code;
    res.json({ league, teams: teamsResult.rows });
  } catch (error) {
    console.error('Error fetching league details', error);
    res.status(500).json({ error: 'failed to fetch league details' });
  }
});

// PUT /api/league/:id — owner updates name / roster limit / lineup config (before draft)
router.put('/:id', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const {
    name, rosterLimit, lineupSlots, positionCaps, irSlots,
    waiverType, waiverPeriodHours, faabBudget,
    tradeDeadlineWeek, tradeReviewHours, tradeVetoVotes,
    scoringPreset, scoringRules, regularSeasonWeeks, playoffTeams, playoffConsolation,
    pickTimeSeconds, minTeams, maxTeams, draftDate, autodraftDelaySeconds,
  } = req.body || {};
  // draftDate: undefined = leave as-is, null = clear, string = (re)schedule.
  const draftDateProvided = draftDate !== undefined;
  let draftDateValue = null;
  if (draftDateProvided && draftDate !== null) {
    const parsed = new Date(draftDate);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'draftDate must be a valid date or null' });
    }
    draftDateValue = parsed.toISOString();
  }
  const limit = rosterLimit === undefined ? null : Number(rosterLimit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 30)) {
    return res.status(400).json({ error: 'rosterLimit must be an integer between 1 and 30' });
  }
  // Validated against the league's current teams/limits inside the handler
  // (see editSizeError below), since it needs the live team count.
  const newMax = maxTeams === undefined ? null : Number(maxTeams);
  const newMin = minTeams === undefined ? null : Number(minTeams);
  const validSlotMap = (map, allowedKeys) =>
    map && typeof map === 'object' && !Array.isArray(map) &&
    Object.entries(map).every(
      ([key, count]) => allowedKeys.includes(key) && Number.isInteger(count) && count >= 0 && count <= 10
    );
  const slotKeys = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
  const positionKeys = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  if (lineupSlots !== undefined && !validSlotMap(lineupSlots, slotKeys)) {
    return res.status(400).json({ error: `lineupSlots must map ${slotKeys.join('/')} to integers 0-10` });
  }
  if (positionCaps !== undefined && !validSlotMap(positionCaps, positionKeys)) {
    return res.status(400).json({ error: `positionCaps must map ${positionKeys.join('/')} to integers 0-10` });
  }
  if (irSlots !== undefined && (!Number.isInteger(irSlots) || irSlots < 0 || irSlots > 5)) {
    return res.status(400).json({ error: 'irSlots must be an integer between 0 and 5' });
  }
  if (waiverType !== undefined && !['priority', 'faab'].includes(waiverType)) {
    return res.status(400).json({ error: "waiverType must be 'priority' or 'faab'" });
  }
  const intInRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (waiverPeriodHours !== undefined && !intInRange(waiverPeriodHours, 0, 168)) {
    return res.status(400).json({ error: 'waiverPeriodHours must be an integer between 0 and 168' });
  }
  if (faabBudget !== undefined && !intInRange(faabBudget, 0, 1000)) {
    return res.status(400).json({ error: 'faabBudget must be an integer between 0 and 1000' });
  }
  if (tradeDeadlineWeek !== undefined && tradeDeadlineWeek !== null && !intInRange(tradeDeadlineWeek, 1, 18)) {
    return res.status(400).json({ error: 'tradeDeadlineWeek must be an integer between 1 and 18 (or null)' });
  }
  if (tradeReviewHours !== undefined && !intInRange(tradeReviewHours, 0, 168)) {
    return res.status(400).json({ error: 'tradeReviewHours must be an integer between 0 and 168' });
  }
  if (tradeVetoVotes !== undefined && !intInRange(tradeVetoVotes, 0, 20)) {
    return res.status(400).json({ error: 'tradeVetoVotes must be an integer between 0 and 20' });
  }
  const { SCORING_PRESETS, SCORING_RULES } = require('../services/scoring.service');
  if (scoringPreset !== undefined && !SCORING_PRESETS[scoringPreset]) {
    return res.status(400).json({ error: `scoringPreset must be one of ${Object.keys(SCORING_PRESETS).join(', ')}` });
  }
  if (scoringRules !== undefined) {
    const valid = scoringRules && typeof scoringRules === 'object' && !Array.isArray(scoringRules) &&
      Object.entries(scoringRules).every(
        ([key, value]) => key in SCORING_RULES && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 50
      );
    if (!valid) {
      return res.status(400).json({ error: 'scoringRules must map known stat names to numbers (|value| <= 50)' });
    }
  }
  if (regularSeasonWeeks !== undefined && !intInRange(regularSeasonWeeks, 1, 17)) {
    return res.status(400).json({ error: 'regularSeasonWeeks must be an integer between 1 and 17' });
  }
  if (playoffTeams !== undefined && !intInRange(playoffTeams, 2, 8)) {
    return res.status(400).json({ error: 'playoffTeams must be an integer between 2 and 8' });
  }
  if (playoffConsolation !== undefined && typeof playoffConsolation !== 'boolean') {
    return res.status(400).json({ error: 'playoffConsolation must be a boolean' });
  }
  if (pickTimeSeconds !== undefined && !intInRange(pickTimeSeconds, 0, 3600)) {
    return res.status(400).json({ error: 'pickTimeSeconds must be an integer between 0 and 3600 (0 = untimed)' });
  }
  if (autodraftDelaySeconds !== undefined && !intInRange(autodraftDelaySeconds, 1, 60)) {
    return res.status(400).json({ error: 'autodraftDelaySeconds must be an integer between 1 and 60' });
  }
  // A preset is just a prefilled full rule set; explicit scoringRules win
  const effectiveRules = scoringRules !== undefined
    ? scoringRules
    : scoringPreset !== undefined
      ? SCORING_PRESETS[scoringPreset]
      : undefined;
  // Keep the display/filter label in step with the actual rules: custom
  // rules mark the league 'custom', a preset stores its own name.
  const effectivePreset = scoringRules !== undefined
    ? 'custom'
    : scoringPreset !== undefined
      ? scoringPreset
      : undefined;
  let previousDraftDate = null;
  try {
    // Game-integrity settings freeze once the draft starts; administrative
    // ones (name, waivers, trades) stay editable all season.
    const preDraftOnly = {
      rosterLimit, lineupSlots, positionCaps, irSlots,
      scoringRules: effectiveRules, regularSeasonWeeks, playoffTeams,
      playoffConsolation, pickTimeSeconds, minTeams, maxTeams, autodraftDelaySeconds,
      draftDate: draftDateProvided ? draftDate : undefined,
    };
    const frozenRequested = Object.entries(preDraftOnly)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    if (frozenRequested.length > 0) {
      const statusResult = await pool.query(
        `SELECT "draft_status", "min_teams", "max_teams", "draft_date",
                (SELECT COUNT(*)::int FROM "teams" WHERE "teams"."league_id" = "leagues"."id") AS "team_count"
         FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2`,
        [leagueId, req.user.id]
      );
      const current = statusResult.rows[0];
      previousDraftDate = current ? current.draft_date : null;
      if (current && current.draft_status !== 'pending') {
        return res.status(409).json({
          error: `these settings are locked once the draft starts: ${frozenRequested.join(', ')}`,
        });
      }
      // Size-limit invariants: valid bounds, min ≤ max, and the cap can't drop
      // below the teams already in the league.
      if (current && (newMin !== null || newMax !== null)) {
        const sizeError = editSizeError({
          newMin, newMax,
          currentMin: current.min_teams,
          currentMax: current.max_teams,
          teamCount: current.team_count,
        });
        if (sizeError) return res.status(400).json({ error: sizeError });
      }
    }
    const result = await pool.query(
      `UPDATE "leagues"
       SET "name" = COALESCE($1, "name"),
           "roster_limit" = COALESCE($2, "roster_limit"),
           "lineup_slots" = COALESCE($3, "lineup_slots"),
           "position_caps" = COALESCE($4, "position_caps"),
           "ir_slots" = COALESCE($5, "ir_slots"),
           "waiver_type" = COALESCE($6, "waiver_type"),
           "waiver_period_hours" = COALESCE($7, "waiver_period_hours"),
           "faab_budget" = COALESCE($8, "faab_budget"),
           "trade_deadline_week" = COALESCE($9, "trade_deadline_week"),
           "trade_review_hours" = COALESCE($10, "trade_review_hours"),
           "trade_veto_votes" = COALESCE($11, "trade_veto_votes"),
           "scoring_rules" = COALESCE($12, "scoring_rules"),
           "regular_season_weeks" = COALESCE($13, "regular_season_weeks"),
           "playoff_teams" = COALESCE($14, "playoff_teams"),
           "playoff_consolation" = COALESCE($15, "playoff_consolation"),
           "pick_time_seconds" = COALESCE($16, "pick_time_seconds"),
           "scoring_preset" = COALESCE($19, "scoring_preset"),
           "min_teams" = COALESCE($20, "min_teams"),
           "max_teams" = COALESCE($21, "max_teams"),
           "autodraft_delay_seconds" = COALESCE($24, "autodraft_delay_seconds"),
           "draft_date" = CASE WHEN $22 THEN $23 ELSE "draft_date" END,
           -- Rescheduling resets the reminder/auto-start bookkeeping so the
           -- new time gets a fresh set of reminders.
           "draft_reminder_stage" = CASE WHEN $22 THEN 0 ELSE "draft_reminder_stage" END,
           "draft_autostart_failed" = CASE WHEN $22 THEN false ELSE "draft_autostart_failed" END,
           "updated_at" = now()
       WHERE "id" = $17 AND "owner_id" = $18
       RETURNING *`,
      [
        name || null,
        limit,
        lineupSlots === undefined ? null : JSON.stringify(lineupSlots),
        positionCaps === undefined ? null : JSON.stringify(positionCaps),
        irSlots === undefined ? null : irSlots,
        waiverType === undefined ? null : waiverType,
        waiverPeriodHours === undefined ? null : waiverPeriodHours,
        faabBudget === undefined ? null : faabBudget,
        tradeDeadlineWeek === undefined ? null : tradeDeadlineWeek,
        tradeReviewHours === undefined ? null : tradeReviewHours,
        tradeVetoVotes === undefined ? null : tradeVetoVotes,
        effectiveRules === undefined ? null : JSON.stringify(effectiveRules),
        regularSeasonWeeks === undefined ? null : regularSeasonWeeks,
        playoffTeams === undefined ? null : playoffTeams,
        playoffConsolation === undefined ? null : playoffConsolation,
        pickTimeSeconds === undefined ? null : pickTimeSeconds,
        leagueId,
        req.user.id,
        effectivePreset === undefined ? null : effectivePreset,
        newMin,
        newMax,
        draftDateProvided,
        draftDateValue,
        autodraftDelaySeconds === undefined ? null : autodraftDelaySeconds,
      ]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'league not found or you are not the owner' });
    }
    // Tell the league when the draft time is set or moved (not when cleared).
    const changed = draftDateProvided &&
      String(previousDraftDate ? new Date(previousDraftDate).toISOString() : null) !== String(draftDateValue);
    if (changed && draftDateValue) {
      const { notifyLeague } = require('../services/activity.service');
      const verb = previousDraftDate ? 'rescheduled' : 'scheduled';
      await notifyLeague(pool, {
        leagueId,
        type: 'draft_scheduled',
        message: `${result.rows[0].name}'s draft has been ${verb}.`,
        data: { url: `/#/league/${leagueId}`, draftDate: draftDateValue },
      });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating league', error);
    res.status(500).json({ error: 'failed to update league' });
  }
});

// POST /api/league/:id/start-draft — owner starts the live draft (once the
// league has reached its minimum team count)
router.post('/:id/start-draft', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the league row so a concurrent join can't slip the count under the
    // minimum between the check and the status flip.
    const leagueResult = await client.query(
      `SELECT "owner_id", "draft_status", "min_teams",
              (SELECT COUNT(*)::int FROM "teams" WHERE "teams"."league_id" = "leagues"."id") AS "team_count"
       FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league || league.owner_id !== req.user.id || league.draft_status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'league not found, not owner, or draft already started' });
    }
    if (!meetsMinimum(league.team_count, league.min_teams)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `need at least ${league.min_teams} teams to start the draft (currently ${league.team_count})`,
      });
    }
    const result = await client.query(
      `UPDATE "leagues"
       SET "draft_status" = 'active', "current_pick" = 0, "updated_at" = now(),
           "pick_deadline_at" = CASE WHEN "pick_time_seconds" > 0
             THEN now() + make_interval(secs => "pick_time_seconds") ELSE NULL END
       WHERE "id" = $1
       RETURNING *`,
      [leagueId]
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error starting draft', error);
    res.status(500).json({ error: 'failed to start draft' });
  } finally {
    client.release();
  }
});

// DELETE /api/league/:id — owner deletes the league
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

// GET /api/league/:id/rosters — every team's roster (for trade building, matchup views)
router.get('/:id/rosters', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    const membership = await pool.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });

    const result = await pool.query(
      `SELECT "teams"."id" AS "team_id", "teams"."name" AS "team_name", "teams"."owner_id",
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
        teams.set(row.team_id, { teamId: row.team_id, teamName: row.team_name, ownerId: row.owner_id, players: [] });
      }
      if (row.id) {
        teams.get(row.team_id).players.push({
          id: row.id, name: row.name, position: row.position, nfl_team: row.nfl_team,
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
    const membership = await pool.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });

    const result = await pool.query(
      `SELECT "transactions".*, "teams"."name" AS "team_name",
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
              home."name" AS "home_team_name", away."name" AS "away_team_name"
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
router.get('/:id/chat', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    const membership = await pool.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });
    const result = await pool.query(
      `SELECT * FROM (
         SELECT "chat_messages"."id", "chat_messages"."message", "chat_messages"."created_at",
                "chat_messages"."user_id", "users"."username"
         FROM "chat_messages" JOIN "users" ON "users"."id" = "chat_messages"."user_id"
         WHERE "chat_messages"."league_id" = $1
         ORDER BY "chat_messages"."created_at" DESC
         LIMIT 50
       ) recent ORDER BY "created_at" ASC`,
      [leagueId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching chat', error);
    res.status(500).json({ error: 'failed to fetch chat' });
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
    const membership = await client.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });

    const matchupResult = await client.query(
      `SELECT "matchups".*,
              home."name" AS "home_team_name", away."name" AS "away_team_name",
              home."owner_id" AS "home_owner_id", away."owner_id" AS "away_owner_id"
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
    const teamLineup = async (teamId) => {
      await materializeLineup(client, {
        leagueId, teamId, season: matchup.season, week: matchup.week,
      });
      const rows = await client.query(
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
      const starters = rows.rows.map((row) => {
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
      });
      const projectedTotal = Math.round(
        starters.reduce((sum, s) => sum + (s.projected || 0), 0) * 100
      ) / 100;
      return { starters, projectedTotal };
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
        projectedTotal: homeTeam.projectedTotal,
      },
      away: {
        teamId: matchup.away_team_id,
        name: matchup.away_team_name,
        starters: awayTeam.starters,
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

/** Shared member gate for the engagement read endpoints below. */
async function requireMember(req, res, leagueId) {
  const membership = await pool.query(
    `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
    [leagueId, req.user.id]
  );
  if (!membership.rows[0]) {
    res.status(403).json({ error: 'not a member of this league' });
    return false;
  }
  return true;
}

// GET /api/league/:id/trophies?season= — the league's trophy case
router.get('/:id/trophies', async (req, res) => {
  const leagueId = intParam(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const season = req.query.season !== undefined ? intParam(req.query.season) : null;
  if (req.query.season !== undefined && !season) {
    return res.status(400).json({ error: 'season must be a positive integer' });
  }
  try {
    if (!(await requireMember(req, res, leagueId))) return;
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
    if (!(await requireMember(req, res, leagueId))) return;
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
    if (!(await requireMember(req, res, leagueId))) return;
    const historyResult = await pool.query(
      `SELECT "league_history"."season", "league_history"."standings",
              "league_history"."champion_team_id", "teams"."name" AS "champion_name"
       FROM "league_history"
       LEFT JOIN "teams" ON "teams"."id" = "league_history"."champion_team_id"
       WHERE "league_history"."league_id" = $1
       ORDER BY "league_history"."season" DESC`,
      [leagueId]
    );
    const trophies = require('../services/trophy.service');
    const seasons = [];
    for (const row of historyResult.rows) {
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
        champion: row.champion_team_id
          ? { teamId: row.champion_team_id, name: row.champion_name }
          : null,
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
