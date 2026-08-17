const pool = require('../modules/pool');
// The two service objects are kept whole (rather than destructured) where the
// call is a seam a test needs to replace: a destructured binding is captured at
// require time and cannot be mocked afterwards.
const projectionService = require('./projection.service');
const lineupService = require('./lineup.service');
const { requireMember } = require('./leagueRole.service');
const {
  getWeekProjections,
  toLegacyProjectionMap,
  getTradeProjectionMetrics,
} = require('./projection.service');
const {
  optimalLineup,
  parseLineupSettings,
  slotEligible,
  materializeLineup,
  DEFAULT_ROSTER_SLOTS,
} = require('./lineup.service');
const { optimalAssignment, buildSwapSuggestions } = require('./lineupOptimizer');
const projectionModel = require('./projectionModel');

class DecisionError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const BENCH = 'BENCH';
const IR = 'IR';

// Above this the suggested player is a real edge; at or below it the two
// distributions overlap enough that the honest answer is "watch it".
const TOSSUP_PROBABILITY = 0.6;

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

/** Accepts a raw number or a { points, ... } projection entry; missing/null -> null. */
function detailOf(projections, playerId) {
  const value = projections.get(playerId);
  if (value == null) return { points: null };
  if (typeof value !== 'object') {
    return { points: Number.isFinite(Number(value)) ? Number(value) : null };
  }
  const points = Number.isFinite(Number(value.points)) ? Number(value.points) : null;
  return { ...value, points };
}

/**
 * Pure: the exact best legal lineup, plus the subset of changes expressible as
 * the one-for-one swap the Apply button performs.
 *
 * Replaces a greedy per-slot scan that could not see past a FLEX-style slot
 * taking the player a dedicated slot needed (see lineupOptimizer.js for the
 * worked counterexample), and that never noticed an EMPTY starting slot at
 * all. Two deliberate behavior changes follow from that:
 *
 *  - a bench player is now recommended into an empty starting slot, not just
 *    as a replacement for an occupied one;
 *  - `optimalTotal` is the optimizer's own total rather than
 *    `projectedTotal + sum(gains)`, so a three-way shuffle reports the real
 *    ceiling even though only part of it is a displayable pairwise swap. The
 *    complete answer is always in `movePlan`.
 *
 * Availability is applied BEFORE optimization, not as a haircut afterwards:
 * a player on a bye, ruled Out, or on IR is not a candidate at all; a locked
 * starter is pinned to his slot; a locked bench player can never be started;
 * and a Doubtful bench player is never auto-promoted over a healthy starter,
 * because there is no reliable active-probability data to make that trade
 * against (see projectionModel.availabilityFor).
 *
 * lineupEntries: [{ playerId, name, position, slot, locked?, injuryStatus?,
 * onBye? }] (slot includes BENCH/IR).
 * projections: Map playerId -> points (number or { points, ... }).
 * defenseByPlayer: Map playerId -> { opponent, opponentPointsAllowed }.
 */
