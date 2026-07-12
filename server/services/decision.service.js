const pool = require('../modules/pool');
const {
  getWeekProjections,
  getRestOfSeasonProjections,
  getPositionDefense,
} = require('./projection.service');
const {
  getLineup,
  optimalLineup,
  parseLineupSettings,
  slotEligible,
  materializeLineup,
} = require('./lineup.service');

class DecisionError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const BENCH = 'BENCH';
const IR = 'IR';

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

/** Accepts either a raw number or a { points, source } projection entry. */
function pointsOf(projections, playerId) {
  const value = projections.get(playerId);
  if (value == null) return 0;
  const raw = typeof value === 'object' ? value.points : value;
  return Number(raw) || 0;
}

/** Map nflTeam -> opponent for a given (season, week), from the synced schedule. */
async function getWeekOpponents({ season, week }) {
  const result = await pool.query(
    `SELECT "nfl_team", "opponent" FROM "nfl_games" WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );
  return new Map(result.rows.map((r) => [r.nfl_team, r.opponent]));
}

// ---------------------------------------------------------------------------
// 1. Start/sit advice
// ---------------------------------------------------------------------------

/**
 * Pure: compare each starting slot's current player against the best eligible
 * bench player, suggesting a swap only when the bench player projects
 * strictly higher. A bench player is used for at most one suggestion.
 *
 * lineupEntries: [{ playerId, name, position, slot, locked? }] (slot includes
 * BENCH/IR). Locked players (game already kicked off) can't be moved by
 * setLineup, so they're excluded from both sides of any suggestion.
 * projections: Map playerId -> points (number or { points, source }).
 * defenseByPlayer: Map playerId -> { opponent, opponentPointsAllowed }.
 * Returns { projectedTotal, optimalTotal, suggestions }.
 */
function buildSuggestions(lineupEntries, projections, defenseByPlayer = new Map()) {
  const allStarters = lineupEntries.filter((e) => e.slot !== BENCH && e.slot !== IR);
  const swappable = allStarters.filter((e) => !e.locked);
  const bench = lineupEntries.filter((e) => e.slot === BENCH && !e.locked);

  const contextFor = (playerId) =>
    defenseByPlayer.get(playerId) || { opponent: null, opponentPointsAllowed: null };

  // The projected total covers the WHOLE lineup, locked starters included —
  // locking only limits which swaps can still be suggested.
  let projectedTotal = 0;
  for (const starter of allStarters) projectedTotal += pointsOf(projections, starter.playerId);
  projectedTotal = round2(projectedTotal);

  const usedBench = new Set();
  const suggestions = [];
  for (const starter of swappable) {
    const currentProjection = pointsOf(projections, starter.playerId);
    let best = null;
    let bestProjection = -Infinity;
    for (const candidate of bench) {
      if (usedBench.has(candidate.playerId)) continue;
      if (!slotEligible(starter.slot, candidate.position)) continue;
      const candidateProjection = pointsOf(projections, candidate.playerId);
      if (candidateProjection > bestProjection) {
        best = candidate;
        bestProjection = candidateProjection;
      }
    }
    if (best && bestProjection > currentProjection) {
      usedBench.add(best.playerId);
      suggestions.push({
        slot: starter.slot,
        current: {
          playerId: starter.playerId,
          name: starter.name,
          projection: currentProjection,
          ...contextFor(starter.playerId),
        },
        suggested: {
          playerId: best.playerId,
          name: best.name,
          projection: bestProjection,
          ...contextFor(best.playerId),
        },
        gain: round2(bestProjection - currentProjection),
      });
    }
  }

  const optimalTotal = round2(
    projectedTotal + suggestions.reduce((sum, s) => sum + s.gain, 0)
  );

  return { projectedTotal, optimalTotal, suggestions };
}

/**
 * Start/sit advice for the caller's team: the current lineup vs. the best
 * available swap at each starting slot, with opponent-difficulty context.
 */
async function startSitAdvice({ leagueId, userId, week }) {
  const leagueCheck = await pool.query(
    `SELECT "best_ball" FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  if (leagueCheck.rows[0] && leagueCheck.rows[0].best_ball) {
    throw new DecisionError(409, 'best-ball leagues set lineups automatically — no advice to give');
  }
  const lineup = await getLineup({ leagueId, userId, week });
  // The lineup's own season is authoritative — a caller-supplied season that
  // disagreed with it would pair this lineup with another year's projections.
  const effectiveSeason = lineup.season;
  const effectiveWeek = lineup.week;

  const [projections, defense, opponents] = await Promise.all([
    getWeekProjections({ season: effectiveSeason, week: effectiveWeek }),
    getPositionDefense({ season: effectiveSeason, uptoWeek: effectiveWeek }),
    getWeekOpponents({ season: effectiveSeason, week: effectiveWeek }),
  ]);

  const defenseByPlayer = new Map();
  for (const entry of lineup.entries) {
    const opponent = opponents.get(entry.nfl_team) || null;
    const teamDefense = opponent ? defense.get(opponent) : null;
    const opponentPointsAllowed = teamDefense ? teamDefense[entry.position] ?? null : null;
    defenseByPlayer.set(entry.id, { opponent, opponentPointsAllowed });
  }

  const lineupEntries = lineup.entries.map((e) => ({
    playerId: e.id,
    name: e.name,
    position: e.position,
    slot: e.slot,
    locked: Boolean(e.locked),
  }));

  const { projectedTotal, optimalTotal, suggestions } = buildSuggestions(
    lineupEntries,
    projections,
    defenseByPlayer
  );

  return { week: effectiveWeek, season: effectiveSeason, projectedTotal, optimalTotal, suggestions };
}

// ---------------------------------------------------------------------------
// 2. Hindsight (actual vs. optimal lineup for finished weeks)
// ---------------------------------------------------------------------------

async function assertLeagueAndTeam({ leagueId, teamId }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new DecisionError(404, 'league not found');
  const teamResult = await pool.query(
    `SELECT 1 FROM "teams" WHERE "id" = $1 AND "league_id" = $2`,
    [teamId, leagueId]
  );
  if (!teamResult.rows[0]) throw new DecisionError(404, 'team not found in this league');
  return league;
}

/** Is every matchup for this league/season/week marked final? (no matchups = not final) */
async function isWeekFinal({ leagueId, season, week }) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS "n", BOOL_AND("final") AS "all_final"
     FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
    [leagueId, season, week]
  );
  const row = result.rows[0];
  return Number(row.n) > 0 && row.all_final === true;
}

