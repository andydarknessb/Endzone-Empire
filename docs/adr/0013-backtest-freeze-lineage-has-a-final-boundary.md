# The backtest freeze lineage has an explicit, immutable final boundary

Status: accepted (2026-08-26)

The `Backtest reproduction (accuracy-roadmap freeze)` workflow proves that
Commit M regenerates byte-identically from Commit A, and that Commit B's
`FREEZE_MANIFEST.json` pins that same A/M. `scripts/ci/discover-freeze-commits.js`
discovers A/M/B structurally on the triggering ref, and it also enforces a
quiet-window rule: after Commit B, only the two published output files
(`backtest-artifacts/pit-sweep-2024-2025/REPORT.md` and `report.json`) may
change. That rule had no end. It scanned every commit from B to HEAD, so once
the sealed revision-38 study was published and ordinary development resumed on
`integration`, every later unrelated commit was judged against the window and
rejected. The workflow went permanently red on integration, main, and every
pull request (issue #468).

The decision: the freeze lineage is a finite, completed sequence with an
explicit final commit, Commit F. The quiet window is exactly `B..F`. Commits
after F are ordinary development and are never judged against the window. F is
a fixed SHA, so `B..F` evaluates identically on every ref (pull request,
integration, main); the check no longer depends on where HEAD happens to be.

For the revision-38 lineage, F is `48c2512137eb3dcc0478474021fe152468c1e470`
("publish revision 38 candidate results"), which touched only `REPORT.md` and
`report.json` and is the sole, final output commit of the lineage. It is
recorded as `DEFAULT_FREEZE_LINEAGE_FINAL_COMMIT` in
`scripts/ci/discover-freeze-commits.js`.

## The lineage, as evidence

- A = `28cf65e2096c444da5accf896bce9f7b1990ee06` (everything non-output).
- M = `26741905b8ad5d2e6ed20230c24f49d3e89cd4b1` (empty-tree byte-identical MDE
  witness).
- B = `9eeccf75b1ef4ff9d5bf40fa39dd7d3bd0b0270e` (`FREEZE_MANIFEST.json`,
  parent M).
- F = `48c2512137eb3dcc0478474021fe152468c1e470` (`REPORT.md` + `report.json`;
  the immutable final boundary).

The last green run was
[run 83](https://github.com/andydarknessb/Endzone-Empire/actions/runs/31593290801)
on `integration` at `48c2512` on 2026-08-12, where both `discover` and
`reproduce` completed. The next run,
[run 84](https://github.com/andydarknessb/Endzone-Empire/actions/runs/31666578060),
was the first red: discovery rejected ordinary non-output commits landing
after F, beginning with the synthetic merge commit
`0d1e9f52baba06952955ed48e31f79f1bb8f4efe`, and stayed red for the same reason
on every completed run afterwards (integration, main, and PR alike), with
`reproduce` skipped as a consequence.

## What a red result means

- `discover` red: the freeze lineage itself is malformed on this ref. A/M is
  missing or malformed, A touches a forbidden path, B does not parent M, B's
  manifest pins the wrong A/M, or a non-output commit landed **inside** the
  window `B..F`. It is never "unrelated development after F"; that is exactly
  the failure mode this ADR removes.
- `discover` red with "not a descendant of discovered Commit B": the recorded
  boundary is stale or a newer freeze superseded this lineage. Update
  `DEFAULT_FREEZE_LINEAGE_FINAL_COMMIT` to the new lineage's final commit, or
  retire the workflow. This is the deliberate fail-loud signal; the check
  never silently falls back to an unbounded or empty window.
- `reproduce` red: the pinned artifacts no longer regenerate byte-identically
  from Commit A. This is a genuine reproducibility regression in the freeze
  pipeline's inputs (image, lockfile, or the offline pipeline code), not a
  history-shape problem.

The sealed study artifacts are never rewritten, regenerated, or reinterpreted
to make CI green; the A/M/B structural checks and the byte-comparison job are
unchanged by this decision. A new freeze lineage, if one is ever cut, gets its
own Commit F and its own entry here.

## Fleet classification

This workflow is **watched, not gating**. Its checks (`discover`, `reproduce`)
are not in the endzone tenant's `ciGates`
(`C:\Users\Cory\fleet\tenants\endzone.json`), so under the fleet merge policy a
red result on them never blocks a merge; it is a finding to read, the same
class as `scan`. The tenant file expresses this class today only implicitly
(absence from `ciGates`), the same way `scan` is expressed. If an explicit
"watched, not gating" field is wanted, that is a fleet-repo change owned by
Cory, tracked as fleet follow-up rather than made here; this ADR is the
repository-owned record of the classification in the meantime.

## Consequences

- Ordinary development on `integration` and `main` no longer turns this
  workflow red. The path filter still scopes it to the backtest/freeze trees
  and this script, so unrelated app commits do not trigger it at all.
- A representative pull-request run (this change edits
  `scripts/ci/discover-freeze-commits.js`, which is in the path filter) and the
  post-merge `integration` push run both exercise the healthy path and are
  expected green, demonstrating the workflow is no longer chronically red or
  spuriously skipped.
- The boundary is enforced in code and reviewed like any other constant; the
  `merged-ADR` uniqueness guard and code review are the controls that keep it
  from being silently moved.
- Tests in `server/test/backtestFreezeDiscovery.test.js` cover: missing or
  malformed A/M/B fail; a non-output change inside `B..F` fails; report-only
  changes inside the window pass; an unrelated change after F does not create a
  chronic red; the lineage stays discoverable from a much later ref; and a
  stale or unresolvable boundary fails loud.
