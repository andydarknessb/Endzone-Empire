# Refusal tests

A refusal test proves the caller was told no. On its own it does not
prove the forbidden work did not run. Those two facts come apart exactly
when a guard is misplaced, which is the case the test exists to catch.

## The rule

**A test for a refusal that protects a mutation must observe the absence
of the forbidden side effect at the closest seam that can see it.**
Asserting the status, the message and the error shape is necessary and
not sufficient. Add an assertion that the relevant write or outbound call
happened exactly zero times.

## Why the response carries no information here

Move a guard below the work it guards and the handler still refuses, with
the same status and the same body, because the transaction rolls back and
the rollback erases the evidence. Every externally observable signal is
byte for byte identical in the correct and the broken version. A test
that reads only those signals cannot fail on that defect. Not unlikely to
fail: cannot.

Two real cases produced this rule, both found on the same day:

- **#192.** A draft-reset guard moved below its `DELETE` statements still
  answered an identical `409` with an identical message.
- **#194.** Two of three mutations still answered `409` and were caught
  only by assertions named "no matchup was inserted" and "no scores were
  written".

The question to ask at each site is not *is there an assertion*. It is
**what would this test do if the guard moved below the work**. A test that
stays green while the row changes is the defect, and from the outside it
looks exactly like a good test.

## What to assert

`server/test/helpers/fakePool.js` is the shared pg seam. It records every
statement and exposes `matching(re)`, so the count is one expression:

```js
const { createFakePool, insert, update, remove } = require('./helpers/fakePool');

assert.equal(fake.matching(insert('matchups')).length, 0, 'no matchup was inserted');
assert.equal(fake.matching(update('leagues')).length, 0, 'current_week / season_status unchanged');
```

Name the assertion after the effect that must not have happened, not
after the mechanism. "no matchup was inserted" survives a refactor of the
query; "no INSERT on line 4" does not.

Where the protected work is not SQL (an avatar upload, an outbound
Tank01 call, a socket broadcast) the closest seam is the injected
collaborator's call count. The rule is the same; only the recorder
changes. `server/test/tank01Client.test.js` is the house exemplar for
that seam, the way `seasonPhaseGate.test.js` is for the SQL one.

Two seams deserve naming because they are easy to get wrong:

- **A side effect outside the transaction is the most important one to
  cover, not the least.** A Supabase Storage upload is not inside the
  request's transaction, so no ROLLBACK undoes it and no SQL count can
  see it. `avatar.service.js` throws the identical
  `AvatarError(403, 'team not found or not yours')` both before the
  upload and after the UPDATE finds no row: delete the first guard and
  the caller sees a byte-identical 403 with the image already in the
  bucket. Only the upload counter separates those two worlds.
- **A cookie is state.** `/api/auth/refresh` rotates its token before the
  guard runs by design, so a statement count asserts the wrong thing.
  What the refusal protects is `setRefreshCookie`, and the token never
  travels in the body, so a body assertion cannot see it either.

### Not every refusal wants a count of zero

Some refusals are produced **by** the mutation rather than by a guard
above it: one `UPDATE` whose `WHERE` clause is the authorization test,
refusing because it matched no row; an `INSERT ... ON CONFLICT DO
NOTHING` refusing on an empty `RETURNING`. There the statement is
supposed to run, and asserting zero would fail on a correct build.

Two things still apply. First, whatever the refusal protects *after* that
statement (the activity-log row, the notification, the `COMMIT`) does get
a count. Telling someone they were promoted when they were not is its own
defect. Second, and more important: assert the **predicate**. A fake that
answers `{ rows: [] }` regardless of its parameters manufactures the
refusal itself, so dropping a conjunct from the production `WHERE` (which
is exactly the change that would let an unauthorized write land) cannot
fail the test. Pin the clause, and pin the bind parameters with it.

### Prefer exact counts over booleans

Both of these are correct:

```js
assert.ok(!fake.calls.some((c) => /^DELETE/.test(c.text)));            // boolean
assert.equal(fake.matching(remove('draft_picks')).length, 0);          // count
```

The count fails with `2 !== 0`, which says how far past the guard
execution got. The boolean fails with `false !== true`, which says only
that it failed. Prefer the count. Reach for the boolean only when the
thing you are excluding is a class of statement rather than one table,
and even then a count of the filtered array reads better.

### Anchor the pattern

An unanchored pattern over generated SQL asserts a **lower bound, not an
equality**, so it is weakest in precisely the direction a scoping bug
travels: any more restrictive statement satisfies it too. The verb and
table matchers exported from `fakePool` are anchored to the leading verb
for this reason. When you need a raw regex, anchor it, and when you are
asserting that a predicate is present, assert the parameters as well.

