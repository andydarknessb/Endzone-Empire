'use strict';

const pool = require('./pool');
const { withTransaction } = require('./withTransaction');
const { recordDataSyncRun } = require('../services/dataSyncRuns');

/**
 * A feed sync is a Sync run (CONTEXT.md, ADR 0036). `runSyncJob({ job, lock,
 * fetch, apply })` is the one place the shape shared by every feed sync
 * (injuries, ADP, schedule, players, week stats) is written: fetch outside any
 * transaction or lock, apply each unit inside its own `withTransaction` (ADR
 * 0033) under the job's lock, and record exactly one `data_sync_runs` row for
 * the whole run.
 *
 * - `fetch()` runs first, outside any transaction and outside any lock. It
 *   returns `units[]`, the work `apply` will run once per unit, or
 *   `{ refused: true, reason }` when the feed answered but the job declines to
 *   write (a thin ADP market, say). An untagged throw from `fetch` is tagged
 *   `fetch_failed`; `fetch` may pre-tag `error.syncFailureReason` itself (a 502
 *   shape guard tags `bad_response`) and that tag wins.
 * - `apply(client, unit)` runs once per unit, each unit in its own transaction
 *   (`withTransaction(pool, ..., { label: job })`) after
 *   `SELECT pg_advisory_xact_lock($1)` with `lock`, when the job takes one. A
 *   unit that throws is tagged `write_failed` (unless already tagged) and
 *   recorded in `detail.failed[]`; the units already applied in earlier
 *   iterations stay applied, since each ran and committed in its own
 *   transaction.
 * - Exactly one `data_sync_runs` row is written per run, by `recordDataSyncRun`
 *   (best-effort: a failure to record never masks the run's real outcome).
 *   `ok` is true only when every unit applied; the outcome and any failed
 *   units live in `detail`, since the table carries no `reason` column.
 * - On success `runSyncJob` resolves to the single unit's `apply` result (or
 *   `{ results: [...] }` when there was more than one unit) - today's only
 *   caller, the injuries job, has exactly one unit, so its result is
 *   `apply`'s return value unwrapped. On a unit failure it rethrows the
 *   ORIGINAL error from the first unit that failed (with any
 *   `error.rollbackError` `withTransaction` attached), after recording; on a
 *   fetch failure it rethrows the (possibly pre-tagged) fetch error the same
 *   way. A refusal never throws; it resolves to `{ refused: true, reason }`.
 */
async function runSyncJob({ job, lock, fetch, apply }) {
  const startedAt = new Date();
  let units;
  try {
    units = await fetch();
  } catch (error) {
    error.syncFailureReason = error.syncFailureReason || 'fetch_failed';
    await recordDataSyncRun({
      job,
      startedAt,
      ok: false,
      detail: { reason: error.syncFailureReason, message: error.message },
    });
    throw error;
  }

  if (units && units.refused) {
    await recordDataSyncRun({
      job,
      startedAt,
      ok: false,
      detail: { reason: 'refused', refusalReason: units.reason || null },
    });
    return { refused: true, reason: units.reason || null };
  }

  const list = Array.isArray(units) ? units : [units];
  const results = [];
  const failed = [];
  let firstFailure = null;
  for (let i = 0; i < list.length; i++) {
    const unit = list[i];
    try {
      // Sequential by design: each unit is its own transaction and must
      // commit or roll back before the next one starts (ADR 0036).
      const result = await withTransaction(
        pool,
        async (client) => {
          if (lock) await client.query('SELECT pg_advisory_xact_lock($1)', [lock]);
          return apply(client, unit);
        },
        { label: job }
      );
      results.push(result);
    } catch (error) {
      error.syncFailureReason = error.syncFailureReason || 'write_failed';
      failed.push({ unit: i, message: error.message, reason: error.syncFailureReason });
      firstFailure = firstFailure || error;
    }
  }

  if (failed.length > 0) {
    await recordDataSyncRun({
      job,
      startedAt,
      ok: false,
      detail: { reason: 'write_failed', failed },
    });
    throw firstFailure;
  }

  await recordDataSyncRun({
    job,
    startedAt,
    ok: true,
    detail: results.length === 1 ? results[0] : { results },
  });
  return results.length === 1 ? results[0] : results;
}

/**
 * `{ latest, latestOk }` for `job` in one query (ORDER BY finished_at DESC, id
 * DESC): `latest` is the most recent run regardless of outcome, `latestOk` is
 * the most recent run with `ok = true` - "last successful sync" (CONTEXT.md).
 * Either is `null` when no such row exists. One round trip via two correlated
 * subqueries, rather than two separate queries, so a caller reading both never
 * pays for or risks a second network hop.
 */
async function lastRun(job) {
  const res = await pool.query(
    `SELECT
       (SELECT row_to_json(r) FROM (
          SELECT "id", "finished_at", "ok", "detail" FROM "data_sync_runs"
           WHERE "job" = $1
           ORDER BY "finished_at" DESC, "id" DESC LIMIT 1
        ) r) AS "latest",
       (SELECT row_to_json(r) FROM (
          SELECT "id", "finished_at", "ok", "detail" FROM "data_sync_runs"
           WHERE "job" = $1 AND "ok" = true
           ORDER BY "finished_at" DESC, "id" DESC LIMIT 1
        ) r) AS "latestOk"`,
    [job]
  );
  const row = res.rows[0] || {};
  return { latest: toRun(row.latest), latestOk: toRun(row.latestOk) };
}

function toRun(json) {
  if (!json) return null;
  return {
    id: json.id,
    finishedAt: json.finished_at ? new Date(json.finished_at) : null,
    ok: json.ok,
    detail: json.detail,
  };
}

module.exports = { runSyncJob, lastRun };
