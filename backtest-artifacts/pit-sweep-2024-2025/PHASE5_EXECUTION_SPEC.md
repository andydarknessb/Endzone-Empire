# PHASE5_EXECUTION_SPEC.md - Phase 5 execution addendum

Study id: `pit-sweep-2024-2025` (same study as `PREREGISTRATION.md`).

**Status: revision 20. NO APPROVALS ARE IN FORCE FOR THESE BYTES.**

Revision 18 (SHA-256 `5A0D6E54B2D84494C5D39093C44204A79F32A4DD813F03909C1094339A52BCF8`)
**was approved** - ledger rows 4, 5, and 6 - and Gate 2 implementation
proceeded under row 6. Revision 19 superseded those bytes and revision 20
supersedes revision 19's, **so those three approvals attach to neither and
must be re-issued against the hash of the current anchor**, exactly as
corrective entry 1 requires. Until they are, nothing is authorized - not
candidate execution, and not further Gate 2 implementation work.

**Revision 19 accumulated no approvals**, so nothing lapsed when revision 20
superseded it. Revision 19 was anchored at commit
`9759a64f4d39cf170cf449f3e2635942e425646d` (SHA-256 `16F29146...`), and
revision 20 changes ONLY the preamble narrative below and section 10's
record of it. **The normative bodies of sections 4.6 and 8.7 are carried
over byte-identically**, which is checkable in one diff against that commit.

**Approvals are recorded EXTERNALLY, in `APPROVAL_LEDGER.md` - never in
this file.** Revisions 1-13 recorded approvals in this document's own
section 10, which changed the approved bytes and so invalidated every hash
an approver had authenticated. That practice is discontinued. Section 10
below is retained as a HISTORICAL RECORD of the review rounds only; it
confers no authority, and the ledger is the sole authoritative record.

**The revision-13 approval chain is broken and was not repaired.** The
independent statistical review of revision 13 authenticated SHA-256
`25DFFCEC77EB5DFE17150020C04465B546F0584919916FD686CCFE77FA17258F`; those
bytes were then overwritten by edits recording the approvals themselves,
and no copy survives (the file was untracked at the time). Revision 13's
successor blob (`0661eafc95...`, committed as an immutable anchor) was
submitted for fresh independent statistical review and **REJECTED** on four
blockers. Revision 14 was that rejection's response; it was itself rejected,
as was revision 15. **The current revision is 20**, and the full chain is
recorded below and in `APPROVAL_LEDGER.md`.

**Revision 14 was also REJECTED**, on five blockers, at blob
`ee6800ecdb4484f5cc599ef6a67c1a77fc9f1068` (SHA-256 `49620ec2...`).
**Revision 15 was also REJECTED**, on two substantive blockers plus
documentary corrections, at blob `4f5f21a8bbb8b95c432816311f27bd1a7c2e6937`
(SHA-256 `e507d0c4...`). Revision 16 was the response to that rejection;
it too was REJECTED, on two blockers, at SHA-256 `8bd263cd...`.
Revision 17 was the response to that rejection; it too was REJECTED, on a
single blocker, at SHA-256 `f7d6b31f...`. **Revision 18 was the response to
THAT rejection**: section 3.2 now carries the literal pinned composition
vector (revision 17 promised one but supplied no literals, so the required
test had nothing to assert against); section 4.5 is renamed "Applies to
every bootstrap inequality", since it governs components (a)-(e1) as well
as the thirteen (e2) rows; and a duplicated revision-16 heading plus a
dangling sentence fragment in the preamble - both introduced by revision
17's own splice - are removed. **Revision 18 was APPROVED** (ledger rows
4-6, 2026-08-03).

**What revisions 19 and 20 add.** Neither is a response to a rejection of
this document. Revision 19 responded to two conformance defects found in the
Gate 2 implementation built under row 6, both in
`scripts/backtest/lib/sweepEvidence.js`. **Each defect has a core that the
sealed text already covered plainly, and an edge where the sealed text was
silent; only the silences required a spec revision rather than only a code
fix:**

- **Section 8.7 (new)** fixes the **scoring-profile axis of the descriptive
  publication**. Prereg 4.3 names the primary and 12.1/12.2/10.6 name no
  profile, so those families inherit it; what no sealed section states is
  how far prereg 16's additional descriptive reporting extends, or whether
  activation carries a profile axis at all. The implementation's use of
  `standard` as the primary contradicted 4.3 outright. 8.7 states the
  resolution.
- **Section 4.6 (new)** fixes the **interval method for the descriptive
  families**. The implementation published a two-sided 95 percent normal
  approximation (`point +/- 1.96 * sqrt(s^2/n)`), while prereg 10.1 fixes a
  percentile cluster bootstrap at exactly 100,000 draws, seed 1499811874.
  For the paired deltas and the 12.2 composites, 10.1 covers this plainly,
  since those are deltas; the implementation simply did not apply it. The
  silence was the absolute metrics, which are not deltas. 4.6 closes that
  and states the method for all of them.

**Revision 20 corrects this preamble and section 10, and nothing else.**
Revision 19's preamble asserted in four places that both defects were
"traceable to silences" in this document. That claim does not hold and
overstated the specification's share of the fault: prereg 4.3 names
`half_ppr` the formal primary in plain text, and prereg 10.1's percentile
rule plainly reaches every delta-valued descriptive family. The bullets
above are the corrected account. **The normative bodies of sections 4.6 and
8.7 always stated their scope correctly** - 4.6 says "Nothing in the sealed
text says what interval an absolute metric carries," and 8.7 says "This
document states that resolution below; it does not claim the sealed sections
already state it jointly" - so revision 20 changes no ruling, only the
narrative that described them.

Neither section changes any component verdict, any cell status, any run
status, or the selection. Both change what is PUBLISHED and how it is
computed, which is why both are labeled substantive rather than mechanical:
by section 0's own test, the stakes decide the label, not the determinism of
the arithmetic.

**What revision 17 added:**

- **Sections 1, 4.4, 7, preamble - all operative current-state language is
  now revision 17, and EVERY approval question routes exclusively to
  `APPROVAL_LEDGER.md`.** Revision 16 still described revision 14 as
  current in two places, and still pointed two approval questions (the (f)
  no-finite-bound amendment, and the S3 user sign-off) at the historical
  section 10 - which the same document declares non-authoritative. Both
  routings are corrected.
- **Section 3.2 - the salted hash construction is RECLASSIFIED as a
  substantive prospective amendment.** Prereg 8.1 fixes the 24 salt
  strings and says salts "differ ONLY in the seed's `hashValue` input", but
  does NOT fix how salt and scoring hash compose into that input. Order,
  delimiter, and re-hashing alternatives are all consistent with the sealed
  text and each sends `mulberry32` down a different trajectory - different
  simulated medians, different salt-mean contrasts, potentially different
  verdicts for a cell near a margin. The construction is now frozen
  byte-exactly (hash first, single ASCII colon `0x3A`, salt second, no
  re-hashing) with a pinned test vector, and is submitted for approval.

**What revision 16 changed** (retained, and confirmed corrected by the
revision-16 review):

- **Sections 6.1, 6.2 - `0.30` is now DISCLOSURE-ONLY, and the
  contradiction is gone.** Revision 15 corrected the evaluability gate to
  section 6.1a's transformed-bound comparison against `DELTA_F`, but left
  section 6.2 still listing `0.30` as "the falsifiability floor" among the
  gates, and left the Gate 2 code directive defining it as the evaluability
  constant. Both are corrected: section 6.2 now carries an explicit
  threshold table separating the two GATES (`0.20`, `0.025`) from the two
  DISCLOSURES (`3.80`, `0.30`), and states that `0.30` determines nothing.
  A new test requires that changing `0.30` alone changes no status at any
  level - only the published per-week count.
- **Section 8.2a rule 6 - the catastrophic veto is an INDEPENDENT FLAG,
  not a Level-3 status.** Revision 15 simultaneously ordered Level 3 as
  `missing > vetoed > ...` (one status per component) and required the veto
  to be retained independently. Those contradict: a component (f) that is
  `missing` on one endpoint while a catastrophic realization fired on the
  other reported `missing`, silently losing the veto. `vetoed` is removed
  from the Level-3 ordering entirely; `catastrophicVeto` becomes a boolean
  flag Level 2 consumes directly, preserving cell precedence
  `vetoed > fail > inconclusive > pass` while making the veto unmaskable.
- **Section 6.4a - the "strictly more likely" claim is NARROWED.** It holds
  against a Reading A that AVERAGES over salts, not against every possible
  Reading A: a max-collapsing Reading A would be exactly equivalent to the
  Cartesian reading. The amendment remains substantive because the sealed
  text names no collapsing rule at all, and the readings it admits span
  from equivalent to strictly weaker.

