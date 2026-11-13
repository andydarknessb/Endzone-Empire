/* eslint-disable no-console */
/**
 * Fits the two v3.2 kicker-blend numbers (#1443) on 2024 and 2025, and nothing else.
 *
 * - Step A, the slope `kickerPointsPerTeamPoint`: for every (kicker, team, season)
 *   with at least 8 games, one pair of means, (team points, kicker points). A
 *   team's points in a game come from the opposing defense's row: `gameOpponent`
 *   is the team that scored, `pointsAllowed` is its points. The slope is through
 *   the origin, sum(x * y) / sum(x * x), over every pair of both seasons pooled.
 * - Step B, the weight `w`: every 2024 and 2025 week from 2 to 18, with the
 *   kickers who have a stat row that week, projected for each w on the grid
 *   0, 0.05, ..., 1 with kicker = { w, kickerPointsPerTeamPoint: <step A> },
 *   appearancesOnly on, nothing else changed. The lowest mean absolute error over
 *   every scored kicker-week wins; an exact tie goes to the smaller w.
 *
 * Read-only: it SELECTs from player_stats and players, and generateProjections
 * computes without writing. It reads 2024 and 2025 only. There is no season flag,
 * and an unknown argument, --season included, is refused.
 *
 * Usage:
 *   node scripts/backtest/fit-kicker-blend.js --self-check   (touches no database)
 *   node scripts/backtest/fit-kicker-blend.js [--out fit.json]
 *
 * Put the printed slope and w in place of the placeholder zeros in
 * MODEL_CONSTANTS_V3_2 (server/services/projectionModel.js).
 */
const fs = require('fs');
const assert = require('assert/strict');
const { SCORING_RULES, rulesForLeague, calculateFantasyPoints } = require('../../server/services/scoringRules');
const { isPresentNumber: isNum } = require('../../server/services/numericPresence');

const SEASONS = [2024, 2025];
const WEEKS = Array.from({ length: 17 }, (_, i) => i + 2);
const WEIGHT_GRID = Array.from({ length: 21 }, (_, i) => i / 20);
const MIN_GAMES = 8;

/** Pure: slope through the origin, sum(x * y) / sum(x * x), over [x, y] pairs. */
function throughOriginSlope(pairs) {
  let xy = 0;
  let xx = 0;
  for (const [x, y] of pairs) {
    xy += x * y;
    xx += x * x;
  }
  return xx > 0 ? xy / xx : null;
}

/** Pure: the row with the lowest MAE, whatever the order; an exact tie goes to the smaller w. */
function pickWeight(rows) {
  let best = null;
  for (const row of rows) {
    if (!best || row.mae < best.mae || (row.mae === best.mae && row.w < best.w)) best = row;
  }
  return best;
}

function parseArgs(argv) {
  const args = { selfCheck: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--self-check') args.selfCheck = true;
    else if (argv[i] === '--out' && argv[i + 1]) { args.out = argv[i + 1]; i++; }
    else throw new Error(`unknown argument ${argv[i]}: this script fits ${SEASONS.join(' and ')} only`);
  }
  return args;
}

function selfCheck() {
  // Pairs (1, 2), (2, 3), (3, 5): sum(x * y) = 23 and sum(x * x) = 14.
  assert.equal(throughOriginSlope([[1, 2], [2, 3], [3, 5]]), 23 / 14);
  assert.equal(pickWeight([{ w: 0.5, mae: 1.2 }, { w: 0.2, mae: 1.0 }, { w: 0.1, mae: 1.1 }]).w, 0.2);
  assert.equal(pickWeight([{ w: 0.3, mae: 1 }, { w: 0.1, mae: 1 }, { w: 0.2, mae: 1.5 }]).w, 0.1);
  console.log('self-check passed: through-origin slope and weight picker');
}

/**
 * Step A's pairs. The projection helpers reach the database when they load, so
 * they are required here, on the real path only.
 */
