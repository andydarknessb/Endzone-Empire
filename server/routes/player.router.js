const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const {
  rulesForLeague,
  buildPlayerSummary,
  projectSeasonPoints,
  getSeasonPositionRank,
  IDP_POSITIONS,
} = require('../services/scoring.service');
const {
  computeByeWeek,
  computeByeWeeks,
  REG_SEASON_WEEKS,
} = require('../services/bye.service');
const { requireMember } = require('../services/leagueMembership.service');

const router = express.Router();

const PAGE_SIZE = 25;
// Individual defender codes are literal Tank01 positions (not the DL/LB/DB
// roster-eligibility GROUP keys used elsewhere — see lineup.service.js's
// POSITION_GROUPS) so a commissioner can filter to exactly "DT" rather than
// the whole defensive-line group. Limited to the codes Tank01 actually
// reports (confirmed live): DE, DT, LB, CB, S, DB — NT/ILB/OLB/FS/SS/DL
// exist in POSITION_GROUPS as a safety net but have ~zero real rows.
const POSITIONS = [
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF',
  'DE',
  'DT',
  'LB',
  'CB',
  'S',
  'DB',
];

// Short-lived in-memory cache for the player summary. Keyed by player + league
// (scoring rules differ per league), so a draft room hammering this endpoint
// serves most reads from memory. TTL is intentionally small — a 30s-stale
// injury/stat line during a live draft is harmless.
const SUMMARY_TTL_MS = 30_000;
const summaryCache = new Map();

