// DEV-ONLY router — mounted only when NODE_ENV !== 'production' (see server.js).
// Exists to demo the live Tecmo touchdown cutscene without waiting for a real
// game. It emits a synthetic scores:updated (with typed `plays`) to a league
// room, exactly like the scheduler's live sync does. Not part of the product.
const express = require('express');
const pool = require('../modules/pool');
const { getIo } = require('../modules/io');

const router = express.Router();

function intParam(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// POST /api/dev/demo-td  { leagueId, matchupId }
// Fires one touchdown for the FIRST starter on each side of the matchup, so
// whoever is viewing sees a cutscene for their own player (and a toast for the
// opponent's). Returns counts only — no roster data leaves the server.
router.post('/demo-td', async (req, res) => {
  const leagueId = intParam(req.body.leagueId);
  const matchupId = intParam(req.body.matchupId);
  if (!leagueId || !matchupId) {
    return res.status(400).json({ error: 'leagueId and matchupId (positive integers) required' });
  }

  const io = getIo();
  if (!io) return res.status(503).json({ error: 'socket server not ready' });

  try {
    const m = await pool.query(
      `SELECT id, season, week, home_team_id, away_team_id,
              COALESCE(home_score, 0) AS home_score, COALESCE(away_score, 0) AS away_score
       FROM "matchups" WHERE id = $1 AND league_id = $2`,
      [matchupId, leagueId]
    );
    const matchup = m.rows[0];
    if (!matchup) return res.status(404).json({ error: 'matchup not found in that league' });

    const starterFor = async (teamId) => {
      const r = await pool.query(
        `SELECT p.id, p.name, p.position, p.nfl_team, g.opponent
         FROM "lineup_entries" le
         JOIN "players" p ON p.id = le.player_id
         LEFT JOIN "nfl_games" g ON g.nfl_team = p.nfl_team AND g.season = le.season AND g.week = le.week
         WHERE le.team_id = $1 AND le.season = $2 AND le.week = $3
           AND le.slot NOT IN ('BENCH','IR')
         ORDER BY le.slot
         LIMIT 1`,
        [teamId, matchup.season, matchup.week]
      );
      return r.rows[0] || null;
    };

    const [homeStarter, awayStarter] = await Promise.all([
      starterFor(matchup.home_team_id),
      starterFor(matchup.away_team_id),
    ]);

    const plays = [];
    const mkPlay = (s) => ({
      playerId: s.id,
      name: s.name,
      position: s.position,
      nflTeam: s.nfl_team,
      opponent: s.opponent || null,
      type: 'rushing',
      tdDelta: 1,
      pointsDelta: 6,
    });
    if (homeStarter) plays.push(mkPlay(homeStarter));
    if (awayStarter) plays.push(mkPlay(awayStarter));

    if (plays.length === 0) {
      return res.status(422).json({ error: 'no starters found for this matchup' });
    }

    io.to(`league:${leagueId}`).emit('scores:updated', {
      leagueId,
      season: matchup.season,
      week: matchup.week,
      scored: [{
        matchupId: matchup.id,
        homeTeamId: matchup.home_team_id,
        awayTeamId: matchup.away_team_id,
        homeScore: Math.round((Number(matchup.home_score) + (homeStarter ? 6 : 0)) * 100) / 100,
        awayScore: Math.round((Number(matchup.away_score) + (awayStarter ? 6 : 0)) * 100) / 100,
      }],
      plays,
    });

    return res.json({ ok: true, emittedTo: `league:${leagueId}`, plays: plays.length });
  } catch (err) {
    console.error('demo-td failed', err.message);
    return res.status(500).json({ error: 'demo failed' });
  }
});

module.exports = router;
