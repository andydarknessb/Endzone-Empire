'use strict';

const syncRun = require('./syncRun');

/**
 * The cadence gate (spec #1492, step two): is `job` due to run right now?
 * Read-side only - it never writes, and it never runs a job itself, it only
 * answers the question. `due({ job, every, after, now }, { lastRun })` ->
 * `{ due, reason }`.
 *
 * - `every` is `'utc-day'` (due once the last successful run's UTC calendar
 *   day is not today's UTC calendar day - so a run finished one minute into a
 *   new UTC day is due again immediately, however few minutes elapsed; an
 *   elapsed-milliseconds cadence would get that backwards) or `{ ms }` (due
 *   once at least that many milliseconds have elapsed since the last
 *   successful run).
 * - `after` names another job whose own latest successful run must postdate
 *   this job's latest successful run - a dependency layered on top of the
 *   cadence above. A job that is due by its own cadence still waits when the
 *   job it depends on has produced nothing fresher than this job's own last
 *   success.
 * - `lastRun` defaults to the Sync run module's reader
 *   (`server/modules/syncRun.js`'s `lastRun`, ADR 0036). A caller may inject
 *   its own reader - one that reads a job's run history under a rule of its
 *   own (a job that stamps which calendar day it ran FOR in its own `detail`,
 *   say, rather than trusting `finished_at`) - without this module knowing
 *   anything about that job's shape.
 * - Never writes: every path through this module only ever reads, through
 *   `lastRun`.
 * - `now` defaults to `new Date()`.
 */
async function due({ job, every, after, now = new Date() } = {}, { lastRun = syncRun.lastRun } = {}) {
  assertValidEvery(every);
  const { latestOk } = await lastRun(job);
  const cadenceVerdict = evaluateCadence(every, latestOk, now);
  if (!cadenceVerdict.due) return cadenceVerdict;
  if (!after) return cadenceVerdict;

  const { latestOk: afterLatestOk } = await lastRun(after);
  if (!afterLatestOk) {
    return { due: false, reason: `waiting on "${after}" to succeed` };
  }
  if (latestOk && afterLatestOk.finishedAt.getTime() <= latestOk.finishedAt.getTime()) {
    return { due: false, reason: `waiting on "${after}" to succeed again` };
  }
  return cadenceVerdict;
}

/** Throws on an `every` shape that is neither `'utc-day'` nor `{ ms }`, regardless of run history. */
function assertValidEvery(every) {
  const isMsCadence = every && typeof every === 'object' && Number.isFinite(Number(every.ms));
  if (every !== 'utc-day' && !isMsCadence) {
    throw new Error(`cadence.due: invalid 'every' value ${JSON.stringify(every)}`);
  }
}

/** Pure: the cadence-only verdict, before any `after` dependency is applied. `every` is already validated. */
function evaluateCadence(every, latestOk, now) {
  if (!latestOk) return { due: true, reason: 'never run' };

  if (every === 'utc-day') {
    return utcDateKey(latestOk.finishedAt) === utcDateKey(now)
      ? { due: false, reason: 'already succeeded today (UTC)' }
      : { due: true, reason: 'last success was a prior UTC day' };
  }

  const ms = Number(every.ms);
  const elapsed = now.getTime() - latestOk.finishedAt.getTime();
  return elapsed >= ms
    ? { due: true, reason: `${elapsed}ms since the last success, cadence is ${ms}ms` }
    : { due: false, reason: `${elapsed}ms since the last success, cadence is ${ms}ms` };
}

/** Pure: a Date's UTC calendar day as a sortable, comparable key (YYYY-MM-DD). */
function utcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = { due, utcDateKey };
