# Abandon home/away activation

Status: accepted (2026-08-14)

The weekly projection engine carries a fully built home/away factor that has
never scored: `MODEL_CONSTANTS.homeAway.enabled` ships false as a safety catch
on a coefficient that was never measured, and the comment that introduced the
gate named `free_baseline_v3.2` as the activation bump once an honest backtest
justified it. We are closing that question without an answer: the activation is
abandoned, the gate stays off permanently, and the factor's code stays in
place.

## Why

The one study positioned to measure the factor produced zero evidence about
it. The pit-sweep-2024-2025 backtest (revision 38, result `no-proposal`) ran
four `homeAway=on` cells, and every one reported `eligible=0, activated=0`.
The study's own ledger traced the cause
(`backtest-artifacts/pit-sweep-2024-2025/APPROVAL_LEDGER.md:5304-5312`): the
activation accounting reads a `knownOrientation` field
(`scripts/backtest/lib/arms.js:633-637`) that no non-test code ever populates,
so the counters were structurally zero regardless of what the factor did.
Harness code at the study's frozen commit did wire real 2024/2025 orientation
into those arms (the snapshot's orientation overlay, with fail-loud
construction guards), though the review records even that as unchecked from
the published packet. The independent results reviewer filed one residual the
record leaves open, UNCHECKED-3, which the ledger carries as a limitation of
the run rather than a finding: every `on` cell differs numerically from its
`off` twin in all seven absolute metrics, both seasons and all seventeen
weekly values, and the packet cannot distinguish the factor genuinely acting
from a pipeline defect. Either way the study's governing ruling stands: the
four fail verdicts carry zero evidence about homeAway.

Getting real evidence now would cost a full new study. The sealed successor
preregistration (`backtest-artifacts/holdout-confirm-2026`) already excludes
a homeAway claim from its own non-goals: "The factor remains untestable
pending orientation data and the `knownOrientation` producer gap." Its rules
make a rerun on the next season's ledger a new study id, and its stated
proportionality rationale (one approval suffices there because its inputs are
append-only rows behind a database CHECK; the pit-sweep carried a
four-approval chain because its inputs could be silently reconstructed)
implies that a fresh 2024/2025 homeAway backtest, whose inputs are likewise
reconstructed, would carry pit-sweep-class machinery again. That weight is an
inference from the stated rationale, not a sealed rule. Even the input data
is code-blocked for past seasons: no 2024/2025 schedule manifests exist, and
`repair-schedule-orientation.js` refuses any season whose first capture
window has opened, with deliberately no override flag.

Against that cost, the expected value is too small. The revision-38 study's
best evidence-bearing candidate (`usage-60-off`; 2025 half-PPR figures, with
the evidence-free `-on` cells excluded) moved paired-delta regret by about
-0.37 points against a control absolute regret of about 27.2. We assume,
without study evidence since none exists either way, that an adjustment
capped at plus or minus 5% has a smaller reachable effect than those usage
changes; on that assumption, a study stage of this weight cannot pay for
itself.

## What this decision is, precisely

Closed with no further work; NOT rejected on evidence. The factor was never
evaluated, and this record must not be read as "tested and failed". Reopening
requires a proposer to bring a new preregistered study through the evaluation
apparatus; nothing short of that may flip `homeAway.enabled`, and whatever
change such a study ever selects carries its own MODEL_VERSION bump.

## Consequences

- `homeAway.enabled: false` is permanent. The gate comment in
  `server/services/projectionModel.js` points here instead of promising v3.2,
  as do the legacy sweep-arm comments in
  `scripts/backtest-weekly-projections.js`.
- The `knownOrientation` producer gap in the backtest harness stays unfixed by
  design: it only matters to a homeAway study that will now never run.
- The home/away chip in `src/components/LineupScreen/LineupScreen.jsx` stays
  dead by design (it renders only when `homeAway.available` is true, which
  requires the gate on); no manager has ever seen it, and no surface changes.
- `CONTEXT.md`'s Factor entry names home/away as permanently gated off.
- The sealed holdout-confirm-2026 study is untouched by this closure. Its
  MODEL_VERSION-bump tripwire (`scripts/holdout/lib/report.js`) keeps naming
  v3.2, correctly, as the thing that must not happen mid-study.
