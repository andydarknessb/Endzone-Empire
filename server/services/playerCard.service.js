const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const { requireMember } = require('./leagueMembership.service');
const irPolicy = require('./irPolicy.service');
// Kept whole (not destructured), like decision.service.js does for its own
// cross-module calls: each of these is a seam a test replaces with
// `t.mock.method`, and a destructured binding is captured at require time and
// can no longer be mocked afterwards.
const byeService = require('./bye.service');
const scoringService = require('./scoring.service');
const { normalizeNflTeam } = require('./nflTeam');
const projectionService = require('./projection.service');
const lineupService = require('./lineup.service');
const decisionService = require('./decision.service');
const decisionCardContextService = require('./decisionCardContext.service');

/**
 * `GET /api/players/:id/card?leagueId=` (#1306, ADR 0040 slice 3): the one
 * Decision-card payload for every Availability context (free agent, waivers,
 * rostered by another team, your team), superseding `/summary` (deleted with
 * PlayerQuickView, a later ticket). Every projected number is the Weekly
 * projection under the league's own scoring; Pool projection never appears
 * here (ADR 0040, "One projection producer on these surfaces").
 *
 * The Ruling on issue #1306 fixes nine pieces of this that the issue body
 * alone could not settle - see the numbered items on the issue for the
 * reasoning. `log` and `decision.projWeek.opponentRankVsPosition` are not
 * covered by that Ruling or by ADR 0040-0042's decision-strip list; this
 * file ships a conservative reading of both (see the functions below) and
 * the PR notes it as an open question rather than a settled one.
 */

