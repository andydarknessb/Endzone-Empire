const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
// Kept whole (not destructured), same test-seam convention as every other
// cross-module call in this file: a destructured binding is captured at
// require time and can no longer be mocked afterwards.
const espnAthleteClient = require('../modules/espnAthleteClient');
const { requireMember } = require('./leagueMembership.service');
const irPolicy = require('./irPolicy.service');
// Kept whole (not destructured), like decision.service.js does for its own
// cross-module calls: each of these is a seam a test replaces with
// `t.mock.method`, and a destructured binding is captured at require time and
// can no longer be mocked afterwards.
const byeService = require('./bye.service');
const scoringRules = require('./scoringRules');
const seasonSummary = require('./seasonSummary.service');
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
 * reasoning. `log` is not covered by that Ruling or by ADR 0040-0042's
 * decision-strip list; this file ships a conservative reading of it (see
 * the functions below) and the PR notes it as an open question rather than
 * a settled one. `decision.projWeek.opponentRankVsPosition` (and its
 * `weeks[]` counterpart) IS settled, by the #1342 Ruling: the opponent
 * Factor is the one producer, ranked (see `opponentRankOf` below).
 */

class PlayerCardError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
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
 * `{ rank, of } | null` (#1342 Ruling): the opponent Factor is the one
 * producer, so this reads `factors.opponent` off the SAME `getWeekProjections`
 * entry `pointsOf` already reads `.points` from, rather than a second query.
 * `null` whenever the factor carries no `rank` (no opponent data, an
 * insufficient sample, or no projection at all) - never `0`, the same
 * missing-data-hides rule the Decision card applies everywhere else.
 */
function opponentRankOf(projections, playerId) {
  const value = projections.get(playerId);
  const opponent = value && typeof value === 'object' && value.factors ? value.factors.opponent : null;
  if (!opponent || opponent.rank == null) return null;
  return { rank: opponent.rank, of: opponent.of };
}

/**
 * Classifies one `getWeeklyProjections` result for one week (formal review
 * f3): unavailable, with the reason CODE ('bye' | 'out' | 'ir' | 'no_team';
 * the client labels it, #1675), or a point value (the
 * RANKING statistic, `projectionService.pointEstimateFor` - #1483 - `null`
 * when the producer had neither). Shared by `buildWeeksForPage` (the list,
 * #1309) and `buildWeeklyBars` (the card, #1306) so the two never classify the
 * same projection two different ways - the list and the card must agree here
 * (spec #1303, story 7).
 */
function classifyWeekProjection(projection) {
  const unavailable = !!(projection
    && projection.factors
    && projection.factors.availability
    && projection.factors.availability.available === false);
  if (unavailable) {
    return { unavailable: true, reason: projection.factors.availability.reason || 'out' };
  }
  const point = projection ? projectionService.pointEstimateFor(projection) : null;
  return { unavailable: false, points: point == null ? null : Number(point) };
}

/**
 * `Map<playerId, identityIds[]>` for every id in `playerIds`, under the SAME
 * partition `player.router.js`'s `player_identities` CTE uses (normalized
 * name + position + Team code): every `players` row a duplicate-source sync
 * could have produced for one real athlete. Every requested id is present in
 * the map even when it has no duplicate (falling back to itself). A plain
 * `players` row never carries `identity_ids` (that field only exists as the
 * CTE's window alias), so `availabilityForMany` and the own-roster Upgrade
 * check both resolve it here rather than reading a field that was never on
 * the row (formal review f1).
 *
 * The single-id case (the Decision card's own call, always N=1) runs the
 * exact scalar-`WHERE "id" = $1` query this function has always run - not
 * the `= ANY($1)` batch form - so `getPlayerCard`'s query shape and count are
 * unchanged (`server/test/playerCard.service.test.js`'s fakePool mocks match
 * on that literal SQL prefix, and its fixtures return `{ id }` rows with no
 * `requested_id` column, which only the single-id shape produces).
 */
async function loadIdentityIdsFor(playerIds) {
  const ids = [...new Set((playerIds || []).map(Number).filter(Number.isInteger))];
  const map = new Map();
  if (ids.length === 0) return map;

  if (ids.length === 1) {
    const [id] = ids;
    const result = await pool.query(
      `WITH "target" AS (
         SELECT LOWER(REGEXP_REPLACE(TRIM("name"), '\\s+', ' ', 'g')) AS "name_key",
                "position",
                COALESCE(fn_normalize_nfl_team("nfl_team"), '') AS "team_key"
         FROM "players" WHERE "id" = $1
       )
       SELECT "players"."id" FROM "players", "target"
       WHERE LOWER(REGEXP_REPLACE(TRIM("players"."name"), '\\s+', ' ', 'g')) = "target"."name_key"
         AND "players"."position" = "target"."position"
         AND COALESCE(fn_normalize_nfl_team("players"."nfl_team"), '') = "target"."team_key"`,
      [id]
    );
    const found = result.rows.map((r) => r.id);
    map.set(id, found.length > 0 ? found : [id]);
    return map;
  }

  const result = await pool.query(
    `WITH "target" AS (
       SELECT "id" AS "requested_id",
              LOWER(REGEXP_REPLACE(TRIM("name"), '\\s+', ' ', 'g')) AS "name_key",
              "position",
              COALESCE(fn_normalize_nfl_team("nfl_team"), '') AS "team_key"
       FROM "players" WHERE "id" = ANY($1::int[])
     )
     SELECT "target"."requested_id" AS "requested_id", "players"."id" AS "identity_id"
     FROM "target"
     JOIN "players"
       ON LOWER(REGEXP_REPLACE(TRIM("players"."name"), '\\s+', ' ', 'g')) = "target"."name_key"
      AND "players"."position" = "target"."position"
      AND COALESCE(fn_normalize_nfl_team("players"."nfl_team"), '') = "target"."team_key"`,
    [ids]
  );
  for (const row of result.rows) {
    if (!map.has(row.requested_id)) map.set(row.requested_id, []);
    map.get(row.requested_id).push(row.identity_id);
  }
  for (const id of ids) {
    if (!map.has(id) || map.get(id).length === 0) map.set(id, [id]);
  }
  return map;
}

/** Single-id convenience wrapper over `loadIdentityIdsFor` - always the
 * one-query scalar form above. */
async function loadIdentityIds(playerId) {
  const map = await loadIdentityIdsFor([playerId]);
  return map.get(playerId) || [playerId];
}

/**
 * Internal: shared plumbing for `upgradesFor` and `getPlayerCard`. Materializes
 * the caller's lineup exactly as `decision.service.waiverSuggestions` does,
 * then makes ONE `getWeekProjections` call covering both the caller's current
 * starters and every requested `playerIds`, so the Weekly projection behind
 * `decision.projWeek.points` and the one behind `decision.upgrade` are the
 * same producer call (Ruling item 2). `upgrades` is `null` for a player on
 * the caller's own roster (checked over the FULL identity set `loadIdentityIds`
 * resolves, not the bare requested id - a duplicate-source players row for a
 * rostered athlete must still read as "already yours", formal review f1) or
 * in a best-ball league (Upgrade is undefined there, ADR 0040), or for a
 * player with No NFL team.
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
    ? await pool.query(`SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY($1::int[])`, [ids])
    : { rows: [] };
  const positionById = new Map(playersResult.rows.map((r) => [r.id, r.position]));
  const noNflTeamIds = new Set(playersResult.rows.filter((r) => r.nfl_team == null).map((r) => r.id));

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

  // One identity read for every requested id (Ruling item 3a) rather than one
  // per id: `upgradesFor` over N ids is now the lineup transaction, the
  // roster read, the position read, one identity read and one
  // `getWeekProjections` call, whatever N is.
  const identityIdsById = await loadIdentityIdsFor(ids);

  const upgrades = new Map();
  for (const id of ids) {
    if (league.best_ball) {
      upgrades.set(id, null);
      continue;
    }
    const identityIds = identityIdsById.get(id) || [id];
    if (identityIds.some((identityId) => ownRosterIds.has(identityId))) {
      upgrades.set(id, null);
      continue;
    }
    // No NFL team (CONTEXT.md): a player off every NFL roster has no game to
    // score in, so he cannot improve any lineup. The engine still carries
    // his old per-game pace until v3.2 (#1438 story 5), so the Upgrade must
    // refuse him here rather than trust that number.
    if (noNflTeamIds.has(id)) {
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
 * as is in this ticket and adopts this function in #1309. `identityIds`
 * (via `loadIdentityIds`, formal review f1) matches the same duplicate-source
 * players rows the router's `player_identities` CTE collapses, not just the
 * bare requested id, so a duplicate row for a rostered or waivered athlete is
 * never mistaken for a free agent. The extra fields (`teamId`, `teamName`,
 * `availableAt`, `rosterCapacity`, `rosterCount`, `faabRemaining`,
 * `waiverPriority`) are the same ones the players-list `context` object
 * already publishes for the caller's own team.
 */
/**
 * `Map<playerId, { state, teamId, teamName, availableAt }>` for every player
 * in `players` (Ruling item 3b), the given league and the CALLER's team
 * (`teamId`/`teamName` describe who rosters the player, `team` says who's
 * asking - `state` is 'my_team' only when those are the same team).
 *
 * The single-player case (the Decision card's own call, via `availabilityFor`
 * below) runs the exact two queries `availabilityFor` has always run, with
 * the exact same row shape (`server/test/playerCard.service.test.js`'s
 * fakePool fixtures - `rosteredBy`/`waiverRow` - carry no `player_id` column,
 * which only this single-player shape tolerates). The batch form (players
 * list, #1309) is exactly three reads for any page: the identity set below,
 * the roster-with-team-name query and the waiver query, each `= ANY` over the
 * union of every player's identity ids.
 */
async function availabilityForMany({ league, team, players }) {
  if (players.length === 0) return new Map();

  const blanketWaiversOpen = Boolean(
    league.waivers_clear_at && new Date(league.waivers_clear_at) > new Date()
  );

  if (players.length === 1) {
    const [player] = players;
    const identityIds = await loadIdentityIds(player.id);
    const [rosterResult, waiverResult] = await Promise.all([
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
    ]);
    const rosteredBy = rosterResult.rows[0] || null;
    if (rosteredBy) {
      return new Map([[player.id, {
        state: rosteredBy.team_id === team.id ? 'my_team' : 'rostered',
        teamId: rosteredBy.team_id,
        teamName: rosteredBy.team_name,
        availableAt: null,
      }]]);
    }
    const availableAt = waiverResult.rows[0] ? waiverResult.rows[0].available_at : null;
    return new Map([[player.id, {
      state: availableAt || blanketWaiversOpen ? 'waivers' : 'free_agent',
      teamId: null,
      teamName: null,
      availableAt,
    }]]);
  }

  const ids = players.map((p) => p.id);
  const identityIdsById = await loadIdentityIdsFor(ids);
  const allIdentityIds = [...new Set([...identityIdsById.values()].flat())];
  const result = new Map();
  if (allIdentityIds.length === 0) return result;

  const [rosterResult, waiverResult] = await Promise.all([
    pool.query(
      `SELECT "team_players"."team_id", "team_players"."player_id", "teams"."name" AS "team_name"
       FROM "team_players" JOIN "teams" ON "teams"."id" = "team_players"."team_id"
       WHERE "team_players"."league_id" = $1 AND "team_players"."player_id" = ANY($2)`,
      [league.id, allIdentityIds]
    ),
    pool.query(
      `SELECT "player_id", "available_at" FROM "waiver_players"
       WHERE "league_id" = $1 AND "player_id" = ANY($2) AND "available_at" > now()`,
      [league.id, allIdentityIds]
    ),
  ]);
  const rosterByIdentityId = new Map(
    rosterResult.rows.map((row) => [row.player_id, { teamId: row.team_id, teamName: row.team_name }])
  );
  const waiverByIdentityId = new Map(
    waiverResult.rows.map((row) => [row.player_id, row.available_at])
  );

  for (const player of players) {
    const identityIds = identityIdsById.get(player.id) || [player.id];
    const rostered = identityIds.map((id) => rosterByIdentityId.get(id)).find(Boolean);
    if (rostered) {
      result.set(player.id, {
        state: rostered.teamId === team.id ? 'my_team' : 'rostered',
        teamId: rostered.teamId,
        teamName: rostered.teamName,
        availableAt: null,
      });
      continue;
    }
    const availableAt = identityIds.map((id) => waiverByIdentityId.get(id)).find(Boolean) || null;
    result.set(player.id, {
      state: availableAt || blanketWaiversOpen ? 'waivers' : 'free_agent',
      teamId: null,
      teamName: null,
      availableAt,
    });
  }
  return result;
}

/**
 * `availability` for one player (Ruling item 6/3b): `availabilityForMany` of
 * one, plus the four team-level fields the players-list `context` object
 * already publishes for the caller's own team - so this payload is
 * byte-for-byte what it was before the batch split.
 */
async function availabilityFor({ league, team, player }) {
  const [stateMap, rosterCountResult, rosterCapacity] = await Promise.all([
    availabilityForMany({ league, team, players: [player] }),
    pool.query(`SELECT COUNT(*)::int AS "roster_count" FROM "team_players" WHERE "team_id" = $1`, [team.id]),
    irPolicy.rosterCapacity(pool, { league, teamId: team.id }),
  ]);
  const state = stateMap.get(player.id);

  return {
    ...state,
    rosterCapacity,
    rosterCount: Number(rosterCountResult.rows[0]?.roster_count || 0),
    faabRemaining: league.waiver_type === 'faab' ? team.faab_remaining : null,
    waiverPriority: league.waiver_type === 'priority' ? team.waiver_priority : null,
  };
}

/**
 * `Map<playerId, weeks[]>` for a whole page (#1309 Ruling item 4): `weeks[]`
 * runs from `currentWeek` through 18, one `getWeeklyProjections({ season,
 * week, league, playerIds })` read per week for the WHOLE page, batched into
 * one `getWeeklyProjectionsForWeeks` call (#1403) - never per player, so a
 * 25-row page and a 1-row page make the same number of calls (the nightly
 * run, #1305, has already filled every one of these for an in-season
 * league). Each entry is `{ week, points }` under the league's own
 * scoring, or `{ week, reason }` (a reason code: 'bye' | 'out' | 'ir' | 'no_team') with no
 * `points` for a week the player is unavailable; `projWeek` is simply the
 * first (current-week) entry.
 */
async function buildWeeksForPage({
  league, players, season, currentWeek, byeWeekByPlayerId, runsByWeek = null,
}) {
  const playerIds = players.map((p) => p.id);
  const weeksByPlayer = new Map(playerIds.map((id) => [id, []]));
  if (playerIds.length === 0) return weeksByPlayer;

  const weeks = [];
  for (let wk = currentWeek; wk <= 18; wk++) weeks.push(wk);
  // #1403: ONE batched read for every remaining week of the WHOLE page (not
  // one per week, and never per player: the query count is part of the
  // contract, Ruling item 4/11). The router passes the runs it already read
  // so the rest-of-season total is summed from the same rows; a passed map
  // missing a week has just that week read.
  const missingWeeks = weeks.filter((wk) => !(runsByWeek && runsByWeek.has(wk)));
  const fetched = missingWeeks.length > 0
    ? await projectionService.getWeeklyProjectionsForWeeks({ season, weeks: missingWeeks, league, playerIds })
    : new Map();

  for (const wk of weeks) {
    const run = (runsByWeek && runsByWeek.get(wk)) || fetched.get(wk) || { projections: new Map() };
    for (const id of playerIds) {
      if (byeWeekByPlayerId.get(id) === wk) {
        weeksByPlayer.get(id).push({ week: wk, reason: 'bye' });
        continue;
      }
      const classified = classifyWeekProjection(run.projections.get(id));
      if (classified.unavailable) {
        weeksByPlayer.get(id).push({ week: wk, reason: classified.reason });
        continue;
      }
      weeksByPlayer.get(id).push({ week: wk, points: classified.points });
    }
  }
  return weeksByPlayer;
}

/**
 * `weeks[]` (Ruling item 5): 1..18, each `{ week, opponent, kind, points?,
 * reason? }`. Weeks before `currentWeek` are `'actual'` from `player_stats`;
 * `currentWeek` onward is one `getWeeklyProjections` call per week (the rows
 * the nightly projection run, #1305, already fills); the bye week is
 * `'bye'` with no points; a week `projection.factors.availability` marks
 * unavailable is `'unavailable'` with `reason` a code ('out' | 'ir' | 'no_team').
 *
 * Open interpretation (formal review f3, not settled by the Ruling or ADR
 * 0040-0042): a past, non-bye week with no `player_stats` row at all (a
 * healthy scratch, a mid-season signing, an unsynced week) still ships
 * `kind: 'actual'`, with `points: null` rather than `0` - the row was never
 * played FOR this player, so `null` says "no number", the same "hide rather
 * than guess" rule ADR 0040 applies to a missing tile. A dedicated
 * `kind: 'unavailable'`/no-data kind for this case is a reasonable
 * alternative the client ticket (#1307) may prefer instead.
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
      weeks.push({ week: wk, opponent, kind: 'bye', reason: 'bye' });
      continue;
    }
    if (wk < currentWeek) {
      const stats = statsByWeek.get(wk);
      weeks.push({
        week: wk,
        opponent,
        kind: 'actual',
        points: stats ? scoringRules.calculateFantasyPoints(stats, rules) : null,
      });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- one cache-hit-or-generate
    // call per remaining week, by design (Ruling item 5); the nightly run
    // (#1305) has already filled every one of these for an in-season league.
    const run = await projectionService.getWeeklyProjections({ season, week: wk, league, playerIds: [player.id] });
    const classified = classifyWeekProjection(run.projections.get(player.id));
    if (classified.unavailable) {
      weeks.push({ week: wk, opponent, kind: 'unavailable', reason: classified.reason });
      continue;
    }
    weeks.push({
      week: wk,
      opponent,
      kind: 'projected',
      points: classified.points,
      // #1342 Ruling item 3: each projected week's own run carries its own
      // opponent Factor (the canvas hover), read the same way `projWeek`
      // reads its current week's - never `classifyWeekProjection`'s or
      // `buildWeeksForPage`'s job (Lead correction item 3: that would change
      // the byte-identical `GET /api/players?view=cards` payload).
      opponentRankVsPosition: opponentRankOf(run.projections, player.id),
    });
  }
  return weeks;
}

/**
 * `{ rank, groupSize } | null` for one player at one position/season (#1356):
 * RANK() semantics (ties share a rank) over the position's whole
 * `player_season_stats` group for that season, rescored under the LEAGUE'S
 * OWN rules - `scoring.service.js`'s `getSeasonPositionRank` ranks the
 * stored (always half-PPR) `fantasy_points` column, so it can't answer a
 * league-scored rank (#1356 body). `null` when the player has no rollup row
 * for that season (most commonly the in-progress current season, whose
 * rollup doesn't exist until the season completes) or the position/season
 * group is empty - the same "hide rather than guess" rule
 * `decision.ros.posRank` already applies.
 *
 * A DEF rollup rescores its STORED `fantasy_points` rather than the
 * aggregate `stats` blob (`hasTeamDefenseTiers`): the teamDefense
 * pointsAllowed/yardsAllowed rules are per-game tiers, so tier-matching a
 * season AGGREGATE once would misprice it - the same accepted deviation
 * `projectSeasonPoints` documents (custom league DEF tiers don't move this
 * number).
 */
async function getRescoredPositionRank({ playerId, position, season, rules }) {
  if (!position || !Number.isInteger(Number(season))) return null;
  const result = await pool.query(
    `SELECT "pss"."player_id", "pss"."stats", "pss"."fantasy_points"
     FROM "player_season_stats" "pss"
     JOIN "players" "p" ON "p"."id" = "pss"."player_id"
     WHERE "p"."position" = $1 AND "pss"."season" = $2`,
    [position, season]
  );
  const scored = result.rows.map((row) => ({
    playerId: row.player_id,
    points: scoringRules.hasTeamDefenseTiers(row.stats)
      ? Number(row.fantasy_points)
      : scoringRules.calculateFantasyPoints(row.stats, rules),
  }));
  const mine = scored.find((row) => row.playerId === playerId);
  if (!mine) return null;
  const rank = 1 + scored.filter((row) => row.points > mine.points).length;
  return { rank, groupSize: scored.length };
}

/**
 * `{ bio, news, injuryFacts, depth, ownership }` (#1308, ADR 0041): every
 * field null (news `[]`) when `player.external_id` is null - never fetches
 * ESPN or reads either table in that case, so a player we've never matched
 * to an ESPN athlete costs this call nothing. `profile`/`overview` are
 * `espnAthleteClient`'s own in-process-cached reads (six hours / five
 * minutes on failure); `depth`/`ownership` read the latest `captured_date`
 * row the daily Sync runs wrote (#1382) - never a live ESPN call, per the
 * Ruling (item 1).
 */
async function loadEspnFacts(player) {
  if (!player.external_id) {
    return { bio: null, news: [], injuryFacts: null, depth: null, ownership: null };
  }
  const [bio, overview, depthResult, ownershipResult] = await Promise.all([
    espnAthleteClient.profile(player.external_id),
    espnAthleteClient.overview(player.external_id),
    pool.query(
      `SELECT "team_code", "position_group", "rank", "captured_date"
       FROM "player_depth_chart" WHERE "player_id" = $1 ORDER BY "captured_date" DESC LIMIT 1`,
      [player.id]
    ),
    pool.query(
      `SELECT "percent_owned", "percent_started", "percent_change", "captured_date"
       FROM "player_ownership" WHERE "player_id" = $1 ORDER BY "captured_date" DESC LIMIT 1`,
      [player.id]
    ),
  ]);
  const depthRow = depthResult.rows[0];
  const ownershipRow = ownershipResult.rows[0];
  return {
    bio: bio || null,
    news: (overview && overview.news) || [],
    injuryFacts: (overview && overview.injuryFacts) || null,
    depth: depthRow ? {
      teamCode: depthRow.team_code,
      positionGroup: depthRow.position_group,
      rank: depthRow.rank,
      capturedDate: depthRow.captured_date,
    } : null,
    ownership: ownershipRow ? {
      percentOwned: ownershipRow.percent_owned != null ? Number(ownershipRow.percent_owned) : null,
      percentStarted: ownershipRow.percent_started != null ? Number(ownershipRow.percent_started) : null,
      change: ownershipRow.percent_change != null ? Number(ownershipRow.percent_change) : null,
      capturedDate: ownershipRow.captured_date,
    } : null,
  };
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
  const rules = scoringRules.rulesForLeague(league);

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
    { line, weather },
    opponents,
    rosMap,
    availability,
    weeks,
    weeklyResult,
    seasonResult,
    espnFacts,
  ] = await Promise.all([
    loadUpgradeContext({ league, team, season, week: effectiveWeek, playerIds: [player.id] }),
    decisionCardContextService.loadUsage({
      playerId: player.id,
      playerTeam: player.nfl_team,
      season,
      week: effectiveWeek,
      rules,
      side: decisionCardContextService.sideForPosition(player.position),
    }),
    decisionCardContextService.loadGameContext({ season, week: effectiveWeek, nflTeam: player.nfl_team })
      .catch((err) => {
        console.error('getPlayerCard: game context failed', err);
        return { line: null, weather: null };
      }),
    decisionCardContextService.loadOpponents({
      leagueId, player, season, week: Number(effectiveWeek), rules,
    }).catch((err) => {
      console.error('getPlayerCard: opponents failed', err);
      return [];
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
    loadEspnFacts(player),
  ]);

  const ros = rosMap.get(player.id) || { total: 0, perGame: 0 };

  // `log`: not covered by the #1306 Ruling or ADR 0040-0042's decision-strip
  // list. Reusing `buildPlayerSummary` (the exact producer `/summary` already
  // shipped, which this route supersedes) rather than inventing a second stat
  // line format is the conservative reading; flagged in the PR as an open
  // question rather than a settled one.
  const summary = seasonSummary.buildPlayerSummary({
    player, weeklyRows: weeklyResult.rows, seasonRows: seasonResult.rows, rules, byeWeek, currentSeasonYear: season,
  });
  const log = {
    current: (summary.currentSeason ? summary.currentSeason.weekly : []).map((w) => ({
      week: w.week,
      opponent: opponentByWeek.get(Number(w.week)) ?? null,
      statLine: w.stats,
      points: w.fantasy_points,
    })),
  };

  // `seasons[]` (#1356): one entry per season on record for the player - the
  // union of DISTINCT season over player_season_stats and player_stats
  // (`weeklyResult`/`seasonResult` above already select every season for
  // this player, unfiltered, so no extra query is needed for the union
  // itself - the same union `publicRead.service.js`'s player-profile read
  // takes), newest first. `games`/`points`/`pointsPerGame` are ALWAYS scored
  // from that season's WEEKLY player_stats rows under the league's own rules
  // (never player_season_stats.fantasy_points, which is stored half-PPR and
  // ignores this league's scoring) - a season with a rollup row but no
  // weekly rows on file reports zero rather than a number under the wrong
  // rules.
  //
  // `seasons[0]` is ALWAYS `league.current_season` (Cory's ruling on #1356,
  // 2026-09-13): the "one entry per season on record" reading left almost
  // every in-season card with no current-season entry at all (the rollup and
  // most weekly rows land after the season completes), and #1358's "current
  // season checked on open" needs one to read. `season` is unioned in
  // explicitly so it is present even with zero rows either side; the
  // `s === season` branch below builds it from the top-level `weeks`/
  // `log.current` regardless (byte-identical, and correct even when
  // `summary.currentSeason` is null - a player with NO stats rows at all now
  // returns exactly that one entry, never `[]`, restating criterion 4).
  const allSeasons = [...new Set([
    season,
    ...weeklyResult.rows.map((r) => r.season),
    ...seasonResult.rows.map((r) => r.season),
  ])].sort((a, b) => b - a);

  const seasons = [];
  for (const s of allSeasons) {
    // eslint-disable-next-line no-await-in-loop -- one rescored rank query
    // per season, by design (a few hundred player_season_stats rows for the
    // position, computed once per request per season).
    const posRank = await getRescoredPositionRank({ playerId: player.id, position: player.position, season: s, rules });
    if (s === season) {
      seasons.push({
        season: s,
        games: summary.currentSeason ? summary.currentSeason.games : 0,
        points: summary.currentSeason ? summary.currentSeason.points : 0,
        pointsPerGame: summary.currentSeason ? summary.currentSeason.perGame : 0,
        posRank: posRank ? posRank.rank : null,
        posRankOf: posRank ? posRank.groupSize : null,
        adp: player.adp != null && Number.isFinite(Number(player.adp)) ? Number(player.adp) : null,
        weeks,
        log: log.current,
      });
      continue;
    }

    const weeklyRowsForSeason = weeklyResult.rows.filter((r) => r.season === s);
    const points = Math.round(
      weeklyRowsForSeason.reduce((sum, r) => sum + scoringRules.calculateFantasyPoints(r.stats, rules), 0) * 100
    ) / 100;
    const games = weeklyRowsForSeason.length;

    // #1356 formal review f2: a past season's schedule and bye week come
    // from the TEAM the player actually played for THAT season - nflverse's
    // per-row `stats.gameTeam` (the most-common value that season), falling
    // back to today's `player.nfl_team` only when no row carries one - never
    // today's team. `buildWeeklyBars` checks the bye week before it looks at
    // stats, so a traded player's old-team week must never fall on his new
    // team's bye and render with no points.
    const teamCounts = new Map();
    for (const row of weeklyRowsForSeason) {
      const gameTeam = row.stats && row.stats.gameTeam;
      if (!gameTeam) continue;
      teamCounts.set(gameTeam, (teamCounts.get(gameTeam) || 0) + 1);
    }
    let seasonTeam = player.nfl_team;
    let seasonTeamCount = 0;
    for (const [team, count] of teamCounts) {
      if (count > seasonTeamCount) { seasonTeam = team; seasonTeamCount = count; }
    }

    // eslint-disable-next-line no-await-in-loop -- one schedule query and one
    // bye lookup per past season (computed once per request per season, the
    // same shape the position rank above takes).
    const [seasonScheduleResult, seasonByeWeek] = await Promise.all([
      pool.query(
        `SELECT "week", "opponent" FROM "nfl_games"
         WHERE "season" = $1 AND fn_normalize_nfl_team("nfl_team") = fn_normalize_nfl_team($2)`,
        [s, seasonTeam]
      ),
      byeService.computeByeWeek(seasonTeam, s),
    ]);
    const opponentByWeekForSeason = new Map(
      seasonScheduleResult.rows.map((r) => [Number(r.week), normalizeNflTeam(r.opponent)])
    );

    seasons.push({
      season: s,
      games,
      points,
      pointsPerGame: games ? Math.round((points / games) * 10) / 10 : 0,
      posRank: posRank ? posRank.rank : null,
      posRankOf: posRank ? posRank.groupSize : null,
      // `players.adp` is a single column, not per-season history - null for
      // every season but the league's current one (#1356 body).
      adp: null,
      weeks: await buildWeeklyBars({ // eslint-disable-line no-await-in-loop -- one call per past season
        league, player, season: s, currentWeek: 19, opponentByWeek: opponentByWeekForSeason, byeWeek: seasonByeWeek, rules,
      }),
      log: weeklyRowsForSeason.map((r) => ({
        week: r.week,
        // f2: a log row prefers its OWN `stats.gameOpponent` (that specific
        // game's opponent) over the derived season schedule, which can only
        // answer for the team `seasonTeam` played the most that year.
        opponent: (r.stats && r.stats.gameOpponent)
          ? normalizeNflTeam(r.stats.gameOpponent)
          : (opponentByWeekForSeason.get(Number(r.week)) ?? null),
        statLine: r.stats,
        points: scoringRules.calculateFantasyPoints(r.stats, rules),
      })),
    });
  }

  return {
    player: {
      id: player.id,
      name: player.name,
      position: player.position,
      teamCode: normalizeNflTeam(player.nfl_team),
      jerseyNumber: player.jersey_number ?? null,
      photoUrl: player.photo_url ?? null,
      byeWeek,
      // `designation`/`detail` stay the feed sync's (Tank01) - ESPN fills only
      // the `facts` sibling beside them, never replacing either (#1308 owner
      // ruling 2026-09-14: `players.injury_detail` still feeds live Edge
      // lines, the Draft board InjuryBadge and the public read model).
      injury: {
        designation: player.injury_status ?? null,
        detail: player.injury_detail ?? null,
        facts: espnFacts.injuryFacts,
      },
    },
    availability,
    // #1667: the Decision card's game context rides the one read, for any
    // player (rostered or not). `line`/`weather` are null on a bye.
    line,
    weather,
    opponents,
    decision: {
      projWeek: {
        week: effectiveWeek,
        points: pointsOf(projections, player.id),
        opponent: opponentByWeek.get(Number(effectiveWeek)) ?? null,
        // #1342 Ruling: the opponent Factor is the producer, ranked. Read off
        // the same `getWeekProjections` entry `pointsOf` already draws
        // `.points` from - no second query, no second producer.
        opponentRankVsPosition: opponentRankOf(projections, player.id),
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
    seasons,
    seasonEnd,
    // News (CONTEXT.md): two producers, ESPN's list winning when present and
    // the feed sync's single note the one fallback item (#1308, ADR 0041).
    news: espnFacts.news.length > 0
      ? espnFacts.news
      : (player.news ? [{ headline: player.news, source: 'feed', publishedAt: null, url: null }] : []),
    log,
    bio: espnFacts.bio,
    depth: espnFacts.depth,
    ownership: espnFacts.ownership,
  };
}

module.exports = {
  PlayerCardError,
  getPlayerCard,
  upgradesFor,
  availabilityFor,
  availabilityForMany,
  buildWeeksForPage,
};
