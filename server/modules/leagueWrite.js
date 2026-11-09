'use strict';

const pool = require('./pool');
const { withTransaction } = require('./withTransaction');
const { logger } = require('./logger');
const sentry = require('./sentry');

const LOCK_AND_ADVANCE = `UPDATE "leagues" SET "board_version" = "board_version" + 1 WHERE "id" = $1 RETURNING *`;

/**
 * leagueWrite({ leagueId, label, within }, body) - the League write (CONTEXT.md,
 * League write; ADR 0070). It owns the League-row lock, the transaction close
 * (withTransaction, ADR 0033) and the after-commit queue. A caller supplies a body
 * and never takes the lock itself.
 *
 * Without `within`: the first statement after BEGIN locks the League row FOR NO
 * KEY UPDATE and advances its board version (ADR 0025, 2026-11-06), then
 * body({ client, league, afterCommit }) runs. `league` is null for
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
      // The UPDATE takes the same FOR NO KEY UPDATE lock a SELECT would, and moves
      // the board version with every League write.
      const leagueResult = await client.query(LOCK_AND_ADVANCE, [leagueId]);
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

/**
 * The League row lock that advances the board version (ADR 0025, 2026-11-06), for
 * a Draft-state writer outside leagueWrite. Call it first in its transaction, as
 * leagueWrite does. Returns the locked row, board_version already advanced, or
 * null for an unknown League.
 */
async function lockLeague(client, leagueId) {
  const result = await client.query(LOCK_AND_ADVANCE, [leagueId]);
  return result.rows[0] || null;
}

module.exports = { leagueWrite, lockLeague };
