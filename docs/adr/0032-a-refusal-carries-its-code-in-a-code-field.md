# A refusal carries its code in a code field

Status: accepted (2026-09-07)

The server shipped more than one failure envelope. In one of them the field a
client reads as the human message was the machine code: `{ error: <code>,
message: <sentence> }`. Thirteen routes emitted it (the nine commissioner
mutations through one `handle()` helper, both coded refusals on
`POST /api/scoring/league/:id/correct-week`, and the shared lineup handler
behind `PUT` and `POST /api/team/lineup`). A commissioner performing a
legitimate action was shown the literal string `PICKEM_SEASON_RESULT_MISSING`
while the sentence written for her sat unread in a field nobody read. The rule
that a client branches on a code and never on message text was unimplementable
almost everywhere, because no module handed a caller a code.

`readHttpFailure` (#957, `src/lib/httpFailure.js`) fixed the reading half: one
pure module returns a message, a code and a status, discriminating on key
presence rather than on the shape of a string, and tolerating every envelope
the server emits. Tolerance is not convergence. This ADR records the writing
half.

We decide that a refusal carries its machine code in a `code` field of its own
and the sentence a person reads in `message`. A refusal with no code keeps
emitting `{ error: <sentence> }`; that shape carries no machine identifier, so
it is not part of this convergence and nothing about it changes. The thirteen
emitters above are converted, and each converted route has a route-level test
asserting all three of: the code arrives under `code`, the sentence arrives
under `message`, and `error` is absent. The third assertion is the load-bearing
one. Without it a route could emit the new key beside the old one and every
test would stay green while nothing had converged.

The convergence is shrink-only rather than a flag day. Emitters outside the
thirteen keep their shapes until their own island converges them, and
`scripts/envelopeConformance.js` counts them: it parses every `res.json(...)`
object literal under `server/` and compares the non-conforming ones against a
per-file, per-shape allowlist with counts. Growth fails. So does a stale entry
whose count no longer matches, because an entry left too high lets the
tolerance silently regrow to its old size. A scan that enumerates zero emitters
fails rather than passing vacuously, the rule ADR 0014 set for the harness
guard.

## The four-envelope tolerance

`readHttpFailure` tolerates four shapes, enumerated from the server on
2026-09-06:

- `{ error: <sentence> }`, the large codeless population.
- `{ error: <code>, message: <sentence> }`, the thirteen emitters this ADR
  converts. **Zero remain in the server after this change.** The reader keeps
  the arm for hand-written fixtures and for any caller still holding an old
  response.
- `{ code, message, requestId }`, the target, already emitted by the global
  express error handler, the `/api` 404 handler, the rate limiter, and the auth
  and user routes.
- `{ error: <sentence>, code }`, a code beside a sentence in the `error` field.
  Eight sites remain, all allowlisted: three on the Draft router, two on the
  league router, two on the pick'em router, one in the league-type middleware.

The tolerance is deliberately not a compatibility promise. It is a countdown
with a counter attached.

## When the reader's tolerance arm is deleted

The reader has one arm that exists only for the shapes this ADR is retiring:
the branch that treats `error` as the code when a `message` sibling is present,
and the branch that falls back to `error` for the sentence when a `code` key is
present. That code is deleted when all three of the following hold:

1. `scripts/envelopeConformance.js` reports zero non-conforming emitters and
   the allowlist is empty. The guard's own stale-entry rule makes an empty
   allowlist provable rather than assumed.
2. No test fixture in the tree hand-writes a retired envelope, except the ones
   deliberately kept to pin the tolerance itself. Those fixtures are the ones
   that go red on the deletion, which is how the deletion is verified rather
   than hoped.
3. One release has shipped with the guard at zero. A browser holding a cached
   client can read a response emitted before the deploy, and the reader is the
   only thing between that response and a toast.

Until all three hold, the arm stays. The condition is written here so the
answer is recorded rather than re-derived, and so the deletion is a decision
someone makes rather than one nobody dares to.

## Considered options

- **Emit `{ code, message }` and drop `error` (chosen).** The `error` key was
  the field the client showed as prose, so leaving it holding the code would
  have preserved the defect for any caller not yet reading through the reader.
  Every client call site reads through `readHttpFailure` as of #957 through
  #972, which is what made the drop safe rather than merely correct.
- **Emit the code in `code` and keep the sentence duplicated in `error`.**
  Rejected: it is indefinitely compatible, which is another way of saying the
  tolerance never shrinks. The guard would have counted zero violations while
  four envelopes were still on the wire.
- **Sweep every emitter in one pass.** Rejected, and out of scope in the parent
  spec: the remaining eight sites are spread across three islands whose copy
  and consumers are owned elsewhere, and a flag day across them would be a copy
  change wearing a refactor's clothes.
- **Guard the envelope by asserting on responses in the test suite instead of
  parsing the source.** Rejected: it can only see routes a test happens to
  drive, so a new non-conforming route with no test would pass. The allowlist
  has to be a property of the source to be a property of the server.
- **Line-keyed allowlist.** Rejected: line numbers churn on every unrelated
  edit, so the list would generate merge conflicts and would be updated by
  reflex rather than by decision.

## Consequences

- The live consumer of this envelope is the Manual Score Correction control in
  `CommissionerTools`, which locks itself on `CORRECTION_WINDOW_EXPIRED`. It
  reads the code through `readHttpFailure` (#972), so it locks on both the new
  and the retired envelope; its test drives both, and the retired row is a
  hand-written fixture that goes red when the tolerance arm is deleted.
- `npm run check:envelope-conformance` runs in the `guards` script. A new
  non-conforming emitter fails it by name and line.
- The `leagueId` and `season` fields the commissioner helper spreads beside a
  rollover integrity refusal are unaffected. Extra fields ride alongside the
  envelope; they are not part of it.