/**
 * Actual vs. optimal lineup for one FINAL week: actual = the team's starters'
 * fantasy_points; optimal = optimalLineup() over every rostered player that
 * week using their actual fantasy_points.
 */
async function weekHindsight({ leagueId, teamId, season, week }) {
  const league = await assertLeagueAndTeam({ leagueId, teamId });
  if (!(await isWeekFinal({ leagueId, season, week }))) {
    throw new DecisionError(409, `week ${week} is not final yet`);
  }

  const entriesResult = await pool.query(
    `SELECT "lineup_entries"."player_id", "players"."name", "players"."position",
            "lineup_entries"."slot",
            COALESCE("player_stats"."fantasy_points", 0) AS "fantasy_points"
     FROM "lineup_entries"
     JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
     LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
       AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
     WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
       AND "lineup_entries"."week" = $3`,
    [teamId, season, week]
  );

  let actualPoints = 0;
  const pointsFor = new Map();
  const players = [];
  const nameById = new Map();
  for (const row of entriesResult.rows) {
    const points = Number(row.fantasy_points) || 0;
    pointsFor.set(row.player_id, points);
    players.push({ playerId: row.player_id, position: row.position });
    nameById.set(row.player_id, row.name);
    if (row.slot !== BENCH && row.slot !== IR) actualPoints += points;
  }
  actualPoints = round2(actualPoints);

  const settings = parseLineupSettings(league);
  const optimal = optimalLineup(players, settings.lineupSlots, pointsFor);
  const optimalStarters = optimal.starters.map((s) => ({ ...s, name: nameById.get(s.playerId) }));
  const optimalPoints = optimal.total;
  const pointsLeftOnBench = Math.max(0, round2(optimalPoints - actualPoints));

  return { teamId, week, actualPoints, optimalPoints, pointsLeftOnBench, optimalStarters };
}

