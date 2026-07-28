/* eslint-disable no-console */
/**
 * Chronological backtest for the weekly projection engine.
 *
 * The point of this script is to make "the new model is better" a claim
 * anybody can check rather than a claim anybody has to believe. Nothing in
 * `free_baseline_v2` should be described as an improvement over the old
 * season-average extrapolation until this has been run over real weeks and
 * the numbers say so.
 *
 * Guarantees, all of them load-bearing:
 *
 * - **No network.** Reads stored `player_stats` / `player_season_stats` /
 *   `nfl_games` only. The weather provider is explicitly disabled, so not one
 *   HTTP request leaves the process.
 * - **No writes.** Projections are produced through
 *   `projection.generateProjections`, which computes without touching the
 *   cache tables. `--out <file>` is the ONLY way this script writes anything,
 *   and it writes to a file, never to a production table.
 * - **Strictly chronological.** Week W is predicted from weeks < W (and
 *   earlier seasons) only. The engine enforces this in SQL; this script never
 *   hands it a later week's data, and never uses the final injury / weather /
 *   opponent picture that only existed after the simulated prediction time.
 * - **Deterministic.** Same database state, same arguments, same output —
 *   the simulation seed is derived from the player/season/week/model, and
 *   players are iterated in id order.
 * - **Missing is not zero.** A player the model declines to project is
 *   counted in `missing`, never scored as a 0-point prediction. Doing
 *   otherwise would flatter whichever model refuses to guess.
 *
 * Usage:
 *   node scripts/backtest-weekly-projections.js [--season N]... [--week N]...
 *       [--position QB]... [--config name]... [--limit N] [--out file.json]
 *
 * Defaults: season 2025, weeks 2-18 (week 1 has no in-season history for the
 * baseline being compared against), every fantasy position, the `default`
 * model configuration.
 *
 * Configurations sweep the half-life / shrinkage constants so alternatives can
 * be compared on the same weeks in one run:
 *   default       ships today
 *   fast-recency  half-life 2 weeks
 *   slow-recency  half-life 8 weeks
 *   heavy-shrink  doubled prior-season and position pseudo-games
 *   light-shrink  halved prior-season and position pseudo-games
 *   interval-130  residual draws scaled 1.30 (tighter band than the default)
 *   interval-145  residual draws scaled 1.45 (what the default already ships)
 *   interval-160  residual draws scaled 1.60 (wider band than the default)
 *   light-slow-8  half-life 8 weeks
 *   light-slow-12 half-life 12 weeks
 *   light-slow-16 half-life 16 weeks
 *   light-flat    half-life 9999 weeks, i.e. recency effectively switched off
 *   blend-25      25% weight on the current-season unweighted mean
 *   blend-50      50% weight on the current-season unweighted mean
 *   blend-75      75% weight on the current-season unweighted mean
 *   slow8-blend-25  half-life 8 plus a 25% current-season-mean blend
 *   slow8-blend-50  half-life 8 plus a 50% current-season-mean blend
 *   usage-25      25% weight on the opportunity-weighted baseline (shipped)
 *   usage-40      40% weight on the opportunity-weighted baseline
 *   usage-60      60% weight on the opportunity-weighted baseline
 *
 * The usage-* sweep priced expected opportunities (pass attempts for QBs,
 * carries + targets for RB/WR/TE) instead of projecting points directly, and it
 * is what selected the `free_baseline_v3` default: `usage-25` improved or held
 * every gate metric in BOTH enriched stored seasons, so it is now literally the
 * shipped configuration and coincides with `default`. `usage-40` and
 * `usage-60` were rejected for regressing 2025 lineup regret (13.76 to 14.54)
 * in exchange for a little more rank correlation, which is the wrong trade for
 * a tool whose job is to pick a lineup. They stay as the labeled heavy arms of
 * the sweep.
 *
 * These configs only move players whose stored stat lines carry the usage keys;
 * K, DEF and IDP are structurally unaffected and should score identically to
 * `default` in any run. A row where they do NOT means something is fabricating
 * an opportunity count.
 *
 * The light-* names date from when the shipped shrinkage was heavier: the
 * pseudo-game counts they once halved are now the DEFAULTS, so each of those
 * configs varies only the half-life. They sweep toward less recency weighting,
 * and blend-* sweeps the separate question of mixing in the incumbent's flat
 * current-season average; the slow8-blend-* pair crosses the two so a gain from
 * one is not mistaken for a gain from the other.
 *
 * WHICH OF THESE NOW EQUAL THE DEFAULTS. That cross is what selected the
 * `free_baseline_v2.2` defaults (half-life 8 with a 0.25 blend, better on MAE,
 * rho, pairwise accuracy and regret in both stored seasons), so `slow8-blend-25`
 * is now literally the shipped configuration, and `slow-recency`, `light-slow-8`
 * and `blend-25` collapse onto it too. `usage-25` joined them at v3. They are
 * kept, not deleted: older run outputs name them, and re-running one against a
 * future candidate is exactly how the next reference comparison gets made.
 *
 * A CAVEAT for the next sweep. Every config below overrides only the constants
 * it names and inherits the rest from whatever is currently shipped, so these
 * names describe a DELTA, not a fixed point in constant-space, and their meaning
 * moved when the defaults moved: `blend-25` scored a 4-week half-life during the
 * v2.2 selection run and scores an 8-week one today, and every config now
 * inherits a 0.25 opportunity blend that none of them scored under at all.
 * Reproducing a published pre-v3 row means pinning the constants in the config
 * explicitly rather than trusting the name.
 *
 * The interval-* sweep exists to re-check p10-p90 coverage, which the
 * unscaled bootstrap under-delivered badly (near 0.6 against a 0.80 target).
 * It widens dispersion without moving the projected mean, so cover10-90 is the
 * column to read; the point metrics are scored off the draw MEDIAN and so
 * still drift a little whenever the residual pool is not centered on zero.
 */
