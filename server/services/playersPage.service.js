const pool = require('../modules/pool');
const { rulesForLeague } = require('./scoringRules');
const { IDP_POSITIONS } = require('./feedSyncRuns.service');
const { projectSeasonPoints } = require('./seasonSummary.service');
const { computeByeWeeks, REG_SEASON_WEEKS } = require('./bye.service');
const { requireMember, MembershipError } = require('./leagueMembership.service');
const { rosterablePositions } = require('./lineup.service');
const irPolicy = require('./irPolicy.service');
const projectionService = require('./projection.service');
const { LEAGUE_SCOPED_SORT_FIELDS } = require('./playerSort');
// Kept whole (not destructured): the same test seam convention
// playerCard.service.js and player.router.js already use for their own
// cross-module calls - a destructured binding is captured at require time
// and can no longer be mocked afterwards.
const playerCardService = require('./playerCard.service');
const playerWatchlistService = require('./playerWatchlist');

/**
 * The Players page's one read (CONTEXT.md's Players page; parent spec #1490):
 * for one manager, in one league or none, the paginated, sorted, filtered
 * player list with Availability, Rosterable-position gating and roster
 * context - exactly what `GET /api/players` returned before this module
 * existed. `readPlayersPage(query, { db })` is the whole read; the route
 * (player.router.js) only authenticates, coerces the request's query
 * strings into the `query` shape this takes, calls this, and maps a
 * refusal's `statusCode` to a response. No SQL, sort field, filter or
 * response shape changed in this move (parent spec #1490: "no wire change") -
 * every response, success or refusal, is byte-equal to before for the same
 * input.
 *
 * Refusals throw `PlayersPageError`, a typed error carrying a `code` field
 * (ADR 0032's pattern for a refusal that names itself) alongside `message`
 * (the sentence a manager reads) and `statusCode` (the number the route
 * sends, 400 or 403). `code` is for the route - and this module's own
 * "green for the wrong reason" tests - to branch on; the route still emits
 * today's `{ error: message }` envelope rather than putting `code` on the
 * wire, since this endpoint is not one of ADR 0032's converted emitters and
 * this move changes no response.
 */
class PlayersPageError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const PAGE_SIZE = 25;

const AVAILABILITY_STATES = new Set([
  'free_agent',
  'waivers',
  'my_team',
  'rostered',
]);

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

// `watching` (#1312) is enrichment, not core data - the same "best-effort"
// tier the caller's own roster read already gets on the client
// (PlayerManagement.jsx's fetchRoster: "a failed ... read only means ...
// never a page-level error"). A watchlist read failure degrades to an empty
// map rather than failing the whole page.
async function watchlistWatchingForManySafe({ teamId, playerIds }) {
  try {
    return await playerWatchlistService.watchingForMany({ teamId, playerIds });
  } catch (error) {
    console.error('Error reading watchlist state', error);
    return new Map();
  }
}