/** weekHindsight for every FINAL regular-season week, plus season totals. */
async function seasonHindsight({ leagueId, teamId, season }) {
  const league = await assertLeagueAndTeam({ leagueId, teamId });

  const weeks = [];
  for (let week = 1; week <= league.regular_season_weeks; week++) {
    try {
      weeks.push(await weekHindsight({ leagueId, teamId, season, week }));
    } catch (error) {
      if (error instanceof DecisionError && error.statusCode === 409) continue; // not final yet
      throw error;
    }
  }

  const totalActual = round2(weeks.reduce((sum, w) => sum + w.actualPoints, 0));
  const totalOptimal = round2(weeks.reduce((sum, w) => sum + w.optimalPoints, 0));
  const totalPointsLeftOnBench = round2(weeks.reduce((sum, w) => sum + w.pointsLeftOnBench, 0));

  return { teamId, weeks, totalActual, totalOptimal, totalPointsLeftOnBench };
}

// ---------------------------------------------------------------------------
// 3. Trade analyzer
// ---------------------------------------------------------------------------

/**
 * Pure: adjust a rest-of-season value for roster fit. If the receiving
 * roster already fills every starting slot this position is eligible for
 * (dedicated slot(s) + FLEX, when eligible) the player is surplus (0.85x);
 * if none of those slots are currently filled, he's filling an empty
 * starting slot (1.15x); otherwise the value is unadjusted.
 */
function fitAdjustedValue(baseValue, position, rosterPositions, lineupSlots) {
  const dedicated = Number(lineupSlots[position]) || 0;
  const flexCapacity = slotEligible('FLEX', position) ? Number(lineupSlots.FLEX) || 0 : 0;
  const capacity = dedicated + flexCapacity;
  const filling = rosterPositions.filter((p) => p === position).length;

  if (capacity > 0 && filling === 0) return round2(baseValue * 1.15);
  if (filling >= capacity) return round2(baseValue * 0.85);
  return round2(baseValue);
}

/**
 * Pure: verdict from each side's fit-adjusted value RECEIVED. Within 10% of
 * each other (relative to the larger side) is 'fair'; otherwise it favors
 * whichever side received more value.
 */
function tradeVerdict(proposerGets, receiverGets) {
  const larger = Math.max(proposerGets, receiverGets);
  if (larger === 0) return 'fair';
  const diff = Math.abs(proposerGets - receiverGets);
  if (diff <= larger * 0.1) return 'fair';
  return proposerGets > receiverGets ? 'favors_proposer' : 'favors_receiver';
}

/**
 * Value both sides of a proposed (not-yet-submitted) trade with
 * rest-of-season projections, adjusted for roster fit on the RECEIVING side
 * of each player. Verdict compares the fit-adjusted totals each side gets.
 */
