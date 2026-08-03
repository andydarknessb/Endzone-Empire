# PHASE5_EXECUTION_SPEC.md - Phase 5 execution addendum

Study id: `pit-sweep-2024-2025` (same study as `PREREGISTRATION.md`).

**Status: revision 13. All three non-final approvals now recorded APPROVED
(section 10): independent statistical review (SHA-256
`25DFFCEC77EB5DFE17150020C04465B546F0584919916FD686CCFE77FA17258F`,
2026-08-02), user sign-off on the S3 deviation (2026-08-02), and user
approval of the remainder of this document (2026-08-02). Not sealed.**

**These three approvals authorize GATE 2 IMPLEMENTATION only. They do NOT
authorize candidate-cell execution.** Candidate-cell execution remains
gated on the fourth and final item: the independent implementation review,
which cannot occur until Gate 2 code exists and which has not yet
happened. **Gate 0 (section 1) remains active** - unchanged by these three
approvals - until that review passes.

This document remains fully self-contained: every section states its
complete, currently-binding requirement in full, not a pointer to an
earlier revision's text.

---

## 0. Classes of addition

**[mechanical completion]** - a genuine silence in the sealed text, filled
with the only reasonable choice once the code it must interoperate with is
examined; introduces no new scientific content. **[substantive prospective
amendment]** - a decision a reasonable reader could resolve differently, OR
one that changes a real outcome (which cells are evaluable, selectable, or
vetoed) - regardless of how forced the arithmetic behind it is; the STAKES
of the change, not the arithmetic's determinism, decide this label.
**[mechanical correction, forced by an implementation fact]** - a case
where the sealed text's OWN derivation rests on a false assumption about
the implementation, and once the true fact is accepted, arithmetic alone
determines the corrected number, AND that number cannot change any verdict
a cell reaches (only what gets disclosed about a verdict already reached
the same way).

---

## 1. Gate 0 - hold

Verified against the current freeze state (Commit A6 `d469050`, Commit M6
`109125c`, Commit B2 `dfd8ae1`): `backtest-entrypoint.js` stops after Step 1
(rosters/cohort artifacts) and the control-only blinded MDE - no `sweep`
mode exists; `backtest-reproduction.yml` regenerates and byte-compares M and
B only - no job for a candidate sweep or a report; `discover-freeze-
commits.js`'s `POST_B_ALLOWED_PATHS` is exactly `{REPORT.md, report.json}`;
prereg 17 requires candidate sweeps to execute from a clean detached
worktree checked out at B, using code already present there - B2's tree
carries none of it. **Hold**: no candidate cell (any of the 8 factorial
cells, salted or unsalted, in any sensitivity) executes against B2 or any
other freeze state until a replacement freeze (Gate 4, producing B3)
carries the complete Phase 5 implementation, that implementation has passed
Gate 3 verification (including the independent implementation review), and
all four approvals in the preamble are recorded on the same approved
revision of this document. **As of 2026-08-02, three of the four are
recorded (statistical review, S3 sign-off, remainder approval - section
10), which authorizes GATE 2 IMPLEMENTATION WORK to begin against this
revision. It does not lift this hold**: no candidate cell executes until
the fourth approval (the independent implementation review of the
resulting Gate 2 code) is also recorded.

---

## 2. Evaluation family **(mechanical completion, restates prereg 7.1, 12.1)**

All **8 factorial cells** (`blendWeight in {0, 0.25, 0.40, 0.60}` crossed
with `homeAway.enabled in {off, on}`) are evaluated and reported, whether or
not any cell passes. The **7 non-control cells** (everything except
`usage-25 x off`, the shipped `free_baseline_v3.1` configuration) are the
**selection family**. `scripts/backtest/lib/arms.js` (Commit A6) already
implements `ALL_CELLS`, `SELECTION_FAMILY`, `CONTROL_CELL`, cell-constant
resolution, the cross-season guard, and constant-hash distinctness
assertions; `sweepEvaluator.js` (Gate 2) consumes these exports directly.

---

## 3. Salt derivation: unsalted and salted `hashValue`

### 3.1 Unsalted derivation

`hashValue = model.scoringHash(rules)` (`projectionModel.js:317`), for
every unsalted diagnostic, oracle-week fidelity check, and the control-only
MDE.

### 3.2 Salted derivation **[mechanical completion]**

**`hashValue(rules, salt) = model.scoringHash(rules) + ':' + salt`**, where
`salt` is one of the 24 fixed strings from prereg 8.1 /
`scripts/backtest/lib/metrics.js`'s `SALTS`. This flows unmodified into
`seedFrom(modelVersion, scoringHashValue, season, week, playerId)`
(`:1113`) -> `mulberry32` (`:333`), exactly as every existing caller already
does with the unsalted value.

### 3.3 Salts are common-random-number replicates, not independent inferential units

The bootstrap cluster (prereg 10.1) is the season-week, 17 per season,
never `17 x 24`. A salt changes only which simulation draw is scored for an
already-fixed real week; `n` for every bootstrap and exact-test computation
is the surviving week count, regardless of how many salts were averaged
into each week's input value.

### 3.4 Required mutation and correctness tests

1. **Determinism**: the same `(rules, salt)` pair produces the identical
   `hashValue` on repeated calls and across process restarts.
2. **Salt-only variation**: for a fixed `rules`, all 24 salts produce 24
   pairwise-distinct `hashValue` strings.
3. **Rules still matter**: for a fixed salt, two different `rules` objects
   produce two different `hashValue` strings.
4. **Unsalted equivalence**: the unsalted path is byte-identical to
   `model.scoringHash(rules)` with no salt suffix, verified against
   production's own existing output.
5. **Final-seed collision testing, at two levels - neither alone is
   sufficient**:
   - **Unit-test level (illustrative, not exhaustive)**: the collision check
     (all 24 seeds from `seedFrom` pairwise distinct for a fixed input) run
     for every effective scoring-profile hash actually in scope - half-PPR,
     standard, and full-PPR (prereg 4.3) - and for every `modelVersion`
     string actually used, read from the same source the sweep does rather
     than hardcoded.
   - **Runtime level (exhaustive over what actually runs, mandatory)**: the
     authoritative sweep itself must assert, for EVERY evaluated player-week
     it actually computes, that the 24 salt-derived final seeds it used are
     pairwise distinct - a cheap O(24^2) runtime guard, analogous to
     `assertSaltAffectsOnlyHashValue` but checking the seed space rather
     than the run-object shape, that aborts the sweep the instant a real
     collision is detected.
6. Reuses `assertSaltAffectsOnlyHashValue` (Commit A6,
   `lib/arms.js:173`) as the integration check that salting the derivation
   changes nothing in a cell's resolved run object except `hashValue`.

---

## 4. Exact-trigger reconciliation rule

### 4.1 The gap

Prereg 10.2 defines when a component **switches** from percentile bootstrap
to the exact method: fewer than 12 clusters, OR a degenerate bootstrap
distribution (fewer than 100 distinct values among the 100,000 resampled
statistics). Component (f) always uses the exact method by construction.

### 4.2 The AND rule **[substantive prospective amendment]**

This document adopts an endpoint-level AND rule as a substantive
prospective amendment to prereg 10.2's literal "switches" language: on
trigger, BOTH the bootstrap-mean inequality AND the direction-normalized
exact sign test are required, never a substitution. Adopted because it can
only make an endpoint harder to pass, never easier, than either procedure
alone. **Fallback if a reviewer instead prefers a literal switch**: on
trigger, the exact sign test alone determines the endpoint, reported as
"not computed: exact-trigger fired" for the bootstrap side. This applies to
every bootstrap inequality across components (a), (b), (c), (d), (e1), and
all **thirteen endpoint-season inequalities across nine preregistered (e2)
rows** (prereg 9.7's nine rows - coverage; MAE, RMSE, rho, WIS each stated
"2025 and 2024"; standard-scoring regret and pairwise; full-PPR regret and
pairwise - resolve to `1 + (4 x 2) + 2 + 2 = 13` individual inequalities).

### 4.3 The cluster-count trigger is dead code under prereg 10.4

Prereg 10.4 requires `n >= 15` for a component to be evaluable at all;
prereg 10.2's cluster-count trigger fires below 12. Since `15 > 12`, the
cluster-count half of the trigger can never fire; **only the
degenerate-distribution condition can, and it is evaluated PER ENDPOINT,
independently** - a two-endpoint component (every co-primary component (a)
through (e1)) can have one endpoint trigger while its sibling does not.

### 4.4 Implementation defects, required fixes

1. **Count distinct bootstrap values after ten-decimal (`roundToTie`)
   normalization**, not on raw floats - a genuinely discrete metric (e.g.
   pairwise accuracy over few eligible pairs) can otherwise register as
   non-degenerate purely from floating-point representation noise.