function buildSuggestions(lineupEntries, projections, defenseByPlayer = new Map(), rosterSlots = undefined, options = undefined) {
  const slots = rosterSlots && rosterSlots.length > 0 ? rosterSlots : DEFAULT_ROSTER_SLOTS;
  // What the optimizer RANKS by ('median' shipped, 'mean' measured better -
  // see MODEL_CONSTANTS.decision). Injectable for tests and sweeps; every
  // production caller takes the constant.
  const lineupRanking = (options && options.lineupRanking)
    || (projectionModel.MODEL_CONSTANTS.decision || {}).lineupRanking
    || 'median';
  const entries = (lineupEntries || []).map((e) => ({ ...e, locked: Boolean(e.locked) }));
  const isStarter = (e) => e.slot !== BENCH && e.slot !== IR;
  const startingSlots = new Set(entries.filter(isStarter).map((e) => e.slot));

  const contextFor = (playerId) =>
    defenseByPlayer.get(playerId) || { opponent: null, opponentPointsAllowed: null };

  const availabilityById = new Map();
  const pinned = new Map();
  const candidates = [];
  for (const entry of entries) {
    const availability = projectionModel.availabilityFor({
      injuryStatus: entry.injuryStatus ?? entry.injury_status ?? null,
      onBye: Boolean(entry.onBye),
      locked: entry.locked,
      lockedSlot: entry.slot,
    });
    availabilityById.set(entry.playerId, availability);
    if (entry.slot === IR) continue; // IR is never a lineup candidate
    if (entry.locked) {
      // Locked starters keep their slot; locked bench players cannot be started.
      if (isStarter(entry)) pinned.set(entry.playerId, entry.slot);
      continue;
    }
    if (!availability.available) continue; // bye / Out / IR designation
    if (availability.autoRecommend === false && !isStarter(entry)) continue; // Doubtful on the bench
    candidates.push({ playerId: entry.playerId, position: entry.position });
  }

  // A player who cannot play is worth exactly 0 this week, so that is what
  // every total and comparison uses. Without this a starter on a bye keeps his
  // full projection, the lineup total overstates itself, and no replacement is
  // ever recommended because the bye player "outprojects" the healthy bench.
  const effectiveProjection = (playerId) => {
    const detail = detailOf(projections, playerId);
    const availability = availabilityById.get(playerId);
    if (availability && !availability.available) {
      // The DISTRIBUTION goes too, not just the mean. A player who cannot play
      // has no distribution of outcomes, and keeping one produced the nonsense
      // "0 (6.82-7.62)" — a zero next to a range that excludes zero. Dropping
      // it also correctly makes probabilityBetter null: there are no odds to
      // quote against someone who is not on the field.
      return {
        ...detail,
        points: 0,
        projection: null,
        unavailable: true,
        unavailableReason: availability.reason,
      };
    }
    return detail;
  };
  const effectivePoints = (playerId) => {
    const points = effectiveProjection(playerId).points;
    return Number.isFinite(Number(points)) ? Number(points) : 0;
  };
  const effectivePointsFor = new Map(entries.map((e) => [e.playerId, effectivePoints(e.playerId)]));

  // The optimizer's ranking values. At 'median' this IS effectivePointsFor -
  // the same Map object, so the shipped configuration cannot diverge by even a
  // rounding step. At 'mean' the rank is the distribution's mean (the
  // statistic that maximizes an expected total), falling back to the displayed
  // points for a projection with no distribution, and 0 for a player who
  // cannot play - the same zero the availability rule gives the display.
  const rankingPointsFor = lineupRanking !== 'mean' ? effectivePointsFor : new Map(entries.map((e) => {
    const detail = effectiveProjection(e.playerId);
    if (detail.unavailable) return [e.playerId, 0];
    const dist = detail.projection;
    const mean = dist && Number.isFinite(Number(dist.mean)) ? Number(dist.mean) : null;
    return [e.playerId, mean != null ? mean : effectivePoints(e.playerId)];
  }));

  // The projected total covers the WHOLE lineup, locked starters included —
  // locking only limits which swaps can still be suggested.
  let projectedTotal = 0;
  for (const starter of entries.filter(isStarter)) {
    projectedTotal += effectivePoints(starter.playerId);
  }
  projectedTotal = round2(projectedTotal);

  const optimal = optimalAssignment({
    rosterSlots: slots,
    candidates,
    pointsFor: rankingPointsFor,
    pinned,
  });

  // The DISPLAYED optimal total is always median-based points, whatever the
  // optimizer ranked by: under 'mean' the assignment's own totals are means,
  // and printing a mean next to per-player medians would be a total that does
  // not add up on screen. At 'median' the maps are the same object and this
  // recomputation reproduces optimal.total exactly.
  let optimalTotal = optimal.total;
  if (rankingPointsFor !== effectivePointsFor) {
    let displayTotal = 0;
    for (const assignment of optimal.assignments) {
      if (assignment.playerId != null) displayTotal += effectivePoints(assignment.playerId);
    }
    optimalTotal = round2(displayTotal);
  }

  const { swaps, fills } = buildSwapSuggestions({
    entries,
    optimalAssignments: optimal.assignments,
    optimalByPlayer: optimal.byPlayer,
    projectionOf: effectiveProjection,
    startingSlots,
  });

  const suggestions = swaps.map((swap) => {
    const currentPoints = swap.currentProjection.points;
    const suggestedPoints = swap.suggestedProjection.points;
    const probability = projectionModel.probabilityBetter(
      swap.suggestedProjection.projection,
      swap.currentProjection.projection
    );
    return {
      slot: swap.slot,
      current: {
        playerId: swap.out.playerId,
        name: swap.out.name,
        projection: currentPoints,
        ...contextFor(swap.out.playerId),
        distribution: swap.currentProjection.projection || null,
        confidence: swap.currentProjection.confidence || null,
        factors: swap.currentProjection.factors || null,
        availability: availabilityById.get(swap.out.playerId) || null,
      },
      suggested: {
        playerId: swap.in.playerId,
        name: swap.in.name,
        projection: suggestedPoints,
        ...contextFor(swap.in.playerId),
        distribution: swap.suggestedProjection.projection || null,
        confidence: swap.suggestedProjection.confidence || null,
        factors: swap.suggestedProjection.factors || null,
        availability: availabilityById.get(swap.in.playerId) || null,
      },
      gain: round2(suggestedPoints - currentPoints),
      probabilityBetter: probability,
      // A comparison the intervals say is close to a coin flip is a watch
      // item, not an instruction to change the lineup. The threshold is 0.6
      // rather than something tighter because probabilityBetter is computed
      // from five summary quantiles per side, so it resolves in steps of 0.04
      // around 0.5 — anything at or below 0.6 is inside that grid's noise.
      verdict: probability != null && probability <= TOSSUP_PROBABILITY ? 'tossup' : 'start',
      confidence: swap.suggestedProjection.confidence || null,
    };
  });

  // Empty starting slots a bench player should fill. The previous greedy
  // recommender could not see these at all: it only ever compared an OCCUPIED
  // slot against the bench, so a manager with an empty FLEX got silence.
  const openSlotFills = fills.map((fill) => ({
    slot: fill.slot,
    playerId: fill.in.playerId,
    name: fill.in.name,
    projection: fill.suggestedProjection.points,
    distribution: fill.suggestedProjection.projection || null,
    confidence: fill.suggestedProjection.confidence || null,
    factors: fill.suggestedProjection.factors || null,
    ...contextFor(fill.in.playerId),
  }));

  // The complete answer, including shuffles no single swap can express.
  const currentSlotById = new Map(entries.map((e) => [e.playerId, e.slot]));
  const movePlan = [];
  for (const assignment of optimal.assignments) {
    if (assignment.playerId == null || assignment.locked) continue;
    const from = currentSlotById.get(assignment.playerId);
    if (from === assignment.slotKey) continue;
    movePlan.push({ playerId: assignment.playerId, fromSlot: from ?? null, toSlot: assignment.slotKey });
  }
  for (const entry of entries) {
    if (!isStarter(entry) || entry.locked) continue;
    if (optimal.byPlayer.has(entry.playerId)) continue;
    movePlan.push({ playerId: entry.playerId, fromSlot: entry.slot, toSlot: BENCH });
  }

  const unavailable = entries
    .filter((e) => {
      const availability = availabilityById.get(e.playerId);
      return availability && !availability.available;
    })
    .map((e) => ({
      playerId: e.playerId,
      name: e.name,
      slot: e.slot,
      reason: availabilityById.get(e.playerId).reason,
    }));

  return {
    projectedTotal,
    optimalTotal,
    suggestions,
    openSlotFills,
    movePlan,
    unavailable,
  };
}

