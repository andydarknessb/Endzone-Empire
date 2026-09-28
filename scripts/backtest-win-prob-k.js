/* eslint-disable no-console */
/**
 * Fit win probability v2's calibration constant k (Home v2 spec, "Win
 * probability v2" board, "Calibration and gate": fit k by minimising log loss
 * at kickoff).
 *
 * For every settled matchup in the chosen season and weeks this gathers the
 * kickoff picture, as the Expected final producer (expectedFinal.service
 * expectedFinalsForWeek) would have priced it before any starter kicked off:
 *   - the lineup that played: the week's lineup_entries, BENCH and IR out; in
 *     best ball every non-IR row is a candidate and the optimizer chooses on
 *     the projections, as the producer does;
 *   - each starter's Weekly projection and Interval (p10, p90) from the
 *     Weekly projection engine's run for that week
 *     (projection.service getWeeklyProjections, league-scored);
 *   - a starter on a bye adds nothing (projection 0, no variance);
 * sums them into each side's Expected final and variance (sum of sigma_i^2,
 * every game still to play), and hands the samples, with each matchup's
 * settled score, to the pure fitter (winProbabilityEvaluation.fitK). The fit
 * and every metric are computed there, unit tested; this script only gathers.
 *
 * Writes nothing that survives. getWeeklyProjections serves the week's cached
 * run when every starter has a row (the run the app served that week) and
 * otherwise generates the missing players and writes them to the cache. To
 * keep the script read-only in effect, all of it runs inside one transaction
 * that is always rolled back, and the weather lookup is off (no network).
 * While it runs, that transaction can hold a projection cache row a
 * concurrent projection run wants; run it outside the nightly window.
 *
 * Why 2026 and kickoff only: the board named 2024 and 2025, but the app had no
 * leagues, lineups or matchups before 2026, so there is nothing real to
 * replay; the settled 2026 weeks are the only head-to-head matchups with the
 * lineups that actually played. k is fitted at kickoff only because the
 * final checkpoint needs no fit (v2 is exactly 0 or 1 once nothing is left
 * to play); the in-game checkpoints come from the shadow rows
 * (scripts/win-prob-shadow-report.js), not from history.
 *
 * Known limits, stated so a reader does not over-read the fit:
 *   - Injury status is today's, not the week's, so it is not applied: an Out
 *     starter is priced at his projection. v1 and v2 share that input.
 *   - Players' NFL teams (for the bye rule) are today's.
 *   - A generated (uncached) week uses stored inputs up to that week's first
 *     kickoff (the engine enforces it), not the live picture of the day.
 *
 * Usage:
 *   node scripts/backtest-win-prob-k.js [--season 2026] [--weeks 1-4]
 *       [--league 71]... [--from 0.6] [--to 1.8] [--step 0.05] [--json]
 *
 *   --season N     default 2026
 *   --weeks A-B    inclusive range (or one week); default every settled week
 *   --league N     only this league (repeatable); default every league
 *   --from/--to/--step   the k grid; default 0.6 to 1.8 by 0.05
 *   --json         print the samples' fit as JSON
 *
 * Runs against whatever database the standard DATABASE_URL / PG* environment
 * points at.
 */

const USAGE = 'Usage: node scripts/backtest-win-prob-k.js [--season N] [--weeks A-B] [--league N]... '
  + '[--from 0.6] [--to 1.8] [--step 0.05] [--json]';

function parseWeeks(value) {
  const match = /^(\d+)(?:-(\d+))?$/.exec(String(value || '').trim());
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] == null ? from : Number(match[2]);
  return from <= to ? { from, to } : null;
}

function parseArgs(argv) {
  const args = {
    season: 2026, weeks: { from: 1, to: 99 }, leagues: [], from: 0.6, to: 1.8, step: 0.05,
    json: false, help: false, errors: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') args.help = true;
    else if (flag === '--json') args.json = true;
    else if (flag === '--season') args.season = Number(argv[++i]);
    else if (flag === '--weeks' || flag === '--week') {
      const weeks = parseWeeks(argv[++i]);
      if (weeks) args.weeks = weeks;
      else args.errors.push(`${flag} must be a week or a range like 1-4`);
    } else if (flag === '--league') args.leagues.push(Number(argv[++i]));
    else if (flag === '--from') args.from = Number(argv[++i]);
    else if (flag === '--to') args.to = Number(argv[++i]);
    else if (flag === '--step') args.step = Number(argv[++i]);
    else args.errors.push(`unknown argument ${flag}`);
  }
  if (!args.help) {
    if (!Number.isInteger(args.season)) args.errors.push('--season takes a year');
    if (args.leagues.some((id) => !Number.isInteger(id))) args.errors.push('--league takes a league id');
    if (!(args.from > 0) || !(args.to >= args.from) || !(args.step > 0)) {
      args.errors.push('the k grid needs 0 < --from <= --to and --step > 0');
    }
  }
  return args;
}