2. **Build the inverted bound's sorted array from the non-tied subset**,
   fixing `exactSignTest`'s (`lib/arms.js:368-403`) index/sample mismatch:
   the current code computes `n`/`k` from `nonTied` (margin-shifted values
   with exact ties dropped) but builds `sortedDeltas` from the FULL,
   untrimmed `weekDeltas` array and indexes it at `sortedDeltas[j - 1]`
   using `j`, which was derived from the smaller non-tied count - whenever
   any week ties out, the order statistic is read from the wrong position.
   **Fix**: the sorted array must be built from the SAME non-tied subset of
   (unshifted) deltas that produced `n` and `k`.
3. **`unevaluable` (never `threshold-not-established`, never a bare `fail`)
   when no finite inverted bound exists** (`j === null`, `bound ===
   Infinity`), per prereg 9.8 point 6's "the endpoint is UNEVALUABLE."
   **[rev10, labeled per rejection finding 1]**: **which CELL-level status
   this endpoint-level `unevaluable` propagates to is itself a substantive
   prospective amendment, not a mechanical consequence, when it occurs on
   component (f).** The sealed text marks a no-finite-bound outcome
   `unevaluable` but does NOT itself extend (f)'s named `inconclusive`
   exception (prereg 9.8) to this specific sub-cause - prereg 9.8's own
   language names sparsity and the falsifiability floor explicitly; the
   no-finite-bound case is a DIFFERENT numbered point (9.8 point 6) that
   happens to use the same word, `unevaluable`, without prereg 9.8
   explicitly folding it into the SAME override. **This document adopts,
   as its own labeled substantive amendment, treating component (f)'s
   no-finite-bound case identically to its other two unevaluable causes
   (mapping to cell `inconclusive`, not the prereg 9.1 default of `fail`)**,
   on the grounds that all three are simply different routes to "component
   (f) could not be evaluated" and treating them inconsistently would be
   arbitrary - but this is a genuine, defensible CHOICE among readings the
   sealed text leaves open, not something the sealed text forces, and is
   therefore **submitted for approval as an amendment** (adopted by this
   draft, not yet approved - see section 10), alongside the AND rule and
   the permutation-control definitions, rather than presented as if prereg
   9.8 already said so. **For a NON-(f) component, no-finite-bound remains
   `fail`** (prereg 9.1's unmodified default; no named exception applies
   there at all, sealed or amended).
4. **Joint `x = -delta` / `margin* = -margin` negation for higher-is-better
   endpoints** - never negate the statistic without also negating the
   margin: define `x = delta` for a favorable-negative inequality (regret,
   MAE, RMSE, WIS) and `x = -delta` for a favorable-positive one (pairwise,
   coverage, rho); apply `exactSignTest`'s existing procedure to `x` against
   `margin* = -margin` for favorable-positive endpoints (unchanged `margin`
   for favorable-negative ones); de-normalize the reported bound (and
   compare against the ORIGINAL, non-negated margin) before publication, so
   the report states every bound in the metric's own natural sign.

### 4.5 Applies to all thirteen inequalities

Sections 4.2-4.4 apply individually to each of components (a), (b), (c),
(d), (e1)'s endpoints, and to each of the thirteen (e2) endpoint-season
inequalities (section 4.2).

---

## 5. Permutation control **[substantive prospective amendment]**

