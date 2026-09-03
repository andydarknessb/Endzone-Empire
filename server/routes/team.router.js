const express = require('express');
const multer = require('multer');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { createRateLimiter } = require('../modules/rateLimit');
const { addFreeAgent, dropPlayer, undoDrop } = require('../services/draft.service');
const { getLineup, setLineup } = require('../services/lineup.service');
const { startSitAdvice, weekHindsight, seasonHindsight } = require('../services/decision.service');
const { uploadTeamAvatar, removeTeamAvatar, MAX_UPLOAD_BYTES } = require('../services/avatar.service');
const { computeByeWeeks } = require('../services/bye.service');
const { requireMember } = require('../services/leagueMembership.service');
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
const projectionService = require('../services/projection.service');

const router = express.Router();
router.use(requireAuth);

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});
// Ten uploads/removals per 10 minutes is ample for legitimate crop-and-retry
// use and caps how much storage churn a single account can cause.
const avatarRateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10 });

// GET /api/team/roster?leagueId=N — the caller's roster in a league
router.get('/roster', async (req, res) => {
  const leagueId = req.query.leagueId;
  if (!/^\d+$/.test(String(leagueId))) {
    return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  }
  try {
    const result = await pool.query(
      `SELECT "players".*, "team_players"."created_at" AS "acquired_at", "teams"."id" AS "team_id",
              "lineup_entries"."slot" AS "lineup_slot", "lineup_entries"."ir_attested"
       FROM "team_players"
       JOIN "players" ON "players"."id" = "team_players"."player_id"
       JOIN "teams" ON "teams"."id" = "team_players"."team_id"
       JOIN "leagues" ON "leagues"."id" = "teams"."league_id"
       LEFT JOIN "lineup_entries" ON "lineup_entries"."team_id" = "teams"."id"
         AND "lineup_entries"."player_id" = "players"."id"
         AND "lineup_entries"."season" = "leagues"."current_season"
         AND "lineup_entries"."week" = "leagues"."current_week"
       WHERE "teams"."league_id" = $1 AND "teams"."owner_id" = $2
       ORDER BY CASE WHEN "lineup_entries"."slot" IN ('BENCH', 'IR') OR "lineup_entries"."slot" IS NULL THEN 1 ELSE 0 END,
                "lineup_entries"."slot", "players"."position", "players"."name"`,
      [Number(leagueId), req.user.id]
    );
    // Bye week is schedule-derived (not a stored players column), so annotate
    // each roster row with its NFL team's bye for the league's current season.
    // Batched: a full roster resolves in one nfl_games query, not one per slot.
    const leagueRow = await pool.query(
      `SELECT "current_season", "current_week" FROM "leagues" WHERE "id" = $1`,
      [Number(leagueId)]
    );
    const season = leagueRow.rows[0]?.current_season ?? null;
    const week = leagueRow.rows[0]?.current_week ?? null;
    const weeklyByPlayer = await projectionService.getWeekProjections({ season, week });
    const byeByTeam = await computeByeWeeks(
      result.rows.map((row) => row.nfl_team),
      season
    );
    for (const row of result.rows) {
      const projection = weeklyByPlayer.get(row.id);
      row.projected_weekly_points =
        projection && Number.isFinite(Number(projection.points))
          ? Number(projection.points)
          : null;
      row.bye_week = byeByTeam.get(row.nfl_team) ?? null;
    }
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching roster', error);
    res.status(500).json({ error: 'failed to fetch roster' });
  }
});

// POST /api/team/roster/:playerId — add a player (free agency); transactional
router.post('/roster/:playerId', async (req, res) => {
  if (!/^\d+$/.test(req.params.playerId)) {
    return res.status(400).json({ error: 'playerId must be a positive integer' });
  }
  const leagueId = req.body && req.body.leagueId;
  if (!Number.isInteger(leagueId) || leagueId < 1) {
    return res.status(400).json({ error: 'leagueId (integer) is required in the body' });
  }
  try {
    // A post-draft free-agent add is not a Pick (#782 ruling 2): addFreeAgent
    // commits the add and fans out `rosterChanged` itself, so the route no longer
    // emits it here.
    const outcome = await addFreeAgent({
      leagueId,
      userId: req.user.id,
      playerId: Number(req.params.playerId),
    });
    res.status(201).json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error adding player to roster', error);
    res.status(500).json({ error: 'failed to add player' });
  }
});