async function analyzeTrade({ leagueId, proposingTeamId, receivingTeamId, offeredPlayerIds, requestedPlayerIds }) {
  if (!Array.isArray(offeredPlayerIds) || offeredPlayerIds.length === 0 ||
      !Array.isArray(requestedPlayerIds) || requestedPlayerIds.length === 0) {
    throw new DecisionError(400, 'offeredPlayerIds and requestedPlayerIds must be non-empty arrays');
  }
  if (proposingTeamId === receivingTeamId) {
    throw new DecisionError(400, 'cannot analyze a trade with yourself');
  }
  const overlap = offeredPlayerIds.filter((id) => requestedPlayerIds.includes(id));
  if (overlap.length > 0) {
    throw new DecisionError(400, 'a player cannot be on both sides of the trade');
  }

  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new DecisionError(404, 'league not found');

  const teamsResult = await pool.query(
    `SELECT "id" FROM "teams" WHERE "id" IN ($1, $2) AND "league_id" = $3`,
    [proposingTeamId, receivingTeamId, leagueId]
  );
  if (teamsResult.rows.length !== 2) {
    throw new DecisionError(404, 'both teams must belong to this league');
  }

  const allPlayerIds = [...offeredPlayerIds, ...requestedPlayerIds];
  const playersResult = await pool.query(`SELECT * FROM "players" WHERE "id" = ANY($1::int[])`, [allPlayerIds]);
  const playersById = new Map(playersResult.rows.map((p) => [p.id, p]));
  for (const id of allPlayerIds) {
    if (!playersById.has(id)) throw new DecisionError(404, `player ${id} not found`);
  }

  const rosterResult = await pool.query(
    `SELECT "team_players"."team_id", "players"."id" AS "player_id", "players"."position"
     FROM "team_players" JOIN "players" ON "players"."id" = "team_players"."player_id"
     WHERE "team_players"."team_id" IN ($1, $2)`,
    [proposingTeamId, receivingTeamId]
  );
  const proposingRoster = rosterResult.rows.filter((r) => r.team_id === proposingTeamId);
  const receivingRoster = rosterResult.rows.filter((r) => r.team_id === receivingTeamId);
  const proposingIds = new Set(proposingRoster.map((r) => r.player_id));
  const receivingIds = new Set(receivingRoster.map((r) => r.player_id));

  for (const id of offeredPlayerIds) {
    if (!proposingIds.has(id)) throw new DecisionError(400, `player ${id} is not on the proposing team's roster`);
  }
  for (const id of requestedPlayerIds) {
    if (!receivingIds.has(id)) throw new DecisionError(400, `player ${id} is not on the receiving team's roster`);
  }

  const fromWeek = league.current_week;
  const throughWeek = league.regular_season_weeks;
  const rosValues = await getRestOfSeasonProjections({ season: league.current_season, fromWeek, throughWeek });

  const settings = parseLineupSettings(league);
  const proposingPositions = proposingRoster.map((r) => r.position);
  const receivingPositions = receivingRoster.map((r) => r.position);

  const players = [];
  let proposerGives = 0;
  let receiverGives = 0;

  for (const id of offeredPlayerIds) {
    const player = playersById.get(id);
    const baseValue = Number(rosValues.get(id)) || 0;
    const fit = fitAdjustedValue(baseValue, player.position, receivingPositions, settings.lineupSlots);
    proposerGives += fit;
    players.push({
      playerId: id, name: player.name, position: player.position,
      rosValue: round2(baseValue), fitAdjustedValue: fit, direction: 'proposer_to_receiver',
    });
  }
  for (const id of requestedPlayerIds) {
    const player = playersById.get(id);
    const baseValue = Number(rosValues.get(id)) || 0;
    const fit = fitAdjustedValue(baseValue, player.position, proposingPositions, settings.lineupSlots);
    receiverGives += fit;
    players.push({
      playerId: id, name: player.name, position: player.position,
      rosValue: round2(baseValue), fitAdjustedValue: fit, direction: 'receiver_to_proposer',
    });
  }

  proposerGives = round2(proposerGives);
  receiverGives = round2(receiverGives);
  const receiverGets = proposerGives; // what proposer sends is what receiver receives
  const proposerGets = receiverGives; // what receiver sends is what proposer receives

  const verdict = tradeVerdict(proposerGets, receiverGets);

  return { verdict, proposerGives, proposerGets, receiverGives, receiverGets, players };
}

// ---------------------------------------------------------------------------
// 4. Waiver suggestions
// ---------------------------------------------------------------------------

