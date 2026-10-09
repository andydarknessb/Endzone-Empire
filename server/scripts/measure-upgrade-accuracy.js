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

module.exports = { parseArgs, measureUpgradeAccuracy, USAGE };