**What revision 15 changes** (each corrects a revision-14 blocker):

- **Section 6.1a - the `0.30` shortcut is WITHDRAWN, not merely
  deprioritized.** Revision 14 offered it as an optional equivalent form
  and asserted algebraic equivalence. **That assertion was wrong and is
  retracted**: the forms are equal in exact arithmetic but NOT under
  `roundToTie`, because rounding is applied to different quantities and
  does not commute with the affine map `x -> 0.05x + 0.01`. Only the
  transformed-bound comparison is permitted, with `roundToTie` applied
  exactly twice and never to intermediates. Two further mutation tests
  pin the non-commutation and the rounding-application count.
- **Section 5.1 - the permutation is now executable from the text alone**:
  the complete mulberry32 transition (including `Math.imul` and every
  `>>> 0`), the byte-exact hash preimage and UTF-8 encoding, the digest
  slice and big-endian read, the explicit `b = 0..9999` replicate range,
  and - the substantive gap - the **source-to-target assignment direction**
  (GATHER, `order[i]` is the SOURCE index), which is otherwise ambiguous
  and whose inverse produces a different assignment. Four further tests,
  including a pinned PRNG vector and a GATHER-vs-SCATTER discriminator.
- **Section 8.2a rule 7 (NEW) - Level-3 `not-applicable`.** Revision 14's
  Level-3 ordering omitted it, leaving no state for (b) on off-cells, (c)
  on `usage-25` cells, or (f) on off-cells. It is vacuously satisfied per
  prereg 9.1, sits outside the precedence chain, keeps the divisor at 7,
  is derived from configuration alone, and its **intentionally absent
  endpoints MUST NOT be reported as Level-4 `missing`** - conflating those
  would fail every off-cell on (b) and (f).
- **Sections 1 and 10 - contradictory approval language removed.** Section
  1 no longer claims Gate 2 is authorized; section 10 no longer reads as
  an approval record. `APPROVAL_LEDGER.md` is the sole authority.
- **Reclassification (section 0's own criterion, applied honestly):**
  section 5.1's permutation construction, section 8.1's **entire harmful-
  boundary column** (the sealed text defines no harmful boundary at all),
  and section 8.2a's rules 3 (inclusive straddle contact) and 5
  (zero-margin straddle disabling) are **relabeled SUBSTANTIVE prospective
  amendments**. Each changes real verdicts; revision 14 labeled them
  mechanical on the reasoning that they were forced, which is precisely the
  error section 0 warns against.

**What revision 14 changed** (retained in full, and accepted as
statistically coherent by the revision-14 review):

- **Section 6.1a (NEW, substantive):** component (f)'s falsifiability guard
  is moved from the pooled seasonwide mean `|b|` to **week-level bounds
  aggregated by MEDIAN**, matching the estimand the procedure actually
  tests. The sealed pooled-mean guard tested the attainability of a
  quantity the sign test never estimates.
- **Section 5.1 (NEW, mechanical):** the permutation control is **fully
  pinned** - PRNG, per-cell seed derivation, `cellKey` byte format,
  **canonical player ordering within a cell**, Fisher-Yates direction and
  inclusivity, exact `rng()` state-consumption order, and blockwise
  construction across cells. Under-specification here could change the
  run-level VOID decision.
- **Section 6.4a (NEW label, substantive):** the veto's evaluation domain -
  the full `(subgroup player-week) x (24 salts)` Cartesian product rather
  than one aggregate per player-week - is **labeled as the substantive
  amendment it is** and brought expressly into approval scope, with runtime
  composite-key completeness required before reduction.
- **Section 8.2a (NEW, mechanical):** the reducer is made **formally
  total** - `threshold-not-established -> failed`, the wide-straddle
  interval and its inclusive boundary rule after `roundToTie`, strict
  pass-test comparisons retained, natural-sign-only comparison, straddle
  disabled where `harmful == favorable`, and independent retention of a
  catastrophic veto.
- **Section 8.2b (NEW, substantive):** the **control receives no candidate
  verdict** - status `baseline`, never `pass`/`fail`/`inconclusive`/
  `vetoed`.

**Gate 0 (section 1) remains active.** No candidate-cell execution, no
real-data access, no authoritative sweep generation. Implementation is
PAUSED pending fresh review and re-approval of this revision.

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
all four approvals are recorded, in `APPROVAL_LEDGER.md`, against the
SAME approved revision of this document.

**Authorization state as of revision 20: NOTHING IS AUTHORIZED.** Zero of
the four approvals are in force against THESE bytes. Revision 18 held three
(ledger rows 4-6) and Gate 2 implementation proceeded under row 6; revision
19 superseded those bytes and revision 20 supersedes revision 19's, so all
three lapse and must be re-issued at the hash of the current anchor.
Revision 19 itself accumulated no approvals, so revision 20 lapsed nothing.
**Revision 20 awaits all three fresh approvals**: its own independent
statistical review (sections 3-8, which is where both new sections 4.6 and
8.7 sit) and, if that issues, the two user attestations (the S3 deviation,
unchanged in substance from revision 18, and the remainder). **Further Gate
2 implementation work is NOT currently authorized** - implementation is
paused at the point revision 19 described and revision 20 restates - and
candidate-cell execution is separately and additionally gated on the fourth
approval (the independent implementation review of the resulting Gate 2
code).

**The Gate 2 code built under revision 18's row 6 does not conform to
revision 20.** `sweepEvidence.js` implements neither section 8.7's profile
axis nor section 4.6's interval method. That code must be brought into
conformance before the fourth approval is sought; the fourth approval is
single-use and must not be spent on an implementation already known to be
non-conformant.

**No section of THIS document supplies or evidences an approval.**
`APPROVAL_LEDGER.md` is the sole authoritative record; section 10 below is
historical narrative only.

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

### 3.2 Salted derivation **[substantive prospective amendment]**

**Reclassified in revision 17.** Revisions 1-16 labeled this "mechanical
completion" on the reasoning that the sealed text requires *some* salted
derivation and this is the obvious one. That reasoning fails section 0's
own criterion, for the same reason the permutation construction (section
5.1) failed it: **the sealed text does not specify this construction, and
different admissible constructions produce different seeds, hence different
simulation draws, hence different metric values, hence potentially
different cell verdicts.**

Prereg 8.1 fixes the 24 salt STRINGS and states that "Salts differ ONLY in
the seed's `hashValue` input". It does **not** fix how the salt and the
scoring hash are combined into that input. Every one of the following is
consistent with the sealed text and yields a different seed stream:

- `scoringHash + ':' + salt` (adopted here)
- `salt + ':' + scoringHash` (order reversed)
- `scoringHash + '|' + salt`, or any other delimiter
- `scoringHash + salt` (no delimiter at all)
- `sha256(scoringHash + salt)`, or any other re-hash of the pair

These are not cosmetic variants. `seedFrom` consumes the composed string,
so each construction sends `mulberry32` down a different trajectory,
producing different simulated medians for every player-week under every
salt - and the 24-salt mean that becomes each week's contrast value moves
with them. A cell sitting near a margin can therefore land on either side
depending purely on this choice. **That is an outcome change, which makes
this substantive regardless of how natural the adopted form looks**, and it
is submitted for approval as part of this revision's scope.

**Frozen construction, byte-exact:**

```
hashValue(rules, salt) = model.scoringHash(rules) + ":" + salt
```

- The scoring hash comes FIRST, the salt SECOND.
- The delimiter is a single ASCII COLON, `0x3A`, exactly one of them.
- No surrounding whitespace, no padding, no case transformation, and no
  re-hashing of the composed string - the concatenation IS the value.
- `salt` is one of the 24 fixed strings from prereg 8.1 /
  `scripts/backtest/lib/metrics.js`'s `SALTS`, used verbatim.

This flows unmodified into
`seedFrom(modelVersion, scoringHashValue, season, week, playerId)`
(`:1113`) -> `mulberry32` (`:333`), exactly as every existing caller already
does with the unsalted value.

**Why the colon is safe as a delimiter here**: `scoringHash` is a
fixed-length lowercase hex digest and the salts match `pit-NN-[0-9a-f]{12}`,
so neither operand can contain a colon and the composition is unambiguously
parseable back into its two parts. A delimiter that could appear inside
either operand would admit two different `(hash, salt)` pairs composing to
the same string, which is why the choice is pinned rather than left open.

**Pinned composition vector:**

- `scoringHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"`
- `salt = "pit-01-879c6f8eae4b"`
- expected `hashValue = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:pit-01-879c6f8eae4b"`

The required test MUST assert byte equality against that literal expected
value.

`salt` here is the first of the 24 preregistered salts (prereg 8.1),
verbatim. `scoringHash` is a synthetic 64-hex-character stand-in of the
correct shape - the vector pins the COMPOSITION rule, not any particular
scoring profile's real digest, so it stays valid regardless of which
profile is being hashed.

**Also required**: an assertion that the composed value is used verbatim as
`seedFrom`'s `scoringHashValue` argument, with no further transformation
between composition and consumption.

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
   draft, not yet approved - approvals are recorded EXCLUSIVELY in
   `APPROVAL_LEDGER.md`, never in this document), alongside the AND rule
   and the permutation-control definitions, rather than presented as if
   prereg 9.8 already said so. **For a NON-(f) component, no-finite-bound remains
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