const round2 = (x) => Math.round(x * 100) / 100;

/** Rolls the gathering transaction back on purpose, carrying its result out. */
class RolledBack extends Error {
  constructor(value) {
    super('rolled back on purpose');
    this.value = value;
  }
}

/**
 * One team's kickoff figures from its lineup rows: `{ expectedFinal,
 * variance, withoutInterval }`, or null with no starters.
 */
function kickoffFigures({ rows, league, week, projections, byeByTeam, services }) {
  const { varianceRemaining, optimalLineup, parseLineupSettings } = services;
  const candidates = rows.map((row) => {
    const onBye = row.nfl_team == null || byeByTeam.get(row.nfl_team) === week;
    const point = onBye ? null : projections.pointsFor(row.player_id);
    const detail = onBye ? null : projections.detailFor(row.player_id);
    return {
      playerId: row.player_id,
      position: row.position,
      slot: row.slot,
      onBye,
      projection: point != null && Number.isFinite(Number(point)) ? round2(Number(point)) : 0,
      interval: detail,
    };
  });
  let starters;
  if (league.best_ball) {
    const { rosterSlots } = parseLineupSettings(league);
    const pointsFor = new Map(candidates.map((c) => [c.playerId, c.projection]));
    const chosen = new Set(optimalLineup(candidates, rosterSlots, pointsFor).starters.map((s) => s.playerId));
    starters = candidates.filter((c) => chosen.has(c.playerId));
  } else {
    starters = candidates.filter((c) => c.slot !== 'BENCH');
  }
  if (starters.length === 0) return null;
  const hasInterval = (s) => !!(s.interval && s.interval.p10 != null && s.interval.p90 != null);
  return {
    expectedFinal: round2(starters.reduce((sum, s) => sum + s.projection, 0)),
    variance: varianceRemaining(starters.map((s) => ({ ...(s.interval || {}), gameFraction: s.onBye ? 0 : 1 }))),
    withoutInterval: starters.filter((s) => !s.onBye && !hasInterval(s)).length,
  };
}

async function gatherSamples(client, args, services) {
  const { getWeeklyProjections, computeByeWeeks } = services;
  const leagueParams = [args.season, args.weeks.from, args.weeks.to];
  if (args.leagues.length) leagueParams.push(args.leagues);
  const { rows: matchups } = await client.query(
    `SELECT "id", "league_id", "week", "home_team_id", "away_team_id", "home_score", "away_score"
     FROM "matchups"
     WHERE "season" = $1 AND "week" BETWEEN $2 AND $3 AND "final" = true
       ${args.leagues.length ? 'AND "league_id" = ANY($4)' : ''}
     ORDER BY "league_id", "week", "id"`,
    leagueParams
  );
  if (matchups.length === 0) return [];
  const leagueIds = [...new Set(matchups.map((m) => m.league_id))];
  const { rows: leagues } = await client.query(`SELECT * FROM "leagues" WHERE "id" = ANY($1)`, [leagueIds]);
  const leagueById = new Map(leagues.map((l) => [l.id, l]));

  const groups = new Map();
  for (const m of matchups) {
    const key = `${m.league_id}:${m.week}`;
    if (!groups.has(key)) groups.set(key, { league: leagueById.get(m.league_id), week: Number(m.week), matchups: [] });
    groups.get(key).matchups.push(m);
  }

  const samples = [];
  for (const { league, week, matchups: weekMatchups } of groups.values()) {
    const teamIds = weekMatchups.flatMap((m) => [m.home_team_id, m.away_team_id]);
    const { rows: lineupRows } = await client.query(
      `SELECT "lineup_entries"."team_id", "lineup_entries"."player_id", "lineup_entries"."slot",
              "players"."position", "players"."nfl_team"
       FROM "lineup_entries"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
       WHERE "lineup_entries"."team_id" = ANY($1) AND "lineup_entries"."season" = $2
         AND "lineup_entries"."week" = $3 AND "lineup_entries"."slot" != 'IR'`,
      [teamIds, args.season, week]
    );
    const playerIds = [...new Set(lineupRows.map((r) => r.player_id))];
    const nflTeams = [...new Set(lineupRows.map((r) => r.nfl_team).filter(Boolean))];
    const [projections, byeByTeam] = await Promise.all([
      getWeeklyProjections({ season: args.season, week, league, playerIds, client, weatherService: false }),
      computeByeWeeks(nflTeams, args.season, { client }),
    ]);
    const rowsByTeam = new Map();
    for (const row of lineupRows) {
      if (!rowsByTeam.has(row.team_id)) rowsByTeam.set(row.team_id, []);
      rowsByTeam.get(row.team_id).push(row);
    }
    const figuresFor = (teamId) => kickoffFigures({
      rows: rowsByTeam.get(teamId) || [], league, week, projections, byeByTeam, services,
    });
    for (const m of weekMatchups) {
      const home = figuresFor(m.home_team_id);
      const away = figuresFor(m.away_team_id);
      samples.push({
        matchupId: m.id,
        leagueId: m.league_id,
        week,
        homeExpectedFinal: home ? home.expectedFinal : null,
        awayExpectedFinal: away ? away.expectedFinal : null,
        homeVariance: home ? home.variance : null,
        awayVariance: away ? away.variance : null,
        startersWithoutInterval: (home ? home.withoutInterval : 0) + (away ? away.withoutInterval : 0),
        finalHomeScore: m.home_score,
        finalAwayScore: m.away_score,
      });
    }
    console.error(`gathered league ${league.id} week ${week}: ${weekMatchups.length} matchups`);
  }
  return samples;
}

