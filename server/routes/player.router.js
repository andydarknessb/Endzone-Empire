const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const {
  rulesForLeague,
  projectSeasonPoints,
  IDP_POSITIONS,
} = require('../services/scoring.service');
const {
  computeByeWeeks,
  REG_SEASON_WEEKS,
} = require('../services/bye.service');
const { requireMember } = require('../services/leagueMembership.service');
const { rosterablePositions } = require('../services/lineup.service');
const irPolicy = require('../services/irPolicy.service');
const projectionService = require('../services/projection.service');
const { ACCEPTED_SORT_FIELDS, LEAGUE_SCOPED_SORT_FIELDS } = require('../services/playerSort');
const { deriveLeaguePhase, LEAGUE_PHASE } = require('../services/leaguePhase');
const { isPickemOnly } = require('../services/leagueType');
// Kept whole (not destructured): a test seam a route test replaces with
// `t.mock.method`, same convention as playerCard.service.js's own
// cross-module calls - a destructured binding is captured at require time
// and can no longer be mocked afterwards.
const playerCardService = require('../services/playerCard.service');
// #1312: the watchlist writes/reads PUT/DELETE /:id/watch and the
// view=cards/`:id/card` `watching` field go through.
const playerWatchlistService = require('../services/playerWatchlist');

const router = express.Router();

const PAGE_SIZE = 25;
// Individual defender codes are literal Tank01 positions (not the DL/LB/DB
// roster-eligibility GROUP keys used elsewhere — see lineup.service.js's
// POSITION_GROUPS) so a commissioner can filter to exactly "DT" rather than
// the whole defensive-line group. DE, DT, LB, CB, S, DB are the codes Tank01
// actually reports (confirmed live); DL, NT, ILB, OLB, FS and SS carry
// ~zero real rows today but are validated too (formal review f1, #1419):
// the Players page's own IDP group chips (DL, LB, DB) send `positions` as
// the WHOLE expanded POSITION_GROUPS set for that key — DL,DE,DT,NT for DL,
// LB,ILB,OLB for LB, DB,CB,S,FS,SS for DB — so a rare code the client's
// expandEligibility legitimately sent can't 400 just because Tank01 hasn't
// produced a row for it yet.
const POSITIONS = [
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF',
  'DE',
  'DT',
  'NT',
  'DL',
  'LB',
  'ILB',
  'OLB',
  'CB',
  'S',
  'FS',
  'SS',
  'DB',
];

// Short-lived in-memory cache for GET /:id/card, the Decision card's payload
// in every context including the Draft room's own (#1306, #1313) - keyed by
// player + league + caller team + week below, since the payload is per-
// CALLER, not per-league. `buildPlayerSummary` (scoring.service.js) is one of
// its producers, called from playerCard.service.js for the season/game-log
// rows; the /:id/summary route that used to read it directly is gone (#1313,
// the Draft room's last caller). TTL is intentionally small — a 30s-stale
// injury/stat line is harmless.
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

// `watching` (#1312) is enrichment, not core data - the same "best-effort"
// tier the caller's own roster read already gets on the client
// (PlayerManagement.jsx's fetchRoster: "a failed ... read only means ...
// never a page-level error"). A watchlist read failure degrades to `false`/
// an empty page rather than failing the whole card or list response.
async function watchlistIsWatchingSafe({ teamId, playerId }) {
  try {
    return await playerWatchlistService.isWatching({ teamId, playerId });
  } catch (error) {
    console.error('Error reading watchlist state', error);
    return false;
  }
}

