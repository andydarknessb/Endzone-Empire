# v3.2 ranks on the mean, truncates the Floor at the observed minimum, and seeds the opponent factor from the prior season

Status: accepted (2026-09-16)

Week 2 2026 exposed three defects in the same Start/sit advice card. Terry
McLaurin projected mean 7.37 / median 10.06 / Floor -7.34 and DK Metcalf
mean 9.03 / median 8.21 / Floor 0.24; every computed input (baseline,
expected opportunities, week 1 targets) favoured Metcalf, yet the advice
ranked on the median and recommended McLaurin as "too close to call". The
median sat above the mean because the residual bootstrap resamples a
player's own residuals, stretched 1.45x about their median, and McLaurin's
pool was dominated by 2025 games above a week-1-deflated baseline; the same
mechanism printed a Floor no wide receiver has ever scored. On the same
card the matchup line read "vs DAL (allows 17.1 to WR)" while the opponent
Factor reported "insufficient opponent sample" and contributed nothing,
because it counts only the current season's games and so sleeps through
weeks 1 to 4 of every season.

We decide that the successor version free_baseline_v3.2 (ADR 0044, spec
#1438) carries three constants changes, each judged on the 2026 holdout
ledger with the rest of v3.2 and none deployed before the week 18 capture
closes:

1. The lineup decision rule ranks on the distribution mean, and the point
   estimate the advice surfaces print is the same statistic, so the number on
   a row is the number the rule ranked on. The mean was measured better on
   the frozen pit-sweep artifacts and again on the week 1 2026 holdout audit
   (Spearman .589 / pairwise .712 against the median's .577 / .707).
2. Each position group's simulated draws are truncated at the lowest score
   any player of that group has recorded over the stored seasons under the
   league's own rules before the Floor and Ceiling are read. The floor is
   data computed per run, not a constant; the constant only says whether it
   applies. Truncation cannot move the median and never touches the mean, so
   the point estimate is untouched; only the impossible tail goes, which is
   also what stops the start/sit probability being fed a fictional outcome.
3. Each defense's points allowed per position is seeded with the prior
   season's value as a shrunk prior worth four pseudo-games, blended toward
   the current season as real games accrue, the same estimator shape the
   recency mean uses. The cap and the shrinkage toward neutral are unchanged;
   only the sample rule moves, so the Factor is live from week 1 and
   converges to the current-season figure. The card labels the matchup line
   "context only" whenever the Factor did not apply.

v3.1's constants are preserved verbatim beside v3.2's, pinned by hash to
the constants the sealed study captured under, so the successor evaluator
(#1439) keeps a genuine v3.1 column as its error bar after the bump.

## Considered options

- **Keep the median as the ranking statistic and fix only the display
  (#1482).** Removes the contradiction on the row but keeps the ranking the
  evidence says is worse, and keeps the skewed-median artifact that produced
  it. #1482 remains the mid-season presentation fix; this ADR is the
  successor's answer.
- **Clamp the Floor at zero.** Simple, but wrong for a position that can
  genuinely score below zero (a quarterback with four interceptions, a
  defense in a blowout, an individual defender). The observed minimum is
  what "no real game has scored this" actually means.
- **Fix the bootstrap itself (a different centring or residual pool).** A
  larger change to the interval machinery whose calibration was measured on
  two seasons; out of scope for a version judged on one ledger, and the
  truncation removes the visible defect without re-tuning the band.
- **Impute the opponent factor's missing sample with the league average.**
  Equivalent to leaving it neutral, which is the defect. A prior season is
  evidence about the same defense; the league average is evidence about
  nothing in particular.
- **Show no matchup line until the Factor applies.** Rejected in favour of
  labelling: the allowance figure is still true, and a manager reads it as
  context. What must not happen is the line implying it moved the number.

## Consequences

- One Model version bump, one DEVIATIONS.md entry, one constants pin
  update; the branch that carries them is held open until the 2026 week 18
  capture closes (2027-01-09T18:00Z), like every other v3.2 child.
- The preregistered Candidate A test on the v3.1 ledger (flip the ranking to
  the mean) still runs and its verdict is recorded; v3.2 adopts the flip on
  the evidence above whichever way that test lands, and the DEVIATIONS entry
  says so.
- The feature loader now scans the prior season once per run, from the
  stored per-week `gameOpponent` key rather than the schedule joined through
  the player's current team, because a traded player's prior-season games
  were earned against someone else's opponents. Rows without the key
  contribute no allowance.
- The market factor (#1484) is not activated by this ADR. Its retrospective
  replay over the ledger's stored `rawEffect` is the evidence that would
  activate it, and the ledger holds no week with a market quote at capture
  yet; the replay script exists so the comparison can run the day one does.
