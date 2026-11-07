'use strict';

const pool = require('./pool');
const { withTransaction } = require('./withTransaction');
const { logger } = require('./logger');
const sentry = require('./sentry');

/**
 * leagueWrite({ leagueId, label, within }, body) - the League write (CONTEXT.md,
 * League write; ADR 0070). It owns the League-row lock, the transaction close
 * (withTransaction, ADR 0033) and the after-commit queue. A caller supplies a body
 * and never takes the lock itself.
 *
 * Without `within`: the first statement after BEGIN locks the League row FOR NO
 * KEY UPDATE, then body({ client, league, afterCommit }) runs. `league` is null for
 * an unknown League (the body refuses it). After COMMIT, the functions queued
 * through afterCommit(fn) run in order. Each is contained: a failure is reported
 * once through the logger and Sentry and the next still runs, because a committed
 * write is never reported as failed. A body that throws rolls back, queues nothing
 * to run, and rethrows its own error.
 *
 * With `within` (the outer write's object): no BEGIN, no lock, no COMMIT. The body
 * runs on the outer client and League, and its after-commit work queues behind the
 * outer commit. A `within` for another League throws.
 *
 * `label` is the withTransaction label; each call site passes its own (ADR 0033).
 */
async function leagueWrite({ leagueId, label, within }, body) {
  if (within) {
    if (!within.league || String(within.league.id) !== String(leagueId)) {
      throw new Error(`leagueWrite: a nested write for League ${leagueId} cannot run within another League`);
    }
    return body({ client: within.client, league: within.league, afterCommit: within.afterCommit });
  }

  const queue = [];
  const result = await withTransaction(
    pool,
    async (client) => {
      // The lock precedes any mutation: the body's first write is always behind it.
      const leagueResult = await client.query(
        `SELECT * FROM "leagues" WHERE "id" = $1 FOR NO KEY UPDATE`,
        [leagueId]
      );
      const league = leagueResult.rows[0] || null;
      return body({ client, league, afterCommit: (fn) => queue.push(fn) });
    },
    { label }
  );

  for (const fn of queue) {
    try {
      await fn();
    } catch (error) {
      logger.error({ err: error, leagueId, label }, 'League write committed but an after-commit step failed');
      sentry.captureError(error, { leagueId });
    }
  }
  return result;
}

module.exports = { leagueWrite };
