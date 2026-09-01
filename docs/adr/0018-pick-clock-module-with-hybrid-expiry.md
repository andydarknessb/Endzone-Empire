# Give the Pick clock one owner, a stored deadline, and in-process firing

Status: accepted (2026-09-01)

The Pick clock (see CONTEXT.md) currently has five independent writers of
`leagues.pick_deadline_at` (draft start, `draftPlayer`, pause/resume, the
autodraft toggle, commissioner undo) and one reader: a 10-second poll in the
worker, the only code path that can conclude a clock expired. Two of the five
writers re-arm the clock with their own inline rules rather than
`nextPickClockSeconds`; the pause/resume rule can leave an Autodraft turn with
no armed clock at all. We introduce a single Pick clock module
(`server/services/pickClock.service.js`) as the only writer and the only
expirer of the deadline, with a named-event interface (draft started, pick
landed, paused, resumed, autodraft toggled, pick undone, sweep due). Expiry
fires from an in-process timer armed in the worker beside the stored deadline;
the polling sweep remains, demoted to a restart and lost-timer backstop.

## Why

- Five writers drifted because the deadline was a public column, not an
  interface. Resuming an untimed league whose on-clock team is autodrafting
  left the deadline NULL forever, and resuming a timed one granted the full
  pick clock instead of the short Autodraft delay: the stall class observed
  in the MinneApple draft. A module boundary makes a sixth ad-hoc writer
  structurally impossible rather than merely discouraged.
- Poll-only detection costs up to 10 seconds per expiry while the room stares
  at zero, and a full Autodraft run pays the poll interval on every pick
  (a 13-team, 15-round finish is ~30 minutes of dead beats). Timer-only
  detection loses the deadline on a worker restart. Storing the instant and
  firing from a timer keeps both properties; the backstop sweep covers a lost
  or double-fired timer, and the module dedupes the two paths.
- Turn advance and clock arming are atomic single statements today; keeping
  them behind one interface preserves that atomicity instead of splitting it
  across modules and reopening a race.
- Expiry consequences belong to the same owner: the Autopick act, the
  consecutive-timeout streak that places a team into Autodraft, and the
  nothing-draftable case, which today spins silently forever on an expired
  deadline.

## Consequences

- Routes, `draftStart`, and `draftPlayer` call named events on the module;
  a direct UPDATE of `pick_deadline_at` or `current_pick` outside it is a
  defect. The clock policy has exactly one spelling.
- Resume arms the policy clock (Autodraft delay, full pick time, or none),
  never the time remaining at pause. Pausing forgives elapsed time.
- An expiry with nothing draftable pauses the draft and appends a Draft
  activity entry naming the stuck team, reusing the paused-then-resumed
  repair flow commissioner correction already established, instead of
  retrying silently or inventing a skipped turn.
- How the room hears about an expiry is an injected dependency; the
  never-silent broadcast adapter is separate follow-on work filling that
  seam.
- The draft tick gets its own catch (an unhandled rejection no longer kills
  the worker) and the advisory-lock release leak is fixed with it. A
  stale-deadline liveness alarm and a separate pool budget for the draft
  loop are deliberately out of scope here.
- The interface is the test surface: the pure policy functions become
  internal seams keeping their focused tests, the test-only
  `compareAutopickCandidates` export is removed, and selection-order and
  expiry contracts are re-expressed through the module. No schema change:
  `leagues` is small enough that the backstop query needs no new index.

## Amendment (2026-09-01): two sanctioned clears sit outside the module

The opening paragraph calls the module "the only writer and the only
expirer of the deadline". As merged, that overclaims by two sites, both
verified during review of PR #604: the commissioner correction path
(`server/services/draft.service.js`) and season rollover
(`server/services/commissioner.service.js`) still write
`pick_deadline_at` directly, each setting it to NULL while tearing down
draft state. Both are sanctioned rather than drift: #599's spec text keeps
the correction unchanged, and a season rollover is not an arming event, so
neither site carries clock policy. Nothing in the #600 to #602 chain
closes the gap.

The boundary this ADR draws is therefore stated precisely: the module is
the only writer that arms a deadline and the only code path that may
conclude one expired. A clear of the column performed while tearing down
draft state is permitted outside it, and the "direct UPDATE is a defect"
consequence above applies to arming and expiry, not to those two teardown
clears. A later change may route the correction's clear through the
module's existing clear operation with no behaviour change, which would
make the original claim literally true; until then this amendment is the
accurate wording.