class PlayerCardError extends Error {
  constructor(statusCode, message, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Accepts either a raw number or a { points, source } projection entry; missing/null -> 0. */
function pointsOf(projections, playerId) {
  const value = projections.get(playerId);
  if (value == null) return 0;
  const raw = typeof value === 'object' ? value.points : value;
  return Number(raw) || 0;
}

/**
 * Internal: shared plumbing for `upgradesFor` and `getPlayerCard`. Materializes
 * the caller's lineup exactly as `decision.service.waiverSuggestions` does,
 * then makes ONE `getWeekProjections` call covering both the caller's current
 * starters and every requested `playerIds`, so the Weekly projection behind
 * `decision.projWeek.points` and the one behind `decision.upgrade` are the
 * same producer call (Ruling item 2). `upgrades` is `null` for a player on
 * the caller's own roster or in a best-ball league (Upgrade is undefined
 * there, ADR 0040).
 */
async function loadUpgradeContext({ league, team, season, week, playerIds }) {
  const ids = [...new Set((playerIds || []).map(Number).filter(Number.isInteger))];
  const settings = lineupService.parseLineupSettings(league);

  const starterRows = await withTransaction(
    pool,
    async (client) => {
      await lineupService.materializeLineup(client, {
        leagueId: league.id, teamId: team.id, season, week, league,
      });
      const result = await client.query(
        `SELECT "lineup_entries"."player_id", "lineup_entries"."slot", "players"."name"
         FROM "lineup_entries"
         JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
         WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2 AND "lineup_entries"."week" = $3
           AND "lineup_entries"."slot" NOT IN ('BENCH', 'IR')`,
        [team.id, season, week]
      );
      return result.rows;
    },
    // Distinct from decision.service.js's own 'decision' label - the guard
    // (scripts/handRolledTransactionGuard.test.js) requires every
    // withTransaction call site to carry a unique label.
    { label: 'player-card' }
  );

  const rosterResult = await pool.query(
    `SELECT "player_id" FROM "team_players" WHERE "team_id" = $1`,
    [team.id]
  );
  const ownRosterIds = new Set(rosterResult.rows.map((r) => r.player_id));

  const playersResult = ids.length > 0
    ? await pool.query(`SELECT "id", "position" FROM "players" WHERE "id" = ANY($1::int[])`, [ids])
    : { rows: [] };
  const positionById = new Map(playersResult.rows.map((r) => [r.id, r.position]));

  const starterIds = starterRows.map((r) => r.player_id);
  const combinedIds = [...new Set([...starterIds, ...ids])];
  const projections = combinedIds.length > 0
    ? await projectionService.getWeekProjections({ season, week, league, playerIds: combinedIds })
    : new Map();

  const currentStarters = starterRows.map((r) => ({
    playerId: r.player_id,
    slot: r.slot,
    name: r.name,
    projection: pointsOf(projections, r.player_id),
  }));

  const upgrades = new Map();
  for (const id of ids) {
    if (league.best_ball || ownRosterIds.has(id)) {
      upgrades.set(id, null);
      continue;
    }
    const candidate = { position: positionById.get(id) ?? null, projection: pointsOf(projections, id) };
    upgrades.set(id, decisionService.upgradeFor(candidate, currentStarters, settings.rosterSlots));
  }

  return { projections, upgrades };
}

/**
 * `Map<playerId, { points, overPlayer, slot } | null>` for every id in
 * `playerIds`, the caller's league and team (Ruling item 2). Shared by the
 * Decision card (one id at a time) and #1309 (a candidate list at once).
 */
async function upgradesFor({ league, team, season, week, playerIds }) {
  const { upgrades } = await loadUpgradeContext({ league, team, season, week, playerIds });
  return upgrades;
}

/**
 * `availability` (Ruling item 6): `state` is computed the same way
 * `player.router.js`'s list loop (`attachLeagueAvailability`) computes it,
 * duplicated here on purpose rather than shared - the router's loop is left
 * as is in this ticket and adopts this function in #1309. The extra fields
 * (`teamId`, `teamName`, `availableAt`, `rosterCapacity`, `rosterCount`,
 * `faabRemaining`, `waiverPriority`) are the same ones the players-list
 * `context` object already publishes for the caller's own team.
 */
async function availabilityFor({ league, team, player }) {
  const identityIds = player.identity_ids || [player.id];

  const [rosterResult, waiverResult, rosterCountResult, rosterCapacity] = await Promise.all([
    pool.query(
      `SELECT "team_players"."team_id", "teams"."name" AS "team_name"
       FROM "team_players" JOIN "teams" ON "teams"."id" = "team_players"."team_id"
       WHERE "team_players"."league_id" = $1 AND "team_players"."player_id" = ANY($2)`,
      [league.id, identityIds]
    ),
    pool.query(
      `SELECT "available_at" FROM "waiver_players"
       WHERE "league_id" = $1 AND "player_id" = ANY($2) AND "available_at" > now()`,
      [league.id, identityIds]
    ),
    pool.query(`SELECT COUNT(*)::int AS "roster_count" FROM "team_players" WHERE "team_id" = $1`, [team.id]),
    irPolicy.rosterCapacity(pool, { league, teamId: team.id }),
  ]);

  const blanketWaiversOpen = Boolean(
    league.waivers_clear_at && new Date(league.waivers_clear_at) > new Date()
  );

  const rosteredBy = rosterResult.rows[0] || null;
  let state;
  let teamId = null;
  let teamName = null;
  let availableAt = null;
  if (rosteredBy) {
    teamId = rosteredBy.team_id;
    teamName = rosteredBy.team_name;
    state = teamId === team.id ? 'my_team' : 'rostered';
  } else {
    availableAt = waiverResult.rows[0] ? waiverResult.rows[0].available_at : null;
    state = availableAt || blanketWaiversOpen ? 'waivers' : 'free_agent';
  }

  return {
    state,
    teamId,
    teamName,
    availableAt,
    rosterCapacity,
    rosterCount: Number(rosterCountResult.rows[0]?.roster_count || 0),
    faabRemaining: league.waiver_type === 'faab' ? team.faab_remaining : null,
    waiverPriority: league.waiver_type === 'priority' ? team.waiver_priority : null,
  };
}

/**
 * `weeks[]` (Ruling item 5): 1..18, each `{ week, opponent, kind, points?,
 * reason? }`. Weeks before `currentWeek` are `'actual'` from `player_stats`;
 * `currentWeek` onward is one `getWeeklyProjections` call per week (the rows
 * the nightly projection run, #1305, already fills); the bye week is
 * `'bye'` with no points; a week `projection.factors.availability` marks
 * unavailable is `'unavailable'` with `reason` 'out' or 'on IR'.
 */
async function buildWeeklyBars({ league, player, season, currentWeek, opponentByWeek, byeWeek, rules }) {
  const statsResult = await pool.query(
    `SELECT "week", "stats" FROM "player_stats" WHERE "player_id" = $1 AND "season" = $2 AND "week" < $3`,
    [player.id, season, currentWeek]
  );
  const statsByWeek = new Map(statsResult.rows.map((r) => [Number(r.week), r.stats]));

  const weeks = [];
  for (let wk = 1; wk <= 18; wk++) {
    const opponent = opponentByWeek.get(wk) ?? null;
    if (wk === byeWeek) {
      weeks.push({ week: wk, opponent, kind: 'bye' });
      continue;
    }
    if (wk < currentWeek) {
      const stats = statsByWeek.get(wk);
      weeks.push({
        week: wk,
        opponent,
        kind: 'actual',
        points: stats ? scoringService.calculateFantasyPoints(stats, rules) : null,
      });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- one cache-hit-or-generate
    // call per remaining week, by design (Ruling item 5); the nightly run
    // (#1305) has already filled every one of these for an in-season league.
    const run = await projectionService.getWeeklyProjections({ season, week: wk, league, playerIds: [player.id] });
    const projection = run.projections.get(player.id);
    const unavailable = !!(projection
      && projection.factors
      && projection.factors.availability
      && projection.factors.availability.available === false);
    if (unavailable) {
      const reason = projection.factors.availability.reason === 'ir' ? 'on IR' : 'out';
      weeks.push({ week: wk, opponent, kind: 'unavailable', reason });
      continue;
    }
    const point = projection ? (projection.median != null ? projection.median : projection.mean) : null;
    weeks.push({ week: wk, opponent, kind: 'projected', points: point == null ? null : Number(point) });
  }
  return weeks;
}

/**
 * The full Decision-card payload for one player in one league (issue #1306).
 * Throws PlayerCardError(404) when the league or player does not exist;
 * requireMember throws MembershipError(403) when the caller holds no team.
 */
async function getPlayerCard({ leagueId, userId, playerId, week }) {
  // requireMember runs FIRST (a risk-review catch, #1306): `teams.league_id`
  // references `leagues.id` ON DELETE CASCADE, so a team row can never
  // outlive its league, and this ordering means a non-member gets the exact
  // same 403 whether the league exists or not - the reverse order let a
  // caller distinguish "no such league" (404) from "not your league" (403),
  // an oracle `/summary` (requireMember first) never had.
  const team = await requireMember(pool, { leagueId, userId });

  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new PlayerCardError(404, 'league not found');

  const playerResult = await pool.query(`SELECT * FROM "players" WHERE "id" = $1`, [playerId]);
  const player = playerResult.rows[0];
  if (!player) throw new PlayerCardError(404, 'player not found');

  const season = league.current_season;
  const effectiveWeek = week === undefined || week === null ? league.current_week : week;
  const seasonEnd = projectionService.lastPlayoffWeek(league);
  const rules = scoringService.rulesForLeague(league);

  const scheduleResult = await pool.query(
    `SELECT "week", "opponent" FROM "nfl_games"
     WHERE "season" = $1 AND fn_normalize_nfl_team("nfl_team") = fn_normalize_nfl_team($2)`,
    [season, player.nfl_team]
  );
  const opponentByWeek = new Map(
    scheduleResult.rows.map((r) => [Number(r.week), normalizeNflTeam(r.opponent)])
  );

  const byeWeek = await byeService.computeByeWeek(player.nfl_team, season);

  const [
    { projections, upgrades },
    usage,
    rosMap,
    availability,
    weeks,
    weeklyResult,
    seasonResult,
  ] = await Promise.all([
    loadUpgradeContext({ league, team, season, week: effectiveWeek, playerIds: [player.id] }),
    decisionCardContextService.loadUsage({
      playerId: player.id, playerTeam: player.nfl_team, season, week: effectiveWeek, rules,
    }),
    projectionService.getRestOfSeason([player.id], leagueId),
    availabilityFor({ league, team, player }),
    buildWeeklyBars({
      league, player, season, currentWeek: effectiveWeek, opponentByWeek, byeWeek, rules,
    }),
    pool.query(
      `SELECT "season", "week", "stats" FROM "player_stats" WHERE "player_id" = $1 ORDER BY "season" DESC, "week"`,
      [player.id]
    ),
    pool.query(
      `SELECT "season", "games_played", "stats" FROM "player_season_stats"
       WHERE "player_id" = $1 ORDER BY "season" DESC`,
      [player.id]
    ),
  ]);

  const ros = rosMap.get(player.id) || { total: 0, perGame: 0 };

  // `log`: not covered by the #1306 Ruling or ADR 0040-0042's decision-strip
  // list. Reusing `buildPlayerSummary` (the exact producer `/summary` already
  // shipped, which this route supersedes) rather than inventing a second stat
  // line format is the conservative reading; flagged in the PR as an open
  // question rather than a settled one.
  const summary = scoringService.buildPlayerSummary({
    player, weeklyRows: weeklyResult.rows, seasonRows: seasonResult.rows, rules, byeWeek, currentSeasonYear: season,
  });
  const log = {
    current: (summary.currentSeason ? summary.currentSeason.weekly : []).map((w) => ({
      week: w.week,
      opponent: opponentByWeek.get(Number(w.week)) ?? null,
      statLine: w.stats,
      points: w.fantasy_points,
    })),
    previousSeasons: summary.previousSeasons,
  };

  return {
    player: {
      id: player.id,
      name: player.name,
      position: player.position,
      teamCode: normalizeNflTeam(player.nfl_team),
      jerseyNumber: player.jersey_number ?? null,
      photoUrl: player.photo_url ?? null,
      byeWeek,
      injury: { designation: player.injury_status ?? null, detail: player.injury_detail ?? null },
    },
    availability,
    decision: {
      projWeek: {
        week: effectiveWeek,
        points: pointsOf(projections, player.id),
        opponent: opponentByWeek.get(Number(effectiveWeek)) ?? null,
        // No producer exists for this and neither the Ruling nor ADR
        // 0040-0042 addresses it (unlike `ros.posRank`, which the Ruling
        // explicitly ships null "in this slice"); following that same
        // missing-data-hides precedent (ADR 0040) rather than inventing a
        // ranking rule nobody has approved.
        opponentRankVsPosition: null,
      },
      ros: {
        points: ros.total,
        perGame: ros.perGame,
        posRank: null,
        throughWeek: seasonEnd,
      },
      upgrade: upgrades.get(player.id) ?? null,
      usage,
    },
    weeks,
    seasonEnd,
    news: player.news ? [{ headline: player.news, source: 'feed', publishedAt: null }] : [],
    log,
    bio: null,
    depth: null,
    ownership: null,
  };
}

module.exports = {
  PlayerCardError,
  getPlayerCard,
  upgradesFor,
  availabilityFor,
};