const num = (x) => (x == null ? '-' : x.toFixed(4));

function printFit({ args, fit, samples }) {
  const weeks = [...new Set(samples.map((s) => s.week))].sort((a, b) => a - b);
  const flagged = samples.filter((s) => s.startersWithoutInterval > 0).length;
  console.log(`Win probability v2 k backtest · season ${args.season} · weeks ${weeks.join(', ') || 'none'}`
    + `${args.leagues.length ? ` · leagues ${args.leagues.join(', ')}` : ''}`);
  console.log(`Matchups: ${fit.count} scored · ${fit.skipped} skipped (no Expected final or no result)`
    + ` · ${flagged} with starters lacking an Interval`);
  console.log('');
  console.log(`${'k'.padStart(6)} ${'log loss'.padStart(10)} ${'Brier'.padStart(8)} ${'clamps'.padStart(7)}`);
  for (const row of fit.grid) {
    const mark = fit.best && row.k === fit.best.k ? '  <- best' : '';
    console.log(`${row.k.toFixed(2).padStart(6)} ${num(row.logLoss).padStart(10)} ${num(row.brier).padStart(8)}`
      + ` ${String(row.clamps).padStart(7)}${mark}`);
  }
  console.log('');
  if (fit.best) {
    console.log(`Best k ${fit.best.k.toFixed(2)}: log loss ${num(fit.best.logLoss)} · Brier ${num(fit.best.brier)}`);
  } else {
    console.log('No usable matchups, so no k.');
  }
  console.log(`v1 at kickoff: log loss ${num(fit.v1.logLoss)} · Brier ${num(fit.v1.brier)}`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.errors.length) {
    args.errors.forEach((e) => console.error(e));
    console.error(USAGE);
    return 2;
  }

  // Required here, not at load, so --help and a bad argument never read the
  // database configuration.
  require('dotenv').config();
  const pool = require('../server/modules/pool');
  const { withTransaction } = require('../server/modules/withTransaction');
  const { getWeeklyProjections } = require('../server/services/projection.service');
  const { computeByeWeeks } = require('../server/services/bye.service');
  const { optimalLineup, parseLineupSettings } = require('../server/services/lineup.service');
  const { varianceRemaining } = require('../server/services/winProbability');
  const { fitK, kGrid } = require('../server/services/winProbabilityEvaluation');
  const services = {
    getWeeklyProjections, computeByeWeeks, optimalLineup, parseLineupSettings, varianceRemaining,
  };

  try {
    let samples;
    try {
      await withTransaction(pool, async (client) => {
        throw new RolledBack(await gatherSamples(client, args, services));
      }, { label: 'backtest-win-prob-k' });
    } catch (err) {
      if (!(err instanceof RolledBack)) throw err;
      samples = err.value;
    }
    const fit = fitK({ samples, kGrid: kGrid({ from: args.from, to: args.to, step: args.step }) });
    if (args.json) console.log(JSON.stringify({ args: { ...args, errors: undefined }, fit }, null, 2));
    else printFit({ args, fit, samples });
    return 0;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, main };