/**
 * Start/sit advice for the caller's team.
 *
 * Projections come from `free_baseline_v2`, scoped to the roster's player ids
 * and priced under THIS league's scoring rules — the engine is never asked to
 * project the entire NFL pool for one lineup view. Opponent difficulty is now
 * an input to the projection rather than decoration hung off it, but the
 * legacy `opponent` / `opponentPointsAllowed` display fields are still
 * populated from getPositionDefense so no client field changes type.
 */
async function startSitAdvice({ leagueId, userId, week }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new DecisionError(404, 'league not found');
  if (league.best_ball) {
    throw new DecisionError(409, 'best-ball leagues set lineups automatically, so there is no advice to give');
  }
  const lineup = await lineupService.getLineup({ leagueId, userId, week });
  // The lineup's own season is authoritative — a caller-supplied season that
  // disagreed with it would pair this lineup with another year's projections.
  const effectiveSeason = lineup.season;
  const effectiveWeek = lineup.week;
  const playerIds = lineup.entries.map((e) => e.id);

  const [run, defense, opponents] = await Promise.all([
    projectionService.getWeeklyProjections({
      season: effectiveSeason,
      week: effectiveWeek,
      league,
      playerIds,
    }),
    projectionService.getPositionDefense({ season: effectiveSeason, uptoWeek: effectiveWeek }),
    getWeekOpponents({ season: effectiveSeason, week: effectiveWeek }),
  ]);
  const projections = toLegacyProjectionMap(run);

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
    injuryStatus: e.injury_status || null,
    onBye: Boolean(e.onBye),
  }));

  const plan = buildSuggestions(
    lineupEntries,
    projections,
    defenseByPlayer,
    lineup.rosterSlots
  );

  const players = lineupEntries.map((entry) => {
    const detail = detailOf(projections, entry.playerId);
    return {
      playerId: entry.playerId,
      name: entry.name,
      slot: entry.slot,
      projection: detail.points,
      distribution: detail.projection || null,
      confidence: detail.confidence || null,
      activeProbability: detail.activeProbability ?? null,
      factors: detail.factors || null,
      ...defenseByPlayer.get(entry.playerId),
    };
  });

  return {
    // Legacy fields, unchanged in name and type.
    week: effectiveWeek,
    season: effectiveSeason,
    projectedTotal: plan.projectedTotal,
    optimalTotal: plan.optimalTotal,
    suggestions: plan.suggestions,
    // Additive.
    modelVersion: run.modelVersion,
    generatedAt: run.generatedAt,
    inputCutoff: run.inputCutoff,
    sourceCoverage: run.sourceCoverage,
    openSlotFills: plan.openSlotFills,
    movePlan: plan.movePlan,
    unavailable: plan.unavailable,
    players,
  };
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
  const optimal = optimalLineup(players, settings.rosterSlots, pointsFor);
  const optimalStarters = optimal.starters.map((s) => ({ ...s, name: nameById.get(s.playerId) }));
  const optimalPoints = optimal.total;
  const pointsLeftOnBench = Math.max(0, round2(optimalPoints - actualPoints));

  return { teamId, week, actualPoints, optimalPoints, pointsLeftOnBench, optimalStarters };
}

