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

## Decision

A pooled transaction closes through one wrapper,
`withTransaction(pool, work, { label })` in `server/modules/`, and the close
rule is written in code exactly once, there, for every pooled transaction that
closes by throw. The wrapper connects, opens the transaction, runs
`work(client)`, and:

- on return, COMMITs and resolves to whatever `work` returned;
- on a throw, rolls back and rethrows the ORIGINAL error. If the ROLLBACK
  itself rejects, that rejection is attached as `error.rollbackError` (when the
  original value can carry it) and logged once with the label; it is never what
  surfaces to the caller, even when it is a falsy or non-Error value;
- if `pool.connect()` itself rejects, nothing is rolled back or released and
  the rejection propagates untouched. There is no client yet, so folding a
  connect failure into the transaction's catch would call ROLLBACK and
  `release` on `undefined` and turn the connection error into a TypeError that
  swallows it (the #1053 trap).

The connection is destroyed - released with an `Error`, so pg-pool drops the
socket and Postgres frees the session's locks on disconnect - whenever, and
only whenever, the ROLLBACK itself rejected. The destroy is driven by a boolean
set when the ROLLBACK's catch runs, not by the truthiness of the value it
rejected with, so a ROLLBACK that rejects with `null`, `0` or `''` still
destroys. Every other path, COMMIT and clean ROLLBACK alike, returns the
healthy connection to the pool bare. The release call is itself guarded, so a
throw from `release` (a double release from a caller that still owns its own,
reachable during the #1061 migration) cannot mask the value or error the
wrapper is already returning or throwing.

## Considered options

A `releaseAfterTransaction(client, err)` helper was rejected: it would leave the
four steps hand-rolled at every site and factor out only the release line, the
one line that was not where the bugs were. Folding `advisoryLock.js` and
`liveGameEngine.js` into the wrapper was rejected too (Ruling 2): each wraps a
lock transaction that never writes and closes by a flag rather than by throw,
and absorbing that shape would widen the wrapper's contract for two callers.
Those two modules keep their own close; it is the same rule this ADR states,
written inline for a flag-based close, and it stays out of this wrapper's scope
rather than out of the rule.

## Consequences

`runInjurySync`, `generateMatchups` and `scoreMatchups` in
`scoring.service.js` call the wrapper and carry no `BEGIN`, `COMMIT`, `ROLLBACK`
or `release` of their own. The copy-pasted rule comment that each once repeated
is removed, and each site keeps a short comment pointing at this ADR rather than
restating the rule; the rule's explanation lives here.

The roughly eighty remaining bare-ROLLBACK sites across the server are a
separate migration, filed as #1061, the follow-up to this ticket. A guard
against a bare `query('ROLLBACK')` ships with that migration's last conversion,
not before it (ADR 0010: a convention ships with its consumer). Because the
wrapper is about to be inherited by that many callers, its jsdoc documents the
misuse shapes it does not defend against - `work` issuing its own
COMMIT/ROLLBACK, `work` querying the ambient pool instead of the passed client,
and nesting on the same pool - so an inheritor reads the boundary before
crossing it.

Retries, timeouts and savepoints are out of scope. The wrapper owns the close,
nothing more.

Refs: #839, #1048, #1053, #1055, #1060, #1061.

## Amendment (2026-09-09): labels are unique (#1068, #1081)

A `withTransaction` label is unique to its call site: it exists only to name which transaction failed to close (#839), so the guard that ships with #1061's last conversion (#1068) also fails when one label appears at two call sites (#1081).