require('dotenv').config();

const fs = require('fs');
const pool = require('../server/modules/pool');
const projection = require('../server/services/projection.service');
const model = require('../server/services/projectionModel');
const { rulesForLeague, SCORING_RULES, calculateFantasyPoints } = require('../server/services/scoring.service');
const { DEFAULT_ROSTER_SLOTS } = require('../server/services/lineup.service');
const { optimalAssignment } = require('../server/services/lineupOptimizer');

const DEFAULT_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** Model-constant variants to compare. Named DEFAULTS, not proven optimums. */
const CONFIGURATIONS = {
  default: MODEL => MODEL,
  'fast-recency': (MODEL) => withBaseline(MODEL, { recencyHalfLifeWeeks: 2 }),
  'slow-recency': (MODEL) => withBaseline(MODEL, { recencyHalfLifeWeeks: 8 }),
  'heavy-shrink': (MODEL) => withBaseline(MODEL, {
    priorSeasonPseudoGames: MODEL.baseline.priorSeasonPseudoGames * 2,
    positionPseudoGames: MODEL.baseline.positionPseudoGames * 2,
  }),
  'light-shrink': (MODEL) => withBaseline(MODEL, {
    priorSeasonPseudoGames: MODEL.baseline.priorSeasonPseudoGames / 2,
    positionPseudoGames: MODEL.baseline.positionPseudoGames / 2,
  }),
  'interval-130': (MODEL) => withSimulation(MODEL, { intervalScale: 1.30 }),
  'interval-145': (MODEL) => withSimulation(MODEL, { intervalScale: 1.45 }),
  'interval-160': (MODEL) => withSimulation(MODEL, { intervalScale: 1.60 }),
  // Half-life sweep at the shipped (already light) shrinkage. 9999 weeks makes
  // every recency weight indistinguishable from 1, which is a flat mean over
  // the whole window in all but name.
  'light-slow-8': (MODEL) => withBaseline(MODEL, { recencyHalfLifeWeeks: 8 }),
  'light-slow-12': (MODEL) => withBaseline(MODEL, { recencyHalfLifeWeeks: 12 }),
  'light-slow-16': (MODEL) => withBaseline(MODEL, { recencyHalfLifeWeeks: 16 }),
  'light-flat': (MODEL) => withBaseline(MODEL, { recencyHalfLifeWeeks: 9999 }),
  // Blend sweep: how much of the incumbent's flat current-season average to mix
  // into the shrunk estimate. The last two cross it with a slower half-life.
  'blend-25': (MODEL) => withBaseline(MODEL, { currentSeasonMeanBlendWeight: 0.25 }),
  'blend-50': (MODEL) => withBaseline(MODEL, { currentSeasonMeanBlendWeight: 0.50 }),
  'blend-75': (MODEL) => withBaseline(MODEL, { currentSeasonMeanBlendWeight: 0.75 }),
  'slow8-blend-25': (MODEL) => withBaseline(MODEL, {
    recencyHalfLifeWeeks: 8,
    currentSeasonMeanBlendWeight: 0.25,
  }),
  'slow8-blend-50': (MODEL) => withBaseline(MODEL, {
    recencyHalfLifeWeeks: 8,
    currentSeasonMeanBlendWeight: 0.50,
  }),
  // Opportunity-weighted baseline sweep. `usage-25` won it and is now the
  // shipped weight, so this group has joined the collection above of configs
  // that re-run a decision already taken.
  'usage-25': (MODEL) => withUsage(MODEL, { blendWeight: 0.25 }),
  'usage-40': (MODEL) => withUsage(MODEL, { blendWeight: 0.40 }),
  'usage-60': (MODEL) => withUsage(MODEL, { blendWeight: 0.60 }),
};