**Definitions**: `T_regret = -mean(regret)` for the **control cell only** -
the mean deployed-policy regret (prereg 5.2, section 6.1's per-season-week
score: the mean over the season-week's 50 rosters), NEGATED so a LARGER `T`
is uniformly favorable across both endpoints. `T_pairwise = mean(pairwise
accuracy)` for the **control cell only** - the six-position macro pairwise
accuracy (prereg 6.2), UNNEGATED. Both are ABSOLUTE control-arm performance
against a permutation null of the within-week-position assignment - never
a candidate-minus-comparator delta.

**Aggregation**, per permutation replicate: average the **24 salt-specific
values** within each week first, then average the 17 week-level values
across weeks - "salt-specific," not "same-salt" (prereg 6.7's paired-
contrast vocabulary does not apply here, since this statistic has no
second arm to pair against). The real (unpermuted) control's `T_obs` uses
the identical procedure.

**Configuration**: scope pinned to **2025 REG weeks 2-18 only**, never
2024, never week 1. **10,000 permutations, seed 940227589**, one
permutation per replicate reused across all 24 salts and both endpoints.
**Plus-one p-value**: `p_hat = (1 + #{b : T_b >= T_obs}) / (1 + 10000)`,
per endpoint. **Threshold `p_hat <= 0.001` on BOTH endpoints**; failing
EITHER makes the whole authoritative run **`void`** (section 8.2, Level 1)
- a pipeline-integrity finding, evaluated once against the control, never a
per-cell verdict.

---

## 6. Component (f): rounding, subgroup mechanics, veto, and callback

### 6.1 The rounding correction and its downstream numbers

Production rounds every simulated median to two decimals BEFORE it is ever
scored (`projectionModel.js:884`, `median: round2(quantile(draws, 0.5))`).
The sealed prereg 9.8 derivation `inc <= |b| * |e|` implicitly assumed
`median_on`/`median_off` were compared unrounded; in reality `error_on =
round2(median_on_raw) - actual` and `error_off = round2(median_off_raw) -
actual` are each independently rounded, so `inc = |error_on| - |error_off|`
can exceed `|b| * |e|` by up to the combined rounding slack. Corrected,
conservative bound, adopted:

```
inc  <=  |b| * |e| + 0.01  <=  0.05 * |b| + 0.01
```

- **Falsifiability floor, `0.30`** (was `0.50`): **substantive prospective
  amendment** - this is an evaluability gate; a cell with realized mean
  `|b|` between 0.30 and 0.50 was `unevaluable` under the sealed number and
  is potentially evaluable under the corrected one, changing which cells
  reach a verdict at all.
- **Veto-incapable disclosure threshold, `3.80`** (was `4.00`):
  **mechanical rounding correction** - used exclusively inside the
  transparency block's `catastrophicCapCouldFire` disclosure
  (`lib/arms.js:456`), never gating the veto itself (which fires strictly
  on the directly-measured `inc > 0.20`); cannot change any verdict.
- **Per-week low-`|b|` disclosure count** (`weeksBelowFalsifiabilityFloor`,
  `lib/arms.js:448-449`): **mechanical consequence** - reuses the same
  `FALSIFIABILITY_FLOOR` constant, so it moves from `0.50` to `0.30`
  automatically once that constant is corrected.

**Required Gate 2 code changes**: `lib/arms.js:366`'s `FALSIFIABILITY_FLOOR
= DELTA_F / MAX_EFFECT` -> `(DELTA_F - 0.01) / MAX_EFFECT` (0.30);
`:456`'s `catastrophicCapCouldFire` check -> `Number(maxAbsBaseline) >
(CATASTROPHIC_CAP - 0.01) / MAX_EFFECT` (3.80).

**Required rounding-boundary mutation tests**: synthetic on/off medians
whose independent `round2` roundings push in opposite directions at the
0.005 boundary, asserting scored `inc` never exceeds `0.05|b| + 0.01`; the
falsifiability-floor and disclosure comparisons tested at `0.30`/`3.80`
rather than `0.50`/`4.00` at their own boundaries.

### 6.2 Normalize every boundary operation

**Every comparison - `<`, `<=`, `>`, `>=`, and equality - involving `0.30`
(the falsifiability floor), `3.80` (the disclosure threshold), or `0.20`
(the veto cap) applies `roundToTie` (ten-decimal, prereg 6.6) to BOTH
operands before the comparison**, not just one: `roundToTie(computedIncOrB)
<compare> roundToTie(0.20 | 0.30 | 3.80)`, for every one of the veto check,
the falsifiability-floor check, and the disclosure-threshold check - so a
genuine boundary value is never misclassified by floating-point
representation noise on either side.

### 6.3 Subgroup membership and averaging

Membership (`b <= 0` in the matched off-cell) is computed once per
`(season, week, blendWeight, playerId)` and reused unchanged across all 24
salts for that cell - the salt affects only `simulateDistribution`'s
residual draw, AFTER `running` (the pre-homeAway baseline `b`) is
finalized, never `running` itself, per `assertSaltAffectsOnlyHashValue`'s
own invariant. `D_w` per endpoint per week = the mean of the 24 same-salt
on-minus-off deltas (same salt on both sides, `saltPairedDelta`,
`lib/metrics.js:333`).

### 6.4 The catastrophic-cap veto: one component-level check, run first

**One veto check, computed BEFORE either endpoint's evaluability minimum or
falsifiability guard runs**, over the full Cartesian set of (subgroup
player-week) x (24 salts) realizations: `inc = |error_on| - |error_off|`,
`error = projected_median - actual`, `projected_median` salt-specific.
**Any single realization with (ten-decimal-normalized) `inc > 0.20` vetoes
the cell immediately**, regardless of whether either endpoint would
otherwise have been evaluable - averaging `inc` across salts first was
considered and rejected, since it could let a genuinely catastrophic
single-salt realization wash out against 23 mild ones.

### 6.5 Callback contract

**Exact signature:**

```
onPreHomeAwayBaseline({
  playerId,
  position,
  season,
  week,
  blendWeight,
  baseline
})
```

**Frozen requirements:**

- `baseline` is `running`, captured raw: finite, unrounded, exactly the
  value immediately before `applyFactor('homeAway', homeAway)`
  (`projectionModel.js` around line 1104, cited as a locator, not a
  definition).
- **Called exactly once** per player-week that reaches the semantic point -
  not "at most once," not "zero or more times."
- **Zero calls on either early return**: `projectFromBundle`'s own `if
  (!player)` branch (`projection.service.js:261-277`) and `projectPlayer`'s
  own `if (baseline.value == null)` branch (`projectionModel.js:1012`) both
  return before the semantic point exists; the callback fires zero times
  for a player-week that exits through either.
- **Type validation is unconditional, immediate, and required at EVERY
  public receiver independently** - `generateProjections`,
  `projectFromBundle`, and `projectPlayer` each validate their own received
  parameter (must be `undefined` or a function; any other type is a hard
  error) **at the top of the function body, before any other logic,
  including before any early-return branch** - so an empty-`playerIds`
  call to `generateProjections` still validates and still throws on a bad
  type even though the per-player loop never executes, and a direct call to
  `projectFromBundle` with a `!player` outcome still validates before that
  early return.
- **Invocation remains conditional**, independent of validation: the
  callback is actually CALLED only at the semantic point inside
  `projectPlayer`, exactly once per qualifying player-week, never
  unconditionally.
- **Callback exceptions ABORT generation and are never swallowed**: if
  `onPreHomeAwayBaseline(...)` itself throws, that exception propagates out
  of `projectPlayer`, `projectFromBundle`, and `generateProjections`,
  aborting the sweep run - no `try`/`catch` anywhere in this chain may catch
  and continue past a callback exception.

**Full threading** (verified against the real call graph): `generateProjections`
(`projection.service.js:408`) accepts the optional parameter, passes it
unchanged into every per-player `projectFromBundle` call (`:449`);
`projectFromBundle` (`:257`) accepts it, passes it unchanged into its own
`model.projectPlayer` call, except on its own early `!player` return, where
it is never invoked; `projectPlayer` fires it at the semantic point or
never, per its own early-return rule. Every production call site omits the
parameter, so none of the three functions' behavior changes for them. Any
future direct caller of `projectFromBundle` (today there are none besides
`generateProjections`, verified by grep) must accept and forward the same
parameter rather than re-implementing `projectFromBundle`'s own assembly
logic to reach `projectPlayer` directly.

---

## 7. Reserve-as-IR (Sensitivity S3) **[substantive prospective deviation, chosen]**

**Declared structurally non-estimable under the frozen active-only cohort.
No S3 estimate is published.** The frozen cohort (prereg 4.1) is
active-class only (`ACT`/`INA`, prereg 3.1); reserve-class rows (`RES`,
`RET`, `EXE`, `E01`) are excluded at roster construction, before any
injury-status mapping happens, so S3's rule (treat reserve-class roster
status as `IR`, prereg 4.2) has no row to apply to. This is chosen over
building a complete reserve-inclusive sensitivity cohort/roster/metric
contract, which would require new roster-construction rules, new frozen
roster artifacts, and very likely its own preregistration document - a
scope expansion beyond this addendum's mandate. **The report states
plainly that S3 was preregistered but is not reported, publishes the
exclusion counts already tracked at roster construction as context (never
as a substitute S3 result), and this is an explicit PROSPECTIVE DEVIATION
from prereg 4.2's sensitivity requirement, requiring its own user sign-off**
(section 10), distinct from the rest of this document's approval.

---

## 8. Status model: the complete reducer, activation, Level 5, and identity

### 8.1 Signed boundaries

Every endpoint has a **favorable boundary** (always `0`), a **passing
boundary** (the signed margin value the tested bound must clear), and a
**harmful boundary**: **`harmful = -passing`** (the mirror) for
**superiority-type endpoints (component (a) only)** - the sole test in this
family phrased as "beat the control by at least the margin," with no
sealed harm threshold of its own, so the mirror is introduced purely to
give wide-straddle a symmetric, defensible harm boundary; **`harmful =
passing`** (the SAME value) for **every noninferiority-type endpoint**
((e1), all thirteen (e2) inequalities) - the margin already defines both
what must be cleared to pass and what, crossed the other way, constitutes
harm, so mirroring it would misclassify a genuinely favorable value as
harmful; **`passing = harmful = 0`** for the **zero-margin endpoints** ((b),
(c), (d)) - both rules coincide trivially. **Component (f) has no
wide-straddle case**: it always uses the one-sided exact binomial method,
never a two-sided bootstrap interval that could "span" anything.

| endpoint | type | passing boundary | harmful boundary |
| --- | --- | ---: | ---: |
| (a) regret | superiority | `-0.15` | `+0.15` (mirror) |
| (a) pairwise | superiority | `+0.005` | `-0.005` (mirror) |
| (b), (c), (d) regret | zero-margin | `0` | `0` |
| (b), (c), (d) pairwise | zero-margin | `0` | `0` |
| (e1) regret | noninferiority | `+0.15` | `+0.15` (same) |
| (e1) pairwise | noninferiority | `-0.005` | `-0.005` (same) |
| (e2) coverage delta | noninferiority | `-0.01` | `-0.01` (same) |
| (e2) MAE / RMSE / WIS delta (each season) | noninferiority | `+0.10` / `+0.15` / `+0.10` | same as passing |
| (e2) Spearman rho delta (each season) | noninferiority | `-0.005` | `-0.005` (same) |
| (e2) standard/full-PPR regret (2025) | noninferiority | `+0.15` | `+0.15` (same) |
| (e2) standard/full-PPR pairwise (2025) | noninferiority | `-0.005` | `-0.005` (same) |
| (f) f1, f2 | noninferiority, exact-only | `+0.025` | n/a - no wide-straddle case |

### 8.2 The exhaustive endpoint -> component -> cell -> run truth table

**Endpoint level (Level 4), exhaustive**: `missing` (absent entirely);
`unevaluable` (below the cluster/row minimum, a degenerate distribution
with no rescue, the falsifiability floor missed for (f), or no finite
inverted exact bound for any component); `passed` (clears the passing
boundary); **`wide-straddle`** (fully evaluated, interval spans both the
favorable boundary and the harmful boundary per the table above -
bootstrap-based endpoints only, never (f)); **`threshold-not-established`**
- the exhaustive catch-all: every other fully-evaluated outcome, with no
exceptions and no seventh bucket. For a triggered endpoint (section 4):
exact-side non-estimability (`unevaluable`) always takes precedence over a
bootstrap-side `wide-straddle` (an endpoint must be "fully evaluated" -
both procedures produced a usable result - before wide-straddle can even
apply); if both ARE evaluable and the bootstrap side is `wide-straddle`,
that outranks ordinary agreement/disagreement handling; otherwise agreement
gives `passed`/`threshold-not-established` and disagreement gives
`threshold-not-established` (never `unevaluable` - both procedures were
computed).

**Component level (Level 3)**: `missing` > `vetoed` (component (f) only) >
`unevaluable` > `wide-straddle` > `failed` > `passed`, by the presence of
any endpoint in that category.

**Cell level (Level 2), the complete, corrected table:**

| component-level cause | cell status | citation |
| --- | --- | --- |
| any component `missing` | **`fail`** | prereg 9.1, 10.4 |
| a component `unevaluable` because `n < 15` (more than 2 of 17 weeks dropped) | **`fail`** | prereg 10.4's own text |
| **component (f) `unevaluable`, for ANY of its three causes** (below the 8-cluster/30-row minimum, the falsifiability floor missed, OR no finite inverted exact bound on either of (f)'s two endpoints) | **`inconclusive`** | prereg 9.8's own explicit override for sparsity/falsifiability; **the no-finite-bound sub-cause is included here as this document's own labeled substantive amendment (section 4.4, item 3), not as something prereg 9.8 already says** |
| a NON-(f) component `unevaluable` for any other reason (no finite exact bound on (a)-(e2), etc.) | **`fail`** | prereg 9.1's default; no named exception covers a non-(f) component |
| any component `wide-straddle` | **`inconclusive`** | prereg 10.6 |
| activation shortfall, `on`-cells only (section 8.3) | **`inconclusive`** | prereg 11.2 |
| a component `failed` | **`fail`** | prereg 9.1 |
| component (f) veto fires | **`vetoed`** | prereg 9.8, section 6.4 |

**Precedence for ALL co-occurring causes on the same cell: `vetoed` >
`fail` > `inconclusive` > `pass`.** An ordering-caused `inconclusive`
(section 8.4) is one more cause in this same list, subject to the identical
precedence - never a special case that jumps the queue: a cell that is
ALSO independently `vetoed` or `fail` for an unrelated reason keeps that
status regardless of an ordering disagreement also being true for it.

**Run level (Level 1)**: every authoritative run is either **`valid`**
(every cell above is computed and published) or **`void`** (the
permutation-control threshold miss, section 5; a canary failure; either of
the two sealed identity assertions, section 8.6) - `void` is a property of
the WHOLE run,
preempting the entire cell-level table rather than being one more row in
it.

### 8.3 Activation **[rev11, exact numerator/denominator restored per rejection finding 4]**

**Activation, restated in full from prereg 11**: a projection is
**activated** iff `factors.homeAway.available === true` AND the raw,
UNROUNDED `homeAway.effect !== 0` - both halves matter, since a factor can
report itself available and still resolve to a zero effect after
shrinkage, and a zero effect changes nothing, so counting THAT as
activation would overstate how treated the `on`-cell's projections actually
are. **Denominator**: eligible, non-neutral, known-orientation projections,
**per position, including DEF** - eligible means not itself excluded from
the cohort; non-neutral excludes a neutral-site game (no home/away
orientation exists to price); known-orientation excludes a projection whose
schedule orientation could not be resolved at all. **Threshold: 0.85,
identical for every position and both seasons** (prereg 11.2).

Checked once per season, per `on`-cell only (`off`-cells have no activation
requirement at all - there is nothing to check activation of when the
factor is not active), layered on top of the reducer above (section 8.2).
Every component is still computed and reported on an intention-to-treat
basis regardless of activation status - no individual component or (e2)
row is marked `unevaluable` because of an activation shortfall. If either
season misses the 0.85 threshold for ANY position, the cell's status is
`inconclusive`, UNLESS the reducer already produced an independent `fail`,
in which case `fail` stands (section 8.2's precedence). All unaffected
component point estimates and CIs are published regardless, for both `on`
and `off` cells.

### 8.4 Ordering and estimand-disagreement sensitivities

**Cell-level (Level 2)**: any cell whose own recorded verdict under the
primary ordering is CONTRADICTED by the DB-collation variant or the
duplicate-order shuffle (prereg 5.2/16's own text: "that result is
INCONCLUSIVE") gets Level 2 `inconclusive`, evaluated per cell. **Selection-
level (Level 5, section 8.5)**: separately, if individual
cells' verdicts are unaffected but the primary and a sensitivity ordering
disagree about WHICH cell the parsimony order would select, that is its own
no-proposal cause. Deployed-policy/force-fill disagreement (prereg 5.3,
"NO SELECTION OCCURS") is selection-level only, with no cell-level analog.

### 8.5 Level 5 - SELECTION

Frozen order: **1.** Run `void` -> no selection is meaningful. **2.** Any
ordering disagreement (the winner-only case, section 8.4) OR
deployed-policy/force-fill disagreement -> `no-proposal`, recording every
applicable reason. **3.** No passing cells (after section 8.4's cell-level
rule has already been applied) -> `no-proposal (none passed)`. **4.** One
or more passing cells -> select by the frozen parsimony order (prereg
12.3). **Step 2's winner-only branch is retained for structural
completeness but is provably unreachable under the current,
configuration-only parsimony order**: prereg 12.3's total order is a pure
function of each cell's own configuration (changed constants versus
control, whether a new factor activated, absolute `blendWeight` change, the
fixed cell order) - never of any point estimate or lineup-ordering variant
- so if the passing SET is unchanged between orderings (section 8.4's
cell-level check found no verdict flipped), the winner computed from that
same set is also unchanged by construction. Kept as defense in depth only.

### 8.6 The TWO sealed identity assertions **[rev12, second assertion restored per rejection finding 3]**

**Prereg 7.3 seals TWO identity assertions, not one**, and revision 11
specified only the second of them. Both are restored here, in full, with
their own scope, invocation point, disposition, and tests. **Failure of
EITHER aborts the run** (this document's own substantive amendment
resolving prereg 7.3's ambiguous "Both identity assertions failing aborts
the run" - the stricter "either suffices" reading, carried forward from
earlier revisions and re-affirmed here now that both assertions are
actually specified), producing a Level 1 `void` (section 8.2), never a
Level 2/3 `vetoed` finding.

#### 8.6.0 **[rev12, restored]** The `usage-25 == control` BIT-IDENTITY assertion

**Sealed text (prereg 7.3)**: "**`usage-25 == control` bit-identity**: the
usage-25 x off cell must be bit-identical to the control arm."

**Why it exists**: `usage-25 x off` and the control ARE the same
configuration by construction - the control is defined as `usage-25 x off`,
the shipped `free_baseline_v3.1` (prereg 7.1). Any difference between them
therefore means the HARNESS introduced one (a different code path, a
different seed derivation, a different rounding), never the model. This is
why the sealed requirement is **bit-identity, not the point-identity** the
`homeaway-on-stored` assertion uses: there is no legitimate source of even
a last-digit difference between two runs of literally the same
configuration, so no tolerance is appropriate. `lib/arms.js:213`'s
`assertControlBitIdentity` already implements exactly this comparison
(`canonicalJson(controlRun) !== canonicalJson(usage25OffRun)` -> throw),
committed in Commit A6.

- **[rev13, corrected per rejection finding 1] Comparison rule: BIT-IDENTITY
  via canonical serialization of PER-PROJECTION objects, never of the run
  object as a whole.** `canonicalJson` (`scripts/backtest/lib/snapshotStore.js:98-122`)
  serializes a plain object via `Object.keys(value).sort()`. **`Object.keys`
  on a `Map` returns `[]`** - a Map's entries live in internal slots, not
  own enumerable properties - so `canonicalJson(aMap)` returns the string
  `"{}"`, silently, with no throw. `generateProjections` returns
  `{ projections: Map<playerId, projection>, inputCutoff, sourceCoverage }`
  (`projection.service.js:455-459`), so **naively canonicalizing two whole
  run objects would compare `"{}"` against `"{}"` for the projections and
  report bit-identity for any two runs whatsoever** - a vacuous pass, and
  precisely the failure mode this assertion exists to prevent. The frozen
  procedure instead is:
  1. **Raw-input uniqueness** on both sides (section 8.6.4's pre-Map scan).
  2. **Exact key-set equality and cardinality equality** over the two
     `projections` Maps (section 8.6.4's set-level rules).
  3. **Pair by `playerId`** (never positionally, never by iteration order)
     and compare, for each paired player, `canonicalJson(projectionA)`
     against `canonicalJson(projectionB)` - each individual projection IS a
     plain object, so `canonicalJson` serializes it correctly and
     deterministically (sorted keys, throws on `undefined`/non-finite).
     Byte-equality of these per-projection strings, for every player, is
     what "bit-identical" means here.
  4. **Explicitly named non-Map run fields**, compared separately by their
     own canonical bytes: `inputCutoff` and `sourceCoverage` - both plain
     values/objects that `canonicalJson` handles correctly. No other
     top-level run field is compared, because no other exists on
     `generateProjections`'s return.

  A deterministic sorted Map-to-array serialization (entries sorted by
  `playerId`, emitted as an array of `[key, value]` pairs) would be an
  acceptable alternative to steps 2-3, and Gate 2 MAY implement it that
  way - but if it does, the sort must be explicit and total (numeric
  `playerId` ordering, not insertion order and not lexicographic-on-number),
  and the uniqueness check of step 1 still runs first, since a duplicate
  key would otherwise silently collapse before the array is ever built.
  **What is NOT acceptable is passing a Map to `canonicalJson` directly.**

  **No allowlist applies** to the per-projection comparison - a field
  excluded from the point-identity allowlist as "provenance metadata" (a
  `confidence` label, a `reason` string) is still required to match here,
  because two runs of the identical configuration have no reason to differ
  in it either. Deliberately stricter than section 8.6.4's comparator, per
  the sealed word "bit-identical."

  **Note on the existing helper**: `lib/arms.js:213`'s
  `assertControlBitIdentity` implements
  `canonicalJson(controlRun) !== canonicalJson(usage25OffRun)`. That is
  correct for the shape its own tests exercise (plain per-run summary
  objects), but **it must NOT be handed two `generateProjections` return
  values directly**, for the `Object.keys`-on-Map reason above. Gate 2
  either feeds it already-per-projection objects, or adds the pairing loop
  around it; either way this is a required, named integration constraint,
  not an implementation detail left to discretion.
- **Scope: the full player-week/salt domain**, exactly as for the other
  assertion - every evaluated season-week (2025 weeks 2-18 and 2024 weeks
  2-18, the 34 preregistered season-weeks) x all 24 salts, for the
  `usage-25 x off` cell and the control arm. Never a single illustrative
  player-week or a single salt: a pass on one says nothing about another,
  and the assertion's result is the conjunction over the entire domain.
- **Invocation point: BEFORE any candidate cell's metrics are computed, and
  before the permutation control runs.** Both this assertion and the
  `homeaway-on-stored` one (section 8.6.1) are harness-integrity gates
  whose failure means no downstream number can be trusted; running them
  after computing candidate metrics would burn the full sweep's runtime
  discovering the harness was broken all along. Order within the pre-flight
  block: canaries (prereg 17) -> **the two identity assertions** ->
  permutation control (section 5) -> candidate cells.
- **Disposition on failure: Level 1 `void`, immediately** - the whole
  authoritative run, no cell-level results published, per prereg 7.3 and
  this section's opening.
- **Set-level requirements** (section 8.6.4's player-key-set equality,
  cardinality equality, `playerId`-keyed pairing, duplicate detection
  before any Map-building, and full coverage) **apply to this assertion
  too**, unchanged - bit-identity of two collections is meaningless if one
  collection silently has fewer members than the other.
- **Required mutation tests - SEVEN cases** (each must be CAUGHT, i.e. must
  fail the assertion; **[rev13, count corrected per non-blocking item 1 -
  revision 12 said "five" while listing six, and this revision adds a
  seventh for the Map defect above]**):
  1. a deliberately perturbed `usage.blendWeight` on one side (e.g.
     `0.2500000001`), proving the comparison is genuinely bit-level and not
     tolerance-based;
  2. a differing `hashValue`/seed derivation on one side, proving the seed
     path is part of what is compared;
  3. a single player-week's `median` differing in its last decimal place,
     proving no rounding tolerance sneaks in;
  4. a field differing ONLY in an allowlist-excluded provenance path such
     as `confidence`, proving this assertion (unlike section 8.6.4's) does
     NOT exempt those;
  5. a `playerId` present on one side and absent on the other (the
     set-level check);
  6. a duplicated `playerId` in either side's raw input (the pre-Map
     duplicate check, section 8.6.4);
  7. **[rev13, new] the Map-serialization regression itself**: two runs
     that genuinely DIFFER in a per-projection value must FAIL the
     assertion - written specifically so that an implementation which
     accidentally passed the whole run object (or the raw `projections`
     Map) to `canonicalJson`, and therefore compared `"{}"` against `"{}"`,
     fails this test rather than reporting a vacuous pass.

#### 8.6.1 Scope: the `homeaway-on-stored` assertion names one pair

Prereg 7.3's `homeaway-on-stored == homeaway-on` names the same two arms
the legacy harness defines: `scripts/backtest-weekly-projections.js`'s
`'homeaway-on'` (`withHistory(MODEL, {}, {enabled: true})`) and
`'homeaway-on-stored'` (`withHistory(MODEL, {}, {enabled: true,
useStoredHistory: true})`, `:233-234`) - both built from `MODEL`, the
SHIPPED baseline constants (`usage.blendWeight = 0.25`), differing ONLY in
`homeAway.useStoredHistory` (default `false`, `projectionModel.js:241`, vs
forced `true`). **This is the shipped-usage (usage-25) `on` cell's pair,
specifically.**

**[rev11, corrected per rejection finding 2]** Revision 10 falsely claimed
`useStoredHistory` "is exactly the count `factors.homeAway.games` can
change." **That is wrong and is withdrawn.** `factors.homeAway.games` (and
the factor's `effect`) come from `context.homeAway` - the LEAGUE-WIDE
positional home/away sample built by `buildLeagueContext` from the
CURRENT-SEASON scan only (prereg 11.1) - which has no dependency whatsoever
on `useStoredHistory`. What `useStoredHistory` actually gates is narrower
and unrelated to that field: `buildPriorGames` (`projectionFeatures.js:177-
231`) attaches a per-row `isHome` orientation tag to an individual PLAYER's
PRIOR-SEASON game rows only when `useStoredHistory` (or `crossSeason`) is
true (`:193, 212, 231`); at the DEFAULT (`false`), those rows simply carry
`isHome: null`. **Per the feature builder's own docblock
(`projectionFeatures.js:512`): "This map is read only behind
`homeAway.useStoredHistory`, so today nothing consumes the orientation at
all."** No current code path - not `recentProduction`, not `opponent`, not
`versusOpponent`, not the `homeAway` factor itself (which reads
`context.homeAway`, never a `priorGames` row's `isHome`) - reads this
attached value. **`useStoredHistory` is therefore expected to be a complete
no-op on every published field today**, and the assertion's purpose is
exactly to verify that emptiness against real data, not to test one
specific field it "changes" - there is no field it currently changes at
all, which is the point.

**The sealed, run-voiding assertion applies ONLY to the usage-25 `on`
cell** (`usage-25-on` vs. its `useStoredHistory`-forced twin) - this is the
ONE comparison whose failure can `void` the authoritative run. **The other
three usage levels' analogous pairs (`usage-00-on`, `usage-40-on`,
`usage-60-on`, each against its own `useStoredHistory`-forced twin) are NOT
part of the sealed assertion.** They MAY be computed as an OPTIONAL,
additional diagnostic - checking whether the same inertness holds at every
usage level - but adopting it is its own substantive prospective amendment
requiring its own explicit approval, and is **descriptive only if
adopted: a failure on one of the three optional pairs never voids the
run** (only the sealed usage-25 pair's failure does). **[rev10, per
non-blocking item 1]**: **the optional three-usage-level diagnostic is
NOT ADOPTED in this document** - recorded plainly, rather than left as
conditionally pending, since no user decision to adopt it has been made;
adopting it later would itself be a labeled amendment requiring its own
approval at that time.

Before comparing outputs, assert the two arms' resolved constants differ
in EXACTLY the `homeAway.useStoredHistory` leaf and nothing else (analogous
to `assertSaltAffectsOnlyHashValue` proving a salt varies only
`hashValue`), so a bug in constructing the "on-stored" variant is caught
structurally, not just by the numeric comparison downstream. Gate 2 must
add a dedicated constants builder for this variant - `lib/arms.js`'s
`resolveConstants` today touches only `usage.blendWeight` and
`homeAway.enabled`, and does not build this third variant - informed by,
not copied from, the legacy harness's `withHistory` pattern.

#### 8.6.2 **[rev10, completed per rejection finding 2]** The complete fresh-vs-fresh allowlist

Neither arm in the "on"/"on-stored" comparison ever touches the database
cache - both are freshly computed through the same sweep pipeline directly
via `projectPlayer`. **The full allowlist, every numeric/nullable path
verified against `projectPlayer`'s actual return shape and the factor
functions it assembles from:**

- **Top level**: `mean`, `median`, `p10`, `p25`, `p75`, `p90`,
  `activeProbability`, `sampleSize`, `effectiveGames` (`:1027`, `:1156` -
  included here, unlike the cache-compatible allowlist, since neither side
  touches persistence).
- **`factors.recentProduction`**: `perGame`, `pointsContribution`,
  `effectiveGames` (`:1070`), **`games`** (`:1069`, `baseline.sampleSize` -
  **[rev10, added]** omitted in error from every prior revision's
  allowlist), and, present only when `usageBlendWeight > 0` for the cell:
  `pointsBaselinePerGame`, `opportunityValue`, `expectedOpportunities`,
  `opportunityEfficiency`, `usageGames`, `usageBlendWeight`.
- **`factors.opponent`**: `effect` (always finite, via `NEUTRAL`'s own
  `effect: 0` fallback, `:596`), `pointsContribution` (always present, set
  generically by `applyFactor`), and **[rev10, added]** `games` (present
  once the sample clears `constants.opponent.minGames`;
  `NEUTRAL('insufficient opponent sample', {..., games: observedGames})`
  carries it too, `:621`; absent only in the "no opponent data" neutral
  branch, consistently on both arms since neither `usage.blendWeight` nor
  `homeAway.useStoredHistory` affects opponent data availability),
  **`allowedPerGame`**, and **`leagueAveragePerGame`** (`games` again,
  `allowedPerGame`, `leagueAveragePerGame` at `:632-634`, present only in
  the `available: true` branch, round2-rounded - consistently present or
  absent together on both arms for the same reason).
- **`factors.versusOpponent`**: `effect`, `pointsContribution`, and
  **[rev10, added]** `meetings` (`:666`, `usable.length` - present in
  every branch including both `NEUTRAL` fallbacks, `:651`, `:661`) and
  `observedDeviation` (`:667`, present only in the `available: true`
  branch, round2-rounded).
- **`factors.homeAway`**: `effect`, `pointsContribution`, `games` (`:710`,
  `totalGames`, present only in the `available: true` branch - sourced
  from the current-season league context, per the correction above, NOT
  from anything `useStoredHistory` touches), and **[rev11, added]**
  `homeGames` and `awayGames` (`:696-697`, present only in the
  `'insufficient home/away sample'` NEUTRAL branch - `homeGames`/`games`
  are mutually exclusive in practice, since they come from different
  return branches of the same function; both arms reach the same branch
  consistently, since neither `usage.blendWeight` nor
  `homeAway.useStoredHistory` affects which branch `homeAwayEffect` takes).
- **`factors.weather`**: `effect`, `pointsContribution`, and the numeric
  forecast measurements `temperatureF`, `windSpeedMph`, `windGustMph`, and
  `precipitationProbability` (all `:729-732`, `isNum(...) ?
  Number(...) : null` - each independently nullable; `scored` (boolean),
  `roof`, `shortForecast`, `forecastTime` (strings) remain excluded,
  non-numeric).
- **[rev11, added per rejection finding 1] `factors.availability`**:
  `activeProbability` (`availabilityFor`, `projectionModel.js:754-786` -
  present as a key in EVERY branch: `0` on bye/out/IR, `null` when
  doubtful/questionable, `1` or a computed value otherwise). This is a
  distinct path from the top-level `activeProbability` (which is assigned
  FROM this same nested value, `availabilityInfo.activeProbability`, at the
  point `projectPlayer` builds its return object) - included here for
  completeness of "every numeric/nullable published path," even though a
  divergence at this nested path would, by construction, already have
  shown up at the top-level path too.
- **[rev11, added per rejection finding 1] `factors.role.pointsContribution`**
  (`projectionModel.js:1128-1130`: `factors.role = hasRoleData ?
  {available: true, pointsContribution: null, note: '...'} : null` -
  ALWAYS `null` when `factors.role` itself is non-null; the path is
  included for completeness since it is a genuine numeric/nullable
  published path, even though its value never varies).

**Still explicitly EXCLUDED** (provenance/cache/label metadata, never
numeric point values): `confidence`, `confidenceReasons`, `unavailableReason`,
`dataQuality.*`, `residualSource`, `opponentTeam`, `isHome`, `scored`,
`roof`, `shortForecast`, `forecastTime`, `availability.reason`,
`availability.status`, `availability.autoRecommend`, `availability.locked`,
`availability.lockedSlot`, `role.available`, `role.note`, any run/cache
bookkeeping field, `sourceCoverage`/`inputCutoff`-style run-level
descriptors.

#### 8.6.3 **[rev10, frozen independently per rejection finding 2's non-blocking note]** The cache-compatible allowlist, frozen on its own terms

**The cache-compatible allowlist (for the SEPARATE, descriptive-only
cache-persistence QA check, section 8.6.5, ONLY) is frozen directly against
`loadCachedRows`'s own mapped shape (`projection.service.js:478-497`), not
derived as "the fresh list minus one field."** Deriving it by subtraction
risks silently propagating a future addition to the fresh list (a field
this document has not yet traced through the cache path) into the cache
allowlist without ever separately verifying it round-trips. Frozen
directly:

- **Top level**: `mean`, `median`, `p10`, `p25`, `p75`, `p90`,
  `activeProbability`, `sampleSize` - each verified present, under the same
  name, in `loadCachedRows`'s row-mapping (`:483-495`). **`effectiveGames`
  is NOT in this list**: `saveProjections`'s INSERT column list
  (`PROJECTION_COLUMNS` block) has no `effective_games` column, and
  `loadCachedRows`'s SELECT/mapping never produces the key.
- **`factors.*`**: every nested leaf listed in section 8.6.2 IS included
  here too, since the whole `factors` object round-trips through the
  `factors` JSONB column (`JSON.stringify(p.factors || {})` on write,
  `row.factors || {}` on read) with no per-field schema to drop anything
  from. **Enumerated explicitly rather than by cross-reference, per
  rejection finding (non-blocking)**: `factors.recentProduction`'s
  `perGame`, `pointsContribution`, `effectiveGames`, `games`, and the
  usage-conditional `pointsBaselinePerGame`, `opportunityValue`,
  `expectedOpportunities`, `opportunityEfficiency`, `usageGames`,
  `usageBlendWeight`; `factors.opponent`'s `effect`, `pointsContribution`,
  `games`, `allowedPerGame`, `leagueAveragePerGame`;
  `factors.versusOpponent`'s `effect`, `pointsContribution`, `meetings`,
  `observedDeviation`; `factors.homeAway`'s `effect`, `pointsContribution`,
  `games`, `homeGames`, `awayGames`; `factors.weather`'s `effect`,
  `pointsContribution`, `temperatureF`, `windSpeedMph`, `windGustMph`,
  `precipitationProbability`; **`factors.availability.activeProbability`**;
  and **`factors.role.pointsContribution`** - the last two named
  explicitly here because revision 11 added them to the fresh-vs-fresh
  allowlist but left them only implicitly covered by a cross-reference on
  this side. **The ONLY field this allowlist excludes relative to the
  fresh-vs-fresh one is the TOP-LEVEL `effectiveGames` duplicate**
  (the nested `factors.recentProduction.effectiveGames` IS present on both
  sides), confirmed independently against `loadCachedRows`'s own code, not
  inferred by subtraction.

#### 8.6.4 **[rev11, restored in full per rejection findings 3 and 5]** Comparator semantics, and duplicate handling BEFORE either side becomes a Map

**Field-level comparator, over the extracted flat map of allowlisted paths
only (section 8.6.2/8.6.3), never the whole object. [rev12, per rejection
finding 2] The steps run in THIS ORDER, and step 2's per-value validation
runs INDEPENDENTLY ON EACH SIDE before the two sides are ever compared to
each other:**

1. **Own-property presence, per side**: for each allowlisted path,
   determine presence independently on each side with
   `Object.prototype.hasOwnProperty.call(obj, path)` - never
   bracket-access-returns-undefined, never `path in obj` (which would also
   match prototype-inherited properties). Record each side's presence as
   its own boolean; do not yet compare them.
2. **[rev12, moved BEFORE the comparison and made ONE-SIDED] Per-value
   type and finiteness validation, independently on each side.** For EACH
   side, independently: if that side reports the path as PRESENT (step 1),
   its value must be either exactly `null` or a finite number. **Anything
   else - `NaN`, `Infinity`, `-Infinity`, a string, a boolean, an object,
   an array, or `undefined`-while-own-property-present - is a HARD ERROR
   for THAT SIDE, raised immediately, regardless of what the other side
   holds at the same path and regardless of whether the other side even
   has the path.** This ordering is the correction: revision 11 required
   both sides to be present before validating either, which meant a
   one-sided `NaN` (or string, or object) sitting opposite a genuinely
   MISSING path on the other side would fall through to step 3 and be
   reported as an ordinary "missing on exactly one side" mismatch - a
   materially weaker, wrong-category finding, when what actually happened
   is that a published numeric path holds a non-numeric value. The
   allowlist is defined to contain only numeric/nullable paths, so a
   violation is a structural defect in the extractor, the object shape, or
   (for the cache path) the persistence round trip - independent of any
   comparison.
3. **Three states per path, not two** (only reached once step 2 has passed
   on BOTH sides, so every present value is now known to be `null` or a
   finite number): (a) missing on BOTH sides -> equal, no difference
   recorded; (b) missing on EXACTLY ONE side -> **difference**, recorded
   and reported, never silently skipped; (c) present on both, and exactly
   one is `null` -> **difference** (a `null` opposite a finite number);
   `null` on both -> equal.
4. **`roundToTie` (ten-decimal, prereg 6.6) equality** for a path present as
   a finite number on BOTH sides - a genuine tie at ten decimal places is
   equality, not a difference, and this is the ONLY numeric comparison rule
   for the point-identity assertion; no other tolerance or rounding
   convention is ever substituted for it. (The `usage-25 == control`
   assertion, section 8.6.0, does not use this comparator at all - it
   requires byte-equal canonical serialization, with no tolerance.)

**Set-level requirements, checked BEFORE any field-level comparison runs**
(field comparison over only the intersection of two collections, silently
skipping rows present on one side and not the other, does not satisfy
"point-identical outputs," prereg 7.3):

- **Exact player-key-set equality**: the set of `playerId` keys in the two
  collections being compared must be IDENTICAL - same members, not merely
  the same count. A `playerId` present in one and absent from the other is
  itself a hard identity failure, reported before any per-field comparison.
- **Cardinality equality**, checked independently of set equality (a
  defense against a bug where a missing playerId on one side happens to be
  offset by an extra, different playerId on the other).
- **`playerId`-keyed pairing, never positional**: every comparison is keyed
  by the `playerId` itself, never by array index or insertion order.
- **[rev12, corrected per rejection finding 1] Duplicate detection inspects
  the RAW INPUT - the raw `playerIds` array, or the raw SQL result rows -
  BEFORE any Map-building loop runs, on BOTH sides of EVERY comparison
  this document defines.** Revision 11 specified comparing a raw list's
  length against the ALREADY-BUILT Map's size, which is **too late**: by
  the time the Map exists, the last-wins reduction has already silently
  discarded the duplicate, so the length-vs-size comparison is inferring a
  loss after the fact rather than preventing it - and any code path that
  builds the Map without also being handed the raw list (or that rebuilds
  it later) loses even that inference. **Corrected: the check is a direct
  scan of the raw input for repeated keys, performed and passed BEFORE the
  reduction is allowed to proceed at all.** Concretely:
  - the **cache-read side** (`loadCachedRows`, `projection.service.js:478-
    497`): scan `result.rows` for repeated `row.player_id` values BEFORE
    the `for (const row of result.rows) { byPlayer.set(...) }` loop
    executes - `byPlayer.set(row.player_id, ...)` would otherwise silently
    keep only the last SQL row for a duplicate `(run_id, player_id)`, a
    real risk if the underlying table ever violated its own data integrity.
    Hard error on any repeat, before the Map is populated.
  - the **fresh-computed sides, for BOTH sealed assertions** - the
    `usage-25 x off` and control arms (section 8.6.0) AND the "on"/
    "on-stored" arms (section 8.6.1): scan each arm's own raw input
    `playerIds` array for repeated ids BEFORE `generateProjections`'s
    per-player loop (`projection.service.js:449`,
    `projections.set(playerId, ...)`) runs. That loop has the identical
    structural blind spot - a repeated id means two `projectFromBundle`
    calls for the same player, the second silently overwriting the first,
    with no visibility that the input itself was malformed. Hard error on
    any repeat, before any projection is computed.
  - **In both cases the verification code performs its own scan rather
    than relying on production's `Map.set` behavior**, which is
    (correctly, for its own purposes) unguarded for this concern.
- **Coverage of every relevant player-week and salt**: the assertion runs
  over the FULL set of player-weeks the sweep's cell actually touches for
  the season(s) in scope, across every salt the "computed" side is
  exercised under - never a single illustrative example. A pass on one
  player-week says nothing about another; the result is the conjunction
  over the entire set.

#### 8.6.5 Cache-persistence QA: descriptive-only, outside the sweep's critical path

**Frozen disposition: descriptive-only. A cache-persistence QA finding
never voids the run.** The authoritative sweep executes from a clean
detached worktree, credential-cleared, inside `docker run --network none`
(prereg 17); every `generateProjections` call it makes is wired against a
reconstruction/snapshot client (`snapshotClient.js`), never
`findRun`/`loadCachedRows`/`saveProjections`/`upsertRun` - verified by
grepping the sweep-adjacent tree (`snapshotClient.js`,
`run-backtest-mde.js`, `run-backtest-extraction.js`) for those four
function names, with zero matches. The cache-persistence question (does
top-level `effectiveGames` survive a production cache round trip; can
`loadCachedRows`'s `byPlayer.set(row.player_id, ...)`, `:478-497`, silently
last-win on a duplicate SQL row) is a real, useful finding about PRODUCTION
code quality, but the sweep's own execution path never exercises a live
cache at all. Reported as a labeled "cache-persistence fidelity
(additional, descriptive, production-code finding - not exercised by the
sweep)" footnote in Gate 3's verification output, never as a run-voiding
gate, and never conflated with the sealed usage-25 assertion (section
8.6.1) or its optional, not-adopted diagnostic.

**Required tests, complete set**: the single-leaf-difference guard for the
usage-25 pair; the full fresh-vs-fresh field-level (section 8.6.2) and
set-level comparison (exact player-key-set equality; independent
cardinality equality; `playerId`-keyed, never positional, pairing;
**[rev13, corrected per non-blocking item 2]** raw-input duplicate
rejection **on every input the comparison touches, not only the cache
path**: (i) each FRESH arm's own raw `playerIds` array - for all four arms
this document defines (the `usage-25 x off` cell and the independently
generated control arm, section 8.6.0; the `on` and `on-stored` arms,
section 8.6.1) - scanned before `generateProjections`'s per-player loop
runs; and (ii) the raw SQL rows on the cache-read path
(`loadCachedRows`), scanned before its `byPlayer.set` loop. Revision 12's
summary named only the `loadCachedRows` risk, which understated the
requirement its own section 8.6.4 already states in full. Plus full
coverage of every relevant player-week and salt, never a single
illustrative example. Both sealed assertions are run-voiding on failure;
the cache-persistence fidelity checks (section 8.6.3's allowlist) are
descriptive-only, labeled outside the sweep's critical path.

---

## 9. Scale statement

**[rev13, corrected per rejection finding 2 - revision 12 understated this
by omitting the control-path arm entirely.]**

- **Primary grid: `8 x 24 x 34 = 6,528`** salted cell-week runs - the
  eight reported factorial cells only, no identity-assertion arms.
- **`homeaway-on-stored` twin (section 8.6.1): `24 x 34 = 816`** further
  salted arm-week generations, always computed.
- **Control-path arm for the `usage-25 == control` assertion (section
  8.6.0): `24 x 34 = 816`** further salted arm-week generations. **This
  was omitted from revision 12's disclosure.** The assertion compares the
  `usage-25 x off` CELL (already inside the 6,528 grid) against the CONTROL
  ARM, and the whole point of the assertion is that the control is
  generated through its own independent path - if the sweep simply reused
  the `usage-25 x off` cell's own output as "the control," the comparison
  would be an object against itself, trivially bit-identical, and would
  prove nothing about the harness. **So the control must be independently
  generated, and that generation is 816 runs the primary grid does not
  already contain.**
- **Total, as this document currently stands: `6,528 + 816 + 816 =
  8,160`** salted arm-week generations.
- **The one way this drops back to `7,344`**: if Gate 2 establishes an
  independent control path that is ALREADY counted elsewhere in the
  pipeline (for example, if the control arm the sweep generates for the
  permutation control, section 5, is the same independently-generated
  artifact this assertion consumes) **and explicitly documents that
  reuse**. That reuse is permitted, but it must be stated and justified in
  Gate 2's own code and in the published report - never assumed silently,
  since an unstated reuse is indistinguishable from the
  compare-an-object-to-itself degeneracy described above.
- **Optional three-usage-level diagnostic (section 8.6.1), NOT ADOPTED**:
  would add a further `3 x 24 x 34 = 2,448` on top of whichever total
  above applies.

---

## 10. Approval record

| approval | status | date | notes |
| --- | --- | --- | --- |
| Independent statistical review of revision 2 | **REJECTED** | | SHA-256 `49DE398789B2690172B147DBEFE36AFD7248BAA0C902AFD590E76604C0144B04` |
| Independent statistical review of revision 3 | **REJECTED** | | SHA-256 `D308B40CDD7DD71773D565A41407437031FC63E5D34678FC66C71DC7160D0306` |
| Independent statistical review of revision 4 | **REJECTED** | | SHA-256 `05167E2800A3B6F78B8111DCA1957BCCFA4E8CADF52E782318B57454FA5F95A3` |
| Independent statistical review of revision 5 | **REJECTED** | | SHA-256 `F443115DB34A6B6A16816C307ADD87B36790A364A5800ABD2D470391AC0BB5B9` |
| Independent statistical review of revision 6 | **REJECTED** | | SHA-256 `2F94C6D903E7C639B620293E7C0931336C6AE15DBF841FFA7B6D3D7A0C1AA4CE` |
| Independent statistical review of revision 7 | **REJECTED** | | SHA-256 `5F1151F5339F9DCF8735979E035DD75E09999280501C65BAD6F74F68F4DEFF56` |
| Independent statistical review of revision 8 | **REJECTED** | | SHA-256 `A23F6F9AD2C15FF71AB46CE57BD4913ADD7540329F488D6689E6B00A0AF16B4A` |
| Independent statistical review of revision 9 | **REJECTED** | | SHA-256 `D59F0B5B0E5291F0812B7D4D99BDB1706D61BF5F21608E644CB436A7D0028E21`; 3 corrections + 2 non-blocking items -> addressed as revision 10 |
| Independent statistical review of revision 10 | **REJECTED** | | SHA-256 `C6F8BCF78C120C96F0CEAC8255A9C1CEF14045D3E46A050B67642F460A84F489`; 5 corrections + 1 non-blocking item -> addressed as revision 11. Accepted: amendment classification, usage-25 scope, optional-diagnostic decision, descriptive cache-QA status, salt/permutation/rounding/callback rules, signed reducer, compute disclosure |
| Independent statistical review of revision 11 | **REJECTED** | | SHA-256 `C28069D2EEDD6BEBB4CC761C515535B01A0568F89F0005E9B9BD696B9C792D28`; 3 corrections + 2 non-blocking items -> addressed as revision 12. Accepted: fresh allowlist, stored-history semantics, activation definition, Level-5 review coverage, optional-diagnostic disposition, amendment wording |
| Independent statistical review of revision 12 | **REJECTED** | | SHA-256 `90FC020E11E27B4CA41E5F3B82F704AF8DFD142FC92012840F0FED9BD5BA1126`; 2 corrections + 2 non-blocking items -> addressed as revision 13. Accepted: raw-input uniqueness timing, independent per-side validation, missing/null/undefined handling, homeaway identity, cache allowlist, cross-references, void dispositions, activation, approval wording |
| **User sign-off on S3 deviation** (section 7) | **APPROVED** | 2026-08-02 | "I approve treating S3 as structurally non-estimable under the frozen active-only cohort, publishing no S3 estimate, and disclosing it as a prospective deviation from preregistration §4.2." |
| **User approval of remainder** | **APPROVED** | 2026-08-02 | "I approve all remaining provisions in Revision 13, SHA-256 `25DFFCEC77EB5DFE17150020C04465B546F0584919916FD686CCFE77FA17258F`." Scope of authorization: Gate 2 IMPLEMENTATION only - does NOT authorize candidate-cell execution, which remains separately gated on the independent implementation review below. |
| **Independent statistical review of revision 13** | **APPROVED** | 2026-08-02 | SHA-256 `25DFFCEC77EB5DFE17150020C04465B546F0584919916FD686CCFE77FA17258F`; scope: sections 3-8 |
| **Independent implementation review** | **pending, strictly last, after Gate 2 code exists** | | scope, complete: the runtime salt-collision guard and its two-level unit/runtime split (section 3.4); the exact-trigger implementation defects, including the (f) no-finite-bound amendment label (section 4.4); the restored permutation-control definitions and aggregation (section 5); the rounding-boundary mutation tests and ten-decimal boundary normalization (section 6.1-6.2); the callback's per-receiver validation, exactly-once invocation, and exception propagation (section 6.5); the S3 non-estimable disclosure (section 7); the signed-boundary table and the exhaustive endpoint/component/cell/run truth table, including the (f)-unevaluable unification (sections 8.1-8.2); **activation's exact numerator/denominator (available && effect!==0, per-position including DEF, over eligible/non-neutral/known-orientation projections) and its precedence against `fail` (section 8.3)**; the restored cell-level ordering-inconclusive behavior and **Level-5 selection precedence, including the provably-unreachable winner-only branch (sections 8.4-8.5)**; **BOTH sealed identity assertions - the `usage-25 == control` bit-identity assertion (section 8.6.0: the Map-safe per-projection canonical-byte comparison and its named prohibition on passing a `Map` to `canonicalJson`, byte-equality with no allowlist and no tolerance, the explicitly-named non-Map run fields, its full player-week/salt scope, its pre-flight invocation point before the permutation control, its run-void disposition, and its seven mutation tests including the Map-serialization regression) and the `homeaway-on-stored` point-identity assertion** (section 8.6.1: its usage-25-only scope, the corrected `useStoredHistory` mechanism explanation, its single-leaf-difference guard), the complete fresh-vs-fresh allowlist (including `homeGames`/`awayGames`, `availability.activeProbability`, `role.pointsContribution`), the independently-frozen and explicitly-enumerated cache-compatible allowlist, **the ordered field-level comparator semantics with per-side type/finiteness validation running BEFORE any cross-side comparison, and raw-input duplicate detection running BEFORE any Map-building loop on both sides of every comparison**, and the descriptive-only cache-QA disposition (section 8.6) |

No candidate cell may be computed while any item above remains unresolved.

---

## 11. Reviewer packet

### 11.1 Honesty caveat

The correction summaries in this document are author-written, not an
attached verbatim transcript of any reviewer's original message; SHA-256
values in the table above record hashes the reviewer stated in
conversation, not hashes independently recomputed against an attached
artifact.

### 11.2 Itemized correction summary (author-written)

Ten rounds, summarized: salt derivation and CRN framing; the exact-trigger
AND rule and its four implementation defects, the fourth of which (the
no-finite-bound-for-(f) cell-status mapping) is labeled a substantive
amendment as of this revision rather than an unlabeled default; the
permutation control's absolute-performance statistics, restored twice after
being compressed away and then corrected in wording; component (f)'s
rounding correction (0.30 substantive, 3.80 mechanical), veto redesign, and
callback contract (validated at all three public receivers, exceptions
never swallowed); S3 settled as a labeled, non-estimable prospective
deviation; the status taxonomy completed into an exhaustive truth table
with a boundary rule corrected to distinguish superiority from
noninferiority endpoints, and every one of component (f)'s three
unevaluable causes now uniformly mapped to cell `inconclusive`; ordering
sensitivity restored to its sealed cell-level effect, explicitly subject to
the same `vetoed > fail > inconclusive > pass` precedence as everything
else; the identity assertion corrected from a cache-round-trip concept to a
two-model-arm (`useStoredHistory`) concept, then rescoped to the sealed
usage-25 pair specifically (with the other three usage levels demoted to a
NOT-ADOPTED optional diagnostic), then given its own complete allowlist
(including previously-missing recentProduction/opponent/versusOpponent/
homeAway/weather numeric fields) independently frozen from the
separately-frozen cache-compatible allowlist; the cache-persistence check
itself frozen as descriptive-only, verified outside the sweep's own
execution path by grep; the scale statement's disclosure covering the
identity-assertion arms; a complete restoration of every section's full
operative text after a prior revision's compressed "(unchanged)" summaries
were found to have silently dropped binding detail; and, this round
(eleven): the fresh-vs-fresh and cache-compatible allowlists both completed
with four previously-missing numeric/nullable paths
(`factors.homeAway.homeGames`/`awayGames`, `factors.availability.
activeProbability`, `factors.role.pointsContribution`); a false claim that
`useStoredHistory` changes `factors.homeAway.games` withdrawn and replaced
with the mechanism the flag actually gates (an unconsumed per-row
orientation tag inside `buildPriorGames`, per the feature builder's own
"nothing consumes the orientation" docblock); the full field-level
comparator semantics (own-property presence, three-state missing/null
handling, numeric-type/finiteness hard errors, `roundToTie` equality)
restored in full; duplicate detection generalized to run BEFORE either side
becomes a Map, on both sides of every comparison this document defines, not
only the cache-read side; activation's exact numerator/denominator
restored; and the "is therefore approved" wording on the (f) no-finite-bound
amendment corrected to "submitted for approval," since no approval has
actually been recorded yet. **This round (twelve)**: the SECOND sealed
identity assertion - `usage-25 == control` bit-identity (prereg 7.3),
already implemented as `assertControlBitIdentity` (`lib/arms.js:213`) but
entirely unspecified in this document through revision 11 - restored in
full with its own canonical-serialization comparison rule (no allowlist, no
tolerance, deliberately stricter than the point-identity comparator), full
player-week/salt scope, pre-flight invocation point, run-void disposition,
and five mutation tests; per-value type/finiteness validation moved BEFORE
any cross-side comparison and made one-sided, so a lone `NaN`/string/object
opposite a missing path hard-errors instead of degrading into an ordinary
missing-path mismatch; duplicate detection moved to a direct scan of the
RAW `playerIds` array and RAW SQL rows before any Map-building loop, rather
than a length-vs-size inference drawn after the last-wins reduction has
already discarded the evidence; the cache allowlist's `availability.
activeProbability` and `role.pointsContribution` enumerated explicitly
instead of by cross-reference; and two stale section cross-references
corrected. **This round (thirteen)**: the bit-identity comparison made
Map-safe - `canonicalJson` serializes a `Map` to the literal string `"{}"`
(its `Object.keys(value)` returns `[]` for a Map, silently, with no throw),
so revision 12's "canonicalize the two run objects" rule would have
compared `"{}"` against `"{}"` and reported a vacuous pass for ANY two
runs; replaced with uniqueness -> exact key-set equality -> pair by
`playerId` -> per-projection canonical-byte comparison, plus the explicitly
named non-Map run fields (`inputCutoff`, `sourceCoverage`), with a
deterministic sorted Map-to-array serialization allowed as an alternative
and a named integration constraint that `assertControlBitIdentity` must
never be handed two `generateProjections` returns directly; a seventh
mutation test added to catch exactly that regression; the compute
disclosure corrected from `7,344` to `8,160` by counting the independently
generated control-path arm the assertion requires (816 runs revision 12
omitted), with the one documented condition under which reuse could return
it to `7,344`; the mutation-case count corrected (six listed under a
"five" label, now seven listed under "seven"); and the duplicate-risk test
summary widened from `loadCachedRows` alone to all four fresh arms' raw
`playerIds` inputs plus the cache rows.

### 11.3 Packet contents

- **`PREREGISTRATION.md` sections**: 1.1 (fetcher contract), 3.1 (roster
  status -> cohort class), 4.1-4.2 (cohort and injury policy), 4.3
  (outcome truth), 5.2-5.3 (regret estimands), 6.3, 6.6-6.7 (metric
  conventions and contrast construction), 7.3 (arms/benchmarks/controls),
  8.1-8.3 (salts and seeds), 9.1-9.7 (the IUT and components (a)-(e2)),
  9.8 (component (f) in full), 10.1-10.6 (the CI contract), 11.1-11.2
  (factor-activation mechanism and thresholds), 12.3 (parsimony total
  order), 16-17 (sensitivities, freeze/reproduction mechanics).
- **Code**: `scripts/backtest/lib/arms.js` (all cited functions;
  `resolveConstants` does not yet build the `useStoredHistory`-forced
  variant), `scripts/backtest/lib/metrics.js` (`SALTS`, `saltPairedDelta`,
  `buildBootstrapResamples`), `scripts/backtest/lib/numbers.js`
  (`isFiniteNumber`, `roundToTie`), `server/services/projectionModel.js`
  (`projectPlayer`, `scoringHash`, `seedFrom`, `mulberry32`,
  `simulateDistribution`, `NEUTRAL`, `opponentEffect`,
  `versusOpponentEffect`, `homeAwayEffect`, `weatherEffect`; the
  `effectiveGames` locators `:1027`, `:1070`, `:1156`; the
  `useStoredHistory` default at `:241`; the median-rounding line `:884`),
  `server/services/projectionFeatures.js` (`:177-231`'s `useStoredHistory`/
  `crossSeason` gating), `server/services/projection.service.js`
  (`projectFromBundle`, `findRun`, `loadCachedRows`, `upsertRun`,
  `saveProjections`), `scripts/backtest-weekly-projections.js`
  (`withHistory`, `:210-234`), `scripts/backtest/lib/snapshotClient.js`
  (confirms the sweep never touches the live cache), `scripts/backtest/lib/asOfView.js`,
  `scripts/backtest/lib/cohort.js`.
- This document, in full.
- Scheduled: the independent implementation review.
