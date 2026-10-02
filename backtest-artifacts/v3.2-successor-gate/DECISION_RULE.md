# Decision rule for the v3.2 gate

Registered 2026-10-02, before any v3.2 column has been read. It governs spec
#1438 under ADR 0044. It was ruled in the owner's session at his instruction,
and it supersedes the proposal of 2026-09-27 on #1438 and the first ruling
comment of 2026-10-02 there.

## What this rule decides

Whether the engine changes under spec #1438 ship as `free_baseline_v3.2`.

It does not decide:

- `simulation.smoothingBandwidth` and `simulation.intervalScale`. They follow
  holdout-confirm-2026 Candidate B (PREREGISTRATION section 8.3).
- `decision.lineupRanking`. ADR 0047 has v3.2 rank on the mean whichever way
  Candidate A lands, and Candidate A's verdict is recorded. This gate scores
  every column on its mean, so it cannot measure that choice.

## 1. The bundle

Fixed today: #1440, #1441, #1442, #1443, #1483, #1485, #1769 and, if its
screen passes, #1484. A new engine change goes to the next successor spec.

Each remaining child is built to its ticket as it reads today and merges
inert behind a `MODEL_CONSTANTS_V3_2` key (the #1442 ruling, point 4). A
tunable its ticket does not fix is named on the ticket before it is built
and is fitted on 2024 and 2025 only. A child not merged by the freeze is
left out, never for a reason read from a 2026 outcome.

The evaluator that applies this rule (#1938) merges before any of #1440 to
#1443.

## 2. One deciding read

After the 2026 week 18 capture closes (2027-01-09T18:00Z), in this order:

1. holdout-confirm-2026 is evaluated and its report recorded.
2. The market screen runs once (#1484). It reads only the weeks of section 3
   that carry a market quote at capture; its pass rule is the addendum of
   2026-10-02 on #1438.
3. `MODEL_CONSTANTS_V3_2` takes Candidate B's verdict and the screen's.
4. The freeze commit is recorded on #1438.
5. The successor evaluation runs once from a clean checkout of that commit,
   by the owner or the project lead, and its report is attached to #1438.

No v3.2 column is read before step 5. If one is, it is recorded on #1438 and
the bundle and this rule are fixed as they then stand. A v3.1 calibration
run may happen at any time and evaluates no check.

A run that throws before it writes its report repeats from the same commit.
The first report written from the freeze commit is the deciding read. A v3.2
defect found before that read is fixed only by a new freeze commit recorded
on #1438. An evaluator defect found after it makes the gate unevaluable; the
read is not repeated.

The same session also rebuilds v3.1 at the last commit before any of #1440
to #1443 merged and compares a digest of the rebuilt v3.1 rows with the
freeze commit's. A difference makes the gate unevaluable: the children must
leave v3.1 untouched. If none of them merged, the comparison is skipped.

The deciding run reads `player_stats` as it stands at that run and records
each profile's actuals SHA-256.

## 3. Weeks

The weeks holdout-confirm-2026's `survivingWeeks` keeps for `half_ppr`
(PREREGISTRATION sections 4 and 9.4), used for every profile and recorded on
#1438 before the freeze. Fewer than 14 is unevaluable.

A surviving week whose value for a metric is null in any column drops from
that metric in every column. Fewer than 14 weeks left for pairwise accuracy
is unevaluable.

## 4. Rows and projections

Every column is scored on its mean, not on the statistic it displayed.

- **Projection.** A column's projection for a row is its mean times its
  active probability where that is a number, its mean where the probability
  is null, and 0 where it has no mean. #1441 stores the mean conditional on
  an Appearance, as v3.1 does.
- **Served.** A column serves a row when it has a mean for it and its active
  probability is not 0.
- **Rows scored in no column**, each counted by week and reason:
  - a row the capture recorded as Unavailable (active probability 0).
    Availability at capture is an input, and the rebuild does not replay all
    of it (Practice squad, DEVIATIONS entry 4);
  - a row whose served state differs between captured v3.1 and rebuilt v3.1;
  - a row no column serves.
- Every other cohort row is scored in every column, at 0 where a column does
  not serve it. An absent actual is 0.

## 5. Metrics

Profile `half_ppr`. Pairwise accuracy is the primary metric and MAE the
second, each computed per week on the rows of section 4. A season value is
the mean over the weeks of section 3. Comparisons use the full precision in
`report.json`, and equality fails a strict comparison.

The rebuild error bar for a metric is the mean over surviving weeks of the
absolute weekly difference between rebuilt v3.1 and captured v3.1.

## 6. Pass

All four:

1. **Pairwise, size.** Rebuilt v3.2 minus rebuilt v3.1, season value,
   exceeds the pairwise error bar.
2. **Pairwise, noise.** The lower one-sided bound on the weekly mean of
   rebuilt v3.2 minus rebuilt v3.1 is strictly above 0, over the weeks
   section 3 leaves for pairwise accuracy. The bound is the sealed study's
   cluster bootstrap over those weeks (PREREGISTRATION section 10: 100,000
   draws, seed 2579717975, the exact sign test under 12 clusters or on a
   degenerate bootstrap) at test alpha 0.0125, for a family level of 0.05.
   Simulated at 14 and 18 weeks on symmetric and on moderately left-skewed
   weekly differences, that bootstrap rejects a true null 1.5 to 3 times as
   often as its nominal level.
3. **MAE, size.** Rebuilt v3.1's MAE minus rebuilt v3.2's, season value,
   exceeds the MAE error bar.
4. **Coverage does no harm.** On the rows scored under section 4 that are
   eligible in every column (active probability not 0, complete interval),
   season coverage is the mean of weekly coverage, and its distance from
   nominal is its absolute difference from 0.80 or 0.50. For 80% and for
   50%, rebuilt v3.2 passes if its season coverage is inside the sealed band
   ([0.75, 0.85] and [0.45, 0.55]) or its distance exceeds rebuilt v3.1's by
   no more than the larger of 0.02 and the absolute difference between
   rebuilt and captured v3.1's distances.

Checks 1 and 3 each imply that rebuilt v3.2 beats captured v3.1 on that
metric, the comparison the #1439 ruling set (point 4). Rebuilt v3.1 is the
comparator because it shares every input with rebuilt v3.2, so rebuild drift
cancels. The #1439 calibration share (point 3) stays reported and selects
nothing.

## 7. Reported, selecting nothing

Spearman rho; `standard` and `ppr`; the per-position pairwise cells; the
four checks on the rows every column serves; the four checks without week
18; coverage on the rows only v3.2 serves; the #1439 calibration share; the
row counts of section 4 by week and reason.

## 8. Outcomes

- **Pass.** The freeze commit's `MODEL_CONSTANTS_V3_2` and engine code ship
  unchanged as `free_baseline_v3.2` in the one bump, and the constants hash
  is recorded beside the verdict.
- **Fail or unevaluable.** None of the bundle ships and the findings go to
  the next successor spec. MODEL_VERSION then moves only if
  holdout-confirm-2026 flips a constant under its section 8.3, and what
  ships as `free_baseline_v3.2` in that case is v3.1's constants plus only
  those flips.
- **Mid-season ship** of any part of the bundle is a deviation touching this
  gate and the sealed study (ADR 0044, amendment of 2026-09-28). It is not
  on the table without re-ruling #1439 and this rule.

## 9. Changes to this rule

This rule changes only by a dated amendment to this file that states its
reason. Until 2026-10-16 the owner may amend any part. After that an
amendment may only repair something that stops the rule being computed.
Nothing changes after a v3.2 column has been read.
