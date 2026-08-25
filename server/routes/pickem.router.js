const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { isLeagueCommissioner } = require('../services/leagueRole.service');
const { requireMember } = require('../services/leagueMembership.service');
const pickem = require('../services/pickem.service');

/**
 * League Pick'em API. Everything here is members-only; the two settings
 * writes are commissioner-only, authorized through leagueRole.service so a
 * co-commissioner has the same powers as the owner (never a raw owner_id
 * compare).
 *
 * Error responses carry a machine-readable `code` alongside `error`, and the
 * lock/validation failures also carry `gameKeys` so the board can highlight
 * exactly which rows the server refused.
 */
const router = express.Router();
router.use(requireAuth);

const REG_SEASON_WEEKS = pickem.REG_SEASON_WEEKS;

function intParam(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

function fail(res, error, fallback) {
  if (error && error.statusCode) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      ...(error.details || {}),
    });
  }
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}

// GET /api/pickem/league/:leagueId/settings — is Pick'em on, and how does it score?
router.get('/league/:leagueId/settings', async (req, res) => {
  const leagueId = intParam(req.params.leagueId);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    await requireMember(pool, { leagueId, userId: req.user.id });
    const [settings, isCommissioner] = await Promise.all([
      pickem.getSettings(leagueId),
      isLeagueCommissioner(pool, leagueId, req.user.id),
    ]);
    res.json({ ...settings, isCommissioner });
  } catch (error) {
    fail(res, error, "failed to load Pick'em settings");
  }
});

// PUT /api/pickem/league/:leagueId/settings — commissioner turns it on/off, picks a mode
router.put('/league/:leagueId/settings', async (req, res) => {
  const leagueId = intParam(req.params.leagueId);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const { enabled, mode } = req.body || {};
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  try {
    await requireMember(pool, { leagueId, userId: req.user.id });
    if (!(await isLeagueCommissioner(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: "only the commissioner can change Pick'em settings" });
    }
    const settings = await pickem.putSettings({ leagueId, enabled, mode });
    res.json({ ...settings, isCommissioner: true });
  } catch (error) {
    fail(res, error, "failed to save Pick'em settings");
  }
});

// GET /api/pickem/league/:leagueId/week/:week — the slate, my picks, and
// everyone else's picks for games that have already kicked off
router.get('/league/:leagueId/week/:week', async (req, res) => {
  const leagueId = intParam(req.params.leagueId);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const week = intParam(req.params.week);
  if (!week || week > REG_SEASON_WEEKS) {
    return res.status(400).json({ error: `week must be between 1 and ${REG_SEASON_WEEKS}` });
  }
  try {
    const viewerTeam = await requireMember(pool, { leagueId, userId: req.user.id });
    const settings = await pickem.getSettings(leagueId);
    if (!settings.enabled) {
      return res.status(403).json({
        error: "Pick'em is not enabled for this league",
        code: 'PICKEM_DISABLED',
      });
    }
    const league = await pickem.loadLeague(pool, leagueId);
    const view = await pickem.getWeekView({
      leagueId,
      userId: req.user.id,
      season: league.current_season,
      week,
      mode: settings.mode,
    });
    // viewerTeamId answers "which of these participants is me" without any
    // consumer holding another manager's account ID (#112, parent #108).
    res.json({ ...view, viewerTeamId: viewerTeam.id });
  } catch (error) {
    fail(res, error, "failed to load the Pick'em week");
  }
});

// PUT /api/pickem/league/:leagueId/week/:week/picks — bulk, all-or-nothing save
router.put('/league/:leagueId/week/:week/picks', async (req, res) => {
  const leagueId = intParam(req.params.leagueId);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const week = intParam(req.params.week);
  if (!week || week > REG_SEASON_WEEKS) {
    return res.status(400).json({ error: `week must be between 1 and ${REG_SEASON_WEEKS}` });
  }
  const picks = req.body && req.body.picks;
  if (!Array.isArray(picks)) return res.status(400).json({ error: 'picks must be an array' });
  try {
    await requireMember(pool, { leagueId, userId: req.user.id });
    const league = await pickem.loadLeague(pool, leagueId);
    const result = await pickem.upsertPicks({
      leagueId,
      userId: req.user.id,
      season: league.current_season,
      week,
      picks,
    });
    res.json(result);
  } catch (error) {
    fail(res, error, 'failed to save picks');
  }
});

// GET /api/pickem/league/:leagueId/standings?season= — season leaderboard
router.get('/league/:leagueId/standings', async (req, res) => {
  const leagueId = intParam(req.params.leagueId);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const requestedSeason = req.query.season !== undefined ? intParam(req.query.season) : null;
  if (req.query.season !== undefined && !requestedSeason) {
    return res.status(400).json({ error: 'season must be a positive integer' });
  }
  try {
    const viewerTeam = await requireMember(pool, { leagueId, userId: req.user.id });
    const league = await pickem.loadLeague(pool, leagueId);
    const season = requestedSeason || league.current_season;
    const { standings, ...meta } = await pickem.getStandings({ leagueId, season });
    // getStandings carries `userId` on each row as the scoring join key, read
    // by internal callers (e.g. season completion). It is account identity, so
    // a member-facing standings row names the manager by Team identity only:
    // strip userId here, at serialization (#343, #115). The viewer knows their
    // own row from `viewerTeamId`.
    const sharedStandings = standings.map((row) => {
      const shared = { ...row };
      delete shared.userId;
      return shared;
    });
    res.json({ ...meta, standings: sharedStandings, viewerTeamId: viewerTeam.id });
  } catch (error) {
    fail(res, error, "failed to load Pick'em standings");
  }
});

module.exports = router;
