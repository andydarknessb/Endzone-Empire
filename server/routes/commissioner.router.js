const express = require('express');
const { requireAuth } = require('../modules/auth');
const commissioner = require('../services/commissioner.service');
const { requireFantasyLeague } = require('../services/leagueType');

const router = express.Router();
router.use(requireAuth);

// A pick'em-only league has no lineups, matchups, waivers or FAAB, so the six
// fantasy mutations below carry an explicit guard (409 PICKEM_ONLY_LEAGUE).
// No blanket mount here: rollover, remove member and avatar moderation apply
// to every league type and stay open.
const fantasyOnly = requireFantasyLeague();

function intOrNull(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

function handle(res, error, fallback) {
  if (error.statusCode) {
    return res.status(error.statusCode).json(
      error.code ? { error: error.code, message: error.message } : { error: error.message }
    );
  }
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}

// DELETE /api/commissioner/league/:id/teams/:teamId — remove a team
router.delete('/league/:id/teams/:teamId', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  const teamId = intOrNull(req.params.teamId);
  if (!leagueId || !teamId) {
    return res.status(400).json({ error: 'league id and team id must be positive integers' });
  }
  try {
    res.json(await commissioner.removeTeam({ leagueId, userId: req.user.id, teamId }));
  } catch (error) {
    handle(res, error, 'failed to remove team');
  }
});

// PUT /api/commissioner/league/:id/teams/:teamId/lineup — force-set a lineup
// { week?, moves: [{ playerId, slot }] }
router.put('/league/:id/teams/:teamId/lineup', fantasyOnly, async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  const teamId = intOrNull(req.params.teamId);
  if (!leagueId || !teamId) {
    return res.status(400).json({ error: 'league id and team id must be positive integers' });
  }
  const { week, moves } = req.body || {};
  if (week !== undefined && (!Number.isInteger(week) || week < 1)) {
    return res.status(400).json({ error: 'week must be a positive integer' });
  }
  try {
    res.json(await commissioner.forceSetLineup({ leagueId, userId: req.user.id, teamId, week, moves }));
  } catch (error) {
    handle(res, error, 'failed to set lineup');
  }
});

// PUT /api/commissioner/league/:id/matchups/:matchupId — adjust scores
// { homeScore, awayScore }
router.put('/league/:id/matchups/:matchupId', fantasyOnly, async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  const matchupId = intOrNull(req.params.matchupId);
  if (!leagueId || !matchupId) {
    return res.status(400).json({ error: 'league id and matchup id must be positive integers' });
  }
  const { homeScore, awayScore } = req.body || {};
  const validScore = (s) => Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 1000;
  if (!validScore(homeScore) || !validScore(awayScore)) {
    return res.status(400).json({ error: 'homeScore and awayScore must be numbers between 0 and 1000' });
  }
  try {
    res.json(await commissioner.adjustMatchupScore({
      leagueId,
      userId: req.user.id,
      matchupId,
      homeScore: Number(homeScore),
      awayScore: Number(awayScore),
    }));
  } catch (error) {
    handle(res, error, 'failed to adjust score');
  }
});

// PUT /api/commissioner/league/:id/transactions-lock — { locked: true|false }
router.put('/league/:id/transactions-lock', fantasyOnly, async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const { locked } = req.body || {};
  if (typeof locked !== 'boolean') {
    return res.status(400).json({ error: 'locked (boolean) is required' });
  }
  try {
    res.json(await commissioner.setTransactionsLocked({ leagueId, userId: req.user.id, locked }));
  } catch (error) {
    handle(res, error, 'failed to update transaction lock');
  }
});

// POST /api/commissioner/league/:id/rollover — archive season and reset
// { keepers?: [{ teamId, playerIds: [] }] }
router.post('/league/:id/rollover', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const { keepers } = req.body || {};
  if (keepers !== undefined && !Array.isArray(keepers)) {
    return res.status(400).json({ error: 'keepers must be an array of { teamId, playerIds }' });
  }
  try {
    res.json(await commissioner.rolloverSeason({ leagueId, userId: req.user.id, keepers: keepers || [] }));
  } catch (error) {
    handle(res, error, 'failed to roll over season');
  }
});

// PUT /api/commissioner/league/:id/teams/:teamId/lock — { locked: true|false }
router.put('/league/:id/teams/:teamId/lock', fantasyOnly, async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  const teamId = intOrNull(req.params.teamId);
  if (!leagueId || !teamId) {
    return res.status(400).json({ error: 'league id and team id must be positive integers' });
  }
  const { locked } = req.body || {};
  if (typeof locked !== 'boolean') {
    return res.status(400).json({ error: 'locked (boolean) is required' });
  }
  try {
    res.json(await commissioner.setTeamLocked({ leagueId, userId: req.user.id, teamId, locked }));
  } catch (error) {
    handle(res, error, 'failed to update team lock');
  }
});

// PUT /api/commissioner/league/:id/teams/:teamId/faab — { faabRemaining }
router.put('/league/:id/teams/:teamId/faab', fantasyOnly, async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  const teamId = intOrNull(req.params.teamId);
  if (!leagueId || !teamId) {
    return res.status(400).json({ error: 'league id and team id must be positive integers' });
  }
  const { faabRemaining } = req.body || {};
  if (!Number.isInteger(faabRemaining) || faabRemaining < 0 || faabRemaining > 1000) {
    return res.status(400).json({ error: 'faabRemaining must be an integer between 0 and 1000' });
  }
  try {
    res.json(await commissioner.setTeamFaab({ leagueId, userId: req.user.id, teamId, faabRemaining }));
  } catch (error) {
    handle(res, error, 'failed to update FAAB budget');
  }
});

// POST /api/commissioner/league/:id/force-transaction — { teamId, action: 'add'|'drop', playerId }
router.post('/league/:id/force-transaction', fantasyOnly, async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const { teamId, action, playerId } = req.body || {};
  if (!Number.isInteger(teamId) || teamId < 1) {
    return res.status(400).json({ error: 'teamId (integer) is required' });
  }
  if (action !== 'add' && action !== 'drop') {
    return res.status(400).json({ error: "action must be 'add' or 'drop'" });
  }
  if (!Number.isInteger(playerId) || playerId < 1) {
    return res.status(400).json({ error: 'playerId (integer) is required' });
  }
  try {
    res.json(await commissioner.forceTransaction({ leagueId, userId: req.user.id, teamId, action, playerId }));
  } catch (error) {
    handle(res, error, 'failed to force transaction');
  }
});

// DELETE /api/commissioner/league/:id/teams/:teamId/avatar — moderation
// removal; privately notifies the affected owner (see commissioner.service.js)
router.delete('/league/:id/teams/:teamId/avatar', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  const teamId = intOrNull(req.params.teamId);
  if (!leagueId || !teamId) {
    return res.status(400).json({ error: 'league id and team id must be positive integers' });
  }
  try {
    res.json(await commissioner.removeTeamAvatar({ leagueId, userId: req.user.id, teamId }));
  } catch (error) {
    handle(res, error, 'failed to remove team avatar');
  }
});

module.exports = router;
