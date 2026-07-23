const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { materializeLineup } = require('../services/lineup.service');
const { dedupeGameIds } = require('../services/matchupGames.service');

// Isolated on purpose: this only maps a fantasy matchup to the real NFL
// games it spans (view_matchup_nfl_games) for the frontend to mount
// <LiveGameStatus> against. It never touches the Socket.IO fantasy-scoring
// pipeline (scoring.service.js / scheduler.js) or the Supabase Realtime
// worker (modules/liveGameEngine.js) — both keep working exactly as before.
const router = express.Router();
router.use(requireAuth);

function intParam(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

// GET /api/matchups/:matchupId/real-games — every tank01_game_id either
// roster in this matchup has a player in, de-duplicated. Bare array response
// (not wrapped in an object): the frontend maps this directly over
// <LiveGameStatus key={gameId} gameId={gameId} />.
router.get('/:matchupId/real-games', async (req, res) => {
  const matchupId = intParam(req.params.matchupId);
  if (!matchupId) {
    return res.status(400).json({ error: 'matchup id must be a positive integer' });
  }

  const client = await pool.connect();
  try {
    const matchupResult = await client.query(
      `SELECT "id", "league_id", "season", "week", "home_team_id", "away_team_id"
       FROM "matchups" WHERE "id" = $1`,
      [matchupId]
    );
    const matchup = matchupResult.rows[0];
    if (!matchup) return res.status(404).json({ error: 'matchup not found' });

    const membership = await client.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [matchup.league_id, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });

    // view_matchup_nfl_games joins through lineup_entries, which is only
    // materialized lazily on first read (services/lineup.service.js) — for
    // a week nobody's opened a lineup screen for yet, lineup_entries would
    // be empty and the view would silently return zero games even though
    // both rosters are full. Materializing both sides here (same call
    // league.router.js's matchup-detail endpoint makes) closes that gap.
    await materializeLineup(client, {
      leagueId: matchup.league_id,
      teamId: matchup.home_team_id,
      season: matchup.season,
      week: matchup.week,
    });
    await materializeLineup(client, {
      leagueId: matchup.league_id,
      teamId: matchup.away_team_id,
      season: matchup.season,
      week: matchup.week,
    });

    const gamesResult = await client.query(
      `SELECT "tank01_game_id" FROM "view_matchup_nfl_games" WHERE "fantasy_matchup_id" = $1`,
      [matchupId]
    );
    res.json(dedupeGameIds(gamesResult.rows));
  } catch (error) {
    console.error('Error fetching real games for matchup', error);
    res.status(500).json({ error: 'failed to fetch real games for matchup' });
  } finally {
    client.release();
  }
});

module.exports = router;
