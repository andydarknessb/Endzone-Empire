# A pooled transaction closes through withTransaction

Status: accepted (2026-09-08)

A transaction borrowed from the pg pool has one dangerous moment: the close.
Not the COMMIT, and not an ordinary ROLLBACK, but the case where the ROLLBACK
itself rejects. A rejecting ROLLBACK leaves the transaction, and any
transaction-scoped lock it holds, open on the socket. If that client is then
returned to the pool with a bare `release()`, the next borrower inherits an
open transaction and the lock strands behind the transaction pooler, where a
sweep cannot see it to clear it. This is the failure #839 traced: a stuck draft
whose advisory lock no longer had an owner any query could find.

The rule that avoids it is small and exact, and it was hand-rolled at every
call site that owned a pooled transaction. Four steps, copy-pasted: hoist a
`rollbackError`, guard the ROLLBACK in the catch, attach the rollback failure
to the original error before rethrowing the original (never the rollback
failure), and in the `finally` release with an `Error` only when that hoisted
`rollbackError` was set. Four steps at each site is four chances to get one
wrong, and #1048, #1053 and #1055 were each a site where one had been.

We decide that a pooled transaction closes through one wrapper,
`withTransaction(pool, work, { label })` in `server/modules/`, and that the
close rule is written in code exactly once, there. The wrapper connects, opens
the transaction, runs `work(client)`, and:

- on return, COMMITs and resolves to whatever `work` returned;
- on a throw, rolls back and rethrows the ORIGINAL error. If the ROLLBACK
  itself rejects, that rejection is attached as `error.rollbackError` and
  logged once with the label, and it is never what surfaces to the caller;
- if `pool.connect()` itself rejects, nothing is rolled back or released and
  the rejection propagates untouched. There is no client yet, so folding a
  connect failure into the transaction's catch would call ROLLBACK and
  `release` on `undefined` and turn the connection error into a TypeError that
  swallows it (the #1053 trap).

The connection is destroyed - released with an `Error`, so pg-pool drops the
socket and Postgres frees the session's locks on disconnect - ONLY when the
ROLLBACK itself rejected. Every other path, COMMIT and clean ROLLBACK alike,
returns the healthy connection to the pool bare. Assigning the hoisted
destroy-flag before attaching to the original error is deliberate: a
non-extensible thrown value (a frozen object, a primitive) makes the attach
throw, and assigning first, then tolerating the attach failure, keeps the
destroy path taken and the original value rethrown.

The rule lives here and nowhere else. `runInjurySync`, `generateMatchups` and
`scoreMatchups` in `scoring.service.js` call the wrapper and carry no `BEGIN`,
`COMMIT`, `ROLLBACK` or `release` of their own; the five-line comment each once
repeated is gone, replaced by one sentence pointing here. Two pooled
transactions stay outside this wrapper on purpose: `advisoryLock.js` and
`liveGameEngine.js` each wrap a lock transaction that never writes and closes
by a flag rather than by throw, and folding that shape in would widen the
wrapper's contract for two callers (they keep their own close, matching this
rule). The roughly eighty remaining bare-ROLLBACK sites across the server are a
separate migration, filed as the follow-up to #1060; a guard against a bare
`query('ROLLBACK')` ships with that migration's last conversion, not before it
(ADR 0010: a convention ships with its consumer).

Retries, timeouts and savepoints are out of scope. The wrapper owns the close,
nothing more.

Refs: #839, #1048, #1053, #1055, #1060.
