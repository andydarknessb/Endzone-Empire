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
  const queryText = `
    SELECT *, COUNT(*) OVER() AS total_count FROM "players"
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