/**
 * Pure: rank free-agent candidates by how much they'd upgrade the weakest
 * current starter among the slots they're eligible for (FLEX included).
 * candidates: [{ playerId, name, position, nflTeam, projection }].
 * currentStarters: [{ playerId, slot, projection }] (starting slots only).
 * Returns the top 25, each annotated with weakestStarterProjection and
 * upgradeDelta, sorted by upgradeDelta descending.
 */
function rankWaiverCandidates(candidates, currentStarters, lineupSlots) {
  const eligibleSlotsByPosition = new Map();
  const eligibleSlotsFor = (position) => {
    if (!eligibleSlotsByPosition.has(position)) {
      eligibleSlotsByPosition.set(
        position,
        Object.keys(lineupSlots).filter((slot) => (lineupSlots[slot] || 0) > 0 && slotEligible(slot, position))
      );
    }
    return eligibleSlotsByPosition.get(position);
  };

  const ranked = candidates.map((candidate) => {
    const eligibleSlots = eligibleSlotsFor(candidate.position);
    const relevant = currentStarters.filter((s) => eligibleSlots.includes(s.slot));
    const weakestStarterProjection = relevant.length === 0
      ? 0
      : Math.min(...relevant.map((s) => Number(s.projection) || 0));
    const upgradeDelta = round2((Number(candidate.projection) || 0) - weakestStarterProjection);
    return { ...candidate, weakestStarterProjection: round2(weakestStarterProjection), upgradeDelta };
  });

  ranked.sort((a, b) => b.upgradeDelta - a.upgradeDelta);
  return ranked.slice(0, 25);
}

/** Waiver-wire suggestions for the caller's team: unrostered players ranked as upgrades. */
async function waiverSuggestions({ leagueId, userId, season, week }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new DecisionError(404, 'league not found');
  const teamResult = await pool.query(
    `SELECT "id" FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
    [leagueId, userId]
  );
  const team = teamResult.rows[0];
  if (!team) throw new DecisionError(403, 'you do not have a team in this league');

  const effectiveSeason = season || league.current_season;
  const effectiveWeek = week || league.current_week;
  const settings = parseLineupSettings(league);
  const projections = await getWeekProjections({ season: effectiveSeason, week: effectiveWeek });

  const client = await pool.connect();
  let starterRows;
  try {
    await client.query('BEGIN');
    await materializeLineup(client, {
      leagueId, teamId: team.id, season: effectiveSeason, week: effectiveWeek,
    });
    const result = await client.query(
      `SELECT "player_id", "slot" FROM "lineup_entries"
       WHERE "team_id" = $1 AND "season" = $2 AND "week" = $3 AND "slot" NOT IN ('BENCH', 'IR')`,
      [team.id, effectiveSeason, effectiveWeek]
    );
    starterRows = result.rows;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const currentStarters = starterRows.map((r) => ({
    playerId: r.player_id,
    slot: r.slot,
    projection: pointsOf(projections, r.player_id),
  }));

  const availableResult = await pool.query(
    `SELECT "players"."id", "players"."name", "players"."position", "players"."nfl_team"
     FROM "players"
     WHERE NOT EXISTS (
       SELECT 1 FROM "team_players"
       WHERE "team_players"."league_id" = $1 AND "team_players"."player_id" = "players"."id"
     )`,
    [leagueId]
  );
  const candidates = availableResult.rows.map((p) => ({
    playerId: p.id,
    name: p.name,
    position: p.position,
    nflTeam: p.nfl_team,
    projection: pointsOf(projections, p.id),
  }));

  const suggestions = rankWaiverCandidates(candidates, currentStarters, settings.lineupSlots);
  return { suggestions };
}

module.exports = {
  DecisionError,
  buildSuggestions,
  startSitAdvice,
  weekHindsight,
  seasonHindsight,
  fitAdjustedValue,
  tradeVerdict,
  analyzeTrade,
  rankWaiverCandidates,
  waiverSuggestions,
};