function withBaseline(constants, overrides) {
  return { ...constants, baseline: { ...constants.baseline, ...overrides } };
}

function withSimulation(constants, overrides) {
  return { ...constants, simulation: { ...constants.simulation, ...overrides } };
}

function withUsage(constants, overrides) {
  return { ...constants, usage: { ...constants.usage, ...overrides } };
}

function parseArgs(argv) {
  const args = {
    seasons: [], weeks: [], positions: [], configs: [], limit: 0, out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--season') { args.seasons.push(Number(value)); i++; }
    else if (flag === '--week') { args.weeks.push(Number(value)); i++; }
    else if (flag === '--position') { args.positions.push(String(value).toUpperCase()); i++; }
    else if (flag === '--config') { args.configs.push(String(value)); i++; }
    else if (flag === '--limit') { args.limit = Number(value); i++; }
    else if (flag === '--out') { args.out = String(value); i++; }
    else if (flag === '--help' || flag === '-h') { args.help = true; }
  }
  if (args.seasons.length === 0) args.seasons = [2025];
  if (args.weeks.length === 0) args.weeks = Array.from({ length: 17 }, (_, i) => i + 2);
  if (args.positions.length === 0) args.positions = DEFAULT_POSITIONS;
  if (args.configs.length === 0) args.configs = ['default'];
  return args;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function mean(values) {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
}

/** Spearman rank correlation. Ties share the average rank. */
function spearman(pairs) {
  if (pairs.length < 3) return null;
  const rank = (values) => {
    const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(values.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
      const shared = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[indexed[k].i] = shared;
      i = j + 1;
    }
    return ranks;
  };
  const xr = rank(pairs.map((p) => p[0]));
  const yr = rank(pairs.map((p) => p[1]));
  const mx = mean(xr);
  const my = mean(yr);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xr.length; i++) {
    num += (xr[i] - mx) * (yr[i] - my);
    dx += (xr[i] - mx) ** 2;
    dy += (yr[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/**
 * Pairwise start/sit accuracy: over every pair of same-position players in the
 * same week whose ACTUAL scores differ, how often did the model rank them the
 * right way round? This is the metric that actually matches what start/sit
 * advice does, which raw MAE does not.
 */
function pairwiseAccuracy(observations) {
  let correct = 0;
  let total = 0;
  const byWeekPosition = new Map();
  for (const o of observations) {
    const key = `${o.season}:${o.week}:${o.position}`;
    if (!byWeekPosition.has(key)) byWeekPosition.set(key, []);
    byWeekPosition.get(key).push(o);
  }
  for (const group of byWeekPosition.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.actual === b.actual) continue;
        if (a.predicted == null || b.predicted == null) continue;
        total += 1;
        const predictedOrder = a.predicted - b.predicted;
        const actualOrder = a.actual - b.actual;
        if (predictedOrder === 0) continue; // a tie can never be "correct"
        if (Math.sign(predictedOrder) === Math.sign(actualOrder)) correct += 1;
      }
    }
  }
  return total === 0 ? { accuracy: null, pairs: 0 } : { accuracy: correct / total, pairs: total };
}

/**
 * Recommendation regret: points left on the bench by starting the lineup the
 * model recommends, versus the lineup that hindsight says was best. Zero is
 * perfect. Computed over a synthetic roster drawn deterministically from that
 * week's observations, so both models face the identical decision.
 */
function lineupRegret(observations, rosterSize = 16) {
  const byWeek = new Map();
  for (const o of observations) {
    const key = `${o.season}:${o.week}`;
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(o);
  }
  const regrets = [];
  for (const group of byWeek.values()) {
    // Deterministic roster: player id order, capped, so the same DB always
    // yields the same rosters for both models.
    const roster = [...group].sort((a, b) => a.playerId - b.playerId).slice(0, rosterSize);
    if (roster.length < DEFAULT_ROSTER_SLOTS.length) continue;
    const candidates = roster.map((o) => ({ playerId: o.playerId, position: o.position }));
    const predicted = new Map(roster.map((o) => [o.playerId, o.predicted == null ? 0 : o.predicted]));
    const actual = new Map(roster.map((o) => [o.playerId, o.actual]));

    const chosen = optimalAssignment({ rosterSlots: DEFAULT_ROSTER_SLOTS, candidates, pointsFor: predicted });
    const best = optimalAssignment({ rosterSlots: DEFAULT_ROSTER_SLOTS, candidates, pointsFor: actual });
    const chosenActual = chosen.assignments
      .filter((a) => a.playerId != null)
      .reduce((sum, a) => sum + (actual.get(a.playerId) || 0), 0);
    regrets.push(best.total - chosenActual);
  }
  return { meanRegret: mean(regrets), weeks: regrets.length };
}

function summarize(observations) {
  const scored = observations.filter((o) => o.predicted != null);
  const errors = scored.map((o) => o.predicted - o.actual);
  const covered = scored.filter((o) => o.p10 != null && o.p90 != null);
  const inInterval = covered.filter((o) => o.actual >= o.p10 && o.actual <= o.p90).length;
  return {
    samples: scored.length,
    missing: observations.length - scored.length,
    mae: errors.length === 0 ? null : mean(errors.map(Math.abs)),
    rmse: errors.length === 0 ? null : Math.sqrt(mean(errors.map((e) => e * e))),
    spearman: spearman(scored.map((o) => [o.predicted, o.actual])),
    ...pairwiseAccuracy(scored),
    ...lineupRegret(scored),
    intervalCoverageP10P90: covered.length === 0 ? null : inInterval / covered.length,
    intervalSamples: covered.length,
  };
}

function fmt(value, digits = 3) {
  if (value == null) return 'n/a';
  return Number(value).toFixed(digits);
}

function report(label, observations) {
  const overall = summarize(observations);
  const byPosition = new Map();
  for (const o of observations) {
    if (!byPosition.has(o.position)) byPosition.set(o.position, []);
    byPosition.get(o.position).push(o);
  }
  const positions = {};
  for (const position of [...byPosition.keys()].sort()) {
    positions[position] = summarize(byPosition.get(position));
  }
  console.log(`\n--- ${label} ---`);
  const line = (name, s) =>
    console.log(
      `  ${name.padEnd(14)} n=${String(s.samples).padStart(5)} missing=${String(s.missing).padStart(4)} ` +
      `MAE=${fmt(s.mae, 2).padStart(6)} RMSE=${fmt(s.rmse, 2).padStart(6)} ` +
      `rho=${fmt(s.spearman).padStart(6)} pairAcc=${fmt(s.accuracy).padStart(6)} ` +
      `regret=${fmt(s.meanRegret, 2).padStart(6)} cover10-90=${fmt(s.intervalCoverageP10P90).padStart(6)}`
    );
  line('OVERALL', overall);
  for (const [position, summary] of Object.entries(positions)) line(position, summary);
  return { overall, positions };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Actual league-scored results for one week — the answer key. */
async function actualsFor({ season, week, positions, rules, limit }) {
  const result = await pool.query(
    `SELECT "ps"."player_id", "ps"."stats", "p"."position"
     FROM "player_stats" "ps"
     JOIN "players" "p" ON "p"."id" = "ps"."player_id"
     WHERE "ps"."season" = $1 AND "ps"."week" = $2 AND "p"."position" = ANY($3::text[])
     ORDER BY "ps"."player_id"
     ${limit > 0 ? 'LIMIT ' + Number(limit) : ''}`,
    [season, week, positions]
  );
  return result.rows.map((row) => ({
    playerId: row.player_id,
    position: row.position,
    actual: calculateFantasyPoints(row.stats, rules),
  }));
}

/**
 * The incumbent baseline: the mean of the player's PRIOR weeks' league-scored
 * points this season — the same "average what he's done so far" idea the
 * original producer implements, re-priced under the same rules so the
 * comparison isolates the model rather than the scoring.
 */
async function baselinePredictions({ season, week, playerIds, rules }) {
  if (playerIds.length === 0) return new Map();
  const result = await pool.query(
    `SELECT "player_id", "stats" FROM "player_stats"
     WHERE "player_id" = ANY($1::int[]) AND "season" = $2 AND "week" < $3`,
    [playerIds, season, week]
  );
  const byPlayer = new Map();
  for (const row of result.rows) {
    if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, []);
    byPlayer.get(row.player_id).push(calculateFantasyPoints(row.stats, rules));
  }
  const out = new Map();
  for (const [playerId, points] of byPlayer) {
    // No prior weeks means NO prediction, not a prediction of zero.
    if (points.length === 0) continue;
    out.set(playerId, points.reduce((s, p) => s + p, 0) / points.length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    return;
  }
  const rules = rulesForLeague(null) || SCORING_RULES;
  const hashValue = model.scoringHash(rules);
  const unknownConfigs = args.configs.filter((c) => !CONFIGURATIONS[c]);
  if (unknownConfigs.length > 0) {
    throw new Error(`unknown --config values: ${unknownConfigs.join(', ')} (have: ${Object.keys(CONFIGURATIONS).join(', ')})`);
  }

  const baselineObservations = [];
  const modelObservations = new Map(args.configs.map((c) => [c, []]));

  for (const season of args.seasons) {
    for (const week of args.weeks) {
      const actuals = await actualsFor({ season, week, positions: args.positions, rules, limit: args.limit });
      if (actuals.length === 0) continue;
      const playerIds = actuals.map((a) => a.playerId);

      const baseline = await baselinePredictions({ season, week, playerIds, rules });
      for (const actual of actuals) {
        baselineObservations.push({
          ...actual,
          season,
          week,
          predicted: baseline.has(actual.playerId) ? baseline.get(actual.playerId) : null,
          p10: null,
          p90: null,
        });
      }

      for (const configName of args.configs) {
        const constants = CONFIGURATIONS[configName](model.MODEL_CONSTANTS);
        const run = await projection.generateProjections({
          season,
          week,
          rules,
          playerIds,
          hashValue,
          // Belt and braces: the engine must not reach the network here.
          weatherService: false,
          modelConstants: constants,
        });
        for (const actual of actuals) {
          const p = run.projections.get(actual.playerId);
          modelObservations.get(configName).push({
            ...actual,
            season,
            week,
            predicted: p && p.median != null ? p.median : (p && p.mean != null ? p.mean : null),
            p10: p ? p.p10 : null,
            p90: p ? p.p90 : null,
          });
        }
      }
      console.log(`scored ${season} week ${week}: ${actuals.length} players`);
    }
  }

  if (baselineObservations.length === 0) {
    console.log(
      '\nNo stored results matched the requested seasons/weeks, so nothing was compared. ' +
      'This says nothing about model accuracy — load historical player_stats first.'
    );
    return;
  }

  const results = { generatedAt: new Date().toISOString(), args, reports: {} };
  results.reports['season-average baseline'] = report('season-average baseline (incumbent)', baselineObservations);
  for (const configName of args.configs) {
    results.reports[`free_baseline_v2:${configName}`] =
      report(`free_baseline_v2 (${configName})`, modelObservations.get(configName));
  }

  console.log(
    '\nRead these as a comparison on THESE weeks only. Lower MAE/RMSE/regret and ' +
    'higher rho/pairAcc are better; interval coverage should sit near 0.80 for a ' +
    'well-calibrated p10-p90 band.'
  );

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(results, null, 2));
    console.log(`\nWrote ${args.out}`);
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = {
  CONFIGURATIONS,
  parseArgs,
  spearman,
  pairwiseAccuracy,
  lineupRegret,
  summarize,
};
