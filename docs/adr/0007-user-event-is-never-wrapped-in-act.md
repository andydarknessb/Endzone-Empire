# user-event is never wrapped in act()

Status: accepted (2026-08-25)

A client test never wraps a `@testing-library/user-event` call in `act()`.
user-event already runs each interaction inside `act()` and drains the act
queue before its promise resolves, so an outer `act()` adds nothing. Work that
outlives the interaction (a save request, the un-awaited `refresh()` behind it,
a toast) is settled by awaiting its observable result at the call site, not by
holding an `act()` open across the interaction. Spec: #263.

## Why

The outer wrapper does not merely fail to help; it manufactures a warning.
React only reports "The current testing environment is not configured to
support act(...)" when an update lands while an act queue is open **and**
`IS_REACT_ACT_ENVIRONMENT` is false (`isConcurrentActEnvironment`,
`react-dom.development.js`). Testing Library's `asyncWrapper` clears that flag
for the duration of every async user-event call, on purpose, so a caller can
wrap in-flight promises itself
(`@testing-library/react/dist/pure.js`). Wrapping the call in `act()` holds the
queue open across exactly that window, so every state update the interaction
causes asynchronously - a Snackbar `notify`, a `setLoading` behind a save -
prints the warning.

That is not the same defect as "An update to X inside a test was not wrapped in
act(...)", which fires with the flag *true* and is fixed per call site (#218).
Conflating the two is the trap: with #218 at zero, a grep for `act` in the suite
output still returned 179 hits from this family alone.

The wrapper was added in good faith, with a comment reasoning that user-event
"does not wrap its own waiting in act()". It does. Recording the ruling here is
what keeps the same reasoning from re-deriving the same wrapper.

## Consequences

- `userEvent.click(...)` and friends are awaited directly. No `act()` around
  them, and no `eslint-disable testing-library/no-unnecessary-act` to permit
  one.
- A test whose interaction starts work that outlives it awaits that work's
  observable result: the request assertion, the toast text, a helper such as
  `settleRefresh` in `LeagueDashboard.test.jsx`. A test that ends without
  awaiting the consequence is the defect; the wrapper only hid it behind a
  different message.
- `act()` stays correct for what it is for: driving a non-user-event trigger
  (a socket callback, `clearLeagueCache`), including a deterministic pump over
  fake timers where each call site's hop count is a documented, understood
  quantity (`NavigationGuard.test.jsx`'s `pump`, one jsdom history-traversal
  hop per call). What #305 closed is the other shape: a real-timer loop
  guessing *how many* `act()` + zero-timeout turns an unspecified settle
  needs, with no per-call-site justification for the number chosen and
  nothing awaited that the test can point to.
- The full client suite reports zero warnings of either family, so a new one is
  legible the day it appears.

## Amendment (2026-09-02): the settleRefresh example is retired

The Consequences section above points to "a helper such as `settleRefresh` in
`LeagueDashboard.test.jsx`" as the worked example of awaiting a test's
outliving work. PR #683 (#645) deleted that file with the legacy dashboard,
and `settleRefresh` is defined nowhere else. No named settle helper of that
shape survives anywhere in the client suite.

The rule this ADR records has not changed: a test whose interaction starts
work that outlives it awaits that work's observable result. Only the worked
example is gone. Its surviving form is inline, with no named helper: await
the observable result of the work the interaction started directly at the
call site, such as the request assertion via `waitFor` or the toast text via
`findBy`. `CommissionerTools.test.jsx` does this, and its header comment
cites this ADR back, so the link between rule and example is visible from
both ends.

A future named helper of the `settleRefresh` shape is fine but not required.
The rule is "await the consequence," not "use a helper."
