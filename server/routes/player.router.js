const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { draftPlayer } = require('../services/draft.service');
const { rulesForLeague, buildPlayerSummary, projectSeasonPoints } = require('../services/scoring.service');

const router = express.Router();

const PAGE_SIZE = 25;
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

// Short-lived in-memory cache for the player summary. Keyed by player + league
// (scoring rules differ per league), so a draft room hammering this endpoint
// serves most reads from memory. TTL is intentionally small — a 30s-stale
// injury/stat line during a live draft is harmless.
const SUMMARY_TTL_MS = 30_000;
const summaryCache = new Map();

function summaryCacheGet(key) {
  const hit = summaryCache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    summaryCache.delete(key);
    return null;
  }
  return hit.value;
}

function summaryCacheSet(key, value) {
  // Bound the map so a long-lived process can't leak memory during a big draft.
  if (summaryCache.size > 2000) summaryCache.clear();
  summaryCache.set(key, { value, expires: Date.now() + SUMMARY_TTL_MS });
}

const REG_SEASON_WEEKS = 18;

/**
 * A team's bye week for a season: the regular-season week (1..18) with no
 * nfl_games row for that team. Returns null when the schedule isn't synced
 * (no rows) or nothing is missing — the dialog just omits the bye then.
 */
async function computeByeWeek(nflTeam, season) {
  if (!nflTeam) return null;
  const r = await pool.query(
    `SELECT DISTINCT "week" FROM "nfl_games"
     WHERE "nfl_team" = $1 AND "season" = $2 AND "week" BETWEEN 1 AND $3`,
    [nflTeam, season, REG_SEASON_WEEKS]
  );
  if (r.rows.length === 0) return null; // schedule not synced for this team
  const played = new Set(r.rows.map((row) => Number(row.week)));
  for (let week = 1; week <= REG_SEASON_WEEKS; week++) {
    if (!played.has(week)) return week;
  }
  return null;
}

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

  // Optional case-insensitive name search. Wildcards/backslashes are escaped so
  // a user typing "%" matches a literal percent, not the whole pool (default
  // ESCAPE '\' applies to the ILIKE below). Capped so a huge string can't bloat
  // the query.
  const search = req.query.search ? String(req.query.search).trim().slice(0, 100) : '';

  // Optional: exclude players already rostered in a league (draft board view)
  const leagueId = req.query.leagueId ? String(req.query.leagueId) : null;
  if (leagueId && !/^\d+$/.test(leagueId)) {
    return res.status(400).json({ error: 'leagueId must be a positive integer' });
  }
  const availableOnly = req.query.available === 'true' && leagueId;

  // Scoring context for the season projection below: use the named league's
  // rules + current season when given (the draft board passes leagueId), else
  // defaults. This keeps the list's projection identical to the quick-view's.
  let projectionRules = rulesForLeague(null);
  let currentSeasonYear = 2026;
  if (leagueId) {
    const leagueRow = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [Number(leagueId)]);
    if (leagueRow.rows[0]) {
      projectionRules = rulesForLeague(leagueRow.rows[0]);
      if (leagueRow.rows[0].current_season != null) {
        currentSeasonYear = Number(leagueRow.rows[0].current_season);
      }
    }
  }

  // Ordering: by ADP (best pick first, undrafted last) for draft/browse views,
  // else by id. Whitelisted — never interpolate raw user input into SQL.
  const orderBy = req.query.sort === 'adp'
    ? `"adp" ASC NULLS LAST, "id"`
    : `"id"`;

  const params = [];
  const where = [];
  if (position) {
    params.push(position);
    where.push(`"position" = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`"name" ILIKE $${params.length}`);
  }
  if (availableOnly) {
    params.push(Number(leagueId));
    where.push(`"id" NOT IN (SELECT "player_id" FROM "team_players" WHERE "league_id" = $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(PAGE_SIZE, offset);
  const queryText = `
    SELECT "players".*, COUNT(*) OVER() AS total_count
    FROM "players"
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  try {
    const result = await pool.query(queryText, params);
    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    const players = result.rows.map(({ total_count, ...p }) => p);

    // Attach a full-season projection (same math the quick-view uses), computed
    // from prior-season totals under the league's scoring rules, so the draft
    // board's "Season Proj" matches the dialog rather than showing a raw
    // per-game figure. One extra query for the whole page.
    const ids = players.map((p) => p.id);
    const seasonByPlayer = new Map();
    if (ids.length > 0) {
      const seasonRes = await pool.query(
        `SELECT "player_id", "season", "games_played", "stats"
         FROM "player_season_stats" WHERE "player_id" = ANY($1)`,
        [ids]
      );
      for (const row of seasonRes.rows) {
        if (!seasonByPlayer.has(row.player_id)) seasonByPlayer.set(row.player_id, []);
        seasonByPlayer.get(row.player_id).push(row);
      }
    }
    for (const p of players) {
      p.projected_points = projectSeasonPoints({
        seasonRows: seasonByPlayer.get(p.id) || [],
        rules: projectionRules,
        currentSeasonYear,
      });
    }

    res.json({
      players,
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

// GET /api/players/:id/summary[?leagueId=N] — everything the quick-view dialog
// needs in one aggressively-cached call: bio (+ photo, jersey, injury, bye),
// current-season weekly lines with a running fantasy total, and previous-season
// totals. Fantasy points are computed from raw stats under the given league's
// scoring rules (default rules when no leagueId), so the same player reads
// differently in a PPR vs. standard league.
router.get('/:id/summary', requireAuth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'player id must be a positive integer' });
  }
  const playerId = Number(req.params.id);

  const leagueId = req.query.leagueId ? String(req.query.leagueId) : null;
  if (leagueId && !/^\d+$/.test(leagueId)) {
    return res.status(400).json({ error: 'leagueId must be a positive integer' });
  }

  const cacheKey = `${playerId}|${leagueId || 'std'}`;
  const cached = summaryCacheGet(cacheKey);
  if (cached) {
    res.set('Cache-Control', 'private, max-age=30');
    return res.json(cached);
  }

  try {
    const playerResult = await pool.query(`SELECT * FROM "players" WHERE "id" = $1`, [playerId]);
    const player = playerResult.rows[0];
    if (!player) return res.status(404).json({ error: 'player not found' });

    // Scoring rules + current season: the named league's (if valid), else
    // defaults / 2026. The current season decides which weekly lines count as
    // "this season" vs. which roll up under Previous Seasons.
    let rules = rulesForLeague(null);
    let currentSeasonYear = 2026;
    if (leagueId) {
      const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [Number(leagueId)]);
      if (leagueResult.rows[0]) {
        rules = rulesForLeague(leagueResult.rows[0]);
        if (leagueResult.rows[0].current_season != null) {
          currentSeasonYear = Number(leagueResult.rows[0].current_season);
        }
      }
    }

    const weeklyResult = await pool.query(
      `SELECT "season", "week", "stats" FROM "player_stats"
       WHERE "player_id" = $1 ORDER BY "season" DESC, "week"`,
      [playerId]
    );
    const seasonResult = await pool.query(
      `SELECT "season", "games_played", "stats" FROM "player_season_stats"
       WHERE "player_id" = $1 ORDER BY "season" DESC`,
      [playerId]
    );
    const byeWeek = await computeByeWeek(player.nfl_team, currentSeasonYear);

    const payload = buildPlayerSummary({
      player,
      weeklyRows: weeklyResult.rows,
      seasonRows: seasonResult.rows,
      rules,
      byeWeek,
      currentSeasonYear,
    });

    summaryCacheSet(cacheKey, payload);
    res.set('Cache-Control', 'private, max-age=30');
    res.json(payload);
  } catch (error) {
    console.error('Error building player summary', error);
    res.status(500).json({ error: 'failed to fetch player summary' });
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
