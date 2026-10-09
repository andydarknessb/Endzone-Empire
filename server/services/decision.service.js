const pool = require('../modules/pool');
// The two service objects are kept whole (rather than destructured) where the
// call is a seam a test needs to replace: a destructured binding is captured at
// require time and cannot be mocked afterwards.
const projectionService = require('./projection.service');
const lineupService = require('./lineup.service');
const {
  getTradeProjectionMetrics,
} = require('./projection.service');
const {
  optimalLineup,
  parseLineupSettings,
  slotEligible,
  materializeLineup,
  lockedPlayerIds,
  DEFAULT_ROSTER_SLOTS,
} = require('./lineup.service');
const { optimalAssignment, buildSwapSuggestions } = require('./lineupOptimizer');
const projectionModel = require('./projectionModel');
const { verdictBand } = require('./intervalReading');
const { normalizeNflTeam } = require('./nflTeam');
// The schedule read start/sit advice pairs with getPositionDefense below;
// shared with the Players page rather than copied (#1574, #1136).
const { getWeekOpponents } = require('./nflWeekOpponents');
// The Decision card's Line, weather and Volatility loaders, reused for the
// start/sit card's fact chips (#1853) and tags (#1858) rather than read a second way.
const decisionCardContext = require('./decisionCardContext.service');
// The ONE pricer the settle pass uses (scoring.service). Hindsight and the
// live what-if price a player-week the identical way the score of record does
// - `calculateFantasyPoints(stats, rulesForLeague(league))` - so a
// custom-scoring league's advisors never contradict its settled score (#739,
// ADR 0024). They read `player_stats.stats`, never the stored
// `fantasy_points` column, which is the DEFAULT-rules price.
const { calculateFantasyPoints, rulesForLeague } = require('./scoringRules');
const { countedRoster } = require('./countedRoster.service');
// The called shot's rows and rules (#1856). This module reads shots to pin
// their pairs; it never asks lineupOverride.service for advice (the router
// hands the declare path an advice loader), so the two do not require each other.
const lineupOverrideService = require('./lineupOverride.service');

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