async function watchlistWatchingForManySafe({ teamId, playerIds }) {
  try {
    return await playerWatchlistService.watchingForMany({ teamId, playerIds });
  } catch (error) {
    console.error('Error reading watchlist state', error);
    return new Map();
  }
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

  // Optional multi-position filter, e.g. `positions=RB,WR,TE` (#1418, ADR
  // 0044): a set-based sibling to `position` above, so a client can ask for
  // several codes in one request. Validated against the same POSITIONS
  // whitelist and refused with the same 400 shape on a bad code. `position`
  // keeps working unchanged; when both are given, `positions` wins.
  let positionsParam = null;
  if (req.query.positions !== undefined && req.query.positions !== '') {
    const codes = String(req.query.positions)
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const invalid = codes.find((c) => !POSITIONS.includes(c));
    if (invalid) {
      return res
        .status(400)
        .json({ error: `position must be one of ${POSITIONS.join(', ')}` });
    }
    // An all-empty-code set (e.g. `positions=,`) carries nothing to filter
    // by, so it is treated as absent - the same "All" `positions` omitted
    // gets - rather than binding an empty ANY() array (formal review f2).
    if (codes.length > 0) positionsParam = [...new Set(codes)];
  }
  // The set the caller asked for, or `null` for "All" - folded together so
  // the league-scoped rosterable gate below has one shape to intersect
  // against regardless of which of the two query params (if either) was used.
  const requestedPositions = positionsParam || (position ? [position] : null);

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

  // view=cards (ADR 0040 slice 6, #1309): the Decision-card-shaped per-row
  // fields (projWeek, ros, ownership, trend, depth, upgrade, weeks[], the
  // rostered availability.teamId/teamName). Both this and the `upgrade` sort
  // key are meaningless outside the caller's own league and lineup (Ruling
  // item 10), so both require leagueId up front, in the style of the
  // `availability` check above.
  const view = req.query.view === 'cards' ? 'cards' : null;
  if ((view === 'cards' || LEAGUE_SCOPED_SORT_FIELDS.includes(req.query.sort)) && !leagueId) {
    return res
      .status(400)
      .json({ error: 'view=cards and sort=upgrade require leagueId' });
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

  // ADR 0045 / CONTEXT.md's Rosterable position: a pool query carrying a
  // league returns only players at that league's rosterable positions - the
  // requested set (or "All") intersected with the union of every starting
  // slot's eligible positions in the league's roster template. `null` here
  // means no league, or a missing/empty template: no gate, same as today.
  const rosterable = rosterablePositions(league);
  let effectivePositions = null;
  if (requestedPositions && rosterable) {
    effectivePositions = requestedPositions.filter((p) => rosterable.has(p));
  } else if (requestedPositions) {
    effectivePositions = requestedPositions;
  } else if (rosterable) {
    effectivePositions = [...rosterable];
  }

  // Ordering: whitelisted sort key + direction — never interpolate raw user
  // input into SQL. ADP is the default (best pick first, undrafted last).
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  // The accepted `?sort=` values live in one exported list (ACCEPTED_SORT_FIELDS,
  // issue #951); anything else normalises to null and falls through to the
  // stable "id" ordering below, silently, exactly as before. Both booleans and
  // the ORDER BY chain read `sortField` so the accepted set has a single source
  // of truth rather than being re-stated at each `req.query.sort === ...`.
  const sortField = ACCEPTED_SORT_FIELDS.includes(req.query.sort) ? req.query.sort : null;
  const projectionSort = sortField === 'projected_points';
  // Bye is schedule-derived, not a stored column (see the bye_week attachment
  // below), so it can't be an ORDER BY target in this query — like
  // projectionSort, it needs the full matching pool fetched and sorted in JS.
  const byeSort = sortField === 'bye_week';
  // Like byeSort/projectionSort: Upgrade is computed per candidate against
  // the caller's own lineup, not a stored column, so it also needs the full
  // matching pool assembled and sorted in JS before pagination (Ruling
  // item 2). Always descending with nulls last - never toggled by `dir`.
  const upgradeSort = sortField === 'upgrade';
  let orderBy;
  if (sortField === 'name') {
    orderBy = `"name" ${dir}, "id"`;
  } else if (sortField === 'adp') {
    orderBy = `"adp" ${dir} NULLS LAST, "id"`;
  } else if (sortField === 'position_rank') {
    orderBy = `"position_rank" ${dir} NULLS LAST, "name", "id"`;
  } else if (sortField === 'nfl_team') {
    orderBy = `"nfl_team" ${dir} NULLS LAST, "id"`;
  } else {
    orderBy = `"id"`;
  }
  // Any of these need the full eligible pool assembled and settled (sorted
  // and/or filtered) before pagination, rather than a plain SQL LIMIT/OFFSET
  // page — a computed field (pace, bye) or a post-fetch filter (bye weeks)
  // can't be decided by the database a page at a time.
  const needsFullPool = projectionSort || byeSort || upgradeSort || byeWeeksFilter.length > 0;

  const params = [];
  const where = [];
  if (effectivePositions) {
    params.push(effectivePositions);
    where.push(`"position" = ANY($${params.length})`);
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

    // sort=upgrade (Ruling item 2): a best-ball league has no Upgrade concept
    // (ADR 0040), so it falls back to the projected_points ordering above,
    // still computed for ordering only and never returned (item 7). Outside
    // best ball, the full eligible pool's ids go to `upgradesFor` in ONE
    // call; rows sort by upgrade.points descending, nulls last, then id -
    // never toggled by `dir`.
    const upgradeBestBallFallback = upgradeSort && Boolean(league && league.best_ball);
    if (upgradeBestBallFallback) {
      await attachProjectedPoints(settled, {
        projectionRules,
        currentSeasonYear,
      });
      settled.sort(nullsLastComparator((p) => Number(p.projected_points), -1));
    } else if (upgradeSort) {
      const upgrades = await playerCardService.upgradesFor({
        league,
        team: memberTeam,
        season: currentSeasonYear,
        week: league.current_week,
        playerIds: settled.map((p) => p.id),
      });
      for (const p of settled) p.upgrade = upgrades.get(p.id) ?? null;
      settled.sort(nullsLastComparator((p) => p.upgrade?.points, -1));
    }

    const pagePlayers = needsFullPool
      ? settled.slice(offset, offset + PAGE_SIZE)
      : settled;
    if (!projectionSort && !upgradeBestBallFallback && view !== 'cards') {
      // upgradeBestBallFallback already computed projected_points for the
      // FULL pool above, and pagePlayers is a slice of those same objects -
      // re-fetching here would just re-set the same value from a second
      // query. view=cards never returns projected_points either way (item
      // 7, ADR 0040 - Pool projection leaves the list), so there's no reason
      // to pay for the query just to strip the field back out below.
      await attachProjectedPoints(pagePlayers, {
        projectionRules,
        currentSeasonYear,
      });
    }

    if (memberTeam && view !== 'cards') {
      await attachLeagueAvailability(pagePlayers, {
        leagueId: Number(leagueId),
        teamId: memberTeam.id,
        blanketWaiversOpen,
      });
    }

    // view=cards (#1309): the Decision-card-shaped per-row fields, all scoped
    // to just this page - `memberTeam`/`league` are guaranteed here since
    // view=cards required leagueId up front, which always resolves both or
    // throws before this point is ever reached.
    if (view === 'cards' && memberTeam && league) {
      const byeWeekByPlayerId = new Map(pagePlayers.map((p) => [p.id, p.bye_week]));
      const seasonEnd = projectionService.lastPlayoffWeek(league);

      // #1403: the page's Weekly projections (current week through 18) are
      // read ONCE, two queries for the whole page, and handed to both the
      // weeks bar and the rest-of-season total. Before this each of those
      // read every week on its own (two queries per week, each), and on a
      // cold cache both generated the same missing rows concurrently.
      const pageWeeks = [];
      for (let wk = league.current_week; wk <= 18; wk++) pageWeeks.push(wk);
      const runsByWeek = await projectionService.getWeeklyProjectionsForWeeks({
        season: currentSeasonYear,
        weeks: pageWeeks,
        league,
        playerIds: pagePlayers.map((p) => p.id),
      });

      const [availabilityMap, weeksByPlayer, rosMap, watchingMap] = await Promise.all([
        playerCardService.availabilityForMany({ league, team: memberTeam, players: pagePlayers }),
        playerCardService.buildWeeksForPage({
          league,
          players: pagePlayers,
          season: currentSeasonYear,
          currentWeek: league.current_week,
          byeWeekByPlayerId,
          runsByWeek,
        }),
        projectionService.getRestOfSeason(pagePlayers.map((p) => p.id), Number(leagueId), { runsByWeek }),
        // #1312 Ruling: `watching` rides the SAME view=cards row every other
        // caller-scoped field does, one batched read for the whole page.
        watchlistWatchingForManySafe({ teamId: memberTeam.id, playerIds: pagePlayers.map((p) => p.id) }),
      ]);

      for (const p of pagePlayers) {
        p.availability = availabilityMap.get(p.id)
          || { state: 'free_agent', teamId: null, teamName: null, availableAt: null };
        const weeks = weeksByPlayer.get(p.id) || [];
        p.weeks = weeks;
        p.projWeek = weeks[0] || null;
        const ros = rosMap.get(p.id) || { total: 0, perGame: 0 };
        p.ros = { points: ros.total, perGame: ros.perGame, posRank: null, throughWeek: seasonEnd };
        p.ownership = null;
        p.trend = null;
        p.depth = null;
        p.watching = watchingMap.get(p.id) ?? false;
      }

      // `upgrade` per row (item 1): best ball is always null; otherwise reuse
      // the full-pool computation above when sort=upgrade already produced it
      // for every one of these same rows, else compute fresh for just the page.
      if (league.best_ball) {
        for (const p of pagePlayers) p.upgrade = null;
      } else if (!(upgradeSort && !upgradeBestBallFallback)) {
        const upgrades = await playerCardService.upgradesFor({
          league,
          team: memberTeam,
          season: currentSeasonYear,
          week: league.current_week,
          playerIds: pagePlayers.map((p) => p.id),
        });
        for (const p of pagePlayers) p.upgrade = upgrades.get(p.id) ?? null;
      }
    }

    const responsePlayers = pagePlayers.map(({ identity_ids, ...player }) => {
      // Pool projection never appears under view=cards (item 7, ADR 0040) -
      // even when computed above for the best-ball upgrade-sort fallback.
      // Outside view=cards, `upgrade` is a sort-computation side effect, not
      // part of that shape, so it's stripped there instead.
      if (view === 'cards') {
        const { projected_points, ...rest } = player;
        return rest;
      }
      const { upgrade, ...rest } = player;
      return rest;
    });
    let context = null;
    if (memberTeam && league) {
      const rosterCountResult = await pool.query(
        `SELECT COUNT(*)::int AS "roster_count" FROM "team_players" WHERE "team_id" = $1`,
        [memberTeam.id],
      );
      // The capacity the server actually enforces for THIS viewer's team, not
      // the IR-inclusive roster limit column. The context is already scoped to
      // memberTeam (rosterCount is that team's count), so the number to publish
      // is that same team's irPolicy.rosterCapacity: draftRosterSize plus its
      // filled IR slots. Reading the stored limit here published a ceiling
      // larger than the gate whenever an IR slot sat empty (#945).
      const rosterCapacity = await irPolicy.rosterCapacity(pool, {
        league,
        teamId: memberTeam.id,
      });
      context = {
        leagueId: Number(leagueId),
        leagueName: league.name,
        rosterCount: Number(rosterCountResult.rows[0]?.roster_count || 0),
        rosterCapacity,
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

// GET /api/players/:id/card?leagueId=N — the Decision card payload for every
// Availability context (free agent, on waivers, rostered by another team, or
// on the caller's own team, #1306, ADR 0040 slice 3) and for the Draft
// room's own `draft` context (#1313, not an Availability state). Every
// projected number is the Weekly projection under the league's own scoring
// (never Pool projection); `upgrade` is null in a best-ball league and for a
// player already on the caller's roster. Supersedes `/summary`, deleted with
// the Draft room's own PlayerQuickView copy (#1313), its last caller.
//
// `requireMember` runs BEFORE the cache is ever read (a risk-review catch,
// #1306): the payload is per-CALLER, not per-league (availability.state,
// faabRemaining, waiverPriority, rosterCount/Capacity and upgrade all read
// the caller's own team), so serving a cache hit to an unauthenticated-for-
// this-league caller would both skip the 403 and leak one manager's FAAB
// budget and roster context to another. The cache key is scoped by the
// caller's own team id and by week for the same reason - a key of player+
// league alone is a cross-team leak even AFTER the membership check.
router.get('/:id/card', requireAuth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res
      .status(400)
      .json({ error: 'player id must be a positive integer' });
  }
  const playerId = Number(req.params.id);

  const leagueId = req.query.leagueId ? String(req.query.leagueId) : null;
  if (!leagueId || !/^\d+$/.test(leagueId)) {
    return res
      .status(400)
      .json({ error: 'leagueId must be a positive integer' });
  }

  const rawWeek = req.query.week;
  if (
    rawWeek !== undefined
    && (!/^\d+$/.test(String(rawWeek)) || Number(rawWeek) < 1 || Number(rawWeek) > REG_SEASON_WEEKS)
  ) {
    return res.status(400).json({ error: `week must be between 1 and ${REG_SEASON_WEEKS}` });
  }
  const week = rawWeek !== undefined ? Number(rawWeek) : undefined;

  try {
    const team = await requireMember(pool, { leagueId: Number(leagueId), userId: req.user.id });
    const cacheKey = `card:${playerId}|${leagueId}|${team.id}|${week ?? 'cur'}`;
    const cached = summaryCacheGet(cacheKey);
    if (cached) {
      // #1312 risk review: `watching` is deliberately read fresh here rather
      // than baked into the cached value below - a PUT/DELETE /:id/watch
      // never invalidates this 30s summary cache, so a cached `watching`
      // would show the manager's own Watch/Unwatch as reverted for up to
      // 30s on the very next card open (reproduced in review).
      const watching = await watchlistIsWatchingSafe({ teamId: team.id, playerId });
      res.set('Cache-Control', 'private, max-age=30');
      return res.json({ ...cached, watching });
    }

    const payload = await playerCardService.getPlayerCard({
      leagueId: Number(leagueId),
      userId: req.user.id,
      playerId,
      week,
    });
    summaryCacheSet(cacheKey, payload);

    // #1312 Ruling: `watching` rides the same #1306 card payload every
    // Availability context reads - attached at the ROUTE (not
    // playerCard.service.js, outside this ticket's Scope) using the SAME
    // team this handler already resolved above, and read fresh on every
    // request rather than cached (see the cache-hit branch above).
    const watching = await watchlistIsWatchingSafe({ teamId: team.id, playerId });
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ ...payload, watching });
  } catch (error) {
    if (error.statusCode)
      return res.status(error.statusCode).json({ error: error.message });
    console.error('Error building player card', error);
    res.status(500).json({ error: 'failed to fetch player card' });
  }
});

// Shared validation for PUT/DELETE /:id/watch (formal review f6): both
// handlers accept the same two inputs and refuse them the same way, so one
// parser is the single source rather than two copies free to drift. Writes
// the 400 itself and returns null on a refusal, so a caller's own early
// `return` is the only control flow it needs.
function parseWatchParams(req, res) {
  if (!/^\d+$/.test(req.params.id)) {
    res.status(400).json({ error: 'player id must be a positive integer' });
    return null;
  }
  const leagueId = req.query.leagueId ? String(req.query.leagueId) : null;
  if (!leagueId || !/^\d+$/.test(leagueId)) {
    res.status(400).json({ error: 'leagueId must be a positive integer' });
    return null;
  }
  return { playerId: Number(req.params.id), leagueId: Number(leagueId) };
}

// PUT/DELETE /api/players/:id/watch?leagueId=N — add/remove this player from
// the caller's own team-scoped watchlist (#1312, ADR 0040 follow-up, grill
// ruling Q6). `requireMember` resolves the caller's own team the same way
// every other league-scoped players route does, so a watch is always the
// CALLER's team's watch, never any other team's - and a manager with a team
// in two leagues keeps two independent watch lists (CONTEXT.md's Team).
// Idempotent: watching an already-watched player, or unwatching one never
// watched, is a 200 with the settled state, not an error.
router.put('/:id/watch', requireAuth, async (req, res) => {
  const params = parseWatchParams(req, res);
  if (!params) return;
  const { playerId, leagueId } = params;
  try {
    const team = await requireMember(pool, { leagueId, userId: req.user.id });
    const outcome = await playerWatchlistService.watch({ teamId: team.id, playerId });
    res.json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    // A player_id foreign-key violation means no such player, the same
    // translation joinLeague's own unique-violation catch makes for its code.
    if (error.code === '23503') return res.status(404).json({ error: 'player not found' });
    console.error('Error watching player', error);
    res.status(500).json({ error: 'failed to watch player' });
  }
});

router.delete('/:id/watch', requireAuth, async (req, res) => {
  const params = parseWatchParams(req, res);
  if (!params) return;
  const { playerId, leagueId } = params;
  try {
    const team = await requireMember(pool, { leagueId, userId: req.user.id });
    const outcome = await playerWatchlistService.unwatch({ teamId: team.id, playerId });
    res.json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error unwatching player', error);
    res.status(500).json({ error: 'failed to unwatch player' });
  }
});

// GET /api/players/:id/in-your-leagues — the viewer's own leagues, each with
// this player's Availability there (#1357, parent #1354). The viewer's
// leagues are the same `"teams"."owner_id"` join `GET /api/league/` uses
// (league.router.js:294): a commissioner with no team in a league has no
// Availability to name there, so that league is simply absent, same as a
// pre-draft league (via `deriveLeaguePhase`). `availabilityFor` is the
// Decision card's own function (playerCard.service.js) — same four states,
// same rostering-team identity — projected down to the three fields this
// response actually carries; its wider fields (rosterCapacity, faabRemaining,
// ...) are the Decision card's business, not this one's.
router.get('/:id/in-your-leagues', requireAuth, async (req, res) => {
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

    const leaguesResult = await pool.query(
      `SELECT "leagues".*, "teams"."id" AS "team_id",
              "teams"."faab_remaining" AS "team_faab_remaining",
              "teams"."waiver_priority" AS "team_waiver_priority"
         FROM "leagues"
         JOIN "teams" ON "teams"."league_id" = "leagues"."id"
        WHERE "teams"."owner_id" = $1
        ORDER BY "leagues"."name" ASC`,
      [req.user.id],
    );

    const leagues = await Promise.all(
      leaguesResult.rows
        // A pick'em-only league has no roster (CONTEXT.md: In your leagues
        // covers leagues "whose rosters exist"; Membership: a pick'em-only
        // member holds none), so it never has an Availability to name —
        // `deriveLeaguePhase` never resolves it to PRE_DRAFT (it is
        // IN_SEASON/COMPLETE from creation, leaguePhase.js's isPickemOnly
        // branch), so that filter alone would leave it in.
        .filter((league) => deriveLeaguePhase(league) !== LEAGUE_PHASE.PRE_DRAFT && !isPickemOnly(league))
        .map(async (league) => {
          const team = {
            id: league.team_id,
            faab_remaining: league.team_faab_remaining,
            waiver_priority: league.team_waiver_priority,
          };
          const availability = await playerCardService.availabilityFor({ league, team, player });
          return {
            leagueId: league.id,
            leagueName: league.name,
            phase: deriveLeaguePhase(league),
            availability: {
              state: availability.state,
              teamId: availability.teamId,
              teamName: availability.teamName,
            },
          };
        })
    );

    res.set('Cache-Control', 'private, no-store');
    res.json({ leagues });
  } catch (error) {
    if (error.statusCode)
      return res.status(error.statusCode).json({ error: error.message });
    console.error('Error building in-your-leagues availability', error);
    res.status(500).json({ error: 'failed to fetch in-your-leagues availability' });
  }
});

// The old POST /api/players/draft/:playerId route was deleted with #782: it was
// dead (nothing in src/, tests/ or scripts/ called it, re-confirmed on the
// branch), and a live Pick lands only through the draft socket, the offline route
// and the clock, all of which now reach the one seam pick.service.landPick.

module.exports = router;
