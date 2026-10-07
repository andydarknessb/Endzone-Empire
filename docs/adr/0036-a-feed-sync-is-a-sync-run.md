# A feed sync is a Sync run

Status: accepted (2026-09-10)

Every feed sync (injuries, ADP, schedule from either source, players, season
stats, team defenses, week stats) has the same shape around its real work:
fetch from a feed, take a lock so two writers of the same table cannot
interleave, write inside a transaction, tag why it failed, and record the run
so the scheduler and the health probe can say when it last succeeded. Between
2026-09-06 and 2026-09-10 eight commits re-edited that shape by hand (#904,
#929, #961, #1047, #1051, #1053, #1055, #1129), and at the end of them it
existed as two hand copies (injuries, ADP) and five syncs with none of it. The
week-stats sync, which runs on the scheduler every few ticks and writes the
stats every Live box is priced from, had no run record, no transaction and no
try/catch around the run.

## Decision

A feed sync is a Sync run (CONTEXT.md) executed through one module,
`runSyncJob({ job, lock, fetch, apply })` in `server/modules/`, and the shape
is written in code once, there.

- `fetch` runs first, outside any transaction and outside any lock, and
  returns the units to apply. A feed call never runs inside a transaction.
- `apply(client, unit)` runs once per unit, each unit in its own transaction
  (through `withTransaction`, ADR 0033) and under the job's lock for that
  transaction. One unit failing keeps the units already applied and is
  recorded; it does not roll back the others.
- The lock is a parameter of the job, keyed by the table family the job
  writes, never a global: players-table writers share `PLAYERS_BULK_WRITE_LOCK`
  (23004, ADR 0033's neighbour in `advisoryLock.js`), nfl_games writers share
  a key of their own so the Tank01 and nflverse schedule sources serialize, and
  a job that writes a table nobody else bulk-writes takes none.
- Every run writes one `data_sync_runs` row with one of five outcomes:
  `ok`, `refused` (the feed answered but the job declined to write, such as a
  thin ADP market), `fetch_failed`, `bad_response`, `write_failed`. The module
  tags an untagged throw from `fetch` as `fetch_failed` and from `apply` as
  `write_failed`; a job may pre-tag `bad_response` or return a refusal. A run
  with any failed unit is `write_failed` with the failed units in its detail.
- `lastRun(job)` returns `{ latest, latestOk }` in one read; "last successful
  sync" is `latestOk`.

## Considered options

One transaction per run was rejected: week stats writes `player_stats` per
game, the same rows the Live box poll upserts, and a slate-wide transaction
would hold those row locks across every game while the poll waits. Per-unit
transactions are the granularity the interleaved code already had; the module
keeps it and adds what the code did not have.

A per-game Sync run for week stats was rejected: sixteen rows every few ticks
is noise the scheduler status cannot read. One run per invocation, with the
units in its detail, is what an operator wants to see.

Moving the syncs out of `scoring.service.js` in the same change was rejected:
three test files mock the sync names on that module's façade with
`t.mock.method`, so the façade's properties must stay plain data and stay put.
The syncs call the module from where they are; a move is a separate pure move.

The Live box source switch also writes a `data_sync_runs` row, and stays
outside this module: it is a signal that the source changed (ADR 0035), not a
run of a feed sync.

## Amendment (#1913): a unit with no transaction

A unit whose `apply` makes feed calls or only autocommit writes runs with
`transaction: false` (`runSyncJob({ job, lock, transaction, fetch, apply })`):
no transaction and no lock, and `apply` gets `null` for its client. That is
what keeps "A feed call never runs inside a transaction" true for the weather
snapshots and the nightly projection fill. A lock needs a transaction, so
`transaction: false` with a `lock` is refused.

## Amendment (#2050): one typed outcome

`runSyncJob` resolves one typed shape, `{ status, results }`: `results` is
always an array (one `apply` result per unit, length 1 for a single-unit run),
and `status` is `ok`, `refused` or `unconfigured` (every unit reported
`unconfigured: true`: an optional integration that is not set up, still an `ok`
row). A refusal resolves `{ status: 'refused', reason, results: [] }`. The other
three statuses, `fetch_failed`, `bad_response` and `write_failed`, throw, with
the status on `error.syncFailureReason`. That makes six outcomes where the
decision above listed five. `lastRun` decodes the same status off each row as
`outcome`, and the readers use it instead of re-interpreting the row: the
cadence gate (a `refused` run settles its UTC day; a failed run holds the job
back for the `retryMs` the job sets for itself) and the scheduler status. A
caller that hands one unit on to its own callers takes it at its own boundary
(`const { results: [unit] } = await runSyncJob(...)`); `runSyncJob` never
resolves two shapes. The Tue/Wed stat-correction pass is a Sync run like the
rest (`transaction: false`), no longer a hand-written row. An apply error may
carry `syncDetail`, merged into the failed row's detail (the pass's failed
weeks).
