const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { draftPlayer } = require('../services/draft.service');

const router = express.Router();

const PAGE_SIZE = 25;
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

// GET /api/players?page=N&position=QB[&leagueId=N&available=true]
// Paginated player pool with strict integer validation on `page`.
router.get('/', requireAuth, async (req, res) => {
  const rawPage = req.query.page === undefined ? '1' : String(req.query.page);
  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1) {
    return res.status(400).json({ error: 'page must be a positive integer' });
  }
  const page = Number(rawPage);
  const offset = (page - 1) * PAGE_SIZE;

  const position = req.query.position && req.query.position !== 'All'
    ? String(req.query.position).toUpperCase()
    : null;
  if (position && !POSITIONS.includes(position)) {
    return res.status(400).json({ error: `position must be one of ${POSITIONS.join(', ')}` });
  }

  // Optional: exclude players already rostered in a league (draft board view)
  const leagueId = req.query.leagueId ? String(req.query.leagueId) : null;
  if (leagueId && !/^\d+$/.test(leagueId)) {
    return res.status(400).json({ error: 'leagueId must be a positive integer' });
  }
  const availableOnly = req.query.available === 'true' && leagueId;

  const params = [];
  const where = [];
  if (position) {
    params.push(position);
    where.push(`"position" = $${params.length}`);
  }
  if (availableOnly) {
    params.push(Number(leagueId));
    where.push(`"id" NOT IN (SELECT "player_id" FROM "team_players" WHERE "league_id" = $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(PAGE_SIZE, offset);
  // projected_points = per-game fantasy average over the player's most
  // recent synced season (null until stats exist)
  const queryText = `
    SELECT "players".*, COUNT(*) OVER() AS total_count,
           (SELECT ROUND(AVG("fantasy_points"), 1) FROM "player_stats"
            WHERE "player_stats"."player_id" = "players"."id"
              AND "player_stats"."season" = (SELECT MAX("season") FROM "player_stats"
                                             WHERE "player_id" = "players"."id")
           ) AS "projected_points"
    FROM "players"
    ${whereSql}
    ORDER BY "id"
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  try {
    const result = await pool.query(queryText, params);
    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    res.json({
      players: result.rows.map(({ total_count, ...p }) => p),
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
    });
  } catch (error) {
    console.error('Error on GET players query', error);
    res.status(500).json({ error: 'failed to fetch players' });
  }
});

// GET /api/players/:id — player detail: weekly stat lines, fantasy points by
// week, season totals, and a per-game projection (season average)
router.get('/:id', requireAuth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'player id must be a positive integer' });
  }
  const playerId = Number(req.params.id);
  try {
    const playerResult = await pool.query(`SELECT * FROM "players" WHERE "id" = $1`, [playerId]);
    const player = playerResult.rows[0];
    if (!player) return res.status(404).json({ error: 'player not found' });

    const weeklyResult = await pool.query(
      `SELECT "season", "week", "stats", "fantasy_points"
       FROM "player_stats" WHERE "player_id" = $1
       ORDER BY "season" DESC, "week"`,
      [playerId]
    );
    const weekly = weeklyResult.rows.map((r) => ({ ...r, fantasy_points: Number(r.fantasy_points) }));
    const latestSeason = weekly.length > 0 ? weekly[0].season : null;
    const seasonWeeks = weekly.filter((w) => w.season === latestSeason);
    const totalPoints = seasonWeeks.reduce((sum, w) => sum + w.fantasy_points, 0);
    res.json({
      player,
      weekly,
      seasonTotals: latestSeason === null ? null : {
        season: latestSeason,
        games: seasonWeeks.length,
        points: Math.round(totalPoints * 100) / 100,
        projectedPoints: seasonWeeks.length > 0
          ? Math.round((totalPoints / seasonWeeks.length) * 10) / 10
          : null,
      },
    });
  } catch (error) {
    console.error('Error fetching player detail', error);
    res.status(500).json({ error: 'failed to fetch player' });
  }
});

// POST /api/players/draft/:playerId — draft a player onto the caller's team.
// Fully transactional: pick + roster insert commit together or not at all.
router.post('/draft/:playerId', requireAuth, async (req, res) => {
  if (!/^\d+$/.test(req.params.playerId)) {
    return res.status(400).json({ error: 'playerId must be a positive integer' });
  }
  const leagueId = req.body && req.body.leagueId;
  if (!Number.isInteger(leagueId) || leagueId < 1) {
    return res.status(400).json({ error: 'leagueId (integer) is required in the body' });
  }

  try {
    const outcome = await draftPlayer({
      leagueId,
      userId: req.user.id,
      playerId: Number(req.params.playerId),
    });
    res.status(201).json(outcome);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error drafting player', error);
    res.status(500).json({ error: 'failed to draft player' });
  }
});

module.exports = router;