function playerIdentityKey(player) {
  const name = String(player.name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const position = String(player.position || '')
    .trim()
    .toUpperCase();
  const team = String(player.nfl_team || '')
    .trim()
    .toUpperCase();
  return `${name}\u0000${position}\u0000${team}`;
}

function dedupePlayerRows(rows) {
  const seen = new Set();
  return rows.filter((player) => {
    const key = playerIdentityKey(player);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

const AVAILABILITY_STATES = new Set([
  'free_agent',
  'waivers',
  'my_team',
  'rostered',
]);

async function attachLeagueAvailability(players, { leagueId, teamId, blanketWaiversOpen }) {
  const identityIds = [
    ...new Set(players.flatMap((player) => player.identity_ids || [player.id])),
  ];
  if (identityIds.length === 0) return;

  const [rosterResult, waiverResult] = await Promise.all([
    pool.query(
      `SELECT "team_id", "player_id" FROM "team_players"
       WHERE "league_id" = $1 AND "player_id" = ANY($2)`,
      [leagueId, identityIds],
    ),
    pool.query(
      `SELECT "player_id", "available_at" FROM "waiver_players"
       WHERE "league_id" = $1 AND "player_id" = ANY($2) AND "available_at" > now()`,
      [leagueId, identityIds],
    ),
  ]);
  const rosterTeamByPlayerId = new Map(
    rosterResult.rows.map((row) => [row.player_id, row.team_id]),
  );
  const waiverByPlayerId = new Map(
    waiverResult.rows.map((row) => [row.player_id, row.available_at]),
  );

  for (const player of players) {
    const identities = player.identity_ids || [player.id];
    const rosterTeamId = identities
      .map((id) => rosterTeamByPlayerId.get(id))
      .find(Boolean);
    if (rosterTeamId) {
      player.availability = {
        state: rosterTeamId === teamId ? 'my_team' : 'rostered',
      };
      continue;
    }
    const availableAt = identities
      .map((id) => waiverByPlayerId.get(id))
      .find(Boolean);
    player.availability = availableAt || blanketWaiversOpen
      ? { state: 'waivers', availableAt }
      : { state: 'free_agent' };
  }
}

// Attaches `projected_points` (the "17-game pace" — a full-season projection
// from prior-season totals under the league's scoring rules, same math the
// quick-view uses) to every player in `list`, mutating each row in place. One
// extra query, scoped to exactly the ids passed in — callers decide how much
// of the pool actually needs this (see the projectionSort branch below: only
// a sort BY this field needs it computed for the whole matching pool before
// the pool can be paginated; everything else only needs it for the page).
async function attachProjectedPoints(
  list,
  { projectionRules, currentSeasonYear },
) {
  const ids = list.map((p) => p.id);
  if (ids.length === 0) return;
  const seasonRes = await pool.query(
    `SELECT "player_id", "season", "games_played", "stats", "fantasy_points"
     FROM "player_season_stats" WHERE "player_id" = ANY($1)`,
    [ids],
  );
  const seasonByPlayer = new Map();
  for (const row of seasonRes.rows) {
    if (!seasonByPlayer.has(row.player_id))
      seasonByPlayer.set(row.player_id, []);
    seasonByPlayer.get(row.player_id).push(row);
  }
  for (const p of list) {
    p.projected_points = projectSeasonPoints({
      seasonRows: seasonByPlayer.get(p.id) || [],
      rules: projectionRules,
      currentSeasonYear,
    });
  }
}

// GET /api/players?page=N&position=QB[&leagueId=N&availability=free_agent]
// Paginated player pool with strict integer validation on `page`.
router.get('/', requireAuth, async (req, res) => {
  const rawPage = req.query.page === undefined ? '1' : String(req.query.page);
  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1) {
    return res.status(400).json({ error: 'page must be a positive integer' });
  }
  const page = Number(rawPage);
  const offset = (page - 1) * PAGE_SIZE;

  const position =
    req.query.position && req.query.position !== 'All'
      ? String(req.query.position).toUpperCase()
      : null;
  if (position && !POSITIONS.includes(position)) {
    return res
      .status(400)
      .json({ error: `position must be one of ${POSITIONS.join(', ')}` });
  }

  // Optional case-insensitive name search. Wildcards/backslashes are escaped so
  // a user typing "%" matches a literal percent, not the whole pool (default
  // ESCAPE '\' applies to the ILIKE below). Capped so a huge string can't bloat
  // the query.
  const search = req.query.search
    ? String(req.query.search).trim().slice(0, 100)
    : '';

  // Optional: exclude players already rostered in a league (draft board view)
  const leagueId = req.query.leagueId ? String(req.query.leagueId) : null;
  if (leagueId && !/^\d+$/.test(leagueId)) {
    return res
      .status(400)
      .json({ error: 'leagueId must be a positive integer' });
  }
  const availableOnly = (req.query.available === 'true' || req.query.hideRostered === 'true') && leagueId;
  const availability = req.query.availability
    ? String(req.query.availability)
    : null;
  if (availability && (!leagueId || !AVAILABILITY_STATES.has(availability))) {
    return res.status(400).json({
      error:
        'availability requires leagueId and must be free_agent, waivers, my_team, or rostered',
    });
  }

  // Optional multi-select Bye-week filter, e.g. `byeWeeks=6,9,14`. Applied
  // across the FULL eligible pool below (not just the current page) — see
  // `needsFullPool`. Comma-separated integers in 1..REG_SEASON_WEEKS; anything
  // else is a 400, same treatment as the other whitelisted inputs above.
  let byeWeeksFilter = [];
  if (req.query.byeWeeks !== undefined && req.query.byeWeeks !== '') {
    const raw = String(req.query.byeWeeks);
    if (!/^\d+(,\d+)*$/.test(raw)) {
      return res
        .status(400)
        .json({ error: 'byeWeeks must be a comma-separated list of integers' });
    }
    byeWeeksFilter = [...new Set(raw.split(',').map(Number))];
    if (byeWeeksFilter.some((week) => week < 1 || week > REG_SEASON_WEEKS)) {
      return res
        .status(400)
        .json({ error: `byeWeeks must be between 1 and ${REG_SEASON_WEEKS}` });
    }
  }

  // Scoring context for the season projection below: use the named league's
  // rules + current season when given (the draft board passes leagueId), else
  // defaults. This keeps the list's projection identical to the quick-view's.
  let projectionRules = rulesForLeague(null);
  let currentSeasonYear = 2026;
  let memberTeam = null;
  let league = null;
  if (leagueId) {
    try {
      memberTeam = await requireMember(pool, {
        leagueId: Number(leagueId),
        userId: req.user.id,
      });
      const leagueRow = await pool.query(
        `SELECT * FROM "leagues" WHERE "id" = $1`,
        [Number(leagueId)],
      );
      league = leagueRow.rows[0] || null;
      if (league) {
        projectionRules = rulesForLeague(league);
        if (league.current_season != null) {
          currentSeasonYear = Number(league.current_season);
        }
      }
    } catch (error) {
      if (error.statusCode)
        return res.status(error.statusCode).json({ error: error.message });
      throw error;
    }
  }
  const blanketWaiversOpen = Boolean(
    league?.waivers_clear_at && new Date(league.waivers_clear_at) > new Date(),
  );

  // Ordering: whitelisted sort key + direction — never interpolate raw user
  // input into SQL. ADP is the default (best pick first, undrafted last).
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const projectionSort = req.query.sort === 'projected_points';
  // Bye is schedule-derived, not a stored column (see the bye_week attachment
  // below), so it can't be an ORDER BY target in this query — like
  // projectionSort, it needs the full matching pool fetched and sorted in JS.
  const byeSort = req.query.sort === 'bye_week';
  let orderBy;
  if (req.query.sort === 'name') {
    orderBy = `"name" ${dir}, "id"`;
  } else if (req.query.sort === 'adp') {
    orderBy = `"adp" ${dir} NULLS LAST, "id"`;
  } else if (req.query.sort === 'position_rank') {
    orderBy = `"position_rank" ${dir} NULLS LAST, "name", "id"`;
  } else if (req.query.sort === 'nfl_team') {
    orderBy = `"nfl_team" ${dir} NULLS LAST, "id"`;
  } else {
    orderBy = `"id"`;
  }
  // Any of these need the full eligible pool assembled and settled (sorted
  // and/or filtered) before pagination, rather than a plain SQL LIMIT/OFFSET
  // page — a computed field (pace, bye) or a post-fetch filter (bye weeks)
  // can't be decided by the database a page at a time.
  const needsFullPool = projectionSort || byeSort || byeWeeksFilter.length > 0;

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
    where.push(`NOT EXISTS (
      SELECT 1 FROM "team_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
    )`);
  }
  if (availability === 'free_agent' && blanketWaiversOpen) {
    where.push('FALSE');
  } else if (availability === 'free_agent') {
    params.push(Number(leagueId));
    where.push(`NOT EXISTS (
      SELECT 1 FROM "team_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
    )`);
    params.push(Number(leagueId));
    where.push(`NOT EXISTS (
      SELECT 1 FROM "waiver_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
        AND "available_at" > now()
    )`);
  } else if (availability === 'waivers' && blanketWaiversOpen) {
    params.push(Number(leagueId));
    where.push(`NOT EXISTS (
      SELECT 1 FROM "team_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
    )`);
  } else if (availability === 'waivers') {
    params.push(Number(leagueId));
    where.push(`NOT EXISTS (
      SELECT 1 FROM "team_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
    )`);
    params.push(Number(leagueId));
    where.push(`EXISTS (
      SELECT 1 FROM "waiver_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
        AND "available_at" > now()
    )`);
  } else if (availability === 'my_team') {
    params.push(Number(leagueId), req.user.id);
    where.push(`EXISTS (
      SELECT 1 FROM "team_players"
      JOIN "teams" ON "teams"."id" = "team_players"."team_id"
      WHERE "team_players"."league_id" = $${params.length - 1}
        AND "teams"."owner_id" = $${params.length}
        AND "team_players"."player_id" = ANY("players"."identity_ids")
    )`);
  } else if (availability === 'rostered') {
    params.push(Number(leagueId), req.user.id);
    where.push(`EXISTS (
      SELECT 1 FROM "team_players"
      JOIN "teams" ON "teams"."id" = "team_players"."team_id"
      WHERE "team_players"."league_id" = $${params.length - 1}
        AND "teams"."owner_id" <> $${params.length}
        AND "team_players"."player_id" = ANY("players"."identity_ids")
    )`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Fallback rank inputs for IDP rows: individual defenders never carry ADP
  // (no market data exists — see adp.service.js), so their position_rank comes
  // from last completed season's stored rollup points instead. Offense/DEF
  // without an ADP stay null: for them a market rank is possible, and mixing
  // market and production ranks in one position's column would mislead.
  params.push(IDP_POSITIONS);
  const idpParam = params.length;
  params.push(currentSeasonYear - 1);
  const rankSeasonParam = params.length;

  if (!needsFullPool) params.push(PAGE_SIZE, offset);
  // The idp_ranks CTE is computed once per query and joined 1:1, NOT filtered
  // by the outer WHERE — ranks must stay global ("LB #5" can't become "#1"
  // because four LBs are rostered in this league). A per-row correlated
  // subquery here was ~15x slower on the unfiltered rank sort.
  const queryText = `
    WITH "player_identities" AS (
      SELECT "source".*,
             ARRAY_AGG("source"."id") OVER (
               PARTITION BY LOWER(REGEXP_REPLACE(TRIM("source"."name"), '\\s+', ' ', 'g')),
                            "source"."position",
                            COALESCE(fn_normalize_nfl_team("source"."nfl_team"), '')
             ) AS "identity_ids",
             ROW_NUMBER() OVER (
               PARTITION BY LOWER(REGEXP_REPLACE(TRIM("source"."name"), '\\s+', ' ', 'g')),
                            "source"."position",
                            COALESCE(fn_normalize_nfl_team("source"."nfl_team"), '')
               ORDER BY ("source"."external_id" IS NULL), "source"."id"
             ) AS "identity_rank"
      FROM "players" AS "source"
    ),
    "canonical_players" AS (
      SELECT * FROM "player_identities" WHERE "identity_rank" = 1
    ),
    "idp_ranks" AS (
      SELECT "pss"."player_id",
             RANK() OVER (
               PARTITION BY "p"."position" ORDER BY "pss"."fantasy_points" DESC
             )::int AS "rank"
      FROM "player_season_stats" "pss"
      JOIN "canonical_players" "p" ON "p"."id" = "pss"."player_id"
      WHERE "pss"."season" = $${rankSeasonParam}
        AND "p"."position" = ANY($${idpParam})
        AND "pss"."fantasy_points" IS NOT NULL
    )
    SELECT "players".*,
           CASE WHEN "players"."adp" IS NOT NULL THEN 1 + (
             SELECT COUNT(*)::int FROM "canonical_players" AS "position_peers"
             WHERE "position_peers"."position" = "players"."position"
               AND "position_peers"."adp" < "players"."adp"
           ) ELSE "idp_ranks"."rank" END AS "position_rank",
           COUNT(*) OVER() AS total_count
    FROM "canonical_players" AS "players"
    LEFT JOIN "idp_ranks" ON "idp_ranks"."player_id" = "players"."id"
    ${whereSql}
    ORDER BY ${orderBy}
    ${needsFullPool ? '' : `LIMIT $${params.length - 1} OFFSET $${params.length}`}
  `;

  try {
    const result = await pool.query(queryText, params);
    const sqlTotal = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    const players = dedupePlayerRows(
      result.rows.map(({ total_count, identity_rank, ...p }) => p),
    );

    // Bye week is schedule-derived, not a stored column — attach it to every
    // row now (whatever `players` currently holds: the full matching pool when
    // Bye/pace sort or a Bye filter is in play, or just this one SQL-paginated
    // page otherwise) so the filter/sort below can see it. Cheap regardless of
    // pool size: one batched query keyed by distinct NFL team, not by player.
    const nflTeams = [
      ...new Set(players.map((p) => p.nfl_team).filter(Boolean)),
    ];
    const byeByTeam = await computeByeWeeks(nflTeams, currentSeasonYear);
    for (const p of players) {
      p.bye_week = byeByTeam.get(p.nfl_team) ?? null;
    }

    // Bye filter: a player with an unknown bye week can't match an explicit
    // week selection, so it's excluded rather than treated as a wildcard.
    let settled = players;
    if (byeWeeksFilter.length > 0) {
      const weekSet = new Set(byeWeeksFilter);
      settled = settled.filter(
        (p) => p.bye_week != null && weekSet.has(p.bye_week),
      );
    }

    // Nulls sort last regardless of direction — folded into the comparator
    // itself (not a post-hoc `.reverse()`, which would also flip the nulls to
    // the front on a descending sort). Shared by every computed-field sort
    // below (mirrors the harness's own simulation in draftHarness.ts).
    const nullsLastComparator = (getValue, direction) => (a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      const aMissing = av == null || !Number.isFinite(av);
      const bMissing = bv == null || !Number.isFinite(bv);
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      if (!aMissing && av !== bv) return direction * (av - bv);
      return a.id - b.id;
    };
    if (byeSort) {
      settled = [...settled].sort(
        nullsLastComparator((p) => p.bye_week, dir === 'DESC' ? -1 : 1),
      );
    }

    // The SQL total_count reflects the outer WHERE only — once a Bye filter
    // narrows `settled` further in JS, the page count has to come from there.
    const total = needsFullPool ? settled.length : sqlTotal;

    // Sorting BY the projection needs it computed for the WHOLE matching pool
    // first (the sort has to settle before the page can be sliced); every
    // other sort/filter only needs it for the page actually being returned —
    // the season-stats query and the math both cost per player, so deferring
    // this until after the page is known keeps that cost proportional to
    // what's rendered, not to the whole eligible pool.
    if (projectionSort) {
      await attachProjectedPoints(settled, {
        projectionRules,
        currentSeasonYear,
      });
      settled.sort(
        nullsLastComparator(
          (p) => Number(p.projected_points),
          dir === 'DESC' ? -1 : 1,
        ),
      );
    }

    const pagePlayers = needsFullPool
      ? settled.slice(offset, offset + PAGE_SIZE)
      : settled;
    if (!projectionSort) {
      await attachProjectedPoints(pagePlayers, {
        projectionRules,
        currentSeasonYear,
      });
    }

    if (memberTeam)
      await attachLeagueAvailability(pagePlayers, {
        leagueId: Number(leagueId),
        teamId: memberTeam.id,
        blanketWaiversOpen,
      });
    const responsePlayers = pagePlayers.map(
      ({ identity_ids, ...player }) => player,
    );
    let context = null;
    if (memberTeam && league) {
      const rosterCountResult = await pool.query(
        `SELECT COUNT(*)::int AS "roster_count" FROM "team_players" WHERE "team_id" = $1`,
        [memberTeam.id],
      );
      context = {
        leagueId: Number(leagueId),
        leagueName: league.name,
        rosterCount: Number(rosterCountResult.rows[0]?.roster_count || 0),
        rosterCapacity:
          league.roster_limit == null ? null : Number(league.roster_limit),
        waiverType: league.waiver_type || null,
        faabRemaining:
          league.waiver_type === 'faab' ? memberTeam.faab_remaining : null,
        waiverPriority:
          league.waiver_type === 'priority' ? memberTeam.waiver_priority : null,
      };
    }

    res.json({
      players: responsePlayers,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
      context,
    });
  } catch (error) {
    if (error.statusCode)
      return res.status(error.statusCode).json({ error: error.message });
    console.error('Error on GET players query', error);
    res.status(500).json({ error: 'failed to fetch players' });
  }
});

// GET /api/players/:id — player detail: weekly stat lines, fantasy points by
// week, season totals, and a per-game projection (season average)
router.get('/:id', requireAuth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res
      .status(400)
      .json({ error: 'player id must be a positive integer' });
  }
  const playerId = Number(req.params.id);
  try {
    const playerResult = await pool.query(
      `SELECT * FROM "players" WHERE "id" = $1`,
      [playerId],
    );
    const player = playerResult.rows[0];
    if (!player) return res.status(404).json({ error: 'player not found' });

    const weeklyResult = await pool.query(
      `SELECT "season", "week", "stats", "fantasy_points"
       FROM "player_stats" WHERE "player_id" = $1
       ORDER BY "season" DESC, "week"`,
      [playerId],
    );
    const weekly = weeklyResult.rows.map((r) => ({
      ...r,
      fantasy_points: Number(r.fantasy_points),
    }));
    const latestSeason = weekly.length > 0 ? weekly[0].season : null;
    const seasonWeeks = weekly.filter((w) => w.season === latestSeason);
    const totalPoints = seasonWeeks.reduce(
      (sum, w) => sum + w.fantasy_points,
      0,
    );
    res.json({
      player,
      weekly,
      seasonTotals:
        latestSeason === null
          ? null
          : {
              season: latestSeason,
              games: seasonWeeks.length,
              points: Math.round(totalPoints * 100) / 100,
              projectedPoints:
                seasonWeeks.length > 0
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
    return res
      .status(400)
      .json({ error: 'player id must be a positive integer' });
  }
  const playerId = Number(req.params.id);

  const leagueId = req.query.leagueId ? String(req.query.leagueId) : null;
  if (leagueId && !/^\d+$/.test(leagueId)) {
    return res
      .status(400)
      .json({ error: 'leagueId must be a positive integer' });
  }

  try {
    if (leagueId) await requireMember(pool, { leagueId: Number(leagueId), userId: req.user.id });
    const cacheKey = `${playerId}|${leagueId || 'std'}`;
    const cached = summaryCacheGet(cacheKey);
    if (cached) {
      res.set('Cache-Control', 'private, max-age=30');
      return res.json(cached);
    }
    const playerResult = await pool.query(
      `SELECT * FROM "players" WHERE "id" = $1`,
      [playerId],
    );
    const player = playerResult.rows[0];
    if (!player) return res.status(404).json({ error: 'player not found' });

    // Scoring rules + current season: the named league's (if valid), else
    // defaults / 2026. The current season decides which weekly lines count as
    // "this season" vs. which roll up under Previous Seasons.
    let rules = rulesForLeague(null);
    let currentSeasonYear = 2026;
    if (leagueId) {
      const leagueResult = await pool.query(
        `SELECT * FROM "leagues" WHERE "id" = $1`,
        [Number(leagueId)],
      );
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
      [playerId],
    );
    const seasonResult = await pool.query(
      `SELECT "season", "games_played", "stats" FROM "player_season_stats"
       WHERE "player_id" = $1 ORDER BY "season" DESC`,
      [playerId],
    );
    const byeWeek = await computeByeWeek(player.nfl_team, currentSeasonYear);

    // Points-based rank within the position for the latest completed season
    // (rows arrive season DESC, so find() takes the newest one).
    const lastCompletedRow =
      seasonResult.rows.find((r) => Number(r.season) < currentSeasonYear) ||
      null;
    const rankInfo = lastCompletedRow
      ? await getSeasonPositionRank(
          playerId,
          player.position,
          Number(lastCompletedRow.season),
        )
      : null;

    const payload = buildPlayerSummary({
      player,
      weeklyRows: weeklyResult.rows,
      seasonRows: seasonResult.rows,
      rules,
      byeWeek,
      currentSeasonYear,
      posRank: rankInfo
        ? { season: Number(lastCompletedRow.season), ...rankInfo }
        : null,
    });

    summaryCacheSet(cacheKey, payload);
    res.set('Cache-Control', 'private, max-age=30');
    res.json(payload);
  } catch (error) {
    console.error('Error building player summary', error);
    res.status(500).json({ error: 'failed to fetch player summary' });
  }
});

// The old POST /api/players/draft/:playerId route was deleted with #782: it was
// dead (nothing in src/, tests/ or scripts/ called it, re-confirmed on the
// branch), and a live Pick lands only through the draft socket, the offline route
// and the clock, all of which now reach the one seam pick.service.landPick.

module.exports = router;