### 4.5 Applies to every bootstrap inequality

Sections 4.2-4.4 apply individually to each of components (a), (b), (c),
(d), (e1)'s endpoints, and to each of the thirteen (e2) endpoint-season
inequalities (section 4.2).

### 4.6 The descriptive families use prereg 10.1's interval, including for ABSOLUTE metrics **[substantive prospective amendment]**

**The gap this fills.** Prereg 10.1 fixes one interval construction for this
study: a cluster bootstrap over season-weeks, **exactly 100,000 draws**,
**seed 1499811874**, shared resamples, and **percentile** bounds taken as the
order statistic at `ceil(q * 100000)` clamped to `[1, 100000]` with no
interpolation. But 10.1 phrases the bound over bootstrap **DELTAS** ("the
`0.9928571429` empirical quantile of the 100,000 bootstrap deltas"), and the
descriptive families required by prereg 12.1 and 16 include **ABSOLUTE**
metrics, which are not deltas. Nothing in the sealed text says what interval
an absolute metric carries.

**This document extends prereg 10.1's percentile rule to the descriptive
families, absolute metrics included - it does not claim 10.1 already covers
them.** The extension is stated here as a labeled substantive amendment for
the same reason section 4.4 item 3 was: the sealed text is silent, and a
reasonable reader could fill the silence differently.

**Frozen definition.** Every published interval in the descriptive families
of section 8.7 - absolute metrics, paired deltas, attribution composites,
and the prereg 10.6 diagnostics alike - is:

1. a **cluster bootstrap over 2025 season-weeks**, the cluster being the
   season-week, resampling the surviving weeks WITH replacement and
   recomputing the per-week mean over the drawn multiset;
2. **exactly 100,000 draws, seed 1499811874**, using the SAME shared
   resample index prereg 10.1 already mandates, so that no descriptive row
   is built on a different null than any other;
3. reported at the **one-sided `alpha/7 = 0.0071428571` level in both
   directions** - the lower bound is the `0.0071428571` quantile and the
   upper bound the `0.9928571429` quantile, exactly as 10.1 states. The
   level is NOT re-opened here; 10.1 fixes it inline and this section
   inherits it unchanged. A two-sided 95 percent normal approximation is
   specifically NOT permitted;
4. taken by the **percentile order statistic at `ceil(q * 100000)` clamped
   to `[1, 100000]`, no interpolation**.

**Why the method, not merely the level, is load-bearing.** Two of the seven
published endpoints are bounded: `coverage` is a proportion on `[0, 1]` and
`rho` a correlation on `[-1, 1]`. A symmetric unbounded margin can place a
published bound outside the endpoint's own support - an absolute coverage
near 0.96 with ordinary week-to-week spread yields an upper bound above 1.0,
which is not a coverage. The percentile bootstrap cannot do this: every
resampled statistic is a mean of observed values, so every bound stays inside
the data's convex hull. The sealed text's choice is doing real work here and
must not be substituted for on grounds of convenience.

**Self-description is mandatory.** Every published descriptive interval
records, alongside its bounds, the **method**, the **alpha**, the **draw
count**, and the **surviving cluster count**. A report in which a prereg 12.1
primary interval and a prereg 10.5 moving-block interval are typographically
indistinguishable is not auditable, and a disclosure that lives only in a
review document does not travel with the data.

**Prereg 10.5 is unaffected.** The moving-block sensitivity keeps its own
sealed construction (block lengths 2 and 3, same 100,000 draws, **seed
588165040**) and is reported alongside these intervals, exactly as 10.5 says.
Where a moving-block row is published, the primary interval of this section
is not computed for that row - it would be discarded unused.

**Scope limit.** This section governs DESCRIPTIVE publication only. It
changes no component endpoint, no Level 2/3/4/5 status, and no verdict. The
gating components already use prereg 10.1 unchanged, via sections 4.2-4.5.

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

### 5.1 The permutation is FULLY PINNED **[substantive prospective amendment]**

**Reclassified from "mechanical completion" in revision 14.** Revision 14
argued this was mechanical because each choice merely writes down what an
implementation must do anyway. That reasoning was wrong on the criterion
this document itself sets in section 0: a decision is substantive when it
**changes a real outcome**, regardless of how forced it looks. The sealed
text (prereg 7.3, 8.3) fixes only the replicate count and the seed; it does
not fix the PRNG, the seed-derivation preimage, the canonical ordering, the
shuffle direction, or the assignment direction. **Different admissible
choices here yield different null distributions, different `p_hat`, and
therefore different run-level VOID decisions on identical data** - and a
VOID decision discards the entire study. That is the largest outcome any
single rule in this document can change, so it is submitted for approval as
a substantive amendment.

**Why this is not optional detail.** The permutation control is the only
gate that can `void` the entire run on its own. Two implementations that
agree on "10,000 seeded within-week-position permutations" but differ in
PRNG, shuffle direction, or player ordering produce different null
distributions, different `p_hat`, and can therefore reach different
run-level VOID decisions on identical data. Everything below is frozen so
that cannot happen.

1. **PRNG: `mulberry32`, stated in full** - the complete state transition,
   not a reference to an implementation. Given 32-bit unsigned state `a`,
   each call performs, in this exact order, with every operation in
   unsigned 32-bit arithmetic (`>>>`) and every multiplication being
   `Math.imul` (32-bit signed multiply with wraparound, NOT floating-point
   `*`):

   ```
   a = (a + 0x6D2B79F5) >>> 0
   t = a
   t = Math.imul(t ^ (t >>> 15), t | 1)
   t = t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))
   return ((t ^ (t >>> 14)) >>> 0) / 4294967296
   ```

   The return is in `[0, 1)`. The divisor is exactly `2^32 = 4294967296`.
   No other generator, no `Math.random`, no reseeding mid-cell, no
   discarding of an initial "warm-up" draw.
2. **Per-cell seed derivation, with the hash input byte-exact.** A
   permutation is a pure function of `(replicate, cellKey)`:

   ```
   preimage = PERMUTATION_SEED_DECIMAL + "|" + replicate_DECIMAL + "|" + cellKey
   seed(replicate, cellKey) = first 4 bytes of SHA-256(UTF-8 bytes of preimage), big-endian unsigned
   ```

   - `PERMUTATION_SEED_DECIMAL` is the literal ASCII `940227589` - the
     seed rendered in base 10 with no sign, no padding, no separators.
   - `replicate_DECIMAL` is the replicate index in base 10, no padding
     (`0`, `1`, ..., `9999` - never `0000`).
   - The two `|` are single ASCII `0x7C` bytes.
   - `cellKey` is the string frozen in step 3.
   - The preimage is encoded as **UTF-8** before hashing. Every byte of it
     is ASCII by construction, so UTF-8 and ASCII coincide here; the
     encoding is named anyway so no implementation substitutes UTF-16.
   - The seed is the **first four bytes** of the 32-byte digest, read
     **big-endian** as an unsigned 32-bit integer (equivalently:
     `digest[0]*2^24 + digest[1]*2^16 + digest[2]*2^8 + digest[3]`).

   Derived by HASH rather than by consuming one long stream, so replicate
   `b` never depends on having generated replicates `0..b-1` - which is
   what makes the "same permutation reused across all 24 salts and both
   endpoints" requirement hold by construction rather than by bookkeeping.
2a. **Replicate range, frozen: `b = 0, 1, ..., 9999` inclusive** - exactly
   10,000 replicates (prereg 7.3), zero-indexed. `b = 10000` is out of
   range and MUST be refused. The observed statistic `T_obs` is NOT a
   replicate and is never assigned an index in this range; the plus-one
   p-value's `+1` accounts for it separately (prereg 7.3), and it must not
   be double-counted by also generating a replicate for it.
3. **`cellKey` format, frozen**: the ASCII string
   **`` `${season}:${week}:${position}` ``** - e.g. `2025:9:RB` - with
   `season` and `week` as bare decimal integers (no zero-padding) and
   `position` one of the six macro positions in their sealed spelling
   (`QB`, `RB`, `WR`, `TE`, `K`, `DEF`, prereg 3.3). The exact byte string
   is load-bearing: it feeds the hash above, so any change to padding,
   separator, or case silently produces a different null distribution.
4. **Canonical player ordering within a cell, frozen: ASCENDING NUMERIC
   `playerId`.** This is the gap that most needed closing - a shuffle is
   only reproducible if what it shuffles was in a defined order first, and
   nothing previously pinned that. The cell's members are sorted by
   `playerId` as a NUMBER (not lexicographically - `"10" < "9"` as strings
   would reorder the cell), ascending, before index 0 is assigned. Ties are
   impossible: `playerId` is unique within a `(season, week, position)` cell
   by cohort construction (prereg 4.1, one row per player per week), and an
   implementation MUST fail closed rather than proceed if it encounters a
   duplicate, since that would mean the cohort itself is malformed.
5. **Shuffle: Fisher-Yates, DESCENDING**, over the canonical ordering:

   ```
   order = [0, 1, ..., size-1]                  // canonical, per step 4
   for (i = size - 1; i > 0; i--) {
     j = Math.floor(rng() * (i + 1))            // 0 <= j <= i, inclusive
     swap(order[i], order[j])
   }
   ```

   Descending `i`, `j` drawn inclusive of `i`, exactly one `rng()` call per
   iteration, `size - 1` calls total for a cell of `size`. The ascending
   variant and the `j < i` (exclusive) variant are both DIFFERENT
   permutation distributions and are excluded.

5a. **Source-to-target assignment direction, frozen.** A permutation array
   is ambiguous by nature - `order` can mean "slot `i` receives element
   `order[i]`" (a GATHER) or "element `i` moves to slot `order[i]`" (a
   SCATTER). These are inverse permutations and generally produce different
   assignments, so the choice is load-bearing and is fixed here:

   > **GATHER. `order[i]` is the SOURCE index. Target slot `i` receives the
   > projection whose canonical index is `order[i]`.**

   Concretely, with `players[]` the cell's members in canonical order (step
   4) and `projections[]` their projected medians in that same canonical
   order, the permuted assignment is:

   ```
   for i in 0 .. size-1:
       permutedProjection[i] = projections[ order[i] ]
   ```

   so `players[i]` - who keeps their own actual points, unmoved - is now
   paired with `projections[order[i]]`. **Actual points are never permuted
   and never re-indexed**; only the projection vector is gathered through
   `order`. Applying the inverse (scatter) is excluded, and an
   implementation MUST carry a test distinguishing the two on a cell whose
   permutation is not self-inverse (any cell of size >= 3 with a 3-cycle
   suffices - a size-2 cell cannot distinguish them, since every
   permutation of two elements is its own inverse).