// The advice wire's per-player verdict fields (spec #2042): the availability
// facts (probability, status, lock) without `reason`, and the one
// `startVerdict` that carries the reason. Both null when the player has none.
function wireVerdict(availability, startVerdict) {
  if (!availability) return { availability: null, startVerdict: null };
  const { reason, ...facts } = availability;
  return { availability: facts, startVerdict };
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------
// 1. Start/sit advice
// ---------------------------------------------------------------------------

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
 * and a Doubtful bench player, or a Position-baseline one (#1775: his number
 * is the position's average, not his own evidence) or a Backup quarterback
 * (ADR 0057), is never auto-promoted
 * over a healthy starter, because there is no reliable data to make that
 * trade against (see the Start verdict).
 *
 * lineupEntries: [{ playerId, name, position, slot, locked? }] (slot includes
 * BENCH/IR). Every availability fact comes from `projections`' Start verdict
 * (ADR 0061); the lock is the entry's own, composed beside it.
 * projections: the Weekly projection result object (`getWeeklyProjections`'s
 * return, #1703) - its `pointsFor`/`factorsFor`/`detailFor`/`startVerdictFor`
 * accessors and its own `projections` map (the raw run entries, for the full distribution and
 * for telling a present-but-no-estimate entry from an absent one) are the
 * only things read here.
 * options.calledShot (#1856): `{ starterId, benchedId }` of the team's open
 * called shot, pinned as described above.
 * defenseByPlayer: Map playerId -> { opponent, opponentPointsAllowed,
 * opponentApplied, line, weather, weatherApplied, marketApplied } (#1853: the
 * game's Line and weather for the start/sit card's fact chips, each with the
 * Factor's applied flag that decides the "context only" label; and #1858's
 * `volatility`, the player's Volatility tag or null, which rides to both sides
 * of every suggestion through the same spread).
 */
function buildSuggestions(lineupEntries, projections, defenseByPlayer = new Map(), rosterSlots = undefined, options = undefined) {
  const slots = rosterSlots && rosterSlots.length > 0 ? rosterSlots : DEFAULT_ROSTER_SLOTS;
  // What the optimizer RANKS by ('median' shipped, 'mean' measured better -
  // see MODEL_CONSTANTS.decision). Injectable for tests and sweeps; every
  // production caller takes the constant.
  const lineupRanking = (options && options.lineupRanking)
    || (projectionModel.MODEL_CONSTANTS.decision || {}).lineupRanking
    || 'median';
  const isStarter = (e) => e.slot !== BENCH && e.slot !== IR;
  // An open called shot (#1856) is treated exactly as a locked pair: its starter
  // keeps his slot and its benched player is never a candidate, so neither
  // player reaches a suggestion or the movePlan. It holds only while the
  // lineup still matches the shot (starter starting, benched player benched).
  const heldByShot = new Set();
  const shot = options && options.calledShot;
  if (shot) {
    const starterEntry = (lineupEntries || []).find((e) => e.playerId === shot.starterId);
    const benchedEntry = (lineupEntries || []).find((e) => e.playerId === shot.benchedId);
    if (starterEntry && benchedEntry && isStarter(starterEntry) && benchedEntry.slot === BENCH) {
      heldByShot.add(shot.starterId);
      heldByShot.add(shot.benchedId);
    }
  }
  const entries = (lineupEntries || []).map((e) => ({
    ...e,
    locked: Boolean(e.locked) || heldByShot.has(e.playerId),
  }));
  const startingSlots = new Set(entries.filter(isStarter).map((e) => e.slot));

  const contextFor = (playerId) =>
    defenseByPlayer.get(playerId)
    || { opponent: null, opponentPointsAllowed: null, line: null, weather: null, volatility: null };

  const availabilityById = new Map();
  const verdictById = new Map(); // the Start verdict, for ADR 0057's Backup zero
  const pinned = new Map();
  const candidates = [];
  for (const entry of entries) {
    // The Start verdict (spec #2042; ADR 0061) from the read, the one producer:
    // bye, No NFL team, Practice squad, Out, IR, Backup, Position-baseline,
    // Doubtful, no-practice and Questionable. The lock is a Lineup fact, so it
    // is composed beside the verdict here and is no part of it.
    const verdict = projections.startVerdictFor(entry.playerId);
    const available = verdict.outcome !== 'unavailable';
    const detail = projections.detailFor(entry.playerId);
    const stored = (projections.factorsFor(entry.playerId) || {}).availability || {};
    const availability = {
      available,
      ...(available && { autoRecommend: verdict.outcome === 'recommendable' }),
      activeProbability: available ? (detail && detail.activeProbability) ?? null : 0,
      reason: verdict.reason,
      status: stored.status || null,
      locked: entry.locked,
      lockedSlot: entry.slot,
    };
    availabilityById.set(entry.playerId, availability);
    verdictById.set(entry.playerId, verdict);
    if (entry.slot === IR) continue; // IR is never a lineup candidate
    if (entry.locked) {
      // Locked starters keep their slot; locked bench players cannot be started.
      if (isStarter(entry)) pinned.set(entry.playerId, entry.slot);
      continue;
    }
    if (!availability.available) continue; // bye / Out / IR designation
    // Doubtful, Position-baseline, Backup or no-practice on the bench. The
    // verdict gates too: a run that stored him Unavailable (a stale IR) is never
    // recommended whatever his live entry says.
    if (!isStarter(entry) && verdict.outcome !== 'recommendable') continue;
    candidates.push({ playerId: entry.playerId, position: entry.position });
  }

  // A player who cannot play is worth exactly 0 this week, so that is what
  // every total and comparison uses. Without this a starter on a bye keeps his
  // full projection, the lineup total overstates itself, and no replacement is
  // ever recommended because the bye player "outprojects" the healthy bench.
  const effectiveProjection = (playerId) => {
    // confidence/factors are read the same way whether or not the player can
    // play - only `points`/`projection` (the distribution) are overridden
    // below for an unavailable player, exactly as the legacy map's spread
    // (`{ ...detail, points: 0, projection: null, ... }`) always kept them.
    const detail = projections.detailFor(playerId);
    const confidence = (detail && detail.confidence) || null;
    const factors = projections.factorsFor(playerId);
    const availability = availabilityById.get(playerId);
    // A Backup quarterback (ADR 0057) is available but will not play: valued
    // at 0 here exactly like an Unavailable player, so a started Backup is
    // advised to the bench. His displayed number (`players[].projection`) stays.
    if (availability && (!availability.available || verdictById.get(playerId)?.reason === 'backup')) {
      // The DISTRIBUTION goes too, not just the mean. A player who cannot play
      // has no distribution of outcomes, and keeping one produced the nonsense
      // "0 (6.82-7.62)" — a zero next to a range that excludes zero. Dropping
      // it also correctly makes probabilityBetter null: there are no odds to
      // quote against someone who is not on the field.
      return {
        points: 0,
        projection: null,
        confidence,
        factors,
        unavailable: true,
        unavailableReason: availability.reason,
      };
    }
    // A player PRESENT in the run with no usable Point estimate is worth 0
    // (the legacy map's own contract every reader here has always kept -
    // `Number.isFinite(Number(null))` is true, so a present-but-null `points`
    // always read as 0); a player genuinely ABSENT from the run is null,
    // exactly what `pointsFor` itself already reports for that case.
    const hasEntry = projections.projections.has(playerId);
    const rawPoints = projections.pointsFor(playerId);
    const points = hasEntry ? (rawPoints == null ? 0 : rawPoints) : null;
    return {
      points,
      // The full raw entry, for `probabilityBetter` and the `distribution`
      // field on the wire - the run's own raw entry, never a second
      // producer.
      projection: projections.projections.get(playerId) || null,
      confidence,
      factors,
    };
  };
  const effectivePoints = (playerId) => {
    const points = effectiveProjection(playerId).points;
    return Number.isFinite(Number(points)) ? Number(points) : 0;
  };
  // The optimizer's ranking values: projection.service's `pointEstimateFor`
  // (#1483), the one ranking statistic - the same number the card headlines.
  // The statistic follows `lineupRanking` (the run's constants in production).
  // A projection with no distribution (a bare number, or `projection: null`)
  // ranks by its displayed points; a player who cannot play is worth 0, the
  // same zero the availability rule gives the display.
  const rankingConstants = { decision: { lineupRanking } };
  const rankingValues = new Map(entries.map((e) => {
    const detail = effectiveProjection(e.playerId);
    if (detail.unavailable) return [e.playerId, 0];
    const point = detail.projection
      ? projectionService.pointEstimateFor(detail.projection, rankingConstants)
      : null;
    return [e.playerId, point != null && Number.isFinite(Number(point))
      ? Number(point)
      : effectivePoints(e.playerId)];
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
    pointsFor: rankingValues,
    pinned,
  });

  // The DISPLAYED optimal total is always the DISPLAYED points
  // (`effectivePoints`), whatever the optimizer ranked by: the display and the
  // ranking read the same `pointEstimateFor` statistic, but this recomputation
  // keeps the total adding up on screen even for a projection whose displayed
  // points and distribution disagree, rather than mixing a ranking-only
  // number into a row of displayed per-player numbers.
  let displayTotal = 0;
  for (const assignment of optimal.assignments) {
    if (assignment.playerId != null) displayTotal += effectivePoints(assignment.playerId);
  }
  const optimalTotal = round2(displayTotal);

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
        ...wireVerdict(availabilityById.get(swap.out.playerId), verdictById.get(swap.out.playerId)),
      },
      suggested: {
        playerId: swap.in.playerId,
        name: swap.in.name,
        projection: suggestedPoints,
        ...contextFor(swap.in.playerId),
        distribution: swap.suggestedProjection.projection || null,
        confidence: swap.suggestedProjection.confidence || null,
        factors: swap.suggestedProjection.factors || null,
        ...wireVerdict(availabilityById.get(swap.in.playerId), verdictById.get(swap.in.playerId)),
      },
      gain: round2(suggestedPoints - currentPoints),
      probabilityBetter: probability,
      // A comparison the intervals say is close to a coin flip is a watch
      // item, not an instruction to change the lineup. The bands (tossup at or
      // below 0.6, strong at or above 0.8) live in Interval reading's
      // verdictBand. The tossup line is 0.6 rather than something tighter
      // because probabilityBetter is computed from five summary quantiles per
      // side, so it resolves in steps of 0.04 around 0.5 — anything at or
      // below 0.6 is inside that grid's noise.
      verdict: verdictBand(probability),
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
    // Every entry's verdict (the same object the suggestion sides carry), so
    // the wire's players[] rows read the reason off it.
    availabilityById,
    verdictById,
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
async function startSitAdvice({ leagueId, userId, week, ignoreCalledShot = false, now = new Date() }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new DecisionError(404, 'league not found');
  if (league.best_ball) {
    throw new DecisionError(409, 'best-ball leagues set lineups automatically, so there is no advice to give');
  }
  // `now` is the time the lineup's locks are read at: the override capture asks
  // for the advice as of a minute before a kickoff (#1862).
  const lineup = await lineupService.getLineup({ leagueId, userId, week, now });
  // The lineup's own season is authoritative — a caller-supplied season that
  // disagreed with it would pair this lineup with another year's projections.
  const effectiveSeason = lineup.season;
  const effectiveWeek = lineup.week;
  const playerIds = lineup.entries.map((e) => e.id);

  const [run, defense, opponents, gameChips] = await Promise.all([
    projectionService.getWeeklyProjections({
      season: effectiveSeason,
      week: effectiveWeek,
      league,
      playerIds,
    }),
    projectionService.getPositionDefense({ season: effectiveSeason, uptoWeek: effectiveWeek }),
    getWeekOpponents({ season: effectiveSeason, week: effectiveWeek }),
    // The Line and weather for the start/sit card's fact chips (#1853): the
    // Decision card's own loaders, one read per game. Optional context, so a
    // failed read degrades to no chips rather than no advice.
    decisionCardContext.loadGameChipContext({
      season: effectiveSeason,
      week: effectiveWeek,
      nflTeams: lineup.entries.map((e) => e.nfl_team),
    }).catch((err) => {
      console.error('start/sit advice: game context lookup failed, continuing without chips:', err.message);
      return new Map();
    }),
  ]);
  // The Volatility tags (#1858), one read of the run's rows for the roster's
  // positions. Optional context: a failed read degrades to no tags, not no advice.
  // The Decision card's own loader, so a player carries the same tag on both.
  const volatilityByPlayer = await decisionCardContext.loadVolatilityTags({
    season: effectiveSeason,
    week: effectiveWeek,
    rules: rulesForLeague(league),
    positions: lineup.entries.map((e) => e.position),
  }).catch((err) => {
    console.error('start/sit advice: volatility lookup failed, continuing without tags:', err.message);
    return new Map();
  });
  // `defense` (getPositionDefense) keys itself by Team code (#1154,
  // projection.service.js), the same vocabulary `opponents` above already
  // folds into (#1136), so this pairing is folded-on-folded with no local
  // remap: read `defense` directly with the already-canonical opponent.
  const defenseByPlayer = new Map();
  for (const entry of lineup.entries) {
    const opponent = opponents.get(normalizeNflTeam(entry.nfl_team)) || null;
    const teamDefense = opponent ? defense.get(opponent) : null;
    const opponentPointsAllowed = teamDefense ? teamDefense[entry.position] ?? null : null;
    // #1485: whether the projection engine actually APPLIED an opponent
    // factor for this player, as opposed to `opponentPointsAllowed` above
    // merely being displayable. The two can now disagree: `opponentPointsAllowed`
    // reads getPositionDefense's raw allowance regardless of sample size,
    // while the engine's own `factors.opponent.available` is the gated,
    // shrunk-and-possibly-seeded value that actually moved the projection.
    // Read straight off the projection the client will show, so a lineup that
    // only ever displays one number cannot silently disagree with itself.
    const opponentApplied = run.opponentAppliedFor(entry.id);
    const game = gameChips.get(normalizeNflTeam(entry.nfl_team)) || null;
    defenseByPlayer.set(entry.id, {
      opponent,
      opponentPointsAllowed,
      opponentApplied,
      // #1853: the game's Line and weather, each labelled by the Factor's own
      // applied flag (`scored`; both are 0-effect under v3.1) rather than by a
      // constant, so a Model version that applies them drops the label.
      line: game ? game.line : null,
      weather: game ? game.weather : null,
      weatherApplied: run.weatherAppliedFor(entry.id),
      marketApplied: run.marketAppliedFor(entry.id),
      volatility: volatilityByPlayer.get(entry.id) ?? null,
    });
  }

  const lineupEntries = lineup.entries.map((e) => ({
    playerId: e.id,
    name: e.name,
    position: e.position,
    slot: e.slot,
    locked: Boolean(e.locked),
  }));

  // The ranking statistic comes from the RUN's constants (#1483), read back
  // off the run's modelVersion, so a successor run ranks and displays the
  // same number and a v3.1 run keeps ranking on the median.
  const runConstants = projectionModel.constantsForVersion(run.modelVersion) || projectionModel.MODEL_CONSTANTS;
  // The team's called shot for the week (#1856), read BEFORE the suggestions
  // and the plan are built so the server pins its pair (the declare path asks
  // for the advice with the shot ignored, so a pair can be re-called). A shot
  // is a convenience on top of the advice: a failed read degrades to no shot
  // and no pin, never to no advice.
  let calledShot = null;
  if (!ignoreCalledShot && lineup.teamId != null) {
    try {
      calledShot = await lineupOverrideService.loadCalledShot(pool, {
        league, teamId: lineup.teamId, season: effectiveSeason, week: effectiveWeek,
      });
    } catch (err) {
      console.error('start/sit advice: called shot lookup failed, continuing without it:', err.message);
    }
  }
  // The manager's season points left and rank (#1861), from the stored weekly
  // rows. Optional context: a failed read degrades to no line, not no advice.
  let pointsLeft = null;
  if (lineup.teamId != null) {
    try {
      pointsLeft = await pointsLeftStanding(pool, {
        leagueId, season: effectiveSeason, teamId: lineup.teamId, throughWeek: league.regular_season_weeks,
      });
    } catch (err) {
      console.error('start/sit advice: points left lookup failed, continuing without it:', err.message);
    }
  }
  // The manager's season record against the Forecast and of Called shots
  // (#1862), private to this team. Optional context: a failed read degrades to
  // no lines, not no advice.
  let seasonRecord = { overrides: null, calledShots: null };
  if (lineup.teamId != null) {
    try {
      seasonRecord = await lineupOverrideService.loadSeasonRecord(pool, {
        leagueId, teamId: lineup.teamId, season: effectiveSeason,
      });
    } catch (err) {
      console.error('start/sit advice: season record lookup failed, continuing without it:', err.message);
    }
  }
  const plan = buildSuggestions(
    lineupEntries,
    run,
    defenseByPlayer,
    lineup.rosterSlots,
    {
      lineupRanking: (runConstants.decision || {}).lineupRanking,
      calledShot: calledShot && calledShot.status !== 'resolved'
        ? { starterId: calledShot.starter.playerId, benchedId: calledShot.benched.playerId }
        : null,
    }
  );

  const players = lineupEntries.map((entry) => {
    // Read straight off the result object (#1703): `pointsFor`/`factorsFor`
    // for the two accessor-backed fields, `detailFor` for confidence/active
    // probability, and the run's own `projections` map for the full
    // distribution the client charts - the run's own raw entry, never a second
    // producer.
    // A player PRESENT in the run with no usable Point estimate reads 0
    // (the legacy map's own "missing -> 0" contract); a player genuinely
    // ABSENT from the run reads null, same as `pointsFor` itself.
    const hasEntry = run.projections.has(entry.playerId);
    const rawPoints = run.pointsFor(entry.playerId);
    const detail = run.detailFor(entry.playerId);
    return {
      playerId: entry.playerId,
      name: entry.name,
      slot: entry.slot,
      projection: hasEntry ? (rawPoints == null ? 0 : rawPoints) : null,
      distribution: run.projections.get(entry.playerId) || null,
      confidence: (detail && detail.confidence) || null,
      activeProbability: (detail && detail.activeProbability) ?? null,
      factors: run.factorsFor(entry.playerId),
      // The verdict the plan gave him, as a suggestion side carries it: the
      // availability facts plus the one `startVerdict`, which the client reads
      // for "No practice this week" beside a Questionable tag (ADR 0056) among
      // others.
      ...wireVerdict(plan.availabilityById.get(entry.playerId), plan.verdictById.get(entry.playerId)),
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
    // The team's called shot for the week, or null (#1856): the pair, the
    // numbers as called and a status of pending, locked or resolved.
    calledShot,
    // `{ total, rank, teams }` of points left this season, or null (#1861).
    pointsLeft,
    // `{ hits, misses }` over this team's resolved Overrides and `{ hits,
    // resolved, streak }` over its resolved Called shots, or null (#1862).
    overrideRecord: seasonRecord.overrides,
    calledShotRecord: seasonRecord.calledShots,
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
 * points; optimal = optimalLineup() over the week AS PLAYED using their actual
 * points. Each player-week is priced from `player_stats.stats` under this
 * league's rules (the settle pass's pricer, #739, ADR 0024), never the stored
 * default-rules `fantasy_points` column.
 *
 * The pool is the settle pass's, read through `rowsHeldAsPlayed` (#736): a
 * row counts only if a tenure of this team covered its player's own kickoff
 * (#228), and in best ball the week's last kickoff too (#635, ADR 0022). A
 * post-game pickup was never startable, so he cannot have been "left on the
 * bench", and in best ball the optimal lineup over that pool IS the score of
 * record, so a best-ball team's actual is its optimal and nothing is ever
 * left on a bench nobody sets. The recap's blunder pick reads this number.
 *
 * IR: an IR occupant is never a candidate starter, in any league type, as in
 * the settle pass and the start/sit advisor (#741). Nothing in the product ever
 * advises STARTING an IR occupant (the start/sit advisor excludes IR outright),
 * so his points are never reported as left on the bench. The product does nag a
 * stale designation (digest) and refuse a lineup save that keeps an ineligible
 * player on IR (lineup.service), but that compels moving him OFF IR for
 * eligibility, never onto a starting slot; a stash that scored means his
 * designation was stale, not that he was startable. The best-ball and standard
 * branches treat IR identically.
 */
async function weekHindsight({ leagueId, teamId, season, week }) {
  const { counted, ...hindsight } = await weekHindsightRoster({ leagueId, teamId, season, week });
  return hindsight;
}

/**
 * weekHindsight's one read, plus the counted roster it priced: every
 * held-as-played, non-IR row as `{ playerId, position, slot, points, name, appeared }`,
 * BENCH rows included. The Captain Hindsight trophy (#1854) prices single
 * bench-for-starter moves over exactly this population and pricer, so it reads
 * the rows here rather than re-deriving them. `weekHindsight` returns the same
 * object minus `counted`, so its wire shape is unchanged.
 *
 * Each counted row also carries `appeared` (#1860): whether his stat line
 * records an Appearance (`madeAppearance`), which the Called shot judge reads.
 */
async function weekHindsightRoster({ leagueId, teamId, season, week }) {
  const league = await assertLeagueAndTeam({ leagueId, teamId });
  if (!(await isWeekFinal({ leagueId, season, week }))) {
    throw new DecisionError(409, `week ${week} is not final yet`);
  }

  const entriesResult = await pool.query(
    `SELECT "lineup_entries"."player_id", "players"."name", "players"."position",
            "players"."nfl_team", "lineup_entries"."slot", "player_stats"."stats"
     FROM "lineup_entries"
     JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
     LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
       AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
     WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
       AND "lineup_entries"."week" = $3`,
    [teamId, season, week]
  );
  const asPlayed = await lineupService.rowsHeldAsPlayed(pool, {
    league, teamId, season, week, rows: entriesResult.rows,
  });

  // Price each row through the settle pass's pricer under THIS league's rules,
  // not the stored default-rules `fantasy_points` column (#739). A row with no
  // `player_stats` match prices at 0, as the old COALESCE did.
  //
  // The IR classification, the started-total test (its dependence on the IR
  // drop happening first, #741), the pricing loop and the rounding are all the
  // counted-roster module's job now (#954); this reader owns the population
  // read above and the shape of what it returns. `actualPoints` is the module's
  // `teamScore` - the score of record for this team - so hindsight and the
  // settle pass cannot disagree.
  const rules = rulesForLeague(league);
  const price = (stats) => calculateFantasyPoints(stats, rules);
  const { counted, teamScore, optimalPoints, optimalStarters, pointsLeftOnBench } =
    countedRoster({ rows: asPlayed, league, price });

  const statsById = new Map(asPlayed.map((r) => [r.player_id, r.stats]));
  return {
    teamId, week, actualPoints: teamScore, optimalPoints, pointsLeftOnBench, optimalStarters,
    counted: counted.map((c) => ({ ...c, appeared: madeAppearance(statsById.get(c.playerId)) })),
  };
}

/** The `league_analytics` type holding every team's points left for one week (#1861, ADR 0054). */
const POINTS_LEFT_TYPE = 'points_left';

/**
 * Each team's points left on the bench over the season, summed from the stored
 * per-week rows (`{ teams: [{ teamId, pointsLeft }] }`), never recomputed from
 * Hindsight: a stored number is judged once and a correction never revisits it.
 * Returns Map(teamId -> total, two places); empty when no week has a row (best
 * ball and pick'em-only leagues never write one). Only weeks through
 * `throughWeek` count: the regular season, the weeks every team plays (a
 * playoff row holds only the teams still alive).
 */
async function seasonPointsLeft(db, { leagueId, season, throughWeek }) {
  const { rows } = await db.query(
    `SELECT "week", "data" FROM "league_analytics"
     WHERE "league_id" = $1 AND "season" = $2 AND "type" = $3 AND "week" <= $4`,
    [leagueId, season, POINTS_LEFT_TYPE, throughWeek]
  );
  const totals = new Map();
  for (const { data } of rows) {
    for (const { teamId, pointsLeft } of data.teams) {
      totals.set(Number(teamId), (totals.get(Number(teamId)) || 0) + Number(pointsLeft));
    }
  }
  return new Map([...totals].map(([teamId, total]) => [teamId, round2(total)]));
}

/**
 * The team's season points left and its rank among the league's teams, fewest
 * first (a tie shares the better rank): `{ total, rank, teams }`, or null when
 * the team has no stored week (nothing is stored in best ball or pick'em-only).
 */
async function pointsLeftStanding(db, { leagueId, season, teamId, throughWeek }) {
  const totals = await seasonPointsLeft(db, { leagueId, season, throughWeek });
  const total = totals.get(Number(teamId));
  if (total === undefined) return null;
  return { total, rank: 1 + [...totals.values()].filter((v) => v < total).length, teams: totals.size };
}

/**
 * Pure: did this player-week's stat line record an Appearance (CONTEXT.md
 * "Appearance"; #1860)? A stat row alone is not one: rows exist for rostered
 * players who never took the field, and the box writes its zeros. An Appearance
 * is a snap (nflverse snap_counts, offense or defense) or any non-zero figure in
 * the line. ponytail: the box and snap feed are the only participation data
 * there is (no active/inactive flag), so a blocking tight end whose snaps have
 * not been published yet reads as no Appearance; upgrade to a game-level active
 * list if the feed ever carries one.
 */
function madeAppearance(stats) {
  return Object.values(stats || {}).some((v) => typeof v === 'number' && Number.isFinite(v) && v !== 0);
}

/**
 * LIVE (in-progress week) counterpart to weekHindsight: actual points so far
 * vs. the best legal lineup achievable from here, using each player's CURRENT
 * points priced from `player_stats.stats` under this league's rules (the
 * settle pass's pricer, #739, ADR 0024), not the stored default-rules
 * `fantasy_points` column. Read-only — it never changes a lineup.
 *
 * Locks are respected: a player whose real game has kicked off can't be moved,
 * so locked players are excluded from swap suggestions entirely. The returned
 * `swaps` therefore only lists actionable bench-for-starter upgrades among
 * still-unlocked players; `delta` is their combined gain.
 *
 * The lock comes from `lineup.service`'s `lockedPlayerIds`, the same predicate
 * `setLineup` refuses a move with, and NOT from a schedule join of this
 * query's own (#227). It used to be the latter, joining `nfl_games` to
 * `players` on raw `nfl_team`, which is the comparison #227 exists to end: a
 * DEF unit's `players.nfl_team` is a full team name, so he joined to nothing
 * and read UNLOCKED here however long his game had been over. This advisor
 * would then suggest benching him and `setLineup` would refuse the very move
 * it had just recommended, with a 409 the manager cannot act on. An advisor
 * that disagrees with the rule it is advising about is worse than no advisor.
 *
 * That also moves the lock's clock from the database's `now()` to the app's,
 * which is the clock `setLineup` has always judged a move by. The two agreeing
 * is the point; a second clock is a second way to disagree.
 *
 * Two things short-circuit all of that, both because there is no move to advise
 * (#977). A SETTLED week has locked every player, so the pool is empty and the
 * answer is already `delta: 0, swaps: []`; it costs one population read and
 * nothing else. BEST BALL seats nobody, so there is no lineup to swap and its
 * actual is its optimal over the whole pool, exactly as `weekHindsight` reads
 * it. Neither branch moves a field on the wire.
 */
async function liveWhatIf({ leagueId, teamId, season, week, weekIsFinal }) {
  const league = await assertLeagueAndTeam({ leagueId, teamId });
  // A settled week has no actionable move left in it: every game has kicked
  // off, so every player is locked, the candidate pool is empty and the answer
  // is fixed at `delta: 0, swaps: []` (#977). Nothing below the population read
  // can change that, so a settled week pays for none of it: no materialisation,
  // no lock read, and no schedule or bye read behind the lock. The population
  // read stays - `actualPoints` is summed from those rows.
  //
  // `isWeekFinal` is a query of its own, so a caller that already holds the
  // settled fact passes it as `weekIsFinal` rather than making us buy it again.
  const isFinal = weekIsFinal === undefined || weekIsFinal === null
    ? await isWeekFinal({ leagueId, season, week })
    : weekIsFinal === true;
  if (!isFinal) {
    await materializeLineup(pool, { leagueId, teamId, season, week, league });
  }

  const rows = await pool.query(
    `SELECT "lineup_entries"."player_id", "players"."name", "players"."position",
            "players"."nfl_team", "lineup_entries"."slot", "player_stats"."stats"
     FROM "lineup_entries"
     JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
     LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
       AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
     WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
       AND "lineup_entries"."week" = $3`,
    [teamId, season, week]
  );
  // Same in-progress `stats` jsonb the box-score sync refreshes every few
  // minutes, priced under the league's rules by the settle pass's pricer, not
  // the default-rules `fantasy_points` column (#739). Live cadence is
  // unchanged: the column and the jsonb move together.
  const rules = rulesForLeague(league);
  let startedPoints = 0;
  const pointsFor = new Map();
  const nameById = new Map();
  const currentStarterIds = new Set();
  // Every row that could ever occupy a starting slot: the whole pool minus IR.
  const wholePool = [];
  for (const row of rows.rows) {
    // An IR occupant is never a swap candidate, locked or not (#741): nothing in
    // the product advises STARTING him (the start/sit advisor excludes IR, the
    // settle pass never counts him). He is neither a starter nor a candidate
    // here, and his points do not count toward actual.
    if (row.slot === IR) continue;
    const points = calculateFantasyPoints(row.stats, rules);
    pointsFor.set(row.player_id, points);
    nameById.set(row.player_id, row.name);
    // Standard: only rows in a starting slot count toward the started total.
    // Best ball keeps no started total (its actual is its optimal over the
    // whole pool), so it never reads this and never sums a lineup nobody sets.
    if (!league.best_ball && row.slot !== BENCH) {
      startedPoints += points;
      currentStarterIds.add(row.player_id);
    }
    wholePool.push({ playerId: row.player_id, position: row.position });
  }

  const settings = parseLineupSettings(league);

  // Best ball seats nobody - the materialisation skips its optimizer seeding
  // and a lineup save refuses any move outside bench and IR - so every row is
  // BENCH and there is no lineup to advise about. Its actual IS its optimal
  // over the whole pool (#635, ADR 0022/0023), the same branch and the same
  // spelling `weekHindsight` carries, on a live week and a settled one alike
  // (#977). The optimizer is a pure function over rows already in hand, so
  // this costs no query - and it needs no lock, because nothing is movable.
  if (league.best_ball) {
    const bestBallTotal = optimalLineup(wholePool, settings.rosterSlots, pointsFor).total;
    return {
      teamId, week, actualPoints: bestBallTotal, optimalPoints: bestBallTotal, delta: 0, swaps: [],
    };
  }

  if (isFinal) {
    const settledPoints = round2(startedPoints);
    return {
      teamId, week, actualPoints: settledPoints, optimalPoints: settledPoints, delta: 0, swaps: [],
    };
  }

  const locked = await lockedPlayerIds(pool, {
    season,
    week,
    players: rows.rows.map((row) => ({ id: row.player_id, nflTeam: row.nfl_team })),
  });
  for (const row of rows.rows) row.locked = locked.has(row.player_id);

  const actualPoints = round2(startedPoints);
  const lockedById = new Map();
  // Only unlocked players are candidates for the "what you could still do" pool;
  // locked players stay wherever they are.
  const candidatePool = [];
  for (const row of rows.rows) {
    if (row.slot === IR) continue;
    lockedById.set(row.player_id, row.locked === true);
    if (row.locked !== true) {
      candidatePool.push({ playerId: row.player_id, position: row.position });
    }
  }

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
// 4. Upgrade (player card)
// ---------------------------------------------------------------------------

const UPGRADE_CANDIDATE = Symbol('upgrade-candidate');

/**
 * The optimal assignment over `roster` (sorted by `playerId`), with
 * `candidate` (`{ position, projection }`) added when given. A kicked-off
 * starter is pinned to his slot and a kicked-off bench player is no candidate.
 */
function bestLineup(roster, rosterSlots, candidate = null) {
  const pointsFor = new Map(roster.map((r) => [r.playerId, Number(r.projection) || 0]));
  const pinned = new Map();
  const pool = [];
  for (const r of roster) {
    if (r.kickedOff) {
      if (r.slot !== BENCH) pinned.set(r.playerId, r.slot);
    } else {
      pool.push({ playerId: r.playerId, position: r.position });
    }
  }
  if (candidate) {
    pointsFor.set(UPGRADE_CANDIDATE, Number(candidate.projection) || 0);
    pool.push({ playerId: UPGRADE_CANDIDATE, position: candidate.position });
  }
  return optimalAssignment({ rosterSlots, candidates: pool, pointsFor, pinned });
}

/**
 * Pure: the Upgrade (ADR 0055) - how much `candidate` (`{ position, projection }`)
 * adds to the caller's optimal lineup for the week: the optimal total with him
 * on the roster minus the optimal total without him, never below 0.
 *
 * `roster` is the team's starters and bench, IR excluded:
 * `[{ playerId, name, position, slot, projection, unavailable, kickedOff }]`
 * (`playerCard.service.js`'s `loadUpgradeContext` builds it). An Unavailable
 * player arrives with `projection` 0 and his reason in `unavailable`. A
 * kicked-off starter is pinned to his slot and a kicked-off bench player is no
 * lineup candidate, as in `buildSuggestions`.
 *
 * `overPlayer` is the roster player in the optimal lineup without the
 * candidate who is not in the one with him (`points` is his own effective
 * projection), null when the candidate fills an empty slot or gains nothing;
 * `slot` is the slot the candidate takes (null when he takes none).
 *
 * Order-invariant: the optimizer is deterministic only for a fixed input
 * order, and the roster read has no ORDER BY, so `roster` is sorted by
 * `playerId` here. Without it, which of two tied players `overPlayer` names
 * would change between page loads.
 */
function upgradeFor(candidate, unsortedRoster, rosterSlots) {
  const roster = [...unsortedRoster].sort((a, b) => a.playerId - b.playerId);
  const without = bestLineup(roster, rosterSlots);
  const withHim = bestLineup(roster, rosterSlots, candidate);
  const points = Math.max(0, round2(withHim.total - without.total));
  const out = points > 0
    ? roster.find((r) => without.byPlayer.has(r.playerId) && !withHim.byPlayer.has(r.playerId))
    : null;
  return {
    points,
    overPlayer: out
      ? { id: out.playerId, name: out.name ?? null, points: round2(Number(out.projection) || 0), unavailable: out.unavailable ?? null }
      : null,
    slot: withHim.byPlayer.get(UPGRADE_CANDIDATE) ?? null,
  };
}

/**
 * Pure: what claiming `candidate` nets once the manager's pick `dropPlayerId`
 * leaves the roster (ADR 0062): the optimal lineup with him in and the drop
 * out, minus the optimal lineup `roster` fields now. Signed, so it goes
 * negative when the drop is worth more than the candidate. `roster` and
 * `candidate` are `upgradeFor`'s; the Upgrade itself never takes the drop.
 */
function swapNetFor(candidate, unsortedRoster, rosterSlots, dropPlayerId) {
  const roster = [...unsortedRoster].sort((a, b) => a.playerId - b.playerId);
  const kept = roster.filter((r) => r.playerId !== Number(dropPlayerId));
  return round2(bestLineup(kept, rosterSlots, candidate).total - bestLineup(roster, rosterSlots).total);
}

module.exports = {
  DecisionError,
  buildSuggestions,
  startSitAdvice,
  weekHindsight,
  weekHindsightRoster,
  POINTS_LEFT_TYPE,
  seasonPointsLeft,
  pointsLeftStanding,
  madeAppearance,
  liveWhatIf,
  seasonHindsight,
  fitAdjustedValue,
  tradeVerdict,
  tradeFairnessSummary,
  analyzeTrade,
  upgradeFor,
  swapNetFor,
};