// DELETE /api/team/roster/:playerId — drop a player; transactional
router.delete('/roster/:playerId', async (req, res) => {
  if (!/^\d+$/.test(req.params.playerId)) {
    return res.status(400).json({ error: 'playerId must be a positive integer' });
  }
  const leagueId = req.query.leagueId;
  if (!/^\d+$/.test(String(leagueId))) {
    return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  }
  try {
    const outcome = await dropPlayer({
      leagueId: Number(leagueId),
      userId: req.user.id,
      playerId: Number(req.params.playerId),
    });
    await getDraftRoomBroadcast().rosterChanged(Number(leagueId));
    res.json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error dropping player', error);
    res.status(500).json({ error: 'failed to drop player' });
  }
});

// POST /api/team/roster/:playerId/undo-drop — re-add a player this team just
// dropped, bypassing the waiver hold that a plain POST /roster would hit.
// Only valid while the waiver_players row still names this team as dropper.
router.post('/roster/:playerId/undo-drop', async (req, res) => {
  if (!/^\d+$/.test(req.params.playerId)) {
    return res.status(400).json({ error: 'playerId must be a positive integer' });
  }
  const leagueId = req.body && req.body.leagueId;
  if (!Number.isInteger(leagueId) || leagueId < 1) {
    return res.status(400).json({ error: 'leagueId (integer) is required in the body' });
  }
  try {
    const outcome = await undoDrop({
      leagueId,
      userId: req.user.id,
      playerId: Number(req.params.playerId),
    });
    await getDraftRoomBroadcast().rosterChanged(leagueId);
    res.status(201).json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error undoing drop', error);
    res.status(500).json({ error: 'failed to undo drop' });
  }
});

// GET /api/team/lineup?leagueId=N&week=W — the caller's weekly lineup
// (materialized on first view; carries forward from the previous week)
router.get('/lineup', async (req, res) => {
  const leagueId = req.query.leagueId;
  if (!/^\d+$/.test(String(leagueId))) {
    return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  }
  const week = req.query.week === undefined ? undefined : req.query.week;
  if (week !== undefined && !/^\d+$/.test(String(week))) {
    return res.status(400).json({ error: 'week must be a positive integer' });
  }
  try {
    const lineup = await getLineup({
      leagueId: Number(leagueId),
      userId: req.user.id,
      week: week === undefined ? undefined : Number(week),
    });
    res.json(lineup);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching lineup', error);
    res.status(500).json({ error: 'failed to fetch lineup' });
  }
});

// PUT/POST /api/team/lineup — move players between slots; the whole batch is
// validated and applied atomically (slot counts, eligibility, lineup locks).
async function updateLineup(req, res) {
  const { leagueId, week, moves } = req.body || {};
  if (!Number.isInteger(leagueId) || leagueId < 1) {
    return res.status(400).json({ error: 'leagueId (integer) is required in the body' });
  }
  if (week !== undefined && (!Number.isInteger(week) || week < 1)) {
    return res.status(400).json({ error: 'week must be a positive integer' });
  }
  try {
    const outcome = await setLineup({ leagueId, userId: req.user.id, week, moves });
    res.json(outcome);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json(
        error.code ? { error: error.code, message: error.message } : { error: error.message }
      );
    }
    console.error('Error setting lineup', error);
    res.status(500).json({ error: 'failed to set lineup' });
  }
}

router.put('/lineup', updateLineup);
router.post('/lineup', updateLineup);

