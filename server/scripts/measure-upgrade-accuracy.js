#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * How well the Upgrade predicts what a pickup delivers (#2169, spec #2165,
 * ADR 0062). For one league and a range of completed weeks it reads the
 * league's add, waiver and trade transactions and, for each acquired player,
 * compares three numbers:
 *
 *   old rule  the Upgrade in the week of the acquisition, candidate never held;
 *   new rule  the Upgrade in his first playable week (#2166);
 *   realized  the same optimal-lineup difference in that first playable week,
 *             priced with actual points under the league's rules.
 *
 * Both predictions read the last stored projection run generated before his
 * first playable kickoff, over the acquiring team's stored lineup for that
 * week with him removed. Read-only: it never generates a projection and
 * writes nothing.
 *
 * `measureUpgradeAccuracy` is the pure core and takes the in-memory week
 * inputs, so the logic is tested without a database.
 */

const { upgradeFor } = require('../services/decision.service');

const USAGE = `Usage: node server/scripts/measure-upgrade-accuracy.js --league <id> --season <year> [--from-week <n>] [--to-week <n>]

  --league <id>      the league whose add, waiver and trade transactions are read
  --season <year>    the season those transactions fall in
  --from-week <n>    first acquisition week to include (default 1)
  --to-week <n>      last acquisition week to include (default: the last completed week)
  --help             print this text`;

const round2 = (x) => Math.round(x * 100) / 100;

function positiveInt(raw, flag) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer, got "${raw}"`);
  return n;
}

/** `argv` is `process.argv.slice(2)`. Throws on a missing or malformed flag. */
function parseArgs(argv) {
  const args = { help: false, league: null, season: null, fromWeek: 1, toWeek: null };
  const flags = { '--league': 'league', '--season': 'season', '--from-week': 'fromWeek', '--to-week': 'toWeek' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      args.help = true;
    } else if (flags[flag]) {
      i += 1;
      args[flags[flag]] = positiveInt(argv[i], flag);
    } else {
      throw new Error(`unknown argument ${flag}`);
    }
  }
  if (!args.help && args.league === null) throw new Error('--league is required');
  if (!args.help && args.season === null) throw new Error('--season is required');
  return args;
}

/** The week's roster priced by what each player scored: nothing is held, nobody is Unavailable. */
const asPlayed = (roster) => roster.map((r) => ({ ...r, projection: r.actual, unavailable: null, kickedOff: false }));

function summarize(predictions, realized) {
  if (predictions.length === 0) return { mae: null, positive: 0, falsePromises: 0, falsePromiseShare: null };
  const errors = predictions.map((p, i) => Math.abs(p - realized[i]));
  const positive = predictions.filter((p) => p > 0).length;
  const falsePromises = predictions.filter((p, i) => p > 0 && realized[i] === 0).length;
  return {
    mae: round2(errors.reduce((a, b) => a + b, 0) / errors.length),
    positive,
    falsePromises,
    falsePromiseShare: positive > 0 ? round2(falsePromises / positive) : null,
  };
}

/**
 * Pure. `acquisitions` is one entry per acquired player:
 *
 *   { position, rosterSlots, acquiredWeek, firstPlayableWeek (null: none left),
 *     weeks: { [week]: { roster, predicted, actual } } }
 *
 * `weeks` holds the acquisition week and the first playable week. `roster` is
 * the team's stored lineup that week without the acquired player, IR excluded,
 * rows as `upgradeFor` takes them plus `actual` (what the row scored);
 * `predicted` and `actual` are the candidate's stored projection and realized
 * points. A player with no playable week left realizes 0 and the new rule
 * promises him nothing.
 *
 * Returns `{ count, old, new }`, each rule `{ mae, positive, falsePromises,
 * falsePromiseShare }`: the mean absolute error of its Upgrade against the
 * realized one, and the share of its positive Upgrades that realized zero.
 */
function measureUpgradeAccuracy(acquisitions) {
  const predicted = { old: [], new: [] };
  const realized = [];
  for (const a of acquisitions) {
    const gain = (week, field) => {
      const w = a.weeks[week];
      const roster = field === 'actual' ? asPlayed(w.roster) : w.roster;
      return upgradeFor({ position: a.position, projection: w[field] }, roster, a.rosterSlots).points;
    };
    const playable = a.firstPlayableWeek !== null;
    predicted.old.push(gain(a.acquiredWeek, 'predicted'));
    predicted.new.push(playable ? gain(a.firstPlayableWeek, 'predicted') : 0);
    realized.push(playable ? gain(a.firstPlayableWeek, 'actual') : 0);
  }
  return {
    count: acquisitions.length,
    old: summarize(predicted.old, realized),
    new: summarize(predicted.new, realized),
  };
}

// ---------------------------------------------------------------------------
// Database shell: reads only. Nothing here generates a projection (the
// service's `getWeeklyProjections` would write one) or writes a row.
// ---------------------------------------------------------------------------

/** `{ teamId, playerId, at }` for every player a team acquired by add, waiver or trade. */
function acquisitionsOf(transactions) {
  const out = [];
  for (const tx of transactions) {
    const d = tx.detail || {};
    const at = new Date(tx.created_at);
    if (tx.type === 'trade') {
      for (const item of d.items || []) out.push({ teamId: item.toTeamId, playerId: item.playerId, at });
    } else if (d.playerId != null && !d.undo && tx.team_id != null) {
      // An undone drop re-adds a player the team already held: not an acquisition.
      out.push({ teamId: tx.team_id, playerId: d.playerId, at });
    }
  }
  return out;
}

/**
 * The first week from `fromWeek` through `lastWeek` whose game for the player's
 * NFL team kicks off after `joinAt`, or null. The rule of
 * `playerCard.service`'s `firstPlayableWeeks` (#2166) with the acquisition's own
 * time as the join time; a team with no game row anywhere keeps `fromWeek`, as
 * there. ponytail: that function reads `now` and the live waiver state, so the
 * loop is repeated here rather than exported from a file this ticket does not
 * own; fold the two once they can share one pure helper.
 */
function firstPlayableWeek(kickoffs, fromWeek, lastWeek, joinAt) {
  if (!kickoffs) return fromWeek;
  for (let wk = fromWeek; wk <= lastWeek; wk++) {
    const kickoff = kickoffs.get(wk);
    if (kickoff && kickoff > joinAt) return wk;
  }
  return null;
}

/**
 * The week the league was in at `at`: the latest week that had started by
 * then, `weekStarts` being `Map<week, Date>`. Null before the first.
 */
function weekAt(weekStarts, at) {
  let found = null;
  for (const [week, start] of weekStarts) {
    if (start <= at && (found === null || week > found)) found = week;
  }
  return found;
}

const MS_PER_DAY = 24 * 3600 * 1000;
const num = (v) => (v == null ? null : Number(v));

/**
 * Reads the league's season and builds the pure core's input, one entry per
 * acquisition it could measure. `skipped` counts the rest by reason.
 *
 * The league keeps no history of its current week, so a week "starts" at the
 * first lineup row the league materialized for it (`lineup_entries.created_at`):
 * the advance writes them straight after it commits, and a lazy read can only
 * make a week start later than it did. ponytail: that bounds the week of an
 * acquisition made in the minutes around an advance; a stored advance
 * timestamp would settle it.
 */
async function buildAcquisitions(pool, { league, season, fromWeek, toWeek }) {
  const projectionService = require('../services/projection.service');
  const lineupService = require('../services/lineup.service');
  const model = require('../services/projectionModel');
  const { rulesForLeague, calculateFantasyPoints } = require('../services/scoringRules');
  const { normalizeNflTeam } = require('../services/nflTeam');

  const rules = rulesForLeague(league);
  const scoringHash = model.scoringHash(rules);
  const lastWeek = projectionService.lastPlayoffWeek(league);
  const rosterSlots = lineupService.parseLineupSettings(league).rosterSlots;

  const [startRows, finalRows, gameRows, txRows] = await Promise.all([
    pool.query(
      `SELECT "week", MIN("created_at") AS "started" FROM "lineup_entries"
       WHERE "league_id" = $1 AND "season" = $2 GROUP BY "week"`,
      [league.id, season]
    ),
    pool.query(
      `SELECT "week" FROM "matchups" WHERE "league_id" = $1 AND "season" = $2
       GROUP BY "week" HAVING BOOL_AND("final")`,
      [league.id, season]
    ),
    pool.query(`SELECT "nfl_team", "week", "kickoff_at" FROM "nfl_games" WHERE "season" = $1`, [season]),
    pool.query(
      `SELECT "team_id", "type", "detail", "created_at" FROM "transactions"
       WHERE "league_id" = $1 AND "type" IN ('add', 'waiver', 'trade') ORDER BY "created_at", "id"`,
      [league.id]
    ),
  ]);
  const weekStarts = new Map(startRows.rows.map((r) => [Number(r.week), new Date(r.started)]));
  const finalWeeks = new Set(finalRows.rows.map((r) => Number(r.week)));
  const lastFinal = Math.max(0, ...finalWeeks);
  const through = toWeek ?? lastFinal;

  const kickoffsByTeam = new Map();
  let seasonEnd = 0;
  for (const r of gameRows.rows) {
    const team = normalizeNflTeam(r.nfl_team);
    if (team === null) continue;
    if (!kickoffsByTeam.has(team)) kickoffsByTeam.set(team, new Map());
    kickoffsByTeam.get(team).set(Number(r.week), new Date(r.kickoff_at));
    seasonEnd = Math.max(seasonEnd, new Date(r.kickoff_at).getTime());
  }

  const lineups = new Map(); // `${teamId}:${week}` -> rows
  const skipped = {};
  const skip = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; return null; };

  async function lineupFor(teamId, week) {
    const key = `${teamId}:${week}`;
    if (!lineups.has(key)) {
      const { rows } = await pool.query(
        `SELECT "lineup_entries"."player_id", "lineup_entries"."slot", "players"."name",
                "players"."position", "players"."nfl_team"
         FROM "lineup_entries" JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
         WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
           AND "lineup_entries"."week" = $3 AND "lineup_entries"."slot" <> 'IR'`,
        [teamId, season, week]
      );
      lineups.set(key, rows);
    }
    return lineups.get(key);
  }

  /** The last stored run for the week generated before `cutoff`, read, never generated. */
  async function runFor(week, cutoff, playerIds) {
    const { rows: runRows } = await pool.query(
      `SELECT "id", "model_version" FROM "projection_runs"
       WHERE "season" = $1 AND "week" = $2 AND "scoring_hash" = $3 AND "generated_at" < $4
       ORDER BY "generated_at" DESC LIMIT 1`,
      [season, week, scoringHash, cutoff]
    );
    if (runRows.length === 0) return null;
    const { rows } = await pool.query(
      `SELECT "player_id", "mean", "median", "factors" FROM "player_week_projections"
       WHERE "run_id" = $1 AND "player_id" = ANY($2::int[])`,
      [runRows[0].id, playerIds]
    );
    const projections = new Map(rows.map((r) => [r.player_id, {
      playerId: r.player_id,
      modelVersion: runRows[0].model_version,
      mean: num(r.mean),
      median: num(r.median),
      factors: r.factors || {},
    }]));
    return projectionService.toWeeklyProjectionResult({ season, week, projections });
  }

  async function weekInput({ teamId, candidate, week, cutoff, joinAt }) {
    const rows = (await lineupFor(teamId, week)).filter((r) => r.player_id !== candidate.id);
    if (rows.length === 0) return skip('no stored lineup');
    const ids = [...rows.map((r) => r.player_id), candidate.id];
    const run = await runFor(week, cutoff, ids);
    if (run === null || run.projections.get(candidate.id) === undefined) return skip('no stored run');

    const statRows = await pool.query(
      `SELECT "player_id", "stats" FROM "player_stats"
       WHERE "season" = $1 AND "week" = $2 AND "player_id" = ANY($3::int[])`,
      [season, week, ids]
    );
    const price = new Map(statRows.rows.map((r) => [r.player_id, calculateFantasyPoints(r.stats, rules)]));
    const held = new Set((await lineupService.rowsHeldAsPlayed(pool, {
      league, teamId, season, week, rows,
    })).map((r) => r.player_id));

    const roster = rows.map((r) => {
      const verdict = run.startVerdictFor(r.player_id);
      // The same zeroing `loadUpgradeContext` applies to a rostered player.
      const zeroed = verdict.outcome === 'unavailable' || verdict.reason === 'backup';
      const kickoff = (kickoffsByTeam.get(normalizeNflTeam(r.nfl_team)) || new Map()).get(week);
      return {
        playerId: r.player_id,
        name: r.name,
        position: r.position,
        slot: r.slot,
        projection: zeroed ? 0 : run.pointsFor(r.player_id),
        unavailable: zeroed ? (verdict.reason || 'out') : null,
        kickedOff: !!kickoff && kickoff <= joinAt,
        // A player the team did not hold at his kickoff could not have started.
        actual: held.has(r.player_id) ? (price.get(r.player_id) || 0) : 0,
      };
    });
    // The candidate's own refusals (CONTEXT.md Start verdict): no Upgrade is shown.
    const verdict = run.startVerdictFor(candidate.id);
    const refused = verdict.outcome === 'unavailable'
      || (verdict.outcome === 'not_recommended' && !verdict.numberTrusted);
    return {
      roster,
      predicted: refused ? 0 : (run.pointsFor(candidate.id) || 0),
      actual: price.get(candidate.id) || 0,
    };
  }

  const acquisitions = [];
  for (const a of acquisitionsOf(txRows.rows)) {
    const acquiredWeek = weekAt(weekStarts, a.at);
    if (acquiredWeek === null || a.at.getTime() > seasonEnd + 7 * MS_PER_DAY) continue; // another season
    if (acquiredWeek < fromWeek || acquiredWeek > through) continue;
    const { rows: [player] } = await pool.query(
      `SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = $1`, [a.playerId]
    );
    if (!player || player.position == null) { skip('unknown player'); continue; }
    const kickoffs = kickoffsByTeam.get(normalizeNflTeam(player.nfl_team));
    const playableWeek = firstPlayableWeek(kickoffs, acquiredWeek, lastWeek, a.at);
    if (playableWeek !== null && !finalWeeks.has(playableWeek)) { skip('first playable week not final'); continue; }
    // Both predictions read the last run stored before his first playable kickoff.
    const kickoff = playableWeek === null ? null : kickoffs && kickoffs.get(playableWeek);
    const cutoff = kickoff || a.at;

    const weeks = {};
    let measurable = true;
    for (const week of new Set([acquiredWeek, playableWeek].filter((w) => w !== null))) {
      weeks[week] = await weekInput({ teamId: a.teamId, candidate: player, week, cutoff, joinAt: a.at });
      if (weeks[week] === null) { measurable = false; break; }
    }
    if (!measurable) continue;
    acquisitions.push({
      playerId: player.id, position: player.position, rosterSlots, acquiredWeek, firstPlayableWeek: playableWeek, weeks,
    });
  }
  return { acquisitions, skipped };
}

const pct = (share) => (share === null ? 'n/a' : `${(share * 100).toFixed(0)}%`);

function report({ league, season, fromWeek, result, skipped }) {
  const line = (label, r) => `  ${label.padEnd(9)} mean absolute error ${String(r.mae ?? 'n/a').padStart(6)}`
    + `   positive ${String(r.positive).padStart(4)}   realized zero ${String(r.falsePromises).padStart(4)} (${pct(r.falsePromiseShare)})`;
  console.log(`Upgrade accuracy, league ${league.id}, season ${season}, from week ${fromWeek}: ${result.count} acquisitions`);
  console.log(line('old rule', result.old));
  console.log(line('new rule', result.new));
  for (const [reason, n] of Object.entries(skipped)) console.log(`  skipped ${n}: ${reason}`);
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const pool = require('../modules/pool');
  try {
    const { rows: [league] } = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [args.league]);
    if (!league) throw new Error(`league ${args.league} not found`);
    if (league.best_ball) throw new Error('best ball has no Upgrade (ADR 0040)');
    const { acquisitions, skipped } = await buildAcquisitions(pool, {
      league, season: args.season, fromWeek: args.fromWeek, toWeek: args.toWeek,
    });
    report({
      league, season: args.season, fromWeek: args.fromWeek, result: measureUpgradeAccuracy(acquisitions), skipped,
    });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}

module.exports = {
  parseArgs, measureUpgradeAccuracy, buildAcquisitions, firstPlayableWeek, acquisitionsOf, weekAt, main, USAGE,
};