## Accidental protection is worse than none

`fakePool` throws on a statement no handler matches. So a refusal test
whose fixture simply never registered the write appears to be protected:
move the guard below the work and the test does fail, on
`unexpected query: INSERT INTO ...`.

That is not an assertion, and the difference matters in a specific way:

- it **passes today**, so nothing looks wrong;
- it reports a **fixture-completeness error**, not the safety property, so
  the failure names the wrong problem and sends the reader to the wrong
  place;
- it **evaporates silently** the first time someone registers that handler
  for an unrelated convenience. No test turns red at the moment the
  protection disappears.

A guard whose disappearance is invisible is the same family of defect as
a guard whose misplacement is invisible, which is what this document is
about. So when you add the count, **register the write handler too**, and
let the fixture answer it successfully. The absence then means the guard
held, rather than meaning the fixture was short a line.

The same goes for a fixture that starves the path some other way: an
empty batch, an empty result set that trips an earlier refusal, a
collaborator that was never stubbed. If the work could not have happened
anyway, a count of zero proves nothing. Make the write reachable, then
prove it did not happen.

### Give the zero a baseline

A count of zero is only evidence if the same counter is known to be able
to count. Prefer a suite where the success path asserts the same matcher
returns 1, or 2, or whatever it should be. Without a baseline, a matcher
that never matches anything and a guard that works are the same green
tick.

### `COMMIT` is a complementary check, never a substitute

```js
assert.equal(fake.matching(insert('matchups')).length, 0);  // required
assert.equal(fake.matching(/^COMMIT$/).length, 0);          // complementary
assert.equal(fake.matching(/^ROLLBACK$/).length, 1);        // complementary
```

Work followed by a `ROLLBACK` also leaves no `COMMIT`. The absence of a
`COMMIT` proves the transaction did not land; it does not prove the work
never ran. That distinction is the whole of the #192 case, so a suite
whose only absence evidence is "no COMMIT" has not met the rule. Finish
with `fake.assertClean()`, which proves every client was released and no
transaction was left open.

## When the refusal has no mutable work behind it

Some guards protect nothing yet: the refusal is decided before any pool
is touched, or the handler's only writes are on a branch the refusal
cannot reach. Those tests do not need a write count, but they do need a
sentence saying so, at the test, naming the reason. Write the reason from
the production path, not from the test:

```js
// No write assertion: authorization runs in the router before the
// service is required, so the request never reaches a statement.
```

A silent absence and a justified absence look the same in a diff six
months later. Only one of them is a decision.

## When the test cannot see the work

A test at a boundary that cannot observe the mutation (a client-side
test, a contract test over a payload shape) is not excused, it is
**paired**: add a lower-level test that can see the seam, and reference it
from the boundary test. The boundary keeps the response contract; the
lower-level test keeps the guard honest.

## Demonstrate, do not assert, that the assertion has power

A convention claimed without a demonstration is the same category of
claim this document exists to distrust. When you add a no-write assertion
to a guard that matters, mutation-test it once: move the guard below the
work, watch the assertion fail, revert. Report both results. Print the
unmutated baseline alongside the mutant, because without a baseline a
surviving mutant and an output you could not parse are the same string.

Run all four cells, not two. The cell that carries the argument is the
one people skip, because it feels like testing something you already
believe: **the mutant against the OLD assertions**. Without it you have a
new test that passes and no evidence the old one was insufficient.

This is the demonstration from #274, on
`PUT /api/draft/league/:id/keepers`. Saving keepers is a replace-all: the
handler `DELETE`s the league's whole slate, then re-`INSERT`s. The test
asserted the 400, the message, and one boolean, `no INSERT INTO
"keepers"`, labelled `nothing was written`. The label overclaimed; the
`DELETE` was not observed. Moving the validation guard down by a single
statement, below the `DELETE` and above the `INSERT` loop:

|                | pre-#274 assertions | with the write counts   |
| -------------- | ------------------- | ----------------------- |
| guard correct  | 3/3 pass            | 3/3 pass                |
| guard **moved**| **3/3 PASS**        | 1 fail, `1 !== 0`       |

The 400 body was byte-identical in both guard positions. Anyone reasoning
from the response alone, which is precisely what the old test did, cannot
tell a league whose keeper slate survived from one whose slate was wiped.

## Scope

This applies to refusals that protect a state change. It does not apply
to pure validation functions with no I/O behind them, or to read-only
refusals, which have nothing to leave behind.