6. **State-consumption order.** Each `(replicate, cellKey)` gets its OWN
   freshly-seeded generator (step 2), consumed by exactly the loop in step
   5 and nothing else. No generator is shared across cells, across
   replicates, or with any other part of the pipeline; no value is drawn
   from it before or after the shuffle. A cell of `size <= 1` consumes ZERO
   `rng()` calls and yields the identity permutation.
7. **What the permutation permutes.** The **projection-to-player assignment
   WITHIN the `(week, position)` cell** (prereg 7.3) - the vector of
   projected medians is permuted against the players' actual points, so
   real skill is destroyed while both marginal distributions are preserved
   exactly. Actual points are NEVER permuted, and no row leaves its cell.
8. **Blockwise construction across cells.** One replicate index `b` selects
   the permutation for EVERY cell simultaneously via step 2 - replicate `b`
   means "cell `2025:2:QB` uses `seed(b, '2025:2:QB')`, cell `2025:2:RB`
   uses `seed(b, '2025:2:RB')`, ..." - so a replicate is a coherent
   whole-scope reassignment, not an independent draw per cell per use. The
   same replicate `b` is reused unchanged across all 24 salts and BOTH
   endpoints, per prereg 7.3.
9. **Statistic recomputation under a permutation.** `T_regret` and
   `T_pairwise` are recomputed by the IDENTICAL code path used for `T_obs`
   (this section's opening definitions and aggregation), with only the
   projection-to-player assignment changed. In particular the pairwise
   macro-average still drops a position with zero eligible pairs and still
   drops the whole week if more than one position drops (prereg 6.2) -
   applied to the PERMUTED assignment, not inherited from the observed one.

**Required determinism tests.** (i) The same `(replicate, cellKey)` yields
a byte-identical permutation across separate processes. (ii) Replicate
9,999 is obtainable without having generated 0-9,998. (iii) A cell whose
members are supplied in a different input order yields the SAME permutation
(proving canonical ordering, not insertion order, governs). (iv) A
one-character change to `cellKey` yields a different permutation. (v) A
cell of size 0 or 1 consumes no randomness and is the identity. (vi) The
`rng()` call count for a cell of size `n` is exactly `n - 1`.
(vii) **A pinned mulberry32 vector**: a fixed seed produces a fixed,
literal sequence of the first several outputs, asserted against hardcoded
values - so a subtly wrong transition (floating-point `*` instead of
`Math.imul`, a missing `>>> 0`, a wrong shift width) fails loudly rather
than producing a plausible-looking but different null distribution.
(viii) **GATHER not SCATTER**, on a cell of size >= 3 whose permutation is
not self-inverse, asserting the assignment matches step 5a and not its
inverse. (ix) `replicate = 10000` is REFUSED. (x) A pinned
`seed(replicate, cellKey)` vector - a literal `(replicate, cellKey)` pair
mapped to its literal expected 32-bit seed, so a change to the preimage
format, the encoding, the digest slice, or the endianness fails loudly.

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

- **Per-week disclosure threshold, `0.30`** (was `0.50`): **DISCLOSURE
  ONLY - it is NOT an evaluability gate and NOT a comparison operand in any
  decision.** It is used in exactly one place: the per-week count
  `weeksBelowFalsifiabilityFloor` (`lib/arms.js:448-449`), which prereg 9.8
  requires published as context for how much of `k` rests on weeks where
  the margin was unattainable. The evaluability gate it was once part of
  has been **replaced entirely by section 6.1a**, which compares a median
  of transformed per-week bounds against `DELTA_F = 0.025` and never
  references `0.30` at all. The name `FALSIFIABILITY_FLOOR` is retained for
  the disclosure constant only, and is a misnomer inherited from the
  superseded design - an implementation MUST NOT infer a gate from it.
- **Veto-incapable disclosure threshold, `3.80`** (was `4.00`):
  **mechanical rounding correction** - used exclusively inside the
  transparency block's `catastrophicCapCouldFire` disclosure
  (`lib/arms.js:456`), never gating the veto itself (which fires strictly
  on the directly-measured `inc > 0.20`); cannot change any verdict.

**Required Gate 2 code changes**: `lib/arms.js:366`'s `FALSIFIABILITY_FLOOR
= DELTA_F / MAX_EFFECT` -> `(DELTA_F - 0.01) / MAX_EFFECT` (0.30),
**retained SOLELY as the per-week disclosure constant**; `:456`'s
`catastrophicCapCouldFire` check -> `Number(maxAbsBaseline) >
(CATASTROPHIC_CAP - 0.01) / MAX_EFFECT` (3.80). **Additionally required**:
the evaluability guard must be rewritten to section 6.1a's transformed-bound
median comparison, and `FALSIFIABILITY_FLOOR` must NOT appear anywhere in
that guard. A test must assert that the constant is referenced by the
disclosure count and by nothing that returns a status.

**Required rounding-boundary mutation tests**: synthetic on/off medians
whose independent `round2` roundings push in opposite directions at the
0.005 boundary, asserting scored `inc` never exceeds `0.05|b| + 0.01`; the
`3.80` disclosure comparison tested at its own boundary; the `0.30`
per-week COUNT tested at its own boundary (a week exactly at `0.30` is
counted, per "at or below"); and - covering the contradiction this revision
removes - **a test asserting that changing `0.30` alone never changes any
endpoint, component, cell, or run STATUS**, only the published count.

### 6.1a The falsifiability guard is WEEK-LEVEL, aggregated by MEDIAN **[substantive prospective amendment]**

**The defect this corrects.** Prereg 9.8 states the falsifiability guard
against the **pooled seasonwide mean `|b|`**: "Publish the realized mean
`|b|` over the 2025 subgroup. If the realized mean `|b|` is at or below
`delta_F / maxEffect` ... component (f) is declared UNEVALUABLE." But the
SAME section defines the estimand as "the **MEDIAN over 2025 season-weeks**
of the on-minus-off delta," and the test is a sign test over week-level
`D_w`. **A guard on the pooled mean therefore tests the attainability of a
quantity the procedure never estimates.** The two can disagree in both
directions:

- A season whose subgroup mass is concentrated in a few high-`|b|` weeks can
  clear a pooled-mean floor while the MEDIAN week remains structurally
  unable to exceed the margin - the guard passes and every per-week sign is
  uninformative, exactly the artefact the guard exists to prevent.
- A season with a long low-`|b|` tail can fail a pooled-mean floor while the
  median week is comfortably falsifiable - the guard fires and discards
  usable evidence.

Prereg 9.8 already treats week-level `|b|_w` as a first-class preregistered
quantity (it requires publishing "the count of individual weeks whose own
realized mean `|b|_w` is at or below 0.50 points ... a favorable sign
there is structurally uninformative"), so this amendment applies the sealed
text's own week-level reasoning to the gate itself rather than only to a
disclosure alongside it.

**Frozen definition.** For component (f), per endpoint (f1 and f2
INDEPENDENTLY - each has its own qualifying week set):

1. **Qualifying weeks.** The 2025 season-weeks `w` with subgroup rows in
   BOTH the on-cell and its matched off-cell - the identical week set the
   endpoint's own `D_w` series is built from. A week with no subgroup rows
   in either cell contributes to neither the test nor this guard.
2. **Per-week attainable bound.** For each qualifying week `w`:

   ```
   bound_w = MAX_EFFECT * meanAbsBaseline_w + 0.01
           = 0.05 * meanAbsBaseline_w + 0.01
   ```

   where `meanAbsBaseline_w` is the mean `|b|` over that week's subgroup
   rows, `b` being the pre-homeAway baseline captured by
   `onPreHomeAwayBaseline` (section 6.5) in the MATCHED OFF-CELL, which is
   where subgroup membership is assigned (prereg 9.8). The `+ 0.01` is
   section 6.1's rounding slack, unchanged and carried per-week rather than
   pooled.
3. **Aggregation: MEDIAN over qualifying weeks**, matching the estimand.
   With `m` qualifying weeks and `bound_(1) <= ... <= bound_(m)` the sorted
   bounds, **the median is the standard order-statistic median**: for odd
   `m`, `bound_((m+1)/2)`; for even `m`, the arithmetic mean of
   `bound_(m/2)` and `bound_(m/2 + 1)`. **The even case is pinned
   explicitly** because the alternatives (lower/upper order statistic) give
   different answers and 17 weeks minus any dropped week is frequently
   even.
4. **Equality rule.** Both operands are `roundToTie`-normalized (ten
   decimals, prereg 6.6, matching section 6.2's convention for every other
   boundary in this component), and the comparison is **inclusive on the
   unfalsifiable side**:

   ```
   roundToTie(median_w(bound_w))  <=  roundToTie(DELTA_F)   ->  UNEVALUABLE
   ```

   `<=` rather than `<`: a median attainable bound exactly EQUAL to the
   margin cannot produce a strictly-clearing result, so it is unfalsifiable,
   matching prereg 9.8's own "at or below" phrasing for the pooled version.
5. **Disposition on firing.** `status: 'unevaluable'`, which for component
   (f) maps to cell `inconclusive` under its named exception (section 8.2) -
   never `fail`, never a pass. Unchanged from the pooled version; only the
   quantity tested changes.
6. **Ordering.** This guard runs in the same position the pooled guard
   occupied: AFTER the catastrophic veto (section 6.4, which is computed
   first and overrides), and BEFORE the exact sign test is read.

**The transformed-bound comparison is the ONLY permitted form. The `0.30`
shortcut is WITHDRAWN.** Revision 14 offered
`roundToTie(median_w(meanAbsBaseline_w)) <= roundToTie(0.30)` as an
optional equivalent. **It is not equivalent, and the claim that it was is
retracted.** The two forms are equal in exact real arithmetic but NOT under
`roundToTie`, because the rounding is applied to different quantities:
`roundToTie` after the affine map `x -> 0.05x + 0.01` does not commute with
`roundToTie` before it. Concretely, `0.05x + 0.01` compresses the input
scale twentyfold, so a `meanAbsBaseline_w` that rounds one way at ten
decimals can carry its transformed bound to the other side of the margin,
and the median of transformed values is not the transform of the median of
values once each is independently rounded. A boundary case would therefore
be decided differently by the two forms - and this gate decides
evaluability, so that is an outcome difference, not a presentational one.

**Normative comparison, and the only one permitted:**

```
roundToTie( median_w( 0.05 * meanAbsBaseline_w + 0.01 ) )  <=  roundToTie( 0.025 )
    ->  UNEVALUABLE
```

`roundToTie` is applied EXACTLY TWICE: once to the median of the
transformed per-week bounds, once to `DELTA_F`. It is NOT applied to the
individual `bound_w` before the median, and NOT to `meanAbsBaseline_w`
before the transform - intermediate rounding would reintroduce the same
non-commutation this correction exists to eliminate. **`0.30` is retained
ONLY as a published reference magnitude for reader orientation and MUST NOT
appear in any comparison.**

**Retained disclosures (prereg 9.8, unchanged and still required).** The
pooled seasonwide mean `|b|` and maximum `|b|` are STILL published - the
amendment removes them from the GATE, not from the report. The per-week
count of weeks at or below the floor is still published. **Additionally
required by this amendment**: the realized `median_w(bound_w)` itself, the
qualifying week count `m`, and the full sorted `bound_w` series, so a
reader can audit the median against the data rather than taking it on
trust.

**Required mutation tests.** (i) A season whose POOLED mean would have
cleared the old floor but whose week-level transformed-bound median does
NOT clear `DELTA_F` must report `unevaluable` - the case the pooled guard
wrongly passed. (ii) The mirror: pooled mean below the old floor,
week-level median above, must be EVALUABLE. (iii) Even-`m` median exactly
on the boundary, asserting the pinned averaging rule and the inclusive
`<=`. (iv) f1 and f2 with DIFFERENT qualifying week sets, asserting the
guard is evaluated independently per endpoint and one endpoint firing does
not fire the other. (v) **The non-commutation itself**: a constructed
`meanAbsBaseline_w` series for which
`roundToTie(median(0.05x + 0.01)) <= roundToTie(0.025)` and
`roundToTie(median(x)) <= roundToTie(0.30)` DISAGREE, asserting the
implementation follows the normative transformed-bound form. An
implementation that silently used the withdrawn shortcut must fail this
test. (vi) `roundToTie` is applied exactly twice - asserting no
intermediate rounding of `bound_w` or `meanAbsBaseline_w`, e.g. by a series
whose per-week values differ from their ten-decimal roundings.

### 6.2 Normalize every boundary operation

**Every comparison - `<`, `<=`, `>`, `>=`, and equality - against a frozen
threshold applies `roundToTie` (ten-decimal, prereg 6.6) to BOTH operands
before the comparison**, not just one, so a genuine boundary value is never
misclassified by floating-point representation noise on either side. The
complete list of such comparisons, and nothing else:

| threshold | used by | kind |
| ---: | --- | --- |
| `0.20` | the catastrophic veto check (section 6.4) | **GATE** |
| `0.025` (`DELTA_F`) | the falsifiability guard, against the median transformed per-week bound (section 6.1a) | **GATE** |
| `3.80` | the `catastrophicCapCouldFire` transparency line | disclosure only |
| `0.30` | `weeksBelowFalsifiabilityFloor`, the per-week count (section 6.1) | **disclosure only** |

**`0.30` DETERMINES NOTHING.** It is not an operand of any evaluability,
pass, fail, or veto decision. It appears in exactly one computation - the
count of individual weeks whose own `meanAbsBaseline_w` is at or below it,
which prereg 9.8 requires published as context for how much of `k` rests on
structurally uninformative weeks. **Any implementation that compares `0.30`
against a pooled or median `|b|` to decide evaluability is WRONG** and must
fail its tests: section 6.1a's transformed-bound comparison against
`DELTA_F` is the sole evaluability gate for component (f). Revision 15's
own section 6.2 previously listed `0.30` as "the falsifiability floor"
alongside the real gates; that listing was a leftover from the pooled-mean
design and is corrected here.

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

#### 6.4a The veto's evaluation domain is a SUBSTANTIVE AMENDMENT **[substantive prospective amendment]**

**Previously unlabeled; labeled here and submitted for approval as part of
this revision's scope.** Prereg 9.8 states the veto as: "For any subgroup
**row**, let `inc = |on-cell error| - |off-cell error|`. If any single
subgroup **row** has `inc > 0.20 points`, the homeAway claim is VETOED."

**"Row" is genuinely ambiguous in the sealed text**, and the two readings
are not equivalent:

- **Reading A (player-week):** a "row" is one subgroup player-week, and
  `inc` is computed once for it - necessarily from some single aggregate
  over the 24 salts, since a player-week has 24 salt-specific projected
  medians and the sealed text names no rule for collapsing them.
- **Reading B (player-week x salt), ADOPTED HERE:** a "row" is one
  *realization* - each of the `24 x (subgroup player-weeks)` distinct
  `(player-week, salt)` pairs is its own `inc`, and any one of them
  exceeding the cap vetoes.

**Reading B is strictly more likely to fire than Reading A WHEN Reading A
AVERAGES over the 24 salts** - the maximum over a set is at least its mean,
so a harm visible in one salt can be diluted below the cap by 23 benign
ones. **The comparison is NOT strict against every possible Reading A**: if
Reading A collapsed the salts by MAXIMUM, it would be exactly equivalent to
Reading B, since the maximum over player-weeks of the per-player-week
maxima is the maximum over the whole Cartesian set. Reading A is
under-determined by the sealed text precisely because it names no
collapsing rule, and the readings it admits range from equivalent (max) to
strictly weaker (mean, median, any quantile below the top). Choosing among
them is therefore a real decision that can change which cells are vetoed -
and a veto is the harshest verdict in the family - which makes this a
substantive prospective amendment requiring explicit approval, not a
mechanical completion.

**Why Reading B is adopted.** Prereg 8.1 fixes the salts as replicates that
"differ ONLY in the seed's `hashValue` input" - they are 24 draws of
simulation noise for the SAME model on the SAME player-week, not 24
different models. A catastrophic harm that appears under one seed is a real
property of the configuration's tail behavior on that player-week; averaging
it against 23 benign draws would report the configuration as safe precisely
when its tail is not. Prereg 9.8's own framing supports this - the veto is
"an additional safety rather than a gate that must bind," which is the logic
of a maximum, not a mean.

**Frozen evaluation domain.** The veto is evaluated over the COMPLETE
Cartesian product

```
{ subgroup player-weeks } x { the 24 preregistered salts }
```

with **no sampling, no truncation, and no early exit that would leave any
member unevaluated for reporting purposes**. Membership in
`{ subgroup player-weeks }` is assigned from the MATCHED OFF-CELL
(`b <= 0`, prereg 9.8), computed once per `(season, week, blendWeight,
playerId)` and reused unchanged across all 24 salts (section 6.3).

**Completeness is a REQUIRED RUNTIME ASSERTION, not an assumption.** The
implementation must verify, before reducing the realizations to a verdict,
that it holds exactly `24 x |subgroup player-weeks|` realizations with a
complete composite-key set - every `(season, week, playerId, salt)` present
exactly once, no duplicate, no gap. A missing realization is a HARD ERROR
that aborts the run, never a silently smaller veto domain: a veto whose
domain quietly shrank is a safety gate reporting "no catastrophic row
found" about rows it never looked at. **The count and the composite-key
completeness result are published** alongside the veto outcome, so a reader
can confirm the domain was whole rather than trusting that it was.

**Required mutation tests.** (i) A single catastrophic realization under
exactly one salt, benign under the other 23, must VETO - the case Reading A
would have missed. (ii) A dropped realization (one absent composite key)
must HARD ERROR, not silently pass. (iii) A duplicated composite key must
HARD ERROR. (iv) The published realization count must equal
`24 x |subgroup player-weeks|` exactly.

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
- recorded EXCLUSIVELY in `APPROVAL_LEDGER.md`, never in this document -
distinct from, and in addition to, the user attestation covering the
remainder of this document.

---

## 8. Status model: the complete reducer, activation, Level 5, and identity

### 8.1 Signed boundaries **[substantive prospective amendment]**

**Reclassified in revision 15.** The **passing** boundaries below are
mechanical - each is a sealed margin restated verbatim from prereg 9.2-9.7.
The **harmful** boundaries are not: **the sealed text never defines a
harmful boundary for any endpoint.** Prereg 10.6 invokes "the harmful
margin" without saying what it is, so every value in the harmful column
below is this document's own construction. Because the harmful boundary is
one of the two inputs to the wide-straddle test (rule 3 of section 8.2a),
each such value directly decides whether real cells report `inconclusive`
or `fail`. The whole harmful column is therefore submitted for approval as
a substantive prospective amendment - in particular the choice to MIRROR
(`harmful = -passing`) for the sole superiority endpoint while keeping
`harmful = passing` for every noninferiority endpoint, which is a
deliberate asymmetry and not a typo.

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

### 8.2a The reducer is FORMALLY TOTAL **[MIXED - see the per-rule labels]**

**Revision 14 labeled this block wholesale "mechanical completion". That
was wrong for two of its rules and is corrected here.** Rules 1, 2, 4, 6,
7 and 8 are mechanical: they make determinate a case the earlier text left
to implementation accident without changing any outcome that text already
determined. **Rules 3 and 5 are SUBSTANTIVE prospective amendments** and are
submitted for approval as such - each decides real cell verdicts that the
sealed text does not decide. Per-rule labels are stated inline below;
where they conflict with any surrounding prose, the inline label governs.
Frozen:

1. **`threshold-not-established` maps to component `failed`.** At Level 4 it
   is its own endpoint status (it records that the endpoint WAS fully
   evaluated and simply did not clear - distinct from `unevaluable`, which
   records that it could not be evaluated at all). At Level 3 that
   distinction has served its purpose and the endpoint is **`failed`** for
   combination, hence cell `fail` under prereg 9.1's default. **It is NEVER
   `inconclusive`**: the endpoint produced a usable result and that result
   did not clear the boundary, which is a measured failure, not absent
   evidence. The Level-4 label is retained verbatim in the published report
   so the distinction remains auditable.
2. **The wide-straddle interval is the endpoint's own one-sided
   `alpha/7 = 0.0071428571` bounds** - `lower` at the `0.0071428571`
   empirical quantile and `upper` at the `0.9928571429` quantile of the
   100,000 bootstrap statistics (prereg 10.1's percentile rule, order
   statistic at `ceil(q * 100000)` clamped to `[1, 100000]`, no
   interpolation). **No separate or wider interval is constructed for
   straddle detection** - reusing the same bounds the pass/fail test uses is
   what keeps "the interval spans both margins" (prereg 10.6) commensurate
   with the test it qualifies.
3. **[SUBSTANTIVE prospective amendment] Boundary inclusivity, after
   `roundToTie` on BOTH operands.** Prereg 10.6 says only that a claim is
   INCONCLUSIVE "if a component's interval spans both the favorable and
   harmful margin" - it does not say whether an interval whose endpoint
   lands EXACTLY on a boundary "spans" it. Both readings are admissible,
   they disagree on real boundary cases, and the disagreement moves a cell
   between `inconclusive` and `fail`/`pass`. The inclusive reading is
   adopted and submitted for approval. Straddle fires when the interval
   reaches or crosses both boundaries:

   ```
   roundToTie(lower) <= roundToTie(min(favorable, harmful))
     AND roundToTie(upper) >= roundToTie(max(favorable, harmful))
   ```

   **Inclusive (`<=`, `>=`) on both ends**: an interval whose endpoint lands
   exactly ON a boundary does span it for this purpose, since prereg 10.6's
   concern is an interval too wide to distinguish benefit from harm, and
   exact contact does not distinguish them. **The pass tests remain
   STRICT** (`upper < passing` for a favorable-negative endpoint, `lower >
   passing` for a favorable-positive one), exactly as prereg 9.2-9.7 phrase
   them ("strictly below", "strictly above"). The two conventions differ on
   purpose and must not be unified.
4. **All comparisons are in the metric's NATURAL SIGN.** Where the exact
   procedure internally negates a favorable-positive statistic and its
   margin (section 4.4 item 4), the bound is de-normalized back to natural
   sign BEFORE any comparison, publication, or straddle check. No comparison
   is ever performed in the internal negated space, and no negated value is
   ever published.
5. **[SUBSTANTIVE prospective amendment] Zero-margin endpoints cannot
   wide-straddle.** For (b), (c), (d), `passing = harmful = favorable = 0`,
   so `min == max` and rule 3 would reduce to `lower <= 0 AND upper >= 0` -
   which is merely "the interval contains zero," the ordinary
   non-significant result, not the pathological width prereg 10.6 targets.
   **Wide-straddle is therefore DISABLED where `harmful == favorable`**, and
   such an endpoint falls to `threshold-not-established` instead.

   **This is substantive and consequential in a specific direction**: with
   straddle enabled, EVERY non-significant (b)/(c)/(d) endpoint would
   straddle, making the cell `inconclusive`; with it disabled they resolve
   to `fail`. Since (b) and (c) are attribution gates that a genuine
   null-effect cell is EXPECTED to miss, the choice determines whether such
   a cell reports `inconclusive` (evidence insufficient) or `fail`
   (attribution not demonstrated) - a materially different published
   conclusion, and one a reasonable reader could resolve either way from
   prereg 10.6 alone. Adopted as written and submitted for approval.
   (Section 8.1's table already states `passing = harmful = 0` for these;
   this closes what the reducer does with it.)
6. **The catastrophic veto is an INDEPENDENT FLAG, not a Level-3 status.**

   **This corrects a real contradiction in revision 15.** That revision
   both (a) ordered Level 3 as `missing > vetoed > unevaluable > ...` with
   exactly one status per component, and (b) required the veto to be
   "retained independently of every other status". Those cannot both hold:
   under (a), a component (f) that is `missing` for one endpoint while a
   catastrophic realization fired on the other reports `missing`, and the
   veto is silently lost - the exact masking (b) forbids. The veto is also
   not really commensurable with the other statuses: `missing`,
   `unevaluable`, `failed` and `passed` describe *how the test came out*,
   whereas a veto describes *a harmful realization that was observed*,
   which remains true regardless of how the test came out.

   **Frozen model.** Component (f) carries, separately:

   - **a Level-3 status**, drawn from the ordinary ordering
     (`missing > unevaluable > wide-straddle > failed > passed`) with
     `vetoed` REMOVED from that ordering entirely; and
   - **`catastrophicVeto`, an independent boolean flag** (with its
     realization list and the completeness attestation of section 6.4a),
     set by the veto check of section 6.4 and **never overwritten,
     downgraded, or cleared by any other component result, by (f)'s own
     status, or by the run-level reducer.**

   **Level 2 consumes the flag directly.** If `catastrophicVeto` is set on
   any component, the cell is **`vetoed`**, and that outranks every other
   cell-level cause - preserving the unchanged cell precedence
   **`vetoed > fail > inconclusive > pass`**. This holds even when (f)'s
   own Level-3 status is `missing` or `unevaluable`, which is precisely the
   case revision 15 got wrong: a catastrophic realization was observed, and
   the fact that some *other* part of (f) could not be evaluated does not
   unobserve it.

   **Publication.** The flag, its realizations, and the section 6.4a
   completeness attestation are published whenever set, alongside (f)'s
   ordinary status - so a cell that would have failed anyway still
   discloses the catastrophic finding. A veto is positive evidence of harm;
   allowing an unrelated failure or absence to mask it would lose the
   strongest safety finding the study can produce.

   **Unchanged**: only component (f) can set the flag (prereg 9.8), and
   **a veto can never turn a failure into a pass.**
7. **Level-3 `not-applicable` is its own state, and it is VACUOUSLY
   SATISFIED for the IUT.** Prereg 9.1 states that a component which does
   not apply "passes **vacuously by definition**, never by test, and is
   reported as 'not applicable'", with the divisor fixed at 7 regardless.
   Revision 14's Level-3 ordering - which at that time still read
   `missing > vetoed > unevaluable > wide-straddle > failed > passed`, both
   terms of which have since been corrected (`vetoed` removed by rule 6
   above; `not-applicable` added by this rule), and which is quoted here
   ONLY as history and is NOT normative - omitted it entirely, leaving the
   reducer without a state for a real and routine case: (b) on every
   off-cell, (c) on both `usage-25` cells, (f) on every off-cell (sections
   9.3, 9.4, 9.8). **The normative ordering is the one stated under
   "Component level (Level 3)" below.** Frozen:

   - **`not-applicable` is a Level-3 status**, assigned when and only when
     the component's own preregistered applicability condition is unmet.
   - It **satisfies the IUT vacuously**: it never blocks a `pass` and never
     contributes a `fail` or `inconclusive` cause. It sits OUTSIDE the
     precedence chain rather than at one end of it - it is not "the weakest
     pass", it is the absence of a test.
   - **The divisor remains 7** (prereg 9.1). A cell with three
     non-applicable components is still tested at `alpha/7` on the four
     that apply. This forecloses divisor-shopping and is restated here
     because the new state makes the temptation concrete.
   - **A not-applicable component publishes NO endpoint results**, and its
     intentionally absent endpoints **MUST NOT be reported as Level-4
     `missing`.** `missing` means "this component was required and its
     evidence is absent" and drives cell `fail`; a component that was never
     required has nothing missing about it. Conflating the two would fail
     every off-cell on (b) and (f) - a catastrophic misreading, and exactly
     the kind of silent absence prereg 9.1's "no assume pass" rule is
     written against, inverted.
   - **The applicability decision is structural, never data-dependent.** It
     is a function of the cell's own configuration only (`homeAway` state,
     `blendWeight` versus the control's 0.25). A component is never marked
     not-applicable because its data was thin, absent, or inconvenient -
     that is `unevaluable` or `missing`, which have their own dispositions.
     An implementation MUST derive applicability from configuration alone
     and MUST NOT accept it as an operator-supplied input.

8. **Totality.** Every endpoint reaches exactly one of the five Level-4
   statuses, OR belongs to a not-applicable component and is not reported at
   all; every component reaches exactly one Level-3 status from the ordinary
   ordering (`not-applicable` included, `vetoed` excluded per rule 6) and
   independently carries the boolean `catastrophicVeto` flag; every cell
   reaches exactly one of `fail`/`inconclusive`/`vetoed`/`pass` (or, for the
   control alone, `baseline` - section 8.2b); every run reaches `valid` or
   `void`. **No input produces an undefined, absent, or implementation-
   defined status at any level, and no combination of a Level-3 status with
   a set veto flag is unrepresentable.** An implementation MUST fail closed
   rather than emit a status outside these sets.

   **Required totality test**: component (f) `missing` or `unevaluable`
   WITH `catastrophicVeto` set must produce cell `vetoed` - the case
   revision 15's ordering silently lost.

**Component level (Level 3)**: **`not-applicable`** is decided FIRST, from
configuration alone (rule 7 above); a not-applicable component takes no
further part in the ordering. For every component that DOES apply:
`missing` > `unevaluable` > `wide-straddle` > `failed` > `passed`, by the
presence of any endpoint in that category, with
`threshold-not-established` counting as `failed` per rule 1 above.
**`vetoed` is NOT in this ordering** - the catastrophic veto is an
independent flag consumed directly by Level 2 (rule 6 above), so that it
cannot be masked by a `missing` or `unevaluable` sibling endpoint.

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
| component (f)'s `catastrophicVeto` FLAG is set (independent of (f)'s own Level-3 status - section 8.2a rule 6) | **`vetoed`** | prereg 9.8, sections 6.4, 6.4a |

**Precedence for ALL co-occurring causes on the same cell: `vetoed` >
`fail` > `inconclusive` > `pass`.** An ordering-caused `inconclusive`
(section 8.4) is one more cause in this same list, subject to the identical
precedence - never a special case that jumps the queue: a cell that is
ALSO independently `vetoed` or `fail` for an unrelated reason keeps that
status regardless of an ordering disagreement also being true for it.

### 8.2b The CONTROL receives no candidate verdict **[substantive prospective amendment]**

**The control cell (`usage-25 x off`) is assigned the distinct status
`baseline` and is NEVER assigned `pass`, `fail`, `inconclusive`, or
`vetoed`.**

Prereg 9.1 scopes the IUT to candidates - "One claim per **candidate**
cell" - and prereg 7.1/12.1 name the control as distinct from "the 7
non-control cells." Component (a)'s comparator IS the control, so running
the candidate IUT on the control would compare it against itself and
produce a permanent, structural `fail` on every real run: an artifact of
asking a nonsensical question, not a finding about the model. Labeling that
artifact `fail` would misreport the shipped configuration as having failed
a test it was never a subject of.

This is labeled a **substantive prospective amendment** rather than a
mechanical completion because the sealed text does not state a status for
the control at all - it scopes the claim to candidates and stops. Choosing
`baseline` (rather than, say, omitting the control from the report, or
reporting it with a null verdict) is a real choice among readings the
sealed text leaves open.

**Frozen rules.** (i) `baseline` is valid ONLY for the control cell; a
candidate cell reporting it is a hard error, since a candidate must not
opt out of the IUT it is required to pass. (ii) A control cell reporting
any candidate verdict is equally a hard error. (iii) The control publishes
NO component results - it has no candidate claim, so there are no
components to report. (iv) The control remains excluded from the Level-5
selection family (prereg 7.1), as it already was. (v) The control's
baseline metrics and the pipeline assertions computed against it (the
permutation control, section 5; the `usage-25 == control` bit-identity
assertion, section 8.6.0) are still published in full - the amendment
removes a VERDICT it should never have had, not the control's data.

**Run level (Level 1)**: every authoritative run is either **`valid`**
(every cell above is computed and published) or **`void`** (the
permutation-control threshold miss, section 5; a canary failure; either of
the two sealed identity assertions, section 8.6; **or a detected
salt-collision, section 3.4 item 5**) - `void` is a property of
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

### 8.7 The descriptive publication contract: which family carries which scoring profile **[substantive prospective amendment]**

**The gap this fills.** Four sealed sections each state a piece of this and
none states the whole:

- **Prereg 4.3** - "half-PPR is the formal primary. Standard and full-PPR
  are no-harm sensitivities."
- **Prereg 12.1** - the factorial family: "all 8 cells' absolute metrics and
  all paired deltas versus control, with CIs, whether or not any cell
  passes." No profile named.
- **Prereg 12.2** - the three attribution composites, "each with CIs". No
  profile named.
- **Prereg 10.6** - control-vs-naive and `usage-signal` are "estimates-only
  diagnostics: reported as point estimates with CIs and NO superiority or
  verdict label." No profile named.
- **Prereg 16** - "Standard and full-PPR scoring profiles - these appear in
  (e2) as no-harm GATES, and **their absolute metrics are additionally
  reported descriptively**."

An unqualified family inherits prereg 4.3's primary. A family prereg 16
names explicitly gets what 16 gives it, and no more. **This document states
that resolution below; it does not claim the sealed sections already state
it jointly.**

**The pinned identifiers.** The three profile names are exactly the keys
`server/services/scoring.service.js` exports and freeze manifest Commit B
seals, and no synonym or display form is admissible anywhere in the evidence
or report schema:

| identifier | prereg 4.3 role | per-reception value | Commit B SHA-256 |
| --- | --- | --- | --- |
| `half_ppr` | **formal primary** | `0.5` | `c82679bf83d475cea25ce54eec835ec86fb7da937770737a42ecc299c443c4f3` |
| `standard` | no-harm sensitivity | `0.0` | `38d7891458c0ba3e514c989bcc5f93e205e7f71f82486ec907ab3026b278063b` |
| `ppr` (full-PPR) | no-harm sensitivity | `1.0` | `2b25b93c3e2625118a4ed8252957b605bc6136a126a2505f5440433e417ff701` |

`ppr` is full-PPR. There is no identifier `full_ppr` and no identifier
`full-ppr` in this contract; the (e2) endpoint KEYS
(`full-ppr-regret-2025`, `full-ppr-pairwise-2025`, section 4.2) are endpoint
names, not profile identifiers, and the two vocabularies must not be
conflated.

**Frozen rules.**

1. **The factorial family (prereg 12.1) is `half_ppr` ONLY.** All 8 cells'
   absolute metrics and all paired deltas versus control are published for
   the primary profile and no other. This is the family a reader treats as
   the study's result, so it carries the formal primary, unqualified.
2. **The attribution composites (prereg 12.2) are `half_ppr` ONLY.** 12.2
   names no profile and is downstream of the 12.1 contrasts.
3. **The prereg 10.6 diagnostics are `half_ppr` ONLY.** Control-vs-naive and
   `usage-signal` name no profile.
4. **The prereg 16 sensitivity publication is `standard` and `ppr`,
   ABSOLUTE METRICS ONLY.** Prereg 16 extends descriptive reporting to those
   two profiles for their absolute metrics and nothing else. **Paired
   deltas, attribution composites, and the 10.6 diagnostics are NOT
   published for `standard` or `ppr`.** A reader wanting a standard-profile
   contrast has (e2)'s gates, which is what prereg 16 says those profiles
   are for.
5. **Activation carries NO profile axis at all.** Prereg 11 publishes
   activation rates "per season and position" and names no scoring profile;
   prereg 11.1/11.2 introduce none. **The activation rows, aggregates, and
   the activation gate therefore have no `scoringProfile` coordinate.**
   Activation measures whether a factor moved a projection, which is a
   property of the model configuration, not of the scoring rules applied to
   the outcome afterwards.

**Rule 5 removes a coordinate rather than adding one, and that is
deliberate.** The Gate 2 implementation carried a `scoringProfile` on the
activation aggregate side while the activation claim side had none, so the
cross-check that ties them compared an axis that existed on only one side.
The sealed text authorizes no such axis, so the correct resolution is to
delete it from the aggregate, not to invent a matching one on the claim.
This is the narrowest reading that makes the two sides agree, and it reaches
the shortest distance past sealed text.

**Interval method.** Every interval in every family above is section 4.6's,
without exception.

**Scope limit.** This section governs DESCRIPTIVE publication only. It
changes no component endpoint, no Level 2/3/4/5 status, no activation
THRESHOLD or verdict (section 8.3 is untouched except for the coordinate
removal in rule 5), and no selection. The (e2) gates continue to evaluate
`standard` and `ppr` exactly as section 4.2 and prereg 9.7 already require -
rule 4 governs what is additionally REPORTED, never what is GATED.

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

## 10. Review history (HISTORICAL RECORD ONLY - confers no authority)

**This section is NOT an approval record and must not be read as one.**
Approvals live exclusively in `APPROVAL_LEDGER.md`. This table is retained
because the review rounds it documents are part of how the specification
reached its current form, and deleting that history would make the
document less auditable, not more.

**Every "APPROVED" row below is VOID as an authority.** Each attaches to a
byte-state of this file that no longer exists - which is precisely the
failure that caused approvals to be moved out of this document. Rows are
left unedited rather than rewritten, so the record of what happened stays
intact.

| review round | outcome | date | notes |
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
| Independent statistical review of revision 13's successor blob | **REJECTED** (R1) | 2026-08-02 | SHA-256 `0661EAFC95...`; 4 blockers: pooled-mean (f) falsifiability against a week-level-delta median estimand; permutation under-specified; reducer not total; player-week x salt veto was an unlabeled substantive amendment -> addressed as revision 14 |
| Independent statistical review of revision 14 | **REJECTED** (R2) | 2026-08-02 | SHA-256 `49620EC2...`; 5 blockers: the `0.30` shortcut is not rounding-equivalent; permutation still under-specified; no Level-3 `not-applicable`; contradictory approval language; four outcome-changing rules misclassified as mechanical -> addressed as revision 15 |
| Independent statistical review of revision 15 | **REJECTED** (R3) | 2026-08-02 | SHA-256 `E507D0C4...`; 2 blockers: (f) self-contradiction (`0.30` still mandated elsewhere); (f) veto status not total, because `missing > vetoed` let a missing sibling endpoint silently mask a fired veto -> addressed as revision 16 |
| Independent statistical review of revision 16 | **REJECTED** (R4) | 2026-08-03 | SHA-256 `8BD263CD...`; 2 blockers: revision/approval routing still contradictory (revision 14 still described as current in two places); the salted hash construction misclassified as mechanical -> addressed as revision 17 |
| Independent statistical review of revision 17 | **REJECTED** (R5) | 2026-08-03 | SHA-256 `F7D6B31F...`; 1 blocker: section 3.2 promised a pinned salt-composition test vector but supplied no literals -> addressed as revision 18 |
| **Independent statistical review of revision 18** | **APPROVED** | 2026-08-03 | SHA-256 `5A0D6E54B2D84494C5D39093C44204A79F32A4DD813F03909C1094339A52BCF8`; scope: sections 3-8. Recorded authoritatively as ledger row 4, with the two user attestations as rows 5-6. **Void as an authority over THIS revision**, per this section's own preamble: revisions 19 and 20 each change the bytes those approvals attach to |
| Gate 2 implementation review (pre-submission, code not this document) | **REJECT** | 2026-08-04 | Reviewed the Gate 2 code built under ledger row 6, at commit `c04d6b1`. Two conformance defects in `scripts/backtest/lib/sweepEvidence.js`: the descriptive scoring-profile axis, and the descriptive interval method. Each had a core the sealed text covered plainly and an edge where it was silent; only the silences required a spec revision rather than only a code fix. **Addressed as revision 19, sections 8.7 and 4.6.** No approval was sought or issued by this round |
| Revision 19 preamble self-correction | **not a review round** | 2026-08-04 | Revision 19 was anchored at commit `9759a64f4d39cf170cf449f3e2635942e425646d` (SHA-256 `16F29146F7CFCC6F9FE5F93199D5291A5CE5BD2E58EBF9A945C26AF498D97DFE`, blob `88ac16980445565eb8fb74dfd178e00686a76d62`) and accumulated **no approvals**. Its preamble asserted in four places that both defects were "traceable to silences" in this document; that overstated the specification's share of the fault, since prereg 4.3 names `half_ppr` primary in plain text and prereg 10.1's percentile rule plainly reaches every delta-valued descriptive family. **Corrected as revision 20**, which changes the preamble and this table only - the normative bodies of sections 4.6 and 8.7 carry over byte-identically from `9759a64` and no ruling changed. Because revision 19 held no approvals, nothing lapsed |
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