// GET /api/team/lineup/advice?leagueId=N&season=S&week=W — start/sit suggestions
// for the caller's team (season/week optional — default to the current lineup)
router.get('/lineup/advice', async (req, res) => {
  const leagueId = req.query.leagueId;
  if (!/^\d+$/.test(String(leagueId))) {
    return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  }
  const season = req.query.season === undefined ? undefined : req.query.season;
  if (season !== undefined && !/^\d+$/.test(String(season))) {
    return res.status(400).json({ error: 'season must be a positive integer' });
  }
  const week = req.query.week === undefined ? undefined : req.query.week;
  if (week !== undefined && !/^\d+$/.test(String(week))) {
    return res.status(400).json({ error: 'week must be a positive integer' });
  }
  try {
    const advice = await startSitAdvice({
      leagueId: Number(leagueId),
      userId: req.user.id,
      season: season === undefined ? undefined : Number(season),
      week: week === undefined ? undefined : Number(week),
    });
    res.json(advice);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching lineup advice', error);
    res.status(500).json({ error: 'failed to fetch lineup advice' });
  }
});

// GET /api/team/hindsight?leagueId=N&teamId=N&season=S&week=W — actual vs.
// optimal lineup for a team; omit week for the full-season summary. Any
// league member may view any team's hindsight (matchup recaps show it).
router.get('/hindsight', async (req, res) => {
  const leagueId = req.query.leagueId;
  const teamId = req.query.teamId;
  if (!/^\d+$/.test(String(leagueId)) || !/^\d+$/.test(String(teamId))) {
    return res.status(400).json({ error: 'leagueId and teamId query params (integers) are required' });
  }
  const season = req.query.season;
  if (!/^\d+$/.test(String(season))) {
    return res.status(400).json({ error: 'season query param (integer) is required' });
  }
  const week = req.query.week === undefined ? undefined : req.query.week;
  if (week !== undefined && !/^\d+$/.test(String(week))) {
    return res.status(400).json({ error: 'week must be a positive integer' });
  }
  try {
    await requireMember(pool, { leagueId: Number(leagueId), userId: req.user.id });

    const result = week === undefined
      ? await seasonHindsight({ leagueId: Number(leagueId), teamId: Number(teamId), season: Number(season) })
      : await weekHindsight({
          leagueId: Number(leagueId), teamId: Number(teamId), season: Number(season), week: Number(week),
        });
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching hindsight', error);
    res.status(500).json({ error: 'failed to fetch hindsight' });
  }
});

// PUT /api/team/:id — rename the caller's team
router.put('/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'team id must be a positive integer' });
  }
  const { name } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const result = await pool.query(
      `UPDATE "teams" SET "name" = $1, "updated_at" = now()
       WHERE "id" = $2 AND "owner_id" = $3 RETURNING *`,
      [name, Number(req.params.id), req.user.id]
    );
    if (!result.rows[0]) return res.status(403).json({ error: 'team not found or not yours' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error renaming team', error);
    res.status(500).json({ error: 'failed to rename team' });
  }
});

// POST /api/team/:id/avatar — upload/replace the caller's team avatar
// (multipart, field name "avatar"; PNG/JPEG/WEBP/GIF up to 5MB)
router.post('/:id/avatar', avatarRateLimiter, (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'file too large (max 5MB)' });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'team id must be a positive integer' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'avatar file is required (multipart field "avatar")' });
  }
  try {
    const team = await uploadTeamAvatar({
      teamId: Number(req.params.id),
      ownerId: req.user.id,
      buffer: req.file.buffer,
    });
    res.json(team);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error uploading team avatar', error);
    res.status(500).json({ error: 'failed to upload avatar' });
  }
});

// DELETE /api/team/:id/avatar — reset the caller's team avatar to the initials fallback
router.delete('/:id/avatar', avatarRateLimiter, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'team id must be a positive integer' });
  }
  try {
    const team = await removeTeamAvatar({ teamId: Number(req.params.id), ownerId: req.user.id });
    res.json(team);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error removing team avatar', error);
    res.status(500).json({ error: 'failed to remove avatar' });
  }
});

module.exports = router;
