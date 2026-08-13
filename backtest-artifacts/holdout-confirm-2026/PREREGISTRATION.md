# PREREGISTRATION - Prospective Holdout Confirmation, 2026 (free_baseline_v3.2 candidates)

Study id: `holdout-confirm-2026`
Status: **DRAFT - NOT SEALED.** This document seals when its final bytes are
committed and their SHA-256 is recorded in `APPROVAL.md` beside the approver's
attestation, and it must seal **before the first 2026 REG kickoff**. A
preregistration sealed after any evaluated outcome exists is not a
preregistration. After sealing, any edit voids the study id; a successor runs
as `holdout-confirm-2026-r2` with its own document.

Written BEFORE any 2026 outcome exists. The only empirical inputs are the
2024/2025 exploratory measurements cited inline, which are what the margins
are scaled by - the pit-sweep's central process lesson applied: margins set
AFTER effect sizes are known, never before.

Purpose is MEASUREMENT WITH A SHIP DECISION ATTACHED. A passing claim flips
the named constant and ships as `free_baseline_v3.2` with the MODEL_VERSION
bump the inert merges deferred. A failing or inconclusive claim flips nothing.

---

## 0. Contents

1. Candidates and claims
2. Why the holdout ledger, and what an arm is
3. Prerequisites (code that must exist before Week 1)
4. Evaluation window and the missing-week budget
5. Outcome truth
6. Rosters and the regret estimand
7. Metric definitions
8. Inference: claims, components, alphas, margins
9. Integrity assertions and void conditions
10. CI contract
11. Interpretation rules
12. Sealing, approval, deviations
13. Non-goals

---

## 1. Candidates and claims

Two candidates, two independent claims, each flipping independently on its own
verdict. Both were merged INERT on `claude/accuracy-roadmap-status-5r5gzb`
(commits `6fa72de`, `ac4c1b6`); nothing in production behavior changes until a
claim here passes.

### Candidate A - lineup decision rule

Flip `MODEL_CONSTANTS.decision.lineupRanking` from `'median'` to `'mean'`:
the lineup optimizer ranks players by the distribution mean; every displayed
number stays the median.

Exploratory evidence (frozen pit-sweep artifacts, 1700 roster-weeks,
production optimizer and distributions): regret 25.915 -> 24.016, a paired
delta of **-1.90 points per roster-week**, direction consistent in both
seasons independently (2024 -1.74/wk, 2025 -2.06/wk, each t ~ -1.9), and the
candidate ordering ran exactly as theory predicts (mean < mid-blend < median
< p75 < p25).

### Candidate B - interval calibration (smoothed bootstrap)

Flip `MODEL_CONSTANTS.simulation.smoothingBandwidth` from `0` to the selected
cell's value and `intervalScale` from `1.45` to `1.0`. Two cells:

| cell | smoothingBandwidth | intervalScale | role |
| --- | ---: | ---: | --- |
| `bw-20` | 0.20 | 1.0 | primary |
| `bw-15` | 0.15 | 1.0 | secondary |

Exploratory evidence (same artifacts, production `simulateDistribution`,
no opponent/usage/homeAway factors in the harness): p10-p90 coverage
0.647 -> 0.814 against a 0.80 target, p25-p75 0.453 -> 0.531 against 0.50,
at intervals 21% narrower. **The transfer risk is the reason this study
exists**: with the full factor chain the shipped model measures 0.745/0.692
(published pit-sweep), not 0.647, so the bandwidth fit on the harness
population may overshoot on the production one. `bw-15` exists for exactly
that case and for no other reason.

### Independence of the two claims

By construction, not assumption: smoothing changes no stored `mean` (the mean
column is the factor-chain output, untouched by the kernel) and pins the
draw median to `mean + median(residuals)`, so Candidate A's ranking inputs are
invariant to Candidate B's mechanism up to draw-sequence noise. Section 9's
mean bit-equality assertion enforces the first half; the median-shift void
bounds the second. Any joint flip is therefore two independent flips.

---

## 2. Why the holdout ledger, and what an arm is

