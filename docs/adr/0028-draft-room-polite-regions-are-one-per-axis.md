# Draft room polite regions are one per axis, gated per announcer

Status: accepted (2026-09-03)

The Draft room speaks to assistive technology through five visually hidden
polite live regions: the room-level Pick announcer, the room-level stall
announcer, the League chat membership announcer, the Readiness announcer, and
the Chat-scoped combined-feed announcer. All five render the same markup and
three of them share one repeat-safe update. The 2026-09-03 architecture review
proposed collapsing them into one announcements module with one gating policy.
We decline that collapse and record why, so the next review reads this before
it reads the code.

The decision: each polite region answers one axis (a committed Pick, a stall
entering or leaving, a membership loss, the Readiness count, a human message
arriving) and owns its own gating, its own mount scope and its own clear path.
What they share is the rendering leaf and the repeat-safe update, nothing
more.

## Why

- **Mount scope is a product rule, not an accident.** A human message a
  manager cannot see must not be announced from another tab, so the feed
  announcer is mounted only with the Chat panel (#513). A Pick, a stall and a
  membership loss must be heard on every tab, so those announcers live in the
  room chrome (#513, #648, #534). Readiness belongs to the pending phase only
  (#164). One component cannot be mounted in two scopes at once.
- **Clear paths differ, and folding them is the hazard.** The stall announcer
  clears on the exit edge so stale "stuck" text does not linger (#653). The
  feed announcer must never clear on Draft activity, or it blanks a still
  unread message announcement on every Pick (#513). A shared gating hook
  would have to carry a reset path that only some announcers own; #513 named
  that the reset-semantics hazard and #636's state-model fix diverged the two
  effects on purpose.
- **The replay guard is in the seams, not in prose.** The Pick and stall
  announcers are fed from live-only socket seams that a `draft:state`
  snapshot never reaches; the feed announcer gates on the shared per-league
  seq. A single module would have to re-derive "live, not backlog" for three
  different sources, and would be one place to get it wrong for all three.
- **One region per axis is what a screen reader needs.** Two announcements
  on one region supersede each other; a stall and an unread message on one
  node would lose one of them (#636, #664).

## Consequences

- The five announcers stay as five components with their own effects, mount
  points and tests. A sixth axis gets a sixth region, not a branch in an
  existing one.
- The shared parts are exactly two: a rendering leaf for the `role="status"`
  span, and a hook that owns the repeat-safe update (the zero-width-space
  idiom). Builders with a single caller inline into their announcer; string
  assertions move to the rendered region.
- A future review that finds five identical spans should reach for this ADR,
  not for a collapse. Reopening it needs a product ruling that changes a
  mount scope, not a line count.