async function kickerPairs(pool, rules) {
  const { isAppearance, normalizeTeamKey } = require('../../server/services/projectionFeatures');
  const kickers = await pool.query(
    `SELECT "ps"."player_id", "ps"."season", "ps"."week", "ps"."stats"
     FROM "player_stats" "ps"
     JOIN "players" "p" ON "p"."id" = "ps"."player_id"
     WHERE "p"."position" = 'K' AND "ps"."season" = ANY($1::int[])`,
    [SEASONS]
  );
  const defenses = await pool.query(
    `SELECT "ps"."season", "ps"."week", "ps"."stats"
     FROM "player_stats" "ps"
     JOIN "players" "p" ON "p"."id" = "ps"."player_id"
     WHERE "p"."position" = 'DEF' AND "ps"."season" = ANY($1::int[])`,
    [SEASONS]
  );

  // What a team scored in a week: the DEF row that faced it carries the points.
  const scoredBy = new Map();
  for (const row of defenses.rows) {
    const team = normalizeTeamKey(row.stats && row.stats.gameOpponent);
    const points = row.stats ? row.stats.pointsAllowed : null;
    if (!team || !isNum(points)) continue;
    const key = `${row.season}:${row.week}:${team}`;
    if (!scoredBy.has(key)) scoredBy.set(key, Number(points));
  }

  // One group per (kicker, team, season): his games for that team that season.
  const groups = new Map();
  for (const row of kickers.rows) {
    if (!isAppearance(row)) continue;
    const team = normalizeTeamKey(row.stats.gameTeam);
    const teamPoints = team ? scoredBy.get(`${row.season}:${row.week}:${team}`) : undefined;
    if (teamPoints === undefined) continue;
    const key = `${row.player_id}:${team}:${row.season}`;
    const group = groups.get(key) || { team: 0, kicker: 0, games: 0 };
    group.team += teamPoints;
    group.kicker += calculateFantasyPoints(row.stats, rules);
    group.games += 1;
    groups.set(key, group);
  }

  const pairs = [];
  for (const group of groups.values()) {
    if (group.games >= MIN_GAMES) pairs.push([group.team / group.games, group.kicker / group.games]);
  }
  return pairs;
}

/** Every kicker with a stat row that week, and his league-scored points. */
async function kickersFor(pool, { season, week, rules }) {
  const result = await pool.query(
    `SELECT "ps"."player_id", "ps"."stats"
     FROM "player_stats" "ps"
     JOIN "players" "p" ON "p"."id" = "ps"."player_id"
     WHERE "ps"."season" = $1 AND "ps"."week" = $2 AND "p"."position" = 'K'
     ORDER BY "ps"."player_id"`,
    [season, week]
  );
  return result.rows.map((row) => ({
    playerId: row.player_id,
    actual: calculateFantasyPoints(row.stats, rules),
  }));
}

/** Step B: one row per grid weight, with the MAE over every scored kicker-week of both seasons. */
async function weightCurve({ pool, projection, model, rules, hashValue, slope }) {
  const totals = new Map(WEIGHT_GRID.map((w) => [w, { absError: 0, scored: 0 }]));
  for (const season of SEASONS) {
    for (const week of WEEKS) {
      const kickers = await kickersFor(pool, { season, week, rules });
      if (kickers.length === 0) continue;
      const playerIds = kickers.map((kicker) => kicker.playerId);
      for (const w of WEIGHT_GRID) {
        const constants = structuredClone(model.MODEL_CONSTANTS);
        constants.baseline.appearancesOnly = true;
        constants.kicker = { w, kickerPointsPerTeamPoint: slope };
        const run = await projection.generateProjections({
          season, week, rules, playerIds, hashValue, weatherService: false, modelConstants: constants,
        });
        const total = totals.get(w);
        for (const kicker of kickers) {
          const projected = run.projections.get(kicker.playerId);
          if (!projected || projected.mean == null) continue;
          total.absError += Math.abs(projected.mean - kicker.actual);
          total.scored += 1;
        }
      }
      console.log(`scored ${season} week ${week}: ${kickers.length} kickers`);
    }
  }
  return WEIGHT_GRID.map((w) => {
    const { absError, scored } = totals.get(w);
    return { w, mae: scored > 0 ? absError / scored : null, scored };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheck) {
    selfCheck();
    return;
  }

  // Required only past the self-check: the first touch of the database.
  require('dotenv').config();
  const pool = require('../../server/modules/pool');
  const projection = require('../../server/services/projection.service');
  const model = require('../../server/services/projectionModel');
  const rules = rulesForLeague(null) || SCORING_RULES;
  const hashValue = model.scoringHash(rules);

  try {
    const pairs = await kickerPairs(pool, rules);
    const slope = throughOriginSlope(pairs);
    if (slope === null) throw new Error('no kicker pairs: nothing to fit the slope on');
    console.log(`kickerPointsPerTeamPoint ${slope} from ${pairs.length} kicker-team-seasons\n`);

    const curve = await weightCurve({ pool, projection, model, rules, hashValue, slope });
    const chosen = pickWeight(curve.filter((row) => row.mae !== null));
    if (!chosen) throw new Error('no scored kicker-weeks: nothing to fit w against');

    console.log('w     MAE      scored');
    for (const row of curve) {
      console.log(`${row.w.toFixed(2)}  ${row.mae === null ? 'n/a' : row.mae.toFixed(4)}  ${row.scored}`);
    }
    console.log(`\nchosen w ${chosen.w}`);

    if (args.out) {
      fs.writeFileSync(args.out, JSON.stringify({
        generatedAt: new Date().toISOString(),
        seasons: SEASONS,
        pairs: pairs.length,
        kickerPointsPerTeamPoint: slope,
        chosenW: chosen.w,
        curve,
      }, null, 2));
      console.log(`\nWrote ${args.out}`);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