Every historical backtest of this engine re-derives inputs from a database
that has since moved. The holdout ledger (`holdout.service.js`, migration
`20260730000001`) writes cohort-complete, pre-kickoff, append-only projection
snapshots whose deadline is enforced by the database clock. Predictions that
were written down before the games and physically cannot change afterwards
are the evidence standard this study runs on.

**Control arm** = the scheduled captures production already takes: the shipped
constants (`smoothingBandwidth 0`, `intervalScale 1.45`, ranking `'median'`),
all three scoring profiles, identified by `constants_hash` and
`model_version`.

**Candidate B arms** = two additional snapshots per (week, profile), captured
under `capture_kind` values **`candidate:bw-20`** and **`candidate:bw-15`**
(distinct kinds, because the ledger's unique key is
`(season, week, scoring_hash, model_version, capture_kind)` and two arms
sharing one kind would collide on it), computed under the `bw-20` and `bw-15`
constants, captured **in the same transaction and from the same REPEATABLE
READ feature snapshot** as that week's scheduled capture, subject to the same
`capture_not_after` deadline and the same all-or-nothing rule. Each is
identified by its own `constants_hash`, and the capture aborts whole if any
candidate row's `mean` diverges from the scheduled row's (section 9.1,
enforced at write time). The capture protocol version is **2**: a complete
capture means all three arms, and a protocol-1 scheduled-only week can never
skip-match as complete. The projection seed is
`seedFrom(modelVersion, scoringHash, season, week, playerId)` in every arm -
identical inputs, identical seed - so a per-player pair of rows differs by
mechanism alone.

**Candidate A needs no capture of its own.** The stored rows carry both
`median` and `mean` (`projection_snapshot_players` columns), and the two
decision rules are two read paths over the SAME control snapshot. The arms
are, exactly:

- control ranking value: `median`, falling back to `mean` where median is
  null (production's `toLegacyProjectionMap` rule);
- candidate ranking value: `mean`, falling back to `median` where mean is
  null (`buildSuggestions`' `'mean'` rule, commit `ac4c1b6`);
- in both arms a row with `active_probability = 0` ranks 0, and a player-week
  with no row ranks 0 (the optimizer's null coercion).

---

## 3. Prerequisites (code that must exist before Week 1)

1. **Candidate-arm capture. BUILT** (`holdout.service.js` `CANDIDATE_ARMS` /
   `captureArms`, protocol 2): the capture tick computes and writes the two
   Candidate B snapshots alongside the scheduled one, same transaction, per
   section 2. Constants for the cells are resolved from production
   `MODEL_CONSTANTS` with exactly the two named leaves changed, and a
   resolver guard refuses an override key that does not already exist -
   JSON key order is the constants hash's identity, and an appended typo'd
   key would corrupt provenance. Remaining for this item: **deploy** before
   the 2026 Week 1 capture window opens.
2. **Evaluation script. BUILT** (`scripts/holdout/lib/evaluate.js` and its
   modules; runner `server/scripts/run-holdout-confirm.js`): deterministic,
   reads only the ledger and the pinned actuals of section 5, emits the
   report and every number in section 8. The sealed values live in ONE
   frozen object (`SEALED`); the evaluator accepts overrides for tests only
   and the report brands any overridden run "NOT THE SEALED STUDY".
   Published with the report.
3. **Roster generator pointed at the ledger cohort. BUILT**, folded into
   item 2 (`scripts/holdout/lib/rosters.js`): pit-sweep §5.1's quotas, caps
   and snake draft against the scheduled arm's cohort rows, under this
   study's seed and the tie-break named in section 6.

Items 2-3 may land during the season (they read, never write). Item 1 gates
evidence: **a week is evaluable only if all three snapshots (control + two
candidate cells) for the primary profile are complete and pre-deadline.**
If item 1 deploys after Week 1, the window starts at the first fully-captured
week; section 4's minimum then decides evaluability. Late deployment narrows
the study; it never relaxes it.

---

## 4. Evaluation window and the missing-week budget

- Window: **2026 REG weeks 1-18**, every week whose all-arm capture is
  complete and on time (`is_late = false`, header `CHECK` satisfied).
- Week 1 is INCLUDED: unlike the reconstructed studies, production's own
  Week-1 projections exist (prior-season history is in the database) and are
  what users actually saw.
- Week 18 is INCLUDED with the pit-sweep's own reasoning: rest-week
  distortion hits every arm identically and cancels in paired deltas; a
  weeks-1-17 sensitivity is published, non-selecting.
- A week missing ANY arm drops for EVERY arm, symmetrically, and is counted
  in the report.
- **Evaluability minimum: 14 surviving weeks.** Below 14, every claim is
  UNEVALUABLE and nothing flips. The scheduled-capture health surface
  (`/api/health` holdout obligations) is the operational guard.
- Scoring profiles: **half_ppr is primary** and the only profile any gate
  reads. standard and ppr captures are taken and published as non-selecting
  sensitivities.

---

## 5. Outcome truth

- Source: nflverse final player-week stats and team-week stats for 2026, plus
  the schedule file, fetched ONCE, no earlier than **14 days after the final
  2026 REG game** (the stat-correction window), by the pinned fetcher
  (`scripts/backtest/lib/sourceFetch.js` contract: HTTPS, host allowlist,
  SHA-256 of exact bytes on write and every read).
- The fetched bytes' hashes are recorded in `ACTUALS_MANIFEST.json` in this
  directory at fetch time, before any metric is computed. Metrics computed
  from bytes not matching the manifest are void.
- Player-weeks are re-scored under each capture's exact scoring rules via
  `calculateFantasyPoints` - no stored fantasy-point column is consumed.
- Identity: ledger rows key by production `player_id`; nflverse rows map
  through the production crosswalk. An unmappable ledger row scores as
  **absent from the stat file**.
- Absence from the stat file = **0 recorded points**, the pit-sweep §4.3
  convention. DEF pseudo-players synthesize from team-week rows plus the
  schedule, exactly as production scores them.
- `active_probability = 0` rows (bye/Out/IR at capture) are excluded from
  interval-coverage denominators and rank 0 in lineups - the same treatment
  in every arm.

---

## 6. Rosters and the regret estimand

Candidate A's endpoint needs rosters. Construction reuses the pit-sweep §5.1
rules verbatim except where named:

- Pool quotas 20 QB / 50 RB / 50 WR / 20 TE / 10 K / 10 DEF = 160, drawn from
  that week's ledger cohort; snake draft, 10 teams, 16 rounds, per-team caps
  2/5/5/2/1/1; slot shape `DEFAULT_ROSTER_SLOTS` (9 starters + 7 bench);
  5 replicates -> **50 rosters per week**.
- Model-independent pre-week ranking: recency-weighted mean of prior
  league-scored points, weight `0.5^(weeksAgo/8)`, two-season window
  (2025 finals + 2026 weeks < W, re-scored under half_ppr from the pinned
  actuals and the already-pinned 2025 sources), at least one prior game.
  A 2025 week-w game is `W + 26 - w` weeks stale in 2026 week W
  (production's `seasonWeekSpan`).
- **Ranking ties break by ascending playerId** - a deliberate, named
  simplification of pit-sweep §5.1's collation-artifact tie-break, whose
  name orderings the ledger does not carry. Ranking values are floats of
  re-scored actuals, so exact ties are rare and the rule is a totalizer,
  not a chooser.
- Roster seed: **375445932** (`sha256("endzone-empire/holdout-confirm-2026/roster-seed")[:8]` as u32).
  Replicate r of week W drafts in the order given by a Fisher-Yates
  permutation under `mulberry32(seedFrom(375445932, season, W, r))`, with
  production's `seedFrom` / `mulberry32`.
- A position that cannot fill its quota with rankable players **fails the
  evaluation loudly** - a cohort that thin is a structural anomaly for
  `DEVIATIONS.md`, never a pool silently reshaped.
- Lineup selection per arm: production `optimalAssignment` under
  `DEFAULT_ROSTER_SLOTS` over the arm's ranking values (section 2).
  Hindsight optimum: the same optimizer over actual points.
- **Regret** per roster-week = hindsight total minus the arm's lineup total,
  both scored on actuals. Per-week score = mean over the 50 rosters. The
  contrast is the paired per-week delta, candidate minus control; negative
  favorable.

---

## 7. Metric definitions

The analysis unit is the WEEK. All formulas are the pit-sweep §6 definitions,
restated where this study reads them:

- **Coverage-80 (week)** = fraction of the week's eligible rows
  (`active_probability != 0`, non-null interval) whose actual lands in
  `[p10, p90]` inclusive. **Coverage-50** likewise on `[p25, p75]`.
- **WIS (week)** = pit-sweep §6.5's formula, K = 2, the two central intervals,
  mean over the week's eligible rows. Lower is better.
- **Interval width (week)** = mean `p90 - p10`. Descriptive only.
- **Regret (week)**: section 6. Lower is better.
- **Calibration distance**: for arm X and week w,
  `D80_X(w) = |cov80_X(w) - 0.80|`, `D50_X(w) = |cov50_X(w) - 0.50|`.
  The contrast statistic is `T(w) = D_ctrl(w) - D_cand(w)`; positive
  favorable.
- Null rows are excluded from coverage/WIS and counted per arm per week.
  Numeric ties resolve on values rounded to 10 decimals.

---

## 8. Inference: claims, components, alphas, margins

Family-wise one-sided **alpha = 0.05 per candidate claim** (the two claims
are separate families; each flips a disjoint constant set and section 1
establishes mechanism-level independence).

### 8.1 Candidate A - one component

- Endpoint: mean over surviving weeks of the paired regret delta.
- **Pass iff the upper one-sided 95% bound (section 10) on the weekly mean
  delta lies strictly below 0.** Margin 0 - superiority, not noninferiority.
- **Power, stated honestly:** at the observed effect (-1.9, weekly SD ~4.1)
  and n = 17, power is roughly **0.55-0.60**. This study can miss a real
  effect of the observed size almost half the time. A miss therefore reads
  INCONCLUSIVE, not refuted (section 11), and the candidate may re-run as a
  new study on the next season's ledger. The margin is still 0 because a
  flip must be justified by this season's own evidence, not by the
  exploratory result it is checking.

### 8.2 Candidate B - two cells, three components

Two cells share alpha by Bonferroni: **per-cell alpha = 0.025**. Within a
cell the claim is an intersection-union test; per Berger's IUT theorem each
component is tested at the CELL's alpha with no further division (a
deliberate, stated departure from the pit-sweep's alpha/7 divisor style: the
IUT is level-alpha when every component is level-alpha, and the divisor there
was a conservatism choice, not a requirement).

A cell passes iff ALL of:

1. **cov80 improvement**: lower one-sided 97.5% bound on the weekly mean of
   `T80(w)` strictly above 0.
2. **cov50 improvement**: lower one-sided 97.5% bound on the weekly mean of
   `T50(w)` strictly above 0.
3. **WIS no-harm**: upper one-sided 97.5% bound on the weekly mean paired
   WIS delta (cand - ctrl) strictly below **+0.05**.

Plus two hard point-estimate bands, non-statistical by design (a candidate
whose realized coverage sits outside the advertised band has failed the
product claim whatever the bootstrap says):

- season cov80 point estimate in **[0.75, 0.85]**;
- season cov50 point estimate in **[0.45, 0.55]**.

**Selection among passing cells is by the fixed order (`bw-20`, `bw-15`)**:
the first passer in that order is selected; nothing about the data reorders
it. If both fail or the claim voids, no calibration flip occurs.

### 8.3 What flips

- Candidate A pass -> `decision.lineupRanking = 'mean'`.
- Candidate B pass -> selected cell's `smoothingBandwidth`,
  `intervalScale = 1.0`.
- Any flip ships as **`free_baseline_v3.2`** with the MODEL_VERSION bump;
  both flips together are still one bump. No pass, no bump, and the inert
  constants stay at their shipped values.

---

## 9. Integrity assertions and void conditions

Checked before any gate is read. A failed assertion VOIDS the named scope -
void is "the run cannot speak", never a pass or a fail.

1. **Mean bit-equality (voids Candidate B):** for every (week, profile,
   player), the candidate cells' stored `mean` must equal the control row's
   `mean` exactly. The kernel touches dispersion only; a diverging mean means
   the arms did not share a feature snapshot.
2. **Median-shift bound (voids Candidate B):** per cell, the signed mean of
   (candidate `median` - control `median`) over all rows must lie in
   **[-0.05, +0.05]**. Individual differences are draw-sequence noise
   (exploratory |mean| 0.42, signed -0.017); a signed mean outside the bound
   is a moved point estimate wearing an interval costume.
3. **Permutation floor (voids Candidate A):** the control arm must beat
   10,000 seeded within-week-position shuffles of the projection-to-player
   assignment on regret at plus-one Monte Carlo `p <= 0.001`
   (permutation seed **3479054401**). A pipeline that cannot distinguish the
   real control from a shuffle cannot measure a 1.9-point delta.
4. **Ledger integrity (voids the week):** any evaluated snapshot whose
   child-row digest fails to reproduce its `cohort_hash`, or whose
   `constants_hash` does not match its arm's resolved constants, drops that
   week for every arm.

---

## 10. CI contract

- Cluster bootstrap over surviving WEEKS, drawn with replacement, size = the
  surviving count; every per-week statistic recomputed per draw; deltas
  within a draw, never across draws.
- **Exactly 100,000 draws. Bootstrap seed 2579717975**
  (`sha256("endzone-empire/holdout-confirm-2026/bootstrap-seed")[:8]` as u32).
- Identical resamples reused for every arm, endpoint and component.
- Percentile bounds; the one-sided q bound is the order statistic at index
  `ceil(q * 100000)` clamped to `[1, 100000]`, no interpolation.
- Exact fallback: if fewer than 12 clusters survive, or fewer than 100
  distinct resampled values occur, the affected component switches to the
  exact one-sided sign test at the same alpha (pit-sweep §9.8 mechanics),
  and the report says so. (Below 14 weeks section 4 has already made the
  claim unevaluable; the 12 threshold only guards a sensitivity rerun.)

---

## 11. Interpretation rules

- A bound straddling its boundary is INCONCLUSIVE, not evidence against.
- INCONCLUSIVE or UNEVALUABLE flips nothing and refutes nothing; a rerun on
  the next season's ledger is a new study id.
- No pooling with 2024/2025 exploratory numbers can rescue anything here.
- Sensitivities (other profiles, weeks 1-17 window) are published,
  non-selecting, and gate nothing.
- The exploratory measurements cited in section 1 are motivation, not
  evidence, and the report must not present them as confirmed by citation.

---

## 12. Sealing, approval, deviations

- Sealing: final bytes committed; SHA-256 recorded beside the approver's
  attestation in `APPROVAL.md` in this directory. **One approval - the
  product owner's - is required and sufficient.** An independent statistical
  read of sections 8-10 before sealing is recommended, not required; if one
  occurs it is recorded in `APPROVAL.md` with its own hash reference.
- The approval surface is deliberately proportionate. The pit-sweep's
  four-approval chain answered a study whose inputs could be silently
  reconstructed; this study's inputs are append-only rows behind a database
  CHECK, and its whole apparatus is one capture extension and one read-only
  evaluator.
- Deviations after sealing: append-only entries in `DEVIATIONS.md`, each
  naming what changed, why, and which claims it touches; a deviation that
  touches a gate voids the touched claim unless it is purely mechanical
  (spelling, a broken link, a restated number verified against the sealed
  value).

## 13. Non-goals

- The market (`gameEnvironment`) and expert-consensus inputs stay INERT: no
  data source is wired, so there is nothing to confirm. Their sweeps are
  future studies.
- No homeAway claim. The factor remains untestable pending orientation data
  and the `knownOrientation` producer gap.
- No MAE/RMSE/rho superiority claim for either candidate: A does not change
  projections, and B's mechanism deliberately does not move point estimates.
- Nothing here re-tunes `usage.blendWeight` or any baseline constant.
