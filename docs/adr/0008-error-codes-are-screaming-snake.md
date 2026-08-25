# Error codes are SCREAMING_SNAKE, on the wire as well as inside

Status: accepted (2026-08-25)

Every application error code this app EMITS is upper snake case, whatever
carries it: a JSON error body from an HTTP route, a socket acknowledgement, or
an `Error` thrown across a service boundary with a `code` on it. There is one
spelling, and a new code does not get to reopen the question.

This settles an inconsistency rather than inventing a rule. `PICKEM_LOCKED`,
`RECENT_AUTH_REQUIRED`, `UNTRUSTED_ORIGIN`, `LINEUP_LOCKED`, `RATE_LIMITED`,
`NOT_FOUND` and the rest were already upper snake. The three socket join
refusals #230 added - `invalid_request`, `not_a_member`, `join_failed` - were
the only lowercase ones in the repository, and they were lowercase because
#230's brief named those strings verbatim, not because anyone chose it. #265
renamed them to `INVALID_REQUEST`, `NOT_A_MEMBER` and `JOIN_FAILED`.

Two rules travel with the spelling, because they are what the code is FOR:

- **The code is the contract; the message is copy.** A client branches on
  `code` and never on the message text. `JOIN_FAILED` proves why: its message
  names the room it failed to join, so matching on text means matching two
  strings for one condition, and a copy edit becomes a behaviour change.
- **An unknown code is an error you cannot interpret, so change no state on
  it.** A client acts on the codes it knows, surfaces the error for anything
  else, and takes nothing away on a code it does not recognise or on an
  acknowledgement carrying no code at all.

## Scope

Applies to error-code STRINGS this application emits. It does not apply to,
and nothing here asks anyone to rename:

- database values (enum-like column contents such as `draft_status`), which
  are data and whose rename is a migration;
- log event names, metric names and non-error protocol tokens (socket event
  names like `draft:join`, the `ok` on a successful ack);
- HTTP status constants and numeric statuses;
- error codes we RECEIVE rather than emit - Node's `ECONNRESET`, Postgres
  `SQLSTATE`s, multer's `LIMIT_FILE_SIZE`. They happen to be upper snake, but
  they are somebody else's contract and are matched as found.

## Considered options

- **Keep lowercase for wire codes deliberately, upper for internal ones.**
  Rejected: the boundary is not where anyone would guess. `PICKEM_LOCKED`
  reaches a browser in an HTTP error body, so it is every bit as much a wire
  code as a socket refusal is, and a rule that splits them makes the next
  author classify their code before spelling it.
- **Leave the three as they are and write down "match what is nearby".**
  Rejected: it makes the convention depend on which file the next author opens
  first, which is exactly the failure this ADR exists to end.
- **Introduce a shared constants module both bundles import.** Left out on
  purpose, and out of scope for #265. The client and the server are separate
  bundles with no shared package today, so this is a build-layout decision
  that deserves its own ticket rather than a side effect of a rename. Until
  then the strings are duplicated at the two ends and pinned by tests on both.

## Consequences

- Renaming a shipped wire code costs one deploy-skew window, and costs it
  cheaply BECAUSE of the unknown-code rule above. While a client and a server
  disagree, the older spelling reads as an unrecognised code: the failure mode
  is a stale display for that window, never an identity cleared on a code
  nobody could interpret. `useDraftSocket.test.js` pins both halves, including
  the pre-#265 lowercase value, so the accepted cost is written down as a test
  rather than remembered.
- The socket join codes are proven at three levels, and a change to them
  should show up in all three: unit tests on the client hook, the contract
  test on the refusal shape, and the real-socket harness in
  `socketJoinEndToEnd.test.js` that drives a genuine connection.
- A new code needs no discussion about spelling. Adding one to a client's
  known set is a deliberate act; until that happens the client's existing
  behaviour for an unknown code is already the correct one.
