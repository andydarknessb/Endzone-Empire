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
 *   successful run). Per spec #1493's "UTC day everywhere" decision, the
 *   `'utc-day'` calendar day a run belongs to is `latestOk.detail.day` when
 *   that is a string - the day a job stamps into its own run record when it
 *   STARTS, so a run that starts before UTC midnight and finishes after it
 *   still belongs to the day it started - falling back to the UTC day of
 *   `latestOk.finishedAt` for a row with no such stamp (a legacy row, or a
 *   job that never crosses midnight and so never bothers). Every daily job
 *   gets this for free from the gate itself; no per-job adapter is needed.
 * - `after` names another job whose own latest successful run must postdate
 *   this job's latest successful run - a dependency layered on top of the
 *   cadence above. A job that is due by its own cadence still waits when the
 *   job it depends on has produced nothing fresher than this job's own last
 *   success. This comparison is always on `finishedAt` (an instant, not a
 *   calendar day - `detail.day` plays no part here). The reverse also holds:
 *   when `after` HAS produced something fresher than this job's own last
 *   success, this job is due even when its own cadence already fired more
 *   recently (a same-UTC-day `'utc-day'` success, say) - `after` is a
 *   standing "something changed since I last ran" signal, not merely a gate
 *   consulted only when the cadence alone already says due (fleet#1511 f2:
 *   without this, a stat-correction pass that succeeds AFTER the day's
 *   off-peak projection fill has already run once left its wipe unrefilled
 *   until the next UTC day).
 * - `lastRun` defaults to the Sync run module's reader
 *   (`server/modules/syncRun.js`'s `lastRun`, ADR 0036). A caller may inject
 *   its own reader - one whose read can fail differently, or that decorates
 *   the underlying rows in some way of its own - without this module knowing
 *   anything about that. It must still resolve `{ latest, latestOk }` in the
 *   shape `lastRun` itself returns.
 * - Never writes: every path through this module only ever reads, through
 *   `lastRun`.
 * - `now` defaults to `new Date()`.
 */
async function due({ job, every, after, now = new Date() } = {}, { lastRun = syncRun.lastRun } = {}) {
  assertValidEvery(every);
  const { latestOk } = await lastRun(job);
  const cadenceVerdict = evaluateCadence(every, latestOk, now);
  if (!after) return cadenceVerdict;

  const { latestOk: afterLatestOk } = await lastRun(after);
  const afterIsFresher = Boolean(afterLatestOk) &&
    (!latestOk || afterLatestOk.finishedAt.getTime() > latestOk.finishedAt.getTime());
  if (afterIsFresher) {
    // `after` has produced something new since this job's own last success:
    // due regardless of whether the cadence above already fired today.
    return cadenceVerdict.due ? cadenceVerdict : { due: true, reason: `"${after}" succeeded since this job's last success` };
  }
  if (!cadenceVerdict.due) return cadenceVerdict; // own cadence already says not due, and `after` gives no reason to override it
  if (!afterLatestOk) {
    return { due: false, reason: `waiting on "${after}" to succeed` };
  }
  return { due: false, reason: `waiting on "${after}" to succeed again` };
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
    return lastSuccessDayKey(latestOk) === utcDateKey(now)
      ? { due: false, reason: 'already succeeded today (UTC)' }
      : { due: true, reason: 'last success was a prior UTC day' };
  }

  const ms = Number(every.ms);
  const elapsed = now.getTime() - latestOk.finishedAt.getTime();
  return elapsed >= ms
    ? { due: true, reason: `${elapsed}ms since the last success, cadence is ${ms}ms` }
    : { due: false, reason: `${elapsed}ms since the last success, cadence is ${ms}ms` };
}

/**
 * Pure: the UTC calendar day `latestOk` belongs to, for `'utc-day'` cadence
 * comparisons only (spec #1493, "UTC day everywhere"). `detail.day`, when the
 * run stamped one at start, wins over `finishedAt` - a run that starts at
 * 23:58 UTC and finishes at 00:01 UTC the next day still belongs to the day
 * it started, and only the job itself knows that at start; by the time this
 * gate reads the row back, `detail.day` is the only trustworthy source for
 * it. A row with no such stamp (a legacy row, or a job whose passes never
 * cross midnight) falls back to the UTC day of `finishedAt`.
 */
function lastSuccessDayKey(latestOk) {
  if (latestOk.detail && typeof latestOk.detail.day === 'string') return latestOk.detail.day;
  return utcDateKey(latestOk.finishedAt);
}

/** Pure: a Date's UTC calendar day as a sortable, comparable key (YYYY-MM-DD). */
function utcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = { due, utcDateKey };