async function attachLeagueAvailability(db, players, { leagueId, teamId, blanketWaiversOpen }) {
  const identityIds = [
    ...new Set(players.flatMap((player) => player.identity_ids || [player.id])),
  ];
  if (identityIds.length === 0) return;

  const [rosterResult, waiverResult] = await Promise.all([
    db.query(
      `SELECT "team_id", "player_id" FROM "team_players"
       WHERE "league_id" = $1 AND "player_id" = ANY($2)`,
      [leagueId, identityIds],
    ),
    db.query(
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

// Attaches `projected_points` (the "17-game pace" - a full-season projection
// from prior-season totals under the league's scoring rules, same math the
// quick-view uses) to every player in `list`, mutating each row in place. One
// extra query, scoped to exactly the ids passed in - callers decide how much
// of the pool actually needs this (see the projectionSort branch below: only
// a sort BY this field needs it computed for the whole matching pool before
// the pool can be paginated; everything else only needs it for the page).
async function attachProjectedPoints(
  db,
  list,
  { projectionRules, currentSeasonYear },
) {
  const ids = list.map((p) => p.id);
  if (ids.length === 0) return;
  const seasonRes = await db.query(
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

// Nulls sort last regardless of direction - folded into the comparator
// itself (not a post-hoc `.reverse()`, which would also flip the nulls to
// the front on a descending sort). Shared by every computed-field sort below
// (mirrors the harness's own simulation in draftHarness.ts).
const nullsLastComparator = (getValue, direction) => (a, b) => {
  const av = getValue(a);
  const bv = getValue(b);
  const aMissing = av == null || !Number.isFinite(av);
  const bMissing = bv == null || !Number.isFinite(bv);
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  if (!aMissing && av !== bv) return direction * (av - bv);
  return a.id - b.id;
};

/**
 * The Players page's whole read. `query` is the typed request the route
 * already coerced from strings (see player.router.js's `GET /`):
 *
 *   userId, page, requestedPositions, search, leagueId, availableOnly,
 *   availability, view, byeWeeksFilter, sortField, dir
 *
 * `{ db }` defaults to the shared pool; a test passes the shared fake-pool
 * helper directly, no module mock required.
 */
async function readPlayersPage(query, { db = pool } = {}) {
  const {
    userId,
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
  } = query;
  const offset = (page - 1) * PAGE_SIZE;
  // `leagueId` arrives as the route's raw (string | null) query value - kept
  // that way so its truthiness gates exactly as it always did (a bare `if
  // (leagueId)`/`!leagueId`), with the numeric form derived here for every
  // DB read and bound param, the same split player.router.js's old handler
  // drew between the two.
  const leagueIdNum = leagueId ? Number(leagueId) : null;

  // These three checks run in the same relative order the pre-module route
  // handler ran them in (availability, then view/sort, then byeWeeks) -
  // preserved deliberately, not just each check's own status/message: a
  // request that fails more than one at once must still surface the SAME
  // one it did before (a risk review on #1497 caught this reordering when
  // the checks first moved here split across the route and this module).
  if (availability && (!leagueId || !AVAILABILITY_STATES.has(availability))) {
    throw new PlayersPageError(
      400,
      'AVAILABILITY_REQUIRES_LEAGUE',
      'availability requires leagueId and must be free_agent, waivers, my_team, or rostered',
    );
  }
  // view=cards (ADR 0040 slice 6, #1309) and sort=upgrade (Ruling item 10)
  // are both meaningless outside the caller's own league and lineup, so both
  // require leagueId up front, in the style of the availability check above.
  if ((view === 'cards' || LEAGUE_SCOPED_SORT_FIELDS.includes(sortField)) && !leagueId) {
    throw new PlayersPageError(
      400,
      'VIEW_OR_SORT_REQUIRES_LEAGUE',
      'view=cards and sort=upgrade require leagueId',
    );
  }
  // Optional multi-select Bye-week filter, e.g. `byeWeeks=6,9,14`. Applied
  // across the FULL eligible pool below (not just the current page) - see
  // `needsFullPool`. Comma-separated integers in 1..REG_SEASON_WEEKS; anything
  // else is a 400, same treatment as the other whitelisted inputs the route
  // itself already validated.
  let byeWeeksFilter = [];
  if (byeWeeksRaw) {
    if (!/^\d+(,\d+)*$/.test(byeWeeksRaw)) {
      throw new PlayersPageError(
        400,
        'INVALID_BYE_WEEKS_FILTER',
        'byeWeeks must be a comma-separated list of integers',
      );
    }
    byeWeeksFilter = [...new Set(byeWeeksRaw.split(',').map(Number))];
    if (byeWeeksFilter.some((week) => week < 1 || week > REG_SEASON_WEEKS)) {
      throw new PlayersPageError(
        400,
        'INVALID_BYE_WEEKS_FILTER',
        `byeWeeks must be between 1 and ${REG_SEASON_WEEKS}`,
      );
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
      memberTeam = await requireMember(db, { leagueId: leagueIdNum, userId });
    } catch (error) {
      if (error instanceof MembershipError) {
        throw new PlayersPageError(error.statusCode, 'NOT_A_MEMBER', error.message);
      }
      throw error;
    }
    const leagueRow = await db.query(
      `SELECT * FROM "leagues" WHERE "id" = $1`,
      [leagueIdNum],
    );
    league = leagueRow.rows[0] || null;
    if (league) {
      projectionRules = rulesForLeague(league);
      if (league.current_season != null) {
        currentSeasonYear = Number(league.current_season);
      }
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

  const projectionSort = sortField === 'projected_points';
  // Bye is schedule-derived, not a stored column (see the bye_week attachment
  // below), so it can't be an ORDER BY target in this query - like
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
  // page - a computed field (pace, bye) or a post-fetch filter (bye weeks)
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
    params.push(leagueIdNum);
    where.push(`NOT EXISTS (
      SELECT 1 FROM "team_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
    )`);
  }
  if (availability === 'free_agent' && blanketWaiversOpen) {
    where.push('FALSE');
  } else if (availability === 'free_agent') {
    params.push(leagueIdNum);
    where.push(`NOT EXISTS (
      SELECT 1 FROM "team_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
    )`);
    params.push(leagueIdNum);
    where.push(`NOT EXISTS (
      SELECT 1 FROM "waiver_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
        AND "available_at" > now()
    )`);
  } else if (availability === 'waivers' && blanketWaiversOpen) {
    params.push(leagueIdNum);
    where.push(`NOT EXISTS (
      SELECT 1 FROM "team_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
    )`);
  } else if (availability === 'waivers') {
    params.push(leagueIdNum);
    where.push(`NOT EXISTS (
      SELECT 1 FROM "team_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
    )`);
    params.push(leagueIdNum);
    where.push(`EXISTS (
      SELECT 1 FROM "waiver_players"
      WHERE "league_id" = $${params.length}
        AND "player_id" = ANY("players"."identity_ids")
        AND "available_at" > now()
    )`);
  } else if (availability === 'my_team') {
    params.push(leagueIdNum, userId);
    where.push(`EXISTS (
      SELECT 1 FROM "team_players"
      JOIN "teams" ON "teams"."id" = "team_players"."team_id"
      WHERE "team_players"."league_id" = $${params.length - 1}
        AND "teams"."owner_id" = $${params.length}
        AND "team_players"."player_id" = ANY("players"."identity_ids")
    )`);
  } else if (availability === 'rostered') {
    params.push(leagueIdNum, userId);
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
  // (no market data exists - see adp.service.js), so their position_rank comes
  // from last completed season's stored rollup points instead. Offense/DEF
  // without an ADP stay null: for them a market rank is possible, and mixing
  // market and production ranks in one position's column would mislead.
  params.push(IDP_POSITIONS);
  const idpParam = params.length;
  params.push(currentSeasonYear - 1);
  const rankSeasonParam = params.length;

  if (!needsFullPool) params.push(PAGE_SIZE, offset);
  // The idp_ranks CTE is computed once per query and joined 1:1, NOT filtered
  // by the outer WHERE - ranks must stay global ("LB #5" can't become "#1"
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

  const result = await db.query(queryText, params);
  const sqlTotal = result.rows[0] ? Number(result.rows[0].total_count) : 0;
  const players = dedupePlayerRows(
    result.rows.map(({ total_count, identity_rank, ...p }) => p),
  );

  // Bye week is schedule-derived, not a stored column - attach it to every
  // row now (whatever `players` currently holds: the full matching pool when
  // Bye/pace sort or a Bye filter is in play, or just this one SQL-paginated
  // page otherwise) so the filter/sort below can see it. Cheap regardless of
  // pool size: one batched query keyed by distinct NFL team, not by player.
  const nflTeams = [
    ...new Set(players.map((p) => p.nfl_team).filter(Boolean)),
  ];
  const byeByTeam = await computeByeWeeks(nflTeams, currentSeasonYear, { client: db });
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

  if (byeSort) {
    settled = [...settled].sort(
      nullsLastComparator((p) => p.bye_week, dir === 'DESC' ? -1 : 1),
    );
  }

  // The SQL total_count reflects the outer WHERE only - once a Bye filter
  // narrows `settled` further in JS, the page count has to come from there.
  const total = needsFullPool ? settled.length : sqlTotal;

  // Sorting BY the projection needs it computed for the WHOLE matching pool
  // first (the sort has to settle before the page can be sliced); every
  // other sort/filter only needs it for the page actually being returned -
  // the season-stats query and the math both cost per player, so deferring
  // this until after the page is known keeps that cost proportional to what's
  // rendered, not to the whole eligible pool.
  if (projectionSort) {
    await attachProjectedPoints(db, settled, { projectionRules, currentSeasonYear });
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
    await attachProjectedPoints(db, settled, { projectionRules, currentSeasonYear });
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
    // upgradeBestBallFallback already computed projected_points for the FULL
    // pool above, and pagePlayers is a slice of those same objects -
    // re-fetching here would just re-set the same value from a second query.
    // view=cards never returns projected_points either way (item 7, ADR 0040
    // - Pool projection leaves the list), so there's no reason to pay for the
    // query just to strip the field back out below.
    await attachProjectedPoints(db, pagePlayers, { projectionRules, currentSeasonYear });
  }

  if (memberTeam && view !== 'cards') {
    await attachLeagueAvailability(db, pagePlayers, {
      leagueId: leagueIdNum,
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
      projectionService.getRestOfSeason(pagePlayers.map((p) => p.id), leagueIdNum, { runsByWeek }),
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
    const rosterCountResult = await db.query(
      `SELECT COUNT(*)::int AS "roster_count" FROM "team_players" WHERE "team_id" = $1`,
      [memberTeam.id],
    );
    // The capacity the server actually enforces for THIS viewer's team, not
    // the IR-inclusive roster limit column. The context is already scoped to
    // memberTeam (rosterCount is that team's count), so the number to
    // publish is that same team's irPolicy.rosterCapacity: draftRosterSize
    // plus its filled IR slots. Reading the stored limit here published a
    // ceiling larger than the gate whenever an IR slot sat empty (#945).
    const rosterCapacity = await irPolicy.rosterCapacity(db, {
      league,
      teamId: memberTeam.id,
    });
    context = {
      leagueId: leagueIdNum,
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

  return {
    players: responsePlayers,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    context,
  };
}

module.exports = {
  PlayersPageError,
  readPlayersPage,
};
