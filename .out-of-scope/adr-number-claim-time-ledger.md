# ADR number claim-time ledger

This repo does not keep a ledger or registry for allocating ADR numbers at
the moment a spec claims one. Numbers are taken by reading the highest
prefix in `docs/adr/` and adding one, and the protection against collisions
is detection, not synchronised allocation.

## Why this is out of scope

The merge-time and post-merge halves of the problem are already built, not
rejected: `scripts/ci/check-adr-uniqueness.js` (from #307) asserts the
numeric prefixes in `docs/adr/` are unique and gapless, and CI's test-build
job runs it on every push and pull request via `npm run
check:adr-uniqueness`. Its own header documents the honest coverage: it
cannot fire while two colliding PRs are both still open, it fails the
second PR whenever its checks re-run after the first merges, and in the
worst case the collision goes red on the next push build against
`integration`. A companion guard, `check-adr-immutability`, keeps merged
ADRs append-only.

What a ledger would add on top is coverage for the claim-time window: two
specs allocating the same number in issue bodies, days before either file
exists, which is exactly how #575 and #598 both claimed 0018 (#603). The
maintainer ruled that window not worth a ledger (2026-09-01):

- The failure needs two concurrent specs cutting ADRs off the same base,
  which has happened, but rarely, and never silently to completion.
- The damage is bounded by the existing guard: even if both colliding files
  had been written and merged, `integration`'s next build goes red. The
  defect cannot persist quietly the way it could before #307's guard.
- A ledger taxes every spec that allocates an ADR number with an extra
  synchronisation step, to shorten a window that already ends loudly.

The cure for the claim-time case is procedural, and cheap: when a
collision is found in issue bodies, the in-flight claim keeps the number
and the other party is told its number explicitly rather than deriving it.
That is how #603 was resolved (0018 to the Pick clock, 0019 assigned
explicitly to the Lineup-surface ADR).

## Prior requests

- #608, "ADR numbers are allocated by unsynchronised read-then-write; add a ledger or guard" (the guard half already existed as #307's `check-adr-uniqueness`; the ledger half is what this file rejects)
