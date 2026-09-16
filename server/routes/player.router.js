const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { REG_SEASON_WEEKS } = require('../services/bye.service');
const { requireMember } = require('../services/leagueMembership.service');
const { readPlayersPage } = require('../services/playersPage.service');
const { ACCEPTED_SORT_FIELDS } = require('../services/playerSort');
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

// GET /api/players?page=N&position=QB[&leagueId=N&availability=free_agent]
// Paginated player pool with strict integer validation on `page`. The read
// itself is playersPage.service.js's readPlayersPage (#1497, parent spec
// #1490): this handler only authenticates, coerces these query strings into
// the typed query object that function takes, calls it, and maps a
// refusal's statusCode to a response - unchanged from before that module
// existed.
router.get('/', requireAuth, async (req, res) => {
  const rawPage = req.query.page === undefined ? '1' : String(req.query.page);
  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1) {
    return res.status(400).json({ error: 'page must be a positive integer' });
  }
  const page = Number(rawPage);

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
  // 0045): a set-based sibling to `position` above, so a client can ask for
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
  // the module has one shape to intersect against the league-scoped
  // rosterable gate, regardless of which of the two query params (if
  // either) was used.
  const requestedPositions = positionsParam || (position ? [position] : null);

  // Optional case-insensitive name search. Wildcards/backslashes are escaped so
  // a user typing "%" matches a literal percent, not the whole pool (default
  // ESCAPE '\' applies to the ILIKE the module builds). Capped so a huge
  // string can't bloat the query.
  const search = req.query.search
    ? String(req.query.search).trim().slice(0, 100)
    : '';

  // Optional: exclude players already rostered in a league (draft board view).
  // Kept as the raw digit-string (or null), same as before this module
  // existed: `readPlayersPage` derives its own numeric form, so a
  // `leagueId=0` corner case still gates the same way it always did.
  const leagueId = req.query.leagueId ? String(req.query.leagueId) : null;
  if (leagueId && !/^\d+$/.test(leagueId)) {
    return res
      .status(400)
      .json({ error: 'leagueId must be a positive integer' });
  }
  const availableOnly = Boolean(
    (req.query.available === 'true' || req.query.hideRostered === 'true') && leagueId,
  );
  const availability = req.query.availability
    ? String(req.query.availability)
    : null;

  // view=cards (ADR 0040 slice 6, #1309): the Decision-card-shaped per-row
  // fields (projWeek, ros, ownership, trend, depth, upgrade, weeks[], the
  // rostered availability.teamId/teamName).
  const view = req.query.view === 'cards' ? 'cards' : null;

  // Optional multi-select Bye-week filter, e.g. `byeWeeks=6,9,14`. Format and
  // range validation (comma-separated integers in 1..REG_SEASON_WEEKS) stays
  // inside the module rather than here: the pre-module handler validated it
  // AFTER the availability and view/sort league-requirement checks, and a
  // request that fails more than one of these at once must keep surfacing
  // the same 400 it did before (byte-equal responses, not just byte-equal
  // status codes) - only the module knows where those two checks land in
  // its own sequence, so only it can keep byeWeeks validation behind them.
  const byeWeeksRaw = req.query.byeWeeks !== undefined && req.query.byeWeeks !== ''
    ? String(req.query.byeWeeks)
    : null;

  // Ordering: whitelisted sort key + direction — never interpolate raw user
  // input into SQL. ADP is the default (best pick first, undrafted last).
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  // The accepted `?sort=` values live in one exported list (ACCEPTED_SORT_FIELDS,
  // issue #951); anything else normalises to null and falls through to the
  // stable "id" ordering, silently, exactly as before.
  const sortField = ACCEPTED_SORT_FIELDS.includes(req.query.sort) ? req.query.sort : null;

  try {
    const result = await readPlayersPage(
      {
        userId: req.user.id,
        page,
        requestedPositions,
        search,
        leagueId,
        availableOnly,
        availability,
        view,
        byeWeeksRaw,
        sortField,
        dir,
      },
      { db: pool },
    );
    res.json(result);
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