/**
 * LIVE (in-progress week) counterpart to weekHindsight: actual points so far
 * vs. the best legal lineup achievable from here, using each player's CURRENT
 * fantasy_points. Read-only — it never changes a lineup.
 *
 * Locks are respected: a player whose real game has kicked off can't be moved,
 * so locked players are excluded from swap suggestions entirely. The returned
 * `swaps` therefore only lists actionable bench-for-starter upgrades among
 * still-unlocked players; `delta` is their combined gain.
 */
async function liveWhatIf({ leagueId, teamId, season, week }) {
  const league = await assertLeagueAndTeam({ leagueId, teamId });
  await materializeLineup(pool, { leagueId, teamId, season, week });

  const rows = await pool.query(
    `SELECT "lineup_entries"."player_id", "players"."name", "players"."position",
            "players"."nfl_team", "lineup_entries"."slot",
            COALESCE("player_stats"."fantasy_points", 0) AS "fantasy_points",
            ("nfl_games"."kickoff_at" IS NOT NULL AND "nfl_games"."kickoff_at" <= now()) AS "locked"
     FROM "lineup_entries"
     JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
     LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
       AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
     LEFT JOIN "nfl_games" ON "nfl_games"."nfl_team" = "players"."nfl_team"
       AND "nfl_games"."season" = $2 AND "nfl_games"."week" = $3
     WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
       AND "lineup_entries"."week" = $3`,
    [teamId, season, week]
  );

  let actualPoints = 0;
  const pointsFor = new Map();
  const nameById = new Map();
  const lockedById = new Map();
  // Only unlocked players are candidates for the "what you could still do" pool;
  // locked players stay wherever they are.
  const candidatePool = [];
  const currentStarterIds = new Set();
  for (const row of rows.rows) {
    const points = Number(row.fantasy_points) || 0;
    pointsFor.set(row.player_id, points);
    nameById.set(row.player_id, row.name);
    lockedById.set(row.player_id, row.locked === true);
    const isStarter = row.slot !== BENCH && row.slot !== IR;
    if (isStarter) {
      actualPoints += points;
      currentStarterIds.add(row.player_id);
    }
    if (row.locked !== true) {
      candidatePool.push({ playerId: row.player_id, position: row.position });
    }
  }
  actualPoints = round2(actualPoints);

  const settings = parseLineupSettings(league);
  // Optimal over the actionable pool. Locked starters are pinned by adding them
  // back as forced candidates so the optimizer keeps their slots realistic.
  const forced = rows.rows
    .filter((r) => r.locked === true && currentStarterIds.has(r.player_id))
    .map((r) => ({ playerId: r.player_id, position: r.position }));
  const optimal = optimalLineup([...candidatePool, ...forced], settings.rosterSlots, pointsFor);
  const optimalIds = new Set(optimal.starters.map((s) => s.playerId));

  // Actionable swaps: an unlocked bench player the optimizer promotes, replacing
  // an unlocked current starter it benches.
  const swapsIn = optimal.starters
    .filter((s) => !currentStarterIds.has(s.playerId) && !lockedById.get(s.playerId))
    .map((s) => ({ playerId: s.playerId, name: nameById.get(s.playerId), points: round2(pointsFor.get(s.playerId) || 0) }));
  const swapsOut = [...currentStarterIds]
    .filter((id) => !optimalIds.has(id) && !lockedById.get(id))
    .map((id) => ({ playerId: id, name: nameById.get(id), points: round2(pointsFor.get(id) || 0) }));

  const swaps = [];
  const outSorted = swapsOut.sort((a, b) => a.points - b.points);
  swapsIn
    .sort((a, b) => b.points - a.points)
    .forEach((inP, i) => {
      const outP = outSorted[i];
      if (outP && inP.points > outP.points) {
        swaps.push({ out: outP, in: inP, gain: round2(inP.points - outP.points) });
      }
    });

  const delta = round2(swaps.reduce((sum, s) => sum + s.gain, 0));
  return { teamId, week, actualPoints, optimalPoints: round2(actualPoints + delta), delta, swaps };
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
 * (dedicated slot(s) + any flex-style slot that also takes it) the player is
 * surplus (0.85x); if none of those slots are currently filled, he's filling
 * an empty starting slot (1.15x); otherwise the value is unadjusted.
 *
 * "Dedicated" vs. "flex-style" is read off each slot's own eligiblePositions
 * length (1 entry = dedicated to that one position/group; 2+ = a flex-style
 * slot), generalizing the old FLEX-only special case to any number of
 * differently-configured flex/superflex/DP slots.
 */
function fitAdjustedValue(baseValue, position, rosterPositions, rosterSlots) {
  let dedicated = 0;
  let flexCapacity = 0;
  for (const slot of rosterSlots) {
    if (!slotEligible(slot.key, position, rosterSlots)) continue;
    if ((slot.eligiblePositions || []).length === 1) dedicated += slot.count;
    else flexCapacity += slot.count;
  }
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

function emptyTradeAggregate() {
  return {
    seasonTotalPoints: 0,
    perGameProjection: 0,
    historicalWeeklyAverage: 0,
    restOfSeasonValue: 0,
  };
}

function addTradeMetrics(aggregate, metrics) {
  for (const key of Object.keys(aggregate)) {
    aggregate[key] = round2(aggregate[key] + finiteNumber(metrics && metrics[key]));
  }
}

function tradeFairnessSummary(offeredTotal, requestedTotal) {
  const offered = finiteNumber(offeredTotal);
  const requested = finiteNumber(requestedTotal);
  const larger = Math.max(offered, requested);
  const fairnessMarginPct = larger === 0
    ? 0
    : round2((Math.abs(offered - requested) / larger) * 100);

  let statusBadge = 'Even / Fair';
  if (fairnessMarginPct > 35) statusBadge = 'Highly Imbalanced';
  else if (fairnessMarginPct > 15) statusBadge = 'Imbalanced';

  const isBlocked = fairnessMarginPct > 50;
  return {
    fairnessMarginPct,
    statusBadge,
    isBlocked,
    collusion_risk: isBlocked ? 'HIGH' : 'LOW',
  };
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
  const projectionMetrics = await getTradeProjectionMetrics({
    playerIds: allPlayerIds,
    season: league.current_season,
    fromWeek,
    throughWeek,
  });

  const settings = parseLineupSettings(league);
  const proposingPositions = proposingRoster.map((r) => r.position);
  const receivingPositions = receivingRoster.map((r) => r.position);

  const players = [];
  const aggregates = {
    offered: emptyTradeAggregate(),
    requested: emptyTradeAggregate(),
  };
  let proposerGives = 0;
  let receiverGives = 0;

  for (const id of offeredPlayerIds) {
    const player = playersById.get(id);
    const metrics = projectionMetrics.get(id) || emptyTradeAggregate();
    const baseValue = finiteNumber(metrics.restOfSeasonValue);
    const fit = fitAdjustedValue(baseValue, player.position, receivingPositions, settings.rosterSlots);
    proposerGives += fit;
    addTradeMetrics(aggregates.offered, metrics);
    players.push({
      playerId: id, name: player.name, position: player.position,
      seasonTotalPoints: round2(finiteNumber(metrics.seasonTotalPoints)),
      perGameProjection: round2(finiteNumber(metrics.perGameProjection)),
      historicalWeeklyAverage: round2(finiteNumber(metrics.historicalWeeklyAverage)),
      rosValue: round2(baseValue), fitAdjustedValue: fit, direction: 'proposer_to_receiver',
    });
  }
  for (const id of requestedPlayerIds) {
    const player = playersById.get(id);
    const metrics = projectionMetrics.get(id) || emptyTradeAggregate();
    const baseValue = finiteNumber(metrics.restOfSeasonValue);
    const fit = fitAdjustedValue(baseValue, player.position, proposingPositions, settings.rosterSlots);
    receiverGives += fit;
    addTradeMetrics(aggregates.requested, metrics);
    players.push({
      playerId: id, name: player.name, position: player.position,
      seasonTotalPoints: round2(finiteNumber(metrics.seasonTotalPoints)),
      perGameProjection: round2(finiteNumber(metrics.perGameProjection)),
      historicalWeeklyAverage: round2(finiteNumber(metrics.historicalWeeklyAverage)),
      rosValue: round2(baseValue), fitAdjustedValue: fit, direction: 'receiver_to_proposer',
    });
  }

  proposerGives = round2(proposerGives);
  receiverGives = round2(receiverGives);
  const receiverGets = proposerGives; // what proposer sends is what receiver receives
  const proposerGets = receiverGives; // what receiver sends is what proposer receives

  const fairness = tradeFairnessSummary(
    aggregates.offered.restOfSeasonValue,
    aggregates.requested.restOfSeasonValue
  );
  const verdict = fairness.isBlocked
    ? 'collusion_risk'
    : tradeVerdict(proposerGets, receiverGets);

  return {
    verdict,
    ...fairness,
    proposerGives,
    proposerGets,
    receiverGives,
    receiverGets,
    aggregates,
    players,
  };
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
function rankWaiverCandidates(candidates, currentStarters, rosterSlots) {
  const eligibleSlotsByPosition = new Map();
  const eligibleSlotsFor = (position) => {
    if (!eligibleSlotsByPosition.has(position)) {
      eligibleSlotsByPosition.set(
        position,
        rosterSlots
          .filter((s) => s.count > 0 && slotEligible(s.key, position, rosterSlots))
          .map((s) => s.key)
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
  const team = await requireMember(pool, { leagueId, userId });

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

  const suggestions = rankWaiverCandidates(candidates, currentStarters, settings.rosterSlots);
  return { suggestions };
}

module.exports = {
  DecisionError,
  buildSuggestions,
  startSitAdvice,
  weekHindsight,
  liveWhatIf,
  seasonHindsight,
  fitAdjustedValue,
  tradeVerdict,
  tradeFairnessSummary,
  analyzeTrade,
  rankWaiverCandidates,
  waiverSuggestions,
};
