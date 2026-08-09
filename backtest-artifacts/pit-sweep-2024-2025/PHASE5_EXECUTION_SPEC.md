# PHASE5_EXECUTION_SPEC.md - Phase 5 execution addendum

Study id: `pit-sweep-2024-2025` (same study as `PREREGISTRATION.md`).

**Status: revision 36. NO APPROVALS ARE IN FORCE FOR THESE BYTES.**

**[stale status corrected at revision 29]** This line and the one below read
"revision 26" from revision 26 through revision 28, while the document was
twice re-anchored past it. Revisions 27 and 28 each edited the preamble for
other reasons and neither updated the number, so the document asserted a
false claim about its own identity in the two most prominent sentences it
has, in bytes an independent reviewer authenticated. It was not caught by
that review because the preamble is outside the sections 3-8 approval
scope. Section 10.2 records the hazard: **a status line has no locator to
resolve and no arithmetic to check, so neither the locator probe nor a
byte-identity proof can see it go stale.**

Revision 18 (SHA-256 `5A0D6E54B2D84494C5D39093C44204A79F32A4DD813F03909C1094339A52BCF8`)
**was approved** - ledger rows 4, 5, and 6 - and Gate 2 implementation
proceeded under row 6. Revision 19 superseded those bytes and revision 20
supersedes revision 19's, **so those three approvals attach to neither and
must be re-issued against the hash of the current anchor**, exactly as
corrective entry 1 requires. Until they are, nothing is authorized - not
candidate execution, and not further Gate 2 implementation work.

**Neither revision 19 nor revision 20 accumulated any approvals**, so nothing
lapsed when either was superseded. Revision 19 was anchored at commit
`9759a64f4d39cf170cf449f3e2635942e425646d` (SHA-256 `16F29146...`) and
revision 20 at `478ee5a127143fe55b848e22cf5faa18704d4f21` (SHA-256
`76672C35...`). **Across all three, the normative bodies of sections 4.6 and
8.7 are carried over byte-identically** - revisions 20 and 21 change only
narrative and reviewer-facing material. That is checkable in one diff against
either commit:

```
diff <(git show 9759a64:backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md \
        | awk '/^### 4\.6 /,/^## 5\. Permutation control/') \
     <(git show <this-anchor>:backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md \
        | awk '/^### 4\.6 /,/^## 5\. Permutation control/')
```

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
as was revision 15. **The current revision is 36**, and the full chain is
recorded below and in `APPROVAL_LEDGER.md`.

**[status line corrected at revision 34, the FOURTH recorded instance.]** These
two lines read "31" at revisions 32 and 33, having read "29" at revision 30 and
"26" from revision 26 through 28. **Section 10.2's seventh hazard class exists
because of this exact defect and did not prevent its third and fourth
occurrences**: a status line has no locator to resolve, no arithmetic to check,
and byte-identity is silent because the line does not change. It is outside
sections 3-8, so no reviewer scoped to the approval range meets it. **Recording
a hazard class is not an instrument aimed at it**, which is what four
occurrences under a recorded class demonstrate. Section 10.2a now specifies the
identifier-consistency check that is.

**[count corrected at revision 35]** The paragraph above says "the FOURTH
recorded instance", counting stale-status RUNS rather than stale revisions and
miscounting even so. The published record is FIVE stale revisions - 27, 28, 30,
32, and 33 - across THREE runs ("26" at revisions 27-28, "29" at revision 30,
"31" at revisions 32-33; revision 26's own "26" was true when anchored). The
old paragraph is not rewritten; the correction is appended so the miscount
stays visible alongside its repair.

**REVISION 36 ANSWERS THE REVISION-35 STATISTICAL REVIEW ROUND (NO
APPROVAL, finding G-A) AND CHANGES NO RULING.** Zero approvals were in
force, so nothing lapses. Its whole content: five stale-locator repairs
with inline brackets (section 6.1's `:891-892` -> `:934-935`, finding G-A
itself; section 8.7 rule 5's `:305-308`/`:352-354` ->
`:312-315`/`:359-361`, surfaced by the revision-36 systematic citation
sweep with no repaired sibling ever having existed; this preamble's and
section 0's `:418`/`:289` -> `:425`/`:296` pair); the 10.2a status-line
count corrected (finding O-3 of the revision-34 review, deferred then
re-verified against every anchor - this preamble's own copy of the count
was corrected at revision 35 while the 10.2a copy was missed); section
10.2a's locator-check paragraph rewritten for the instrument's
claim-expression tier, continuation extraction and sealed self-validation
- **until revision 36 the fourth instrument had NO known-answer
self-validation, so the revision-35 narration below, which records the
four scripts "known-answer-validated", was false of `check-locators.js`
when written and is left standing with this correction in front of it**;
section 10's table gains this step's row, which also records the reviewer
rotation the study owner accepted; and this paragraph. **Every ruling,
threshold, label and count of revision 35 carries forward unchanged; a
reviewer reads sections 6.1 and 8.7 at their bracket sites and section 0's,
and the confinement set for this step is recorded in the corrective
entry.** The next commission goes to a FRESH reviewer with no prior
exposure, who reads the full scope cold - thirteen of revision 35's
twenty-two changed regions were never read by the round this revision
answers.

**REVISION 35 IS THE B3 RE-CUT'S SPEC STEP: it resolves the deferral batch
recorded at ledger entry 21 item (4), and it MOVES THE APPROVAL SCOPE.** All
four approvals in force against revision 34 (ledger rows 7-10, blob
`e339020a`) lapse at this anchor, per the deferral plan - the first
supersession since revision 18 to lapse live approvals, and the first ever to
lapse an implementation review. What changes, by class:

- **The six user rulings of 2026-08-08** (D1-D6, all "accept the
  recommendation; D1 both-season"): the SPEC-C catastrophic-veto season scope
  sealed as BOTH-SEASON with the veto's own domain size published
  (6.1a/6.4/6.4a, substantive); the two prereg-16 week-window families
  implemented as section 8.7 rules 6-7 with their scope pinned (substantive);
  the `--records-out`/`--records-in` generation-records checkpoint adopted
  (section 9, substantive); prereg 4.1's eligibility propagated into 6.3's
  subgroup membership with the permutation-domain asymmetry stated (6.3 and
  5.2, substantive); 8.7's cohort disclosure extended to half-PPR-priced
  outcome truth (substantive); and the estimand audit trail carried into the
  published document schema (8.4/8.5, substantive).
- **The producer determinations register transcribed** (sections 4.6, 4.6.2,
  5.2, 8.3, 8.4, 8.5, 8.6.0; per-item labels inline; determination 6 is
  WITHDRAWN-CONFORMANT and is recorded in section 10's table only, not
  re-opened).
- **The generation-seam wiring obligations sealed** as section 8.6.6
  (mechanical completions, each forced by an existing sealed requirement).
- **The seven inert findings closed** (eight edits: this preamble's miscount;
  8.7's misdated parenthetical; 8.6.1's defined-implies-MET inference struck
  and re-evidenced; 6.2's list completed with `exactSignTest`'s two
  `<= alpha` sites and `boundAgrees`,
  inertness shown; 8.2b's Level-1 enumeration completed with 6.4a's fifth
  void
  cause; 8.2's untriggered `wide-straddle`-beats-`passed` precedence stated
  from extracted reducer behavior; SPEC-A rides as rule 6-7; SPEC-B is the
  `boundAgrees` row).
- **Disclosures and narrative repairs**: section 9's no-consumer condition
  restated as of these bytes (it is now FALSE - the count has consumers);
  first-run expectations A, B, and D recorded in section 9; the two
  deliberately-unfixed adversarial notes disclosed in 8.6.6; section 1
  re-stated in non-rotting form; section 6.1's owed tests recorded MET;
  locators re-verified against this tree (every drifted citation repaired,
  brackets inline).
- **Housekeeping**: section 10's table regains its row practice (a 33 -> 34
  record, the overtaken implementation-review row's forward clause, and this
  step's row); section 10.2a's bar paragraph records the four instrument
  scripts LANDED and known-answer-validated; section 11.3(b) extended to the
  `--inputs` producer modules and the instruments.

**A reviewer must READ the changed sections, not diff them.** The
confinement check's mapped set for this step, exactly: the preamble and
sections 1, 4.4, 4.6 (the intro and all of 4.6.1-4.6.4), 5.2 (new; section
5's intro and 5.1 are untouched), 6.1, 6.1a, 6.2, 6.3, 6.4, 6.4a, 8.2,
8.2b, 8.3, 8.4, 8.5, 8.6.0, 8.6.1, 8.6.6 (new), 8.7, 9, 10, 10.2a, 10.3 (one
locator repair only), and 11.3's list (b). **Byte-identical
to the revision-34 anchor and safe to diff**: sections 0, 2, 3 (all
subsections), 4.1-4.3, 4.5, 5's intro and 5.1, 6.5, 7, 8.1, 8.2a, 8.6.2,
8.6.3, 8.6.4, 8.6.5,
10.1, 10.2, 11.1, 11.2, and 11.3's list (a).

**Revision 33 answers an independent statistical review that returned NO
APPROVAL on eight findings, and UNLIKE revisions 30, 31 and 32 it MOVES THE
APPROVAL SCOPE.** Five sections inside 1010-3361 change, so this is not a
clean per-region step: **a reviewer must READ the changed sections, not diff
them.**

- **F2, the blocking finding: three stale locators inside frozen
  requirements.** Section 8.6.4 cited `projection.service.js:478-497` for
  `loadCachedRows`; that range is mostly `findRun` and **excludes the
  `byPlayer.set` loop the requirement is about**, which is at `:506-507`.
  Repaired to `:496-524`. Section 6.5's two: "around line 1104" pointed at a
  blank line with the call at `:1127`, and `:261-277` began on a comment with
  the branch at `:270-283`.
- **F1: section 6.2's closing clause asserted leg 2 was unsatisfied before
  revision 29. It was satisfied.** No scope reading admissible at revision 25
  puts `3.80` outside section 6.2's list. What the scope sentence actually
  repaired is a completeness declaration that was FALSE read document-wide,
  since section 8.1's seven passing boundaries are frozen thresholds absent
  from the table. **The classification label is unchanged.**
- **F3: section 4.6 item 3 carried `[substantive prospective amendment]`
  while its body said the level "is NOT re-opened here."** Corrected to
  `[restates prereg 10.1]`; item 4's amendment narrowed to its APPLICATION.
  The error ran in the safe direction.
- **F4: section 4.3 stated `n >= 15` as a universal over every component.**
  False of component (f), whose sealed minimum is prereg 9.8's 8 clusters and
  30 rows. Premise scoped; the conclusion is unaffected.
- **F7: the reviewer packet omitted five sealed sections its own rulings rest
  on** - prereg 3.3, 5.1, 6.2, 7.1, 7.2. Added, and **section 10.2a now
  specifies the packet-coverage check** that would have caught it.
- **F8: section 10.2's heading had been false for eight growths.** It read
  "The negative-existence inventory [added at revision 22]" while holding the
  confinement check, the locator check and eight more classes - 31 lines at
  revision 22, 462 at revision 32. **Split into 10.2 (the inventory) and
  10.2a (the instruments).** Nothing renumbers.

**Revision 32 changes no ruling, no classification, and no ruling-bearing
number, and SECTIONS 3-8 ARE UNTOUCHED.** It closes the three items revision
31 parked, all inside section 10.2, and **it is the last revision before the
independent statistical review is commissioned.**

- **The `server/` figure is restated under ONE definition**: 159 commits, of
  182 touching `server/`, touch neither `backtest-artifacts/` nor
  `scripts/backtest/`. Revision 31 gave a floor of 140 and named two other
  boundaries; **one definition applied consistently beats three offered for
  comparison**, which invites averaging figures that answer different
  questions. The 21-commit gap to the artifact-only boundary is exactly the
  Gate 2 implementation commits.
- **The `.js` invariant's filter is widened from commit SUBJECT to PATH.**
  The two agree at every measurement taken, so this corrects no undercount;
  it makes the check test what the claim means. A study commit typed
  `fix(backtest)` is caught by one and missed by the other.
- **A count over that population rots by construction**, because the
  population grows with the commit that anchors the revision making the
  claim. Entries 14, 15 and the revision-31 ledger commit recorded 24, 25 and
  26; **all three were true when written and the invariant never moved.**
  Quoting such a number now requires naming the anchor it was measured at.

**A stopping rule applies from here.** The scope document is built when no
known-open item would change sections 3-8 or a structural claim the document
makes about itself. **Section 10.2 AND section 10.2a refinements** that
surface after this point **ride to a revision after the review is
commissioned**, because **both are outside the approval scope**: their
improvements make the drafter's checks better and change nothing a reviewer
reads, verifies, or is asked to approve. **[scope extended at revision 33 -
the rule named only 10.2, and revision 33's split moved every instrument it
was written to govern into 10.2a, which would have left the rule covering the
inventory and not the checks.]**
Letting them gate the commission trades a real cost - the review not
happening - against an improvement the reviewer never sees.

**Revision 31 changes no ruling, no classification, and no number, and
SECTIONS 3-8 ARE UNTOUCHED.** It corrects five claims this document makes
about itself, all of one family - a claim or an instrument measuring
something ADJACENT to what it asserts. Section 11.2's three stale bounds are
repaired by DELETING their endpoints rather than refreshing them (section
10.2's new EIGHTH class: a closed-form correction to an unversioned claim
rots again - "through 27" was itself revision 27's repair and had gone stale
by three); section 11.2's preamble bullet pointed at a revision-21 paragraph
that no longer exists; and section 10.2 gains a NINTH class for the
path-scoped confinement diff, whose validity rests on the range containing
one party's commits - a precondition that lapsed when an unrelated 17-file
client feature entered the range without changing the answer.

**And the SEVENTH class fired again in the revision that recorded it.**
Revision 30 specified the confinement check, repaired revision 29's preamble,
and shipped with its own status line reading **"revision 29"** at both sites,
in published bytes. The confinement check saw the preamble change - the
preamble is in revision 30's changed set - but a structural check reports
WHICH sections moved, never whether a sentence inside one is still true. That
is the same adjacency the other four describe, and it is why the status line
needs a reader, not a probe. Corrected here to 31.

**Revision 30 changes no ruling, no classification, and no number, and
SECTIONS 3-8 ARE UNTOUCHED.** It adds one thing: **section 10.2a now specifies
the confinement check** that revision 29's own preamble failed. Map every
changed line to its nearest preceding heading at **any** level, and compare
the resulting set against the set the revision claims - **as a set equality
in both directions**, because a subset check passes the defect that actually
occurred. The check is primary because it has no boundary to resolve and so
none to get wrong; slicing stays secondary. It was validated retrospectively
against revision 28 -> 29 before being adopted, where it reproduces the known
answer including the section 8.6.0 the prose had missed.

**Section 6.2 grew from 27 lines to 74 at revision 29 and must be READ, NOT
DIFFED.** No ruling changed there: all four thresholds in its table are
component-(f) items, so the scope sentence documents a boundary that already
held and no comparison entered or left the list. This is stated here and in
section 10's revision 29 -> 30 row because **revision 29's own row cannot be
edited** - rows are left unedited so the record of what happened stays intact.

**Revision 29 responds to the independent statistical review of revision
28, which issued NO APPROVAL.** It answers all eight findings: section 6.2
gains an explicit component-(f) scope and a stated boundary against section
8.2a (BLOCKER 1); section 3.2's pinned composition vector is corrected from
a 64-character stand-in to the 32 characters `scoringHash` actually
produces (2); section 6.5's "verified against the real call graph" claim is
retracted in place and its locator family repaired (3); section 9's 6,528
is re-attributed from section 8.7 rule 4 to prereg 9.7's sealed gates (4);
and four smaller claims about locators, coordinates and phrase counts are
corrected (5-8). **NO RULING CHANGED, and the mechanical category keeps its
sole member** - finding 4 strengthens that classification rather than
threatening it, since the count turns out to be determinate on sealed text
alone. **Sections 4.6, 8.6.2 and 8.7 are byte-identical to the revision-28
anchor**, verified by mapping every changed line to its owning heading rather
than by slicing.

**[confinement claim corrected at revision 29, before publication]** An
earlier draft of this paragraph named sections 8.6.1 and 8.6.3-8.6.5 as
byte-identical and omitted 8.6.2. **It had the set exactly inverted**: 8.6.2
is the one untouched section of the five, and the other four each carry a
locator repair. **Section 8.6.0 changed as well and the draft named neither
way.** The five changes, in full, and nothing else in these sections:

| section | repair |
| --- | --- |
| 8.6.0 | `projection.service.js:455-459` -> `:475-479` |
| 8.6.1 | `projectionFeatures.js:177-231` -> `:188` |
| 8.6.3 | `:478-497` -> `:496`, and `:483-495` -> `:507` |
| 8.6.4 | `:449` -> `:467` |
| 8.6.5 | `:478-497` -> `:496` |

**No requirement, allowlist entry, field name, or comparator changes in any
of them** - the allowlists name their fields by name, so their meaning never
depended on the citations.

**This paragraph committed the exact defect the round is about**, which is why
it is corrected in place rather than silently: it asserted a byte-identity set
that one command falsifies, in the preamble, in the revision whose subject is
claims this document makes about itself. It also inverted the same 8.6.2
attribution that the fourth hazard class records as having travelled three
hops - section 10.2's outstanding list, the review, and the findings file all
filed the `loadCachedRows` sites under 8.6.2 when they live in 8.6.3 and
8.6.5. **A recurrence inside the correction for that recurrence** is the
sharpest available evidence that the mapping check belongs in the process
rather than in a reader's discipline.

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

**Revision 28 changes no ruling, no classification, and no number. It
corrects SIX SECTION NUMBERS that revision 27 got wrong**, and records the
hazard class they belong to.

Revision 27's repair record named **section 8.6.1** as the home of the
fresh-vs-fresh allowlist whose locators it repaired. **That allowlist is
section 8.6.2's.** The locators, the repair, the "inside sections 3-8" claim
and the 2-modified-1-added delta were all correct; only the subsection number
was wrong, at six sites. It matters because 8.6.1 is the scope section for
the **same assertion pair**, so the pointer resolves to the most plausible
available wrong text - the failure mode section 10.2 records for
`arms.js:213`, committed by the section whose function is to be the work-list
against it.

**Section 10.2 now carries it as a FOURTH hazard class**, distinct from stale
`file.js:NNN` locators, negative-existence claims, and unqualified internal
line citations: **a section attribution resolves, just to the wrong section**,
so neither the locator check nor any byte-identity proof can catch it. The
mechanical rule is recorded with it - **a slice terminator must match every
heading level at or above the target's** - because a terminator of
`/^(### |## )/` does not match `####` and makes section 8.6.1 measure 374
lines where it has 107. Both the drafting and the audit of revision 27
committed the error, with different probes, which is the argument for
recording it as a class.

**Revision 27 changes no ruling. It corrects a DISCLOSED NUMBER that was
wrong in every revision from 13 onward**, answering a reading of sections 1,
2, 9, 10, and 11 - five sections no review round had ever examined - that
raised six findings and issued no approval.

**Section 9's scale statement omitted an entire generation axis.** It counted
as though scoring profile were a REPORTING coordinate, so that one generation
could be re-scored afterwards into `standard` and `ppr`. It is a GENERATION
coordinate: `loadFeatureBundle` takes `rules` as a build-time parameter
(`projectionFeatures.js:425`), every historical stat line is re-priced
through it (`:197`, `:296`) **[locators repaired at revision 36: `:418`
and `:289` had drifted by the +7 comment shift whose section-9 siblings
revision 35 repaired; these preamble occurrences were missed]**, the
module's own docblock says the stored
half-PPR column "is never read as an authoritative value" (`:20-23`), and the
freeze manifest pins each profile by SHA-256 of its rules bytes and
re-verifies the pin. **The corrected total is `14,688`, not `8,160`** - an
understatement of eighty percent.

**The count is fully determined, and section 8.7 rule 4 is what determines
it.** Rule 4 fixes the row set at 8 cells, 2 endpoints, 2 profiles, 2025
only, and rejects outcome-dependent row sets by name, so nothing here waits
on a result: `2 x 8 x 24 x 17 = 6,528`. That makes this
**`[mechanical correction, forced by an implementation fact]`** - and it is
**the first member that category has ever had**, so section 0 now records its
boundary (the definition's "sealed text" is DESCRIPTIVE, since section 9's
count sits in this document), its three conditions shown rather than cited,
and the provenance of how the member was admitted.

**Five errata ride along**, all outside the rulings: section 2 named
`sweepEvaluator.js` as consuming three `arms` exports it references zero
times; four `projectionModel.js` `effectiveGames` locator sites had drifted,
**two of them inside section 8.6.2's normative allowlist**, so sections 3-8
are NOT byte-identical at this step; section 11.2 described section 10's
table as current five revisions ago, pointing readers away from section 10.3;
and section 1 claimed "zero occurrences" where the obvious grep returns one.

**Revision 26 changes no ruling and no classification. It hardens the TEST
that section 0 uses to license one**, answering a statistical review of
revision 25 that raised three findings and issued no approval.

**No finding impugned the sole member or any ruling.** All three were
durability defects: ways revision 25's three-leg test could admit a FUTURE
contradiction it should exclude. Section 0's test now has **five legs**:

- **Leg 2 absorbs the contested-set qualifier.** The sentence doing the real
  work - a completeness declaration over a set whose membership is itself
  disputed forces nothing - sat thirty-one lines below the legs, in the
  non-member discussion, where a drafter applying the legs in order would
  never reach it.
- **Leg 4 adds UNIQUENESS.** Nothing previously required that only one
  passage satisfy the legs. Two passages each governing and directing
  different things would each have qualified as "the governing passage",
  licensing a mechanical label on precisely the case the category exists to
  prevent - because choosing between two decisions is itself a decision.
- **Leg 5 adds PRIORITY AND IMMUTABILITY**, and is the one exploitable
  deliberately rather than reached by error. Without it, a drafter owing a
  substantive label could add a passage specifying the outcome they wanted,
  observe that it contradicts the older rule, and withdraw the older rule as
  a "mechanical correction" - **manufacturing the forcing condition inside
  the same revision that invokes it**. Leg 5 requires the governing passage
  to predate the correction, be unmodified by it, and have that identity
  **shown rather than asserted**.

**Both new legs are demonstrated for the sole member in section 0 itself**,
by enumeration for leg 4 and by an eight-revision diff for leg 5. A revision
that added a "shown, not asserted" requirement while asserting its own
compliance would be self-refuting.

Revision 26 also tightens the section 4.6 characterization - it does contain
a universal, over a set section 8.7 defines, so leg 2 fails rather than the
section being silent - and removes two stale INTERNAL line citations that
revision 25 introduced and that its own edit invalidated. **The test is NOT
claimed closed**; section 0 says so directly.

**Revision 25 changed no ruling at all. It corrected how revision 24
CLASSIFIED and GROUNDED one**, and disclosed that the contradiction the
change resolves was present in bytes that were approved.

The tie-rounded `catastrophicCapCouldFire` comparison stands exactly as
revision 24 adopted it. What was wrong was the reasoning around it:

- **Section 6.2 of this document already compelled that form**, and names
  `3.80` in a table declared to be "the complete list of such comparisons,
  and nothing else." Revision 24 searched the PREREGISTRATION for authority,
  found prereg 6.6 reaching the comparison only at its boundary, concluded
  the question was open, and labeled the resolution a substantive
  prospective amendment. It also cited section 6.2 in its own supporting
  prose **without opening it**.
- **The label is therefore wrong by section 0's own test.** A substantive
  amendment is "a decision a reasonable reader could resolve differently"; a
  reader who reaches section 6.2 cannot. Revision 25 reclassifies it as a
  **[mechanical correction, forced by an internal contradiction]** and
  regrounds it on section 6.2, citing the governing lines.
- **Section 0 gains that category**, which did not exist. Its absence is why
  the change had no honest label available. **The category has exactly one
  member**, and section 0 records one explicitly excluded case alongside it -
  sections 4.6 and 8.7 at revision 21, which was drafted here as a second
  instance and then failed the category's own test, because section 4.6
  declared no completeness and never named activation. Revision 22 was right
  to call that one substantive. The non-member is kept because it draws the
  edge, and answers a reviewer's first question about any downgrade.
- **Section 10.3 discloses** that revision 18 - **approved 2026-08-03 as
  ledger rows 4-6** - contained both section 6.2's rule naming `3.80` and
  section 6.1's directive prescribing the opposite form, and that the
  contradiction survived revisions 19 through 24 unnoted by any review
  round, including the one that approved it. No verdict, status, or
  published number is affected, and the implementation always followed
  section 6.2; the harm was to reviewability.

**A downgrade from substantive to mechanical makes a revision easier to
approve.** Section 0's new category therefore states its forcing condition
in the label itself, and section 6.1 states plainly why the downgrade is
honest rather than convenient: the governing passage names the object, and a
reader reaching it has no second reading available.

**Revision 24 changed no existing ruling and added one new one.** It answered
a statistical review of revision 23 that raised findings and issued no
approval. Three rounds of adversarial reading produced **no finding against
any ruling in this document**; every defect was in the scaffolding beneath
them - citations, counts, and directives - which is exactly the material a
byte-identity proof is trusted to cover and cannot see. What changed:

- **Five satisfied directives now carry dated status blocks** (section 4.4
  items 1 and 2; section 6.1's `0.30` constant, `3.80` constant, and
  evaluability-guard rewrite). Each was written in the present tense about
  code that had already satisfied it, so each read as pending. The
  requirement text is preserved and the status recorded beneath it, rather
  than the requirement being rewritten into the past tense - in a
  preregistered document, what was required and when it was met is worth
  more than a tidier sentence.
- **One directive is recorded NOT MET**, in the same place and the same
  form: section 6.1's required test that `FALSIFIABILITY_FLOOR` is
  referenced by nothing returning a status. Recording it alongside the five
  met ones is the point - a block that only ever says MET cannot distinguish
  done from pending.
- **Section 6.1 gains a labeled substantive amendment**: the
  `catastrophicCapCouldFire` comparison is tie-rounded on both operands
  rather than bare. Prereg 6.6 supports that form and does not compel it,
  and the section says so in those words rather than citing 6.6 as if it
  settled the question.
- **Section 8.6.0's endorsement of `assertControlBitIdentity` is
  withdrawn.** It described that helper as already implementing "exactly
  this comparison" four lines above the bullet forbidding that exact use,
  which would pass vacuously on two `Map`-carrying run objects.
- **Ten stale locators are repaired, and section 10.2's inventory of them is
  corrected** on four counts, including a phantom entry cited nowhere in
  this document and a blanket claim that locator drift never carries a false
  statement, which is untrue wherever the citation sits inside a directive.

**The status-block form is ADOPTED here as this document's standing way of
recording a satisfied requirement.** Revision 22 introduced it at a single
site in section 8.6.1; revision 24 applies it at six more. It is adopted by
this sentence rather than by repetition, because a convention that becomes
standing by propagation is harder to revisit than one that became standing
by decision. **[rule added at revision 35, per the accepted round-3
disposition]** **Definition and export are never evidence of invocation, and
no status block may cite them as such.** A MET status must cite the evidence
that the required thing actually RUNS - a call site on the governed path, or
a test that fails when the invocation is removed - never that a function
exists and is exported. The worked instance is section 8.6.1's single-leaf
guard block, whose revision-22 form inferred MET from definition and export
and is re-evidenced at revision 35 from actual invocation.

**Byte-identity for the 23 to 24 step is available PER REGION, not
document-wide.** Sections 4.6 and 8.7 are byte-identical to revision 23 and
may be diffed. Sections 4.4, 6.1, 8.6.0, 8.6.2, 10.2, 11.2, 1, and this
preamble changed. Section 6.1 carries a new substantive amendment and cannot
be diffed past. Earlier ledger entries answered this question document-wide
in both directions - unavailable for 21 to 22, available for 22 to 23 - and
carrying either regime forward gives the wrong answer for half of this one.

**Revision 23 changed no ruling. It repaired four pieces of false or
self-contradictory scaffolding sitting under conclusions that survive
unchanged**, all found in a review round against revision 22:

- **Section 4.6.1 said 2024 carries "eight of the thirteen" (e2)
  inequalities.** It carries FOUR. Prereg 9.7's nine rows yield thirteen
  endpoint-season inequalities: coverage at 2025 is one, the MAE/RMSE/rho/WIS
  rows at "2025 and 2024" are eight across BOTH seasons, and the four
  scoring-profile rows are 2025-only. "Eight" counted the dual-season rows'
  total, half of which is 2025. The ruling is unaffected - publishing both
  seasons needs one 2024 inequality, and component (e1) alone would carry it.
- **Section 8.7 rule 4 said "This is NOT the eight-cell factorial grid."** It
  IS the same eight cells, as the same rule states nine lines later and as
  section 4.6.2 corroborates by naming rule 4's family as one of exactly two
  absolute-metric families published across the eight cells. What separates
  rule 4 from rule 1 is the endpoint count, the absolute-only limit, and the
  season - not the cell count.
- **Section 4.6.1 claimed both seasons unqualifiedly** while rule 4 restricts
  its family to 2025 only, and section 4.6.2 places rule 4's family inside
  4.6.1's stated scope. Specific-governs-general would resolve it, but nothing
  in 4.6.1 deferred. The carve-out is now stated at the source.
- **Section 4.6.4 cited two supports that do not hold.** Details in that
  section; both are restated at their real standing, and the branch they
  support now rests on prereg 6.2 and prereg 16, which are sufficient.

**Because no ruling moved at that step, the byte-identity check WAS
available for the 22 to 23 step**, unlike the 21 to 22 step: sections 4.6.2,
4.6.3, and all five of section 8.7's rules were byte-identical. That
statement is about the 22 to 23 step only. **Revision 24's own regime is
stated above and is neither of these - it is per-region.**

**Revision 22 was the first revision since 18 to change a RULING.** Revisions
19-21 were narrative and packet corrections; revision 22 answers a findings
round against revision 21 and changes normative text in sections 1, 4.6,
8.6.1, and 8.7. What changed, and why:

- **Section 8.7 rule 4 now fixes a ROW SET**, not only the metric-type axis.
  Revision 21 named prereg 16 without inheriting a row set from it - the only
  one of the five rules whose family had none - leaving two defensible
  readings a 14x apart in published rows, each with a 100,000-draw bootstrap
  attached and nothing to hard-fail either. Rule 4 is now bound to (e2)'s own
  scope, with the cell set fixed independently of Level 5 selection.
- **Section 8.7 rule 5 PINS activation to `half_ppr` instead of removing its
  profile axis.** Revision 21's removal rested on a false premise - that
  activation is profile-invariant - when `homeAway.effect` derives from
  `calculateFantasyPoints`, making the exact-zero numerator event
  profile-contingent. Pinning applies this document's own inheritance canon;
  removal invented an exemption.
- **Section 4.6 no longer claims the sealed text is silent about
  absolute-metric intervals.** Prereg 10.1's first five bullets already bind
  them; only bullet 6's bound is delta-phrased. The amendment label is now
  scoped to the two items that are genuinely extensions, because labeling
  sealed content as amendable runs in the direction of loosening the seal.
- **Section 4.6 gains a SEASON coordinate, a total reducer, a definition of
  "surviving" for a statistic with no comparator, and a correct account of
  what "shared resamples" means when `n` varies** (4.6.1-4.6.4). Each closed a
  gap through which a descriptive-only row could have gone unpublished,
  thrown inside a mandated primitive, or been built two different ways.
- **Section 4.6's moving-block carve-out is withdrawn.** It said the primary
  interval "is not computed" for a row carrying a moving-block sensitivity,
  which contradicts prereg 10.5's sealed precondition that there be a primary
  CI to report alongside.
- **Sections 1, 8.6.1, 8.6.2 repair claims that went false when the CODE
  changed** - the `sweep`-mode barrier, the `resolveConstants` builder, and
  the `PROJECTION_COLUMNS` locator - none of which any byte-identity proof
  could have surfaced, because the document did not change.

**Revision 21 corrected section 11, the reviewer packet.** It also touched
the preamble, section 1's authorization paragraph, and added a row to section
10's table - revision 21's own claim that it changed section 11 "and nothing
else" was false, and is withdrawn here. **[corrected at revision 22]**
Section 11.2's itemized correction summary stopped at review round thirteen
while this document reached revision 21, and section 11.3's packet contents
predated everything now under review: it omitted **prereg 12.1 and 12.2**,
which section 8.7's rulings rest on directly, named `metrics.js` only for
`SALTS`/`saltPairedDelta`/`buildBootstrapResamples` while section 4.6
mandates its percentile-bootstrap primitives, omitted `freezeManifest.js`
where the three scoring-profile identifiers and their Commit B digests are
pinned, and carried a "does not yet" claim about `resolveConstants` that
`arms.js`'s `resolveConstantsWithStoredHistory` had since made false. A
packet is USED rather than audited, so a stale one misdirects silently and is
never caught by the review it feeds. **No ruling changed; sections 4.6 and
8.7 are byte-identical to revisions 19 and 20.**

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

**This category had ZERO members through revision 26.** It occurred exactly
once in this document: in the definition above. **Revision 27 is its first
use, which makes revision 27 the round where its boundary gets set.** The
fourth category records a member AND a non-member because the edge is what
makes a category safe to use. This one had neither.

**MEMBER - revision 27's scale correction (section 9).** All three
conditions, in order:

1. **The derivation rests on a false assumption about the implementation.**
   Section 9 counted as though scoring profile were a REPORTING coordinate
   applied after generation. `projectionFeatures.js:425` threads `rules`
   into feature construction and `:197`/`:296` re-price every historical
   stat line through it **[locators repaired at revision 36; `:418` and
   `:289` had drifted]**, so the profile changes the features and therefore
   the projection itself.
2. **Arithmetic alone determines the corrected number.** Section 8.7 rule 4
   fixes the cell scope at 8, the endpoints at 2, the profiles at 2, and the
   season at 2025 only, and forbids an outcome-dependent row set by name.
   `2 x 8 x 24 x 17 = 6,528`, with no free parameter left open.
3. **The number cannot change any verdict.** SHOWN in section 9, with both
   commands and their results recorded, rather than asserted here.

**BOUNDARY DECISION - "the sealed text's OWN derivation" is read
DESCRIPTIVELY, not as a locus requirement. [decided at revision 27]** The
definition above was written against a case where the defective count sat in
sealed preregistration text. Section 9's count sits in THIS document, so the
reading had to be settled before the category could take its first member.
The three conditions test WHY the number is wrong, WHETHER the fix is
determinate, and WHETHER it can move a verdict. **Which document the number
was written in bears on none of the three.** Two counts with identical
defect, identical determinacy, and identical inertness cannot earn different
labels on the strength of which file they sit in, and no rationale for that
asymmetry survives inspection except "stricter is safer" - which is not a
reason, and is precisely how a test acquires legs that do no work.

**PROVENANCE OF THE FIRST MEMBER, disclosed rather than left to be
discovered.** The member was admitted in the same round that found the
defect, by the same party that drafted the correction, under a boundary
reading settled in that same round. **This is the shape leg 5 of the fourth
category exists to catch**, and the fact that leg 5 does not formally bind
THIS category is not a reason to behave as though the hazard is absent. It
is recorded so a later reader can weigh the first member knowing how it was
admitted. Section 10.3 is this document's precedent for disclosing exactly
this kind of fact about its own history.

**[mechanical correction, forced by an internal contradiction]** **[added at
revision 25, hardened at revision 26]** - a case where TWO passages of THIS
DOCUMENT direct different things about the same object, and one of them
governs on its own terms. The correction adopts the governing passage,
withdraws the other, and introduces no new content - the document had
already decided, in a place its own reader would reach.

**A passage governs only if ALL FIVE of the following hold.** They are
numbered so a reviewer can test them one at a time and name which one fails:

1. **Subject.** Its subject is that class of decision - not a passage that
   mentions the object while ruling on something else.
2. **Completeness over an uncontested set.** It declares its scope complete,
   **over a set whose membership is not itself the matter in dispute**. A
   completeness declaration ranging over a set whose membership is exactly
   what is disputed forces nothing, because it does not settle whether the
   object is inside it.
3. **Naming.** It names the object explicitly.
4. **Uniqueness.** **No other passage of this document satisfies legs 1-3
   for the same object.** Where two passages each govern on their own terms
   and direct different things, the conflict is substantive by construction:
   the document decided twice, not once, and choosing between two decisions
   is itself a decision a reasonable reader could resolve differently.
5. **Priority and immutability.** The governing passage **predates the
   correction and is unmodified by it.** The revision making the correction
   must not create, edit, or extend the passage it cites as governing; that
   passage must be byte-identical to its state in the revision where the
   contradiction arose, **and the identity must be SHOWN, not asserted.**

**Leg 5 exists because without it this category is a general-purpose
downgrade for any substantive change.** A drafter who wanted to replace rule
A with rule B, and who would otherwise owe a substantive label and an
approval, could in a single revision: add a passage whose subject is that
class of decision, declare its list complete, and name the object,
specifying B; observe that it now contradicts A; and withdraw A as a
"mechanical correction, forced by an internal contradiction." At the
post-edit bytes every other leg holds - **including leg 4, precisely because
A was withdrawn** - and "the document had already decided" becomes true only
in the sense that it decided four paragraphs earlier, in the same revision,
for this purpose. **A document may not manufacture its own forcing
condition.**

**This category has exactly ONE member**, and one explicitly excluded case.
The exclusion is recorded with it, because the edge is what makes the
category safe to use.

**MEMBER - revision 24's `catastrophicCapCouldFire` comparison form
(section 6.1).** Section 6.2 governs. All five legs, in order:

1. **Subject**: section 6.2's subject is precisely which comparisons are
   normalized at a boundary. Its heading is "Normalize every boundary
   operation" and it rules on nothing else.
2. **Completeness over an uncontested set**: it declares its list "the
   complete list of such comparisons, and nothing else". The set is
   "comparisons against a frozen threshold", whose membership is not what
   was disputed - the dispute was over the FORM of one comparison already
   inside it, not over whether it was inside.
3. **Naming**: the list names `3.80`, "the `catastrophicCapCouldFire`
   transparency line", by threshold and by field.
4. **Uniqueness - shown at revision 26 by enumeration.** Every completeness
   declaration in this document was enumerated, and every mention of `3.80`
   and of `catastrophicCapCouldFire` was inspected. The other completeness
   declarations rule on different classes of decision - section 4.6.2's
   surviving-week partition, section 5.1's generator pinning, section 8.2's
   status truth table, section 8.6.1's single-leaf constants diff, section
   8.7's scoring-profile assignment, section 3.4's runtime salt check - and
   **none of them names `3.80` or `catastrophicCapCouldFire` at all.** The
   only other passages carrying both are quotations OF section 6.2: the
   block quote in section 6.1 and the disclosure table in section 10.3.
   A quotation of the governing passage is not a second governing passage.
5. **Priority and immutability - shown at revision 26 by diff.** Section 6.2
   is **byte-identical across revisions 18, 19, 20, 21, 22, 23, 24, and
   25**: 27 lines heading-through-section-end, 26 lines body with trailing
   blanks stripped, **0 differing at every step**, with each version's
   boundaries resolved independently. It therefore predates the
   contradiction's discovery, predates revision 25's correction, and was not
   touched by it. Revision 26 does not modify it either - see section 4 of
   this revision's confinement report.

   **REVISION 29 EDITS SECTION 6.2, AND THIS LEG IS UNAFFECTED. [noted at
   revision 29]** A reader who diffs section 6.2 against any recent anchor
   will find it changed - it grows from 27 lines to 74 - and must not
   conclude leg 5 was violated. **The claim above is CLOSED and historical**:
   it states that section 6.2 was byte-identical across revisions 18 through
   25, which is what establishes that revision 25's correction did not touch
   its own governing passage. That is a fact about revisions 18-25 and no
   later edit can falsify it. Leg 5 asks whether the governing passage
   predated **the correction invoking it** and was unmodified **by that
   correction**; it does not freeze the passage forever. Revision 29's edit
   answers an unrelated finding - the section stated no scope at all - and
   **the scope it states keeps `3.80` inside the list**, so section 6.1's
   member survives on the same terms. Had revision 29 instead narrowed the
   list to exclude `3.80`, leg 2 would have failed and the classification
   with it; that is the change this note exists to distinguish from the one
   actually made.

Corrected at revision 25; the demonstrations for legs 4 and 5 were added at
revision 26, when those legs were.

**NOT A MEMBER - sections 4.6 and 8.7 at revision 21**, which contradicted
each other about whether activation carried section 4.6's interval. Measured
against the test above at the bytes where the contradiction existed
(`ed5b001`):

- **Section 4.6 fails legs 2 and 3.** Its 66 lines DO contain a universal -
  "**Every** published interval in the descriptive families of section 8.7 -
  absolute metrics, paired deltas, attribution composites, and the prereg
  10.6 diagnostics alike - is:" - so it is not silent, and an earlier
  draft of this passage overstated the case by saying it declared no
  completeness "of any kind". **But a universal claim over a set that
  ANOTHER section defines is not a declaration that one's own scope is
  complete**: section 4.6 ranges over "the descriptive families of section
  8.7" and leaves membership of that set to 8.7, which is the contested
  question. Leg 2 fails. **Leg 3 fails outright and unambiguously**:
  activation appears nowhere in those 66 lines - the object was OMITTED from
  the enumeration, not named by it.
- **Section 8.7 fails legs 1 and 2.** "Every interval in every family above
  is section 4.6's, without exception" is a completeness claim, and rule 5
  does name activation, so **leg 3 passes**. But *whether activation was one
  of the families above* was the dispute itself, so the completeness ranges
  over a contested set and **leg 2 fails**. And the sentence is a one-line
  aside in a section whose subject is scoring-profile assignment, not
  interval method, so **leg 1 fails** too.

**Note the symmetry, which is what makes this the instructive exclusion.**
Each section deferred the contested set to the other: 4.6 ranged over "the
families of section 8.7", and 8.7 ranged over "every family above". Two
mutually-deferring universals settle nothing between them.

This is leg 2 doing the work, which is why revision 26 moved the
qualifier INTO leg 2 rather than leaving it here as commentary: **a
completeness declaration over a set whose membership is the thing in dispute
forces nothing.** Stated only in this discussion, it was thirty-one lines
below the legs, where a drafter applying them in order would never reach it.

Neither passage governed on its own terms, so choosing between them genuinely
was a decision a reasonable reader could resolve differently. **Revision 22
classified it as a substantive amendment, and that was correct.**

**A downgrade from substantive to mechanical makes a revision easier to
approve, so the bar is the forcing condition, not convenience.** The label
names that condition so a reviewer can test it directly: if a reasonable
reader could reach the governing passage and still resolve the question the
other way, the forcing condition fails and the change is substantive.
Nothing here licenses reclassifying a decision merely because one reading
seems better argued - and the excluded case above is the worked example of a
contradiction that did NOT qualify.

**This test is NOT claimed to be closed [revision 26].** Revision 25 stated
it in three legs. A review of revision 25 found three ways those three legs
could be satisfied by a contradiction the category should not admit -
two passages both governing, a completeness declaration over a contested
set, and a passage manufactured by the correction itself - and revision 26
closes all three by adding legs 4 and 5 and by folding the contested-set
qualifier into leg 2. A fourth such shape was searched for and not found.

**That is "we looked and did not find one", which is exactly the evidence
that was available before the third was found.** No claim is made here that
five legs are sufficient, and a future reviewer should treat the absence of a
sixth as unproven rather than settled. If the test is ever relied on for a
second member, the right question is not "does it pass the five legs" alone
but also "what would a drafter who wanted the wrong answer do with them."

---

## 1. Gate 0 - hold

**Reference frame, stated explicitly [revision 22].** The clauses below are
evaluated **at the freeze state** (Commit A6 `d469050`, Commit M6 `109125c`,
Commit B2 `dfd8ae1`), which is the only frame in which the Gate 0 barrier
means anything: prereg 17 requires candidate sweeps to execute from a
detached worktree checked out at B, so what matters is what B2's tree
carries, not what `integration`'s HEAD carries. **One clause is now false at
HEAD and true at B2, and revision 21 did not say so**: `sweep` mode. At HEAD
**[re-verified against this revision's tree at revision 35]**,
`backtest-entrypoint.js:285` is
`const MODES = Object.freeze(['freeze', 'sweep', 'inputs'])` with `runSweep()`
at `:311`, and both `server/scripts/run-backtest-sweep.js` and
`server/scripts/run-backtest-inputs.js` exist. **At B2,
`backtest-entrypoint.js` contains exactly ONE occurrence of the string
`sweep`, at `:58`, and it is the study-id path segment
`pit-sweep-2024-2025`, not a mode. [corrected at revision 27]** Revisions 21
through 26 said "zero occurrences", which the obvious grep falsifies on the
first line it returns. **No sweep MODE exists at B2**, which is the claim
that was meant and is the one that carries the argument. The mode was added
by `41a8a65`, after the freeze.
**This does not weaken the hold - it strengthens the reason for it.** The
sweep machinery exists but lives outside the freeze B2 pins, which is exactly
the mismatch Gate 4's B3 re-cut must resolve.

Verified against the freeze state named above: `backtest-entrypoint.js` stops
after Step 1 (rosters/cohort artifacts) and the control-only blinded MDE -
**at B2 no `sweep` mode exists** (see the paragraph above for HEAD);
`backtest-reproduction.yml` regenerates and byte-compares M and
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

**Authorization state as of THE ANCHORED BYTES: NOTHING IS AUTHORIZED.
[re-stated in non-rotting form at revision 31; re-drafted at revision 35,
which the facts changed]** Zero of the four approvals are in force against
THESE bytes. Revision 18 held three (ledger rows 4-6) and Gate 2
implementation proceeded under row 6; revision 19 superseded those bytes and
all three lapsed. **Revision 34 then accumulated ALL FOUR approvals** -
ledger rows 7-10, each authenticating blob `e339020a`: the independent
statistical review, the two user attestations, and the independent
implementation review of the complete implementation. **THESE bytes
supersede that blob, so all four lapse at this anchor** - the first
supersession since 18 to lapse live approvals, the first ever to lapse an
implementation review, and a step taken knowingly under the deferral plan
recorded at ledger entry 21 item (4), not by accident. Every OTHER revision
between 18 and 34 accumulated no approvals, and section 10's table is the
enumeration.

**This paragraph carried four rotting endpoints until revision 31**: it
opened "as of revision 28" while the document stood at 31, bounded the
no-approval run at "19 through 27", enumerated "23, 24, 25, 26, and 27"
without 28, and closed "revision 28 awaits all three fresh approvals" - **a
claim about authorization that was false by three revisions, in the block
whose only job is to say what is authorized.** The endpoints are **deleted
rather than refreshed**, because refreshing them is section 10.2's EIGHTH
class: a closed-form correction to an unversioned claim rots again, with a
newer number and an appearance of greater care. A claim about *these bytes*
is true by construction at every anchor; a claim about a numbered revision
is true until the next one.

**THIS REVISION awaits all FOUR fresh approvals**: its own independent
statistical review (sections 3-8, which is where sections 4.6, 5, 6, and 8
sit and where this revision's substantive amendments land), the two user
attestations (the S3 deviation, unchanged in substance from revision 18, and
the remainder), and the independent implementation review - strictly last, of
the COMPLETE implementation at the intended freeze-candidate head. **The
sequencing adopted for the re-cut is stated here rather than left silent: all
four approval rows are appended BEFORE the Gate 4 freeze chain (A' -> M' ->
B3) is cut, so `POST_B_ALLOWED_PATHS` stays output-only; and the object the
implementation review examines is the FREEZE-CANDIDATE HEAD** - the last
non-output commit - **which this document reads as satisfying the hold's
"that implementation has passed Gate 3 verification (including the
independent implementation review)" clause**, since the re-issued review is
among the four pre-freeze rows and B3's tree differs
from the reviewed head only by the regenerated MDE artifact and the freeze
manifest, both
generated outputs. That reading is flagged to the reviewer; if it is ruled
insufficient, the fallback is naming `APPROVAL_LEDGER.md` on the repaired
allowlist, disclosed as such. **Section 10.3 is required reading before any
of the four**: it discloses that the bytes approved as rows 4-6 contained an
internal contradiction between sections 6.1 and 6.2 that six subsequent
revisions did not catch.

**THE SECTIONS 3-8 BOUNDARY IS THIS DOCUMENT'S DOMINANT FAILURE GEOMETRY, and
it is stated once here rather than instance by instance. [folded at revision
29]** Revisions 26 through 28 recorded these as separate "scope asymmetries",
first and second. They are one structural fact with five known instances:
**for each, the defect and the thing that would have caught it sit on
OPPOSITE SIDES of the approval boundary**, so no single reviewer's scope
contains both.

| the defective half | the half that would catch it |
| --- | --- |
| section 6.1's label, INSIDE | section 0's five-leg test licensing it, OUTSIDE |
| section 9's scale attribution, OUTSIDE | section 8.7 rule 4 and prereg 9.7, INSIDE |
| section 3.2's stale `:1113`, INSIDE | section 10.2's inventory that deleted it, OUTSIDE |
| section 6.2's unstated scope, INSIDE | section 8.2a's contrary convention, INSIDE - the one instance where both halves were in scope, and four rounds still missed it |
| the preamble's stale revision number, OUTSIDE | nothing; no locator, no arithmetic |

The consequences differ by direction and both directions are real. Where the
licensing half is outside, **a review can examine whether a label was
correctly applied but not whether the test licensing it is sound.** Where the
governing half is inside, **a reviewer can falsify a correction they cannot
approve** - section 9's arithmetic fails if rule 4 does not say what section 9
claims, even though section 9 is out of their reach.

**This document does not resolve the geometry; it records it**, because the
remainder attestation's scope is the approver's decision and this is what
turns on it. **The fourth row is the warning against assuming scope is the
whole problem**: both halves sat inside sections 3-8 and four review rounds
passed over the contradiction anyway. **[re-stated at revision 35]** The
implementation work this revision's rulings require has LANDED at these
bytes, test-pinned. It proceeded while rows 7-10 were IN FORCE and under
the user's explicit 2026-08-08 rulings; the deferral plan of ledger entry
21 item (4) is what SCHEDULED the pre-freeze code window, and the
then-in-force approvals are what the work landed under - a plan schedules,
it does not authorize, and no narrative text supplies an approval.
**Candidate-cell execution remains barred**, gated
on all four fresh approvals, Gate 3, and the Gate 4 freeze chain, per the
hold above.

**Implementation conformance, as of THESE bytes. [re-drafted at revision 35;
the revision-24 account of a non-conformant Gate 2 implementation went false
as the code was brought into conformance across the subsequent rounds]** The
implementation at this anchor carries everything this document requires of
it, and the two items revision 24 recorded as owed - section 6.1's test that
`FALSIFIABILITY_FLOOR` is referenced by nothing returning a status, and the
mutation test that changing `0.30` alone changes no status - **now exist and
are recorded MET in section 6.1's status block, with their locations**. The
code changes this revision's own rulings require (D1-D6) landed 2026-08-08,
each pinned by tests, BEFORE this text was anchored - code first, spec
citations taken against the tree they will freeze with, per the lesson of
the ten stale locators at revision 24. The independent implementation review
must be RE-ISSUED against the freeze-candidate head; its lapsed predecessor
(row 10) is history, not authority.

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
assertions. **[consumer list corrected at revision 27]** **Seven modules
consume those three exports directly**: `controlCellEvaluator.js`, `mde.js`,
`sweepEvidence.js`, `sweepInference.js`, `sweepPreflight.js`,
`sweepReport.js`, and `server/scripts/run-backtest-sweep.js`.

**`sweepEvaluator.js` does NOT, and every revision through 26 said it did.**
It requires `arms` (`:21`) and uses `classifyBootstrapEndpoint`,
`exactSignTest`, and `classifyTriggeredEndpoint`, but references none of
`ALL_CELLS`, `SELECTION_FAMILY`, or `CONTROL_CELL` - zero occurrences of any
of the three. Of the Gate 2 sweep modules it was the ONE that does not
consume them. **Because it does require `arms`, the error did not announce
itself**: a reader checking whether the named module depends on the named
file would find that it does, and stop.

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
(`:1134`) -> `mulberry32` (`:333`), exactly as every existing caller already
does with the unsalted value. **[locator corrected at revision 29]** The
call site was cited as `:1113`, which is `};`; the five-argument call is at
`:1134` and the definition at `:322`. Section 10.2 records why this one
survived a probe that was reported as having removed it.

**Why the colon is safe as a delimiter here**: `scoringHash` is a
fixed-length lowercase hex digest and the salts match `pit-NN-[0-9a-f]{12}`,
so neither operand can contain a colon and the composition is unambiguously
parseable back into its two parts. A delimiter that could appear inside
either operand would admit two different `(hash, salt)` pairs composing to
the same string, which is why the choice is pinned rather than left open.

**Pinned composition vector:**

- `scoringHash = "0123456789abcdef0123456789abcdef"`
- `salt = "pit-01-879c6f8eae4b"`
- expected `hashValue = "0123456789abcdef0123456789abcdef:pit-01-879c6f8eae4b"`

The required test MUST assert byte equality against that literal expected
value.

`salt` here is the first of the 24 preregistered salts (prereg 8.1),
verbatim. `scoringHash` is a synthetic 32-hex-character stand-in of the
correct shape - the vector pins the COMPOSITION rule, not any particular
scoring profile's real digest, so it stays valid regardless of which
profile is being hashed.

**[width corrected at revision 29]** Revisions 18-28 gave this stand-in as
**64** hex characters and called it "the correct shape". It is not:
`scoringHash` is `sha256(...).digest('hex').slice(0, 32)`
(`projectionModel.js:317-319`), so its range is 32 characters and the
mandated byte-equality test above pinned the composition rule against a
left operand the function can never produce. No seed stream is affected -
colon concatenation is width-independent, so the composition rule itself
survives unchanged, and the colon-safety argument above is untouched
because a 32-character lowercase hex digest still cannot contain `0x3A`.
What was wrong is the shape claim and the strength of the required test.
Section 3.4's test 4, which verifies the unsalted path "against
production's own existing output", is what would have collided with the
64-character literal had both been executed.

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
   `lib/arms.js:225`) as the integration check that salting the derivation
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

Prereg 10.4 requires `n >= 15` for **a BOOTSTRAP component** - (a) through
(e2) - to be evaluable at all; prereg 10.2's cluster-count trigger fires
below 12. Since `15 > 12`, the cluster-count half of the trigger can never
fire; **only the degenerate-distribution condition can, and it is evaluated
PER ENDPOINT, independently** - a two-endpoint component (every co-primary
component (a) through (e1)) can have one endpoint trigger while its sibling
does not.

**[premise scoped at revision 33]** Revisions through 32 stated `n >= 15` as
a universal over every component. **It is false of component (f)**, whose
sealed evaluability minimum is prereg 9.8's: *"at least 8 distinct 2025
season-week clusters with subgroup rows in both cells, AND at least 30
subgroup rows in total."* Section 8.2's own Level-2 table already names the
8/30 minimum, so the document stated both and contradicted itself across two
sections.

**The conclusion of this section is unaffected** - the cluster-count trigger
is dead for the bootstrap components by the `15 > 12` arithmetic, and dead
for (f) because (f) uses the exact sign test by construction and never
consults the trigger at all. **Only the premise was over-broad.**

**The failure path if it had been left**: an implementation applying
`n >= 15` to (f) declares it unevaluable between 8 and 14 clusters, exactly
where prereg 9.8 requires the sign test to run, and under section 8.2 that
surfaces as a cell `inconclusive` - a verdict change driven by a premise the
sealed text does not support.

### 4.4 Implementation defects, required fixes

1. **Count distinct bootstrap values after ten-decimal (`roundToTie`)
   normalization**, not on raw floats - a genuinely discrete metric (e.g.
   pairwise accuracy over few eligible pairs) can otherwise register as
   non-degenerate purely from floating-point representation noise.

   **Status of that requirement [revision 24]. MET.** `lib/metrics.js:464`
   **[locators re-verified at revision 35; `:458` had drifted]**
   is `distinctValues: new Set(Array.from(sorted, (v) => roundToTie(v))).size`,
   and the comment at `:455-463` cites "PHASE5_EXECUTION_SPEC.md section 4.4
   item 1" by name.
2. **Build the inverted bound's sorted array from the non-tied subset**,
   fixing `exactSignTest`'s (`lib/arms.js:795` **[locator re-verified at
   revision 35; `:765` had drifted]**) index/sample mismatch:
   the current code computes `n`/`k` from `nonTied` (margin-shifted values
   with exact ties dropped) but builds `sortedDeltas` from the FULL,
   untrimmed `weekDeltas` array and indexes it at `sortedDeltas[j - 1]`
   using `j`, which was derived from the smaller non-tied count - whenever
   any week ties out, the order statistic is read from the wrong position.
   **Fix**: the sorted array must be built from the SAME non-tied subset of
   (unshifted) deltas that produced `n` and `k`.

   **Status of that requirement [revision 24]. MET.** `lib/arms.js:815-817`
   **[locators re-verified at revision 35; `:776-778` and `:789-792` had
   drifted]** builds `nonTiedPairs` and derives both `n` and `k` from it, and
   the comment at `:828-831` cites "Section 4.4 item 2" by name, stating that the
   sorted array comes from "the SAME non-tied subset (of unshifted x-values)
   that produced `n` and `k` - never the full, untrimmed weekDeltas array."
   **The sentence above beginning "the current code computes" is WITHDRAWN.**
   It described the pre-fix state and went false when the code changed. It is
   left standing rather than deleted silently, so the record of what was
   required, and of when it was met, survives - the same disposition section
   8.6.1 uses for its own withdrawn claim.
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

### 4.6 The descriptive families use prereg 10.1's interval, including for ABSOLUTE metrics **[MIXED - see the per-item and per-subsection labels]**

**What the sealed text already binds, and what it does not.** Prereg 10.1's
first five bullets already bind absolute metrics - bullet 1 resamples and
recomputes "every per-week metric mean," and bullets 2-5 fix the
surviving-cluster rule, the 100,000 draws, the seed 1499811874, and the
shared resamples. What the sealed text does not supply is the BOUND for a
non-delta statistic: bullet 6 phrases the percentile rule over bootstrap
**deltas** only ("the `0.9928571429` empirical quantile of the 100,000
bootstrap deltas"). **This section extends that one bullet, and nothing
else.**

Revision 21 and its predecessors said instead that "nothing in the sealed
text says what interval an absolute metric carries." That was false and ran
in the dangerous direction: it invited a reviewer to treat the cluster
definition and the draw count as open for them to resolve, when 10.1 seals
both and neither is amendable here. **[corrected at revision 22]**

**Frozen definition.** Every published interval in the descriptive families
of section 8.7 rules 1-4 - absolute metrics, paired deltas, attribution
composites, and the prereg 10.6 diagnostics - is:

1. **[restates prereg 10.1, not amendable here]** a **cluster bootstrap over
   the row's own season's evaluated weeks**, the cluster being the
   season-week, resampling the surviving weeks WITH replacement and
   recomputing the per-week mean over the drawn multiset;
2. **[restates prereg 10.1, not amendable here]** **exactly 100,000 draws,
   seed 1499811874**, using prereg 10.1's shared resample index;
3. **[restates prereg 10.1, not amendable here]** **[label corrected at
   revision 33]** reported at the **one-sided `alpha/7 = 0.0071428571` level
   in both directions** - the lower bound is the `0.0071428571` quantile and
   the upper bound the `0.9928571429` quantile, exactly as 10.1 states. The
   level is NOT re-opened here; 10.1 fixes it inline and this section
   inherits it unchanged. A two-sided 95 percent normal approximation is
   specifically NOT permitted;
4. **[substantive prospective amendment]** taken by the **percentile order
   statistic at `ceil(q * 100000)` clamped to `[1, 100000]`, no
   interpolation**. **[scope of the amendment narrowed at revision 33]** The
   RULE is prereg 10.1's, stated there verbatim and not re-opened here.
   **What is amended is its APPLICATION to a non-delta statistic**, which
   bullet 6 phrases over bootstrap deltas; that extension is the only part
   of this list not already sealed.

**Only item 4 is amended, and only as to its application.** Items 1-3
restate prereg 10.1 and are not open to a reviewer to resolve differently.

**Why item 3's label changed. [revision 33]** It carried `[substantive
prospective amendment]` while its own body said the level "is NOT re-opened
here" and that "this section inherits it unchanged." **A passage that
inherits a sealed value unchanged is not an amendment to it**, and the label
contradicted the sentence beneath it for eighteen revisions. **The error ran
in the SAFE direction** - over-labelling as substantive makes an approval
harder to obtain, never easier - which is why it was a minor finding rather
than a blocking one, and why correcting it does not weaken anything a prior
approver relied on.

**The per-week value of an ABSOLUTE descriptive row, sealed. [transcribed at
revision 35 from the producer determinations register, item 1 -
mechanical completion]** The per-week value entering this section's bootstrap
for an absolute row is the **arithmetic mean of the 24 salt-specific week
values, accumulated in `metrics.SALTS` order**. Section 5 pins exactly this
within-week salt average for the permutation statistic, and section 3.3's
common-random-number doctrine makes the salts replicates of one week; no
sealed text states a different estimator for the descriptive absolute
families, so this fills that silence with the only reading consistent with
both.

#### 4.6.1 The SEASON coordinate **[substantive prospective amendment]**

Prereg 12.1 is season-UNQUALIFIED - "all 8 cells' absolute metrics and all
paired deltas versus control, with CIs, whether or not any cell passes" - and
the study evaluates 34 season-weeks across 2024 and 2025, with 2024 a
first-class safety season carrying component (e1) and four of the thirteen
(e2) inequalities (one each from the MAE, RMSE, Spearman rho, and WIS rows,
which prereg 9.7 evaluates on 2025 and 2024; the coverage row and all four
scoring-profile rows are 2025-only). **The descriptive families therefore carry a SEASON
coordinate, and rows are published for BOTH 2024 and 2025, with one
exception**: section 8.7 rule 4's prereg 16 **SCORING-PROFILE** sensitivity
family is 2025-only, because prereg 9.7 evaluates all four scoring-profile
inequalities on 2025 alone and rule 4's row set mirrors them. **[exception
scope tightened at revision 35]** That exception is rule 4's family ALONE:
the two prereg-16 WEEK-WINDOW families that section 8.7 rules 6-7 add at
revision 35 are also prereg-16 families, and they are NOT captured by it -
their bullets name no season, so they take this section's default and carry
**both seasons**. Every other descriptive family
carries both seasons. Publishing 2025
alone would silently narrow a sealed publication requirement.

**Each row's clusters are its own season's evaluated weeks**, never a pooled
34-week set. This also removes a contradiction that a 2025-only rule created:
the 2024 regret/pairwise delta versus control is simultaneously an (e1)
gating endpoint interval'd over 2024 clusters via sections 4.2-4.5, and a
prereg 12.1 descriptive row. Both now use the same cluster set, so one number
never carries two different intervals.

**The season is part of the mandatory self-description below**, so a
season-scope mismatch is visible in the report rather than silent.

#### 4.6.2 "Surviving" for a statistic with no comparator **[substantive prospective amendment]**

Prereg 10.4's dropping rule is CONTRAST-scoped: "A week with no rows for an
arm is dropped **from that contrast** for BOTH the candidate and every
comparator, symmetrically." An ABSOLUTE metric for one cell has no
comparator, so the sealed rule does not by itself say which weeks survive.

**Frozen rule: for an ABSOLUTE-METRIC family published across the eight cells
for side-by-side comparison, a week survives only if it has rows in ALL EIGHT
cells - the drop is the UNION across that family, not per-cell.** 10.4's
principle is that quantities being compared are compared over the same weeks,
and prereg 12.1 exists precisely to present the eight cells side by side; a
per-cell drop would publish eight absolute rows over eight different week
sets and defeat the comparison the section is for.

**This covers two families, not one**: prereg 12.1's primary absolute metrics
(section 8.7 rule 1, `half_ppr`), and the prereg 16 sensitivity rows (rule 4,
`standard` and `ppr`). The union is taken **within** a family - separately for
each `(season, scoring profile, endpoint)` - never pooled across families, so
a sparse week in a `ppr` sensitivity row never drops a week from the primary
`half_ppr` matrix.

**How the union composes with section 8.7's week-window families. [added at
revision 35 with rules 6-7]** The two prereg-16 week-window families are
DERIVED re-analyses of rule 1's rows, so they inherit rule 1's union rather
than computing a second one: **the all-eight-cells union is taken on the full
family first, and the window (`weeks-2-17`, `week-18-only`) then intersects
the surviving set.** The commensurability rationale above reaches its sharpest
consequence at the one-candidate-week window: **a week 18 that fails the
union in ANY cell renders the whole `week-18-only` family `unevaluable` for
that `(season, endpoint)`, across all eight cells.** The per-cell-own-week
alternative was considered and rejected on this section's own grounds - it
would publish a side-by-side family over different weeks, which is the defect
the union exists to prevent.

**The two diagnostic estimands' per-week values, sealed. [transcribed at
revision 35 from the producer determinations register, item 2 - mechanical
completion]** `control-naive` IS a contrast (this section says so above), so
its per-week value is the **salt-paired control-minus-naive delta in prereg
6.7's form** (`metrics.saltPairedDelta`). `usage-signal` is NOT a contrast
(this section assigns it the own-weeks rule), so its per-week value is the
**benchmark arm's own absolute week value, salt-averaged exactly as section
4.6's absolute rule states**.

**The attribution composites' per-salt evaluation, sealed. [transcribed at
revision 35 from the register, item 3 - mechanical completion]** The prereg
12.2 composites are **evaluated per salt and then averaged over the 24 salts
in `metrics.SALTS` order** - prereg 6.7's pairing discipline extended to the
four-cell interaction, which is evaluated as the difference of differences
`((u,on) - (u,off)) - ((0.25,on) - (0.25,off))` per salt. The two-term
composites reuse `saltPairedDelta` unchanged, so their bytes match the gating
contrasts' arithmetic exactly - the same one-number-one-value doctrine as the
season coordinate.

**The benchmark arms are salt-invariant, sealed. [transcribed at revision 35
from the register, item 4 - mechanical completion]** The two prereg 7.2
benchmark arms are deterministic functions of prior games, with no simulation
draw for a seed to vary; each benchmark arm-week is therefore **evaluated
ONCE and published under all 24 salts**, since the arm-week universe requires
a complete salt set for every generated arm-week. Component (d)'s salt-paired
contrast (prereg 6.7) is consequently **a paired delta against a constant
comparator** - which is what a salt-invariant benchmark means, not a defect
of the pairing.

**PAIRED DELTAS AND THE PREREG 12.2 ATTRIBUTION COMPOSITES ARE UNAFFECTED.**
Both are contrasts, so prereg 10.4's contrast-scoped rule already fixes their
surviving sets - for a composite, "the candidate and every comparator" is
every cell entering that composite, all FOUR in the case of the interaction
(`(u,on) - (u,off) - (0.25,on) + (0.25,off)`) - and this section neither
extends nor overrides it. A descriptive paired delta and its gating
counterpart in components (a)-(e1) therefore share one cluster set and one
interval - for exactly the reason section 4.6.1 gives on the season axis, and
the union rule above is scoped to absolute metrics so as not to reintroduce
that same defect on the cluster axis. Extending the union to paired deltas
would drop weeks in which a THIRD, uninvolved cell happened to be empty,
producing a descriptive interval for the (candidate, control) pair over a
different week set than the gating interval for the same pair: two intervals,
and two points, for what any reader would call one number.

For the remaining descriptive rows - the **prereg 10.6 diagnostics** - the
surviving set is that row's own non-empty weeks, because they are single
series rather than an eight-cell family and there is no family to keep
commensurable.

**One qualification, and it is not optional.** `control-naive` IS a contrast:
prereg 7.2 makes `naive-recency` a benchmark arm and prereg 9.5 names it
"Comparator" in those words, while prereg 4.1 treats naive-definedness as a
real condition ("`naive-recency` requires at least one prior game ... so
component (d) would have no comparator"). Prereg 10.4 therefore fixes its
surviving set as it does for any contrast: **a week in which `naive-recency`
is undefined drops from that contrast on BOTH sides, and "its own non-empty
weeks" means the CONTRAST's, never the control arm's alone.** No claim is
made here about `usage-signal`, which prereg 7.2 describes as an estimator
over a restricted game set rather than as a contrast; it takes the own-weeks
rule above unless and until the sealed text is shown to make it a contrast.

**These cases are exhaustive over section 4.6's scope.** Absolute metrics of
either family take the union within their family; the contrasts - paired
deltas, the 12.2 composites, and `control-naive` - take prereg 10.4; the
remaining 10.6 diagnostic takes its own weeks.

**Two alternative readings were considered and rejected.** Dropping only each
cell's own empty weeks for absolute metrics changes less machinery but
publishes non-commensurable rows. Applying the union to the whole family
INCLUDING the gating contrasts would keep everything on one week set, but it
is unavailable: this section's scope limit forbids changing any component
endpoint, and doing so would silently re-cluster components (a)-(e1). The
rule above is the only reading that keeps the absolute family commensurable
without touching a single gating interval.

#### 4.6.3 The shared index is shared PER CLUSTER COUNT **[mechanical completion]**

Prereg 10.1 states both that resampling is "over the SURVIVING clusters, and
`n` is the surviving count" and that "every bootstrap-based component uses
IDENTICAL resamples." These are reconciled by 10.1's own sequencing, not in
tension: **the index is built AFTER week dropping and is a deterministic
function of the seed and the surviving cluster count.** Rows with the same
`n` therefore share draws identically; rows with different `n` necessarily do
not, because a `draws x n` index cannot be reused at a different `n`.

`metrics.js`'s own guard states the same rule in its error text - "the
resample index must be built AFTER week dropping, and shared" - and
`buildBootstrapResamples({ clusterCount })` is seeded, so equal `n` yields
byte-identical draws with no object needing to be passed around.

This matters because prereg 16 REQUIRES a weeks-2-17 sensitivity, a mandated
16-cluster family **(section 8.7 rule 6 carries its row set as of revision
35)**, and prereg 10.4 permits up to two further drops. A single
global index would be unsatisfiable against the sealed text; a per-cluster-
count index satisfies both bullets exactly. **[noted at revision 35]** The
windowed family has NO evaluability floor of its own: prereg 10.4's `n >= 15`
is component-scoped and descriptive rows never void (section 4.6.4), so its
surviving count may fall through `estimated` to `degenerate` to `unevaluable`
with no additional rule, and prereg 10.2's exact-inference trigger remains
component-only - a descriptive row publishes `distinctValues` but never
switches method.

#### 4.6.4 The reducer for descriptive rows is TOTAL **[substantive prospective amendment]**

A descriptive row is DESCRIPTIVE. It must never throw, never void a run, and
never change a component, cell, or run status - and section 4.6's scope limit
below is only true if this section is total.

Undefined per-week values are contemplated by the sealed text and by the
metrics' own definitions.

**Sealed**: prereg 6.2's pairwise macro-average drops a position with zero
eligible pairs from that week's macro-average, and drops the WEEK when more
than one position drops - a drop that counts against prereg 10.4's
missing-cell budget. Prereg 16 requires Week-18 absolute metrics "published
on their own," a ONE-cluster row, which mandates the `degenerate` branch
below by construction.

**Inferred from the metric definitions, and stated here as inference rather
than citation**: coverage and WIS have empty denominators when every
projection in a week is null, since prereg 6.6 excludes null projections from
both; and rho is undefined under total ties, where rank variance is zero. The
preregistration's one explicit whole-week-undefined statement concerns 2024
Week 1, which prereg 4.1 excludes from the evaluation window in both seasons,
so it is not load-bearing here.

**[corrected at revision 23]** Revision 22 carried these as a single sealed
citation list, attributing whole-week undefinedness to prereg 6.6 and
asserting a rho total-ties rule the preregistration does not contain. Prereg
6.6 is "Null and tie conventions (global)": it excludes a null projection
from six metrics, fixes exact ties at 0.5, removes tied pairs from the
pairwise denominator, and pins 10-decimal tie rounding - it says nothing
about a whole week. The rho claim is true as mathematics and appears nowhere
in the sealed text. Both are now stated at their real standing, which leaves
the branch below resting on prereg 6.2 and prereg 16 alone - and those are
sufficient, because both concern EVALUATED weeks, which the 2024 Week 1
passage cannot supply.

The mandated primitives are strict: `bootstrapMean` throws on any non-finite
week value and `buildBootstrapResamples` throws on `clusterCount <= 0`.

**Frozen rule.** Before any resampling, a descriptive row is classified:

- **`unevaluable`** - zero surviving clusters, or any surviving week value
  non-finite. Publish the row with `status: 'unevaluable'`, a stated reason,
  `point`/`lower`/`upper` all null, and NO interval. Never call the
  bootstrap.
- **`degenerate`** - exactly one surviving cluster. Publish the point, with
  `lower`/`upper` null and `status: 'degenerate'`. A one-cluster bootstrap
  resamples the same week every draw, so its interval is a zero-width
  artifact; publishing it as a CI would misrepresent a point as an estimate.
  This is the case prereg 16's Week-18-alone requirement produces by
  construction **(section 8.7 rule 7 carries that family's row set as of
  revision 35)**.
- **`estimated`** - two or more surviving clusters, all finite. Compute items
  1-4 above.

**A descriptive row's status is NEVER a Level 1/2/3/4/5 input.** An
`unevaluable` descriptive row does not make any component unevaluable, does
not make any cell inconclusive, and does not void the run. Level 1's void
causes remain exactly those enumerated in section 8.2's run level.

**Why the method, not merely the level, is load-bearing.** Several published
endpoints are bounded: `coverage` and `pairwise` are proportions on `[0, 1]`,
`rho` is a correlation on `[-1, 1]`, and `regret`, `mae`, `rmse`, and `wis`
are bounded below by zero. A symmetric unbounded margin can place a published
bound outside the endpoint's own support - an absolute coverage near 0.96
with ordinary week-to-week spread yields an upper bound above 1.0, which is
not a coverage. The percentile bootstrap cannot do this: every resampled
statistic is a mean of observed values, so every bound stays inside the
data's convex hull. The sealed text's choice is doing real work here and must
not be substituted for on grounds of convenience.

**Self-description is mandatory.** Every published descriptive row records,
alongside its bounds, the **method**, the **alpha**, the **draw count**, the
**surviving cluster count**, the **season**, the **scoring profile**, and the
**status** of section 4.6.4. A report in which a prereg 12.1 primary interval
and a prereg 10.5 moving-block interval are typographically
indistinguishable is not auditable, and a disclosure that lives only in a
review document does not travel with the data.

**Prereg 10.5 is unaffected.** The moving-block sensitivity keeps its own
sealed construction (block lengths 2 and 3, same 100,000 draws, **seed
588165040**) and is reported alongside these intervals, exactly as 10.5 says.
**A moving-block row carries its own bounds and does not additionally
duplicate this section's primary interval in the same record; the primary
interval is always computed and published on the cell's own row, so that
every moving-block row has a primary CI to sit alongside, exactly as 10.5
requires. No endpoint is ever left without a primary interval on the grounds
that a moving-block sensitivity exists for it.** Revision 21 said the primary
interval "is not computed" for such a row, which contradicted 10.5's sealed
precondition that there be a primary CI to report alongside.
**[corrected at revision 22]**

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

### 5.2 The observation domain **[added at revision 35; substantive prospective amendment - transcribed from the producer determinations register, item 8, and sealed with the D4 ruling of 2026-08-08]**

The sealed text does not pin which players form the permutation cells. The
implementation constrains the choice from three sides - every observation row
needs a finite `actual` and `projected`; every ROSTERED player needs an
observation (a measured zero must never stand in for missing evidence); and
each salt's observation ids must equal the cell's canonical member list
elementwise. Within those walls, frozen:

**The domain is EVERY COHORT MEMBER WITH A MACRO POSITION AND A RESOLVED
OUTCOME TRUTH** - a finite `actualPointsByPlayerId` entry, which the outcome
layer writes only for scored and zero-recorded members.

- **BYE MEMBERS ARE IN.** A bye player stays in the cohort and in rosters,
  and the reducer requires every rostered player to carry an observation, so
  excluding byes would fail every week with a rostered bye. The consequence
  is stated head-on rather than left implicit: **bye players participate in
  the permutation control's statistics, where prereg 4.1 excludes them from
  the sweep's own point-accuracy scoring.** Both `T_obs` and every `T_b` are
  computed from the same rows by the identical code path, so the gate is
  internally consistent under this reading.
- **The asymmetry against section 6.3 is DELIBERATE and is confined to the
  BYE leg.** The D4 ruling propagates prereg 4.1's eligibility into
  component (f)'s subgroup membership (section 6.3), excluding bye and
  non-macro members there - the fail-safe direction for a safety gate whose
  zero-delta diluters weaken it. It does NOT propagate the bye exclusion
  here, because this domain is forced the other way by the
  every-rostered-player-needs-an-observation invariant. **Non-macro-position
  members are excluded in BOTH places** - here as counted exclusions, there
  by the eligibility predicate - so the two domains differ in exactly one
  leg, and that leg's direction is forced on each side by its own layer's
  invariant.
- **EXCLUSIONS ARE COUNTED, NEVER SILENT.** A member outside the domain (an
  unresolved outcome, or a position outside the six macro positions) is
  tallied by reason, per member-WEEK - one member excluded all season
  contributes 17. A silently-shrunk domain is a fail-open by omission, and
  the reducer cannot see it, because its coverage assertions bound the
  domain only from below.
- **A rostered player outside the domain FAILS THE CAPTURE, by name, with
  the exclusion reason attached** - never discovered hours later as a
  cause-free coverage mismatch.

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
  `weeksBelowFalsifiabilityFloor` (`lib/arms.js:925` **[locator repaired at
  revision 35; `:882` was stale, the one hard failure of the scripted
  locator check's first full run]**), which prereg 9.8
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
  (the comparison at `lib/arms.js:934-935`, against the constant at
  `:781` **[locators re-verified at revision 35; `:891-892` and `:751` had
  drifted]**), never gating the veto itself (which fires strictly
  on the directly-measured `inc > 0.20`); cannot change any verdict.

**Required Gate 2 code changes** **[the locators in this directive are
historical to its issuing; current sites are in the status block below]**:
`lib/arms.js:743`'s `FALSIFIABILITY_FLOOR
= DELTA_F / MAX_EFFECT` -> `(DELTA_F - 0.01) / MAX_EFFECT` (0.30),
**retained SOLELY as the per-week disclosure constant**; `:751`'s
`catastrophicCapCouldFire` check -> `Number(maxAbsBaseline) >
(CATASTROPHIC_CAP - 0.01) / MAX_EFFECT` (3.80). **Additionally required**:
the evaluability guard must be rewritten to section 6.1a's transformed-bound
median comparison, and `FALSIFIABILITY_FLOOR` must NOT appear anywhere in
that guard. A test must assert that the constant is referenced by the
disclosure count and by nothing that returns a status.

**Status of those requirements [revision 24; locators re-verified and the
fourth item's status updated at revision 35].** Four requirements sit in the
paragraph above. **All four are now MET.** The fourth was recorded NOT MET
from revision 24 until the tests landed; the block below preserves that
history rather than rewriting it.

- **The `0.30` disclosure constant - MET.** `lib/arms.js:773` is
  `const FALSIFIABILITY_FLOOR = (DELTA_F - 0.01) / MAX_EFFECT; // 0.30`.
- **The `3.80` disclosure constant - MET.** `lib/arms.js:781` is
  `const CATASTROPHIC_CAP_COULD_FIRE_THRESHOLD = (CATASTROPHIC_CAP - 0.01)
  / MAX_EFFECT; // 3.80`, consumed by the comparison at `:934-935`. **The
  FORM of that comparison differs from the text above**; section 6.2
  governs it, and the correction is recorded immediately below rather than
  inside this status block.
- **The evaluability-guard rewrite - MET.** `lib/arms.js:981-995` builds the
  transformed weekly bounds, takes their median, and returns `unevaluable`
  when `roundToTie(medianWeeklyBound) <= roundToTie(DELTA_F)`. The comment
  at `:966-967` names it as the falsifiability guard and records that "the
  pooled 0.30 quantity remains disclosure-only." `FALSIFIABILITY_FLOOR`
  occurs in exactly three places in `arms.js` - its definition (`:773`), the
  disclosure count (`:926`), and the export list (`:1713`) - and in none of
  them inside the guard.
- **The test asserting the constant is referenced by NOTHING that returns a
  status - recorded NOT MET at revision 24, MET as of revision 35.** The
  revision-24 finding stands as history: `backtestArms.test.js`'s value
  assertion (now at `:514`) carries the message `'0.30 remains
  disclosure-only'` while checking only the number, and the disclosure-count
  semantics tests (now `:604` and `:616`) test the count, not the negative -
  **an assertion message stating a property the assertion does not check.**
  Both owed tests NOW EXIST, and each is invocation-grade evidence rather
  than a definition-and-export inference: `backtestArms.test.js:1177`,
  `'section 6.1: FALSIFIABILITY_FLOOR is referenced by the disclosure count
  and by nothing that returns a status'`, reads `arms.js`'s own source,
  asserts the constant occurs at exactly its three sites, and asserts every
  site sits outside the transformed-bound guard; and `:1219`, `'section 6.1:
  MUTATION - changing 0.30 alone changes no status, only the disclosure
  count'`, loads a mutant module with `FALSIFIABILITY_FLOOR = 99`, asserts
  no endpoint, component, cell, or claim status moves, and asserts the
  published count DOES move (a mutation that changed nothing at all would be
  a vacuous harness).

**The comparison FORM is corrected** **[mechanical correction, forced by an
internal contradiction]**. **Revision 24 classified this as a substantive
prospective amendment and grounded it on prereg 6.6. Both were wrong, and
section 6.2 of THIS DOCUMENT is why** - see "How this was misclassified"
below, which is retained rather than deleted because the misclassification
is the finding.

The directive above prescribes a BARE comparison,
`Number(maxAbsBaseline) > (CATASTROPHIC_CAP - 0.01) / MAX_EFFECT`.
`lib/arms.js:934-935` **[locator repaired at revision 36: this occurrence
read `:891-892`, the pre-growth site, after revision 35's sweep updated
its four sibling citations and missed this one - finding G-A of the
revision-35 statistical review, the escape that forced the locator
instrument's claim-expression tier]** instead computes
`roundToTie(Number(maxAbsBaseline)) > roundToTie(CATASTROPHIC_CAP_COULD_FIRE_THRESHOLD)`,
which is tie-rounded on BOTH operands. **This document adopts the
tie-rounded form**, and states its grounds at their real strength rather
than overstating them.

**SECTION 6.2 OF THIS DOCUMENT ALREADY COMPELS THE TIE-ROUNDED FORM, AND
NAMES `3.80` EXPLICITLY.** Its opening rule reads:

> **Every comparison - `<`, `<=`, `>`, `>=`, and equality - against a frozen
> threshold applies `roundToTie` (ten-decimal, prereg 6.6) to BOTH operands
> before the comparison**, not just one ... Within component (f), the
> complete list of such comparisons, and nothing else:

**[quote refreshed at revision 29]** Section 6.2 now states its scope
explicitly, and the words "Within component (f)" are part of the rule
quoted above rather than an editorial insertion here. That scope does not
weaken this argument, and is the reason it survives: `catastrophicCapCouldFire`
is a component-(f) comparison, so it sits inside the universal either way,
and the universal is now checkable rather than open-ended.

and the third row of the table immediately following it is:

> | `3.80` | the `catastrophicCapCouldFire` transparency line | disclosure only |

That is the same comparison. It is not an analogy, an adjacent rule, or a
principle requiring extension: section 6.2 enumerates the comparison by its
threshold and by the name of the field it feeds, inside a list declared
exhaustive. **The bare directive above and section 6.2 are in direct
contradiction, and section 6.2 governs** - it is the section whose entire
subject is which comparisons are normalized, it states its list is complete,
and it names this one.

**A reasonable reader who reaches section 6.2 cannot resolve this the other
way.** That is the test section 0 sets for a substantive amendment, and this
fails it. The tie-rounded form is what this document already required.

**Why section 6.2's rule bites here, concretely.** The threshold is not the
hazard: `(0.20 - 0.01) / 0.05` evaluates to exactly the double nearest
`3.8`, so the derived constant and the literal are the same value. The
hazard is the OTHER operand. `maxAbsBaseline` is a maximum over computed
per-week mean absolute baselines, so it carries summation-order
representation noise; a value one unit in the last place above `3.8` makes
the bare comparison `true` and the tie-rounded comparison `false`. That is
exactly the misclassification section 6.2's opening sentence names - "a
genuine boundary value ... misclassified by floating-point representation
noise on either side" - which is why 6.2 requires BOTH operands rounded
rather than only the threshold.

**Prereg 6.6 corroborates but is not the ground, and revision 24 leaned on
it wrongly.** 6.6's fourth bullet fixes ten-decimal rounding for tie
decisions and names one extension (component (f)'s sign test).
`catastrophicCapCouldFire` is a strict `>`, so 6.6 reaches it only at the
boundary. Read alone, that supports the tie-rounded form without compelling
it - which is what revision 24 concluded, and why it labeled the change
substantive. **The error was searching the sealed text for authority without
first asking what in this document already governed the comparison.** Section
6.2 did, by name.

**The mutation test at the end of this section always had a determinate
expected result**; revision 24 said otherwise and that is withdrawn. It
mandates "the `3.80` disclosure comparison tested at its own boundary," and
section 6.2 fixes which form that boundary takes, so the expected result was
determined from revision 18 onward. `backtestArms.test.js:533-545`
**[locators re-verified at revision 35]** exercises
it under the tie-rounded form (`3.8` -> `false`, `3.81` -> `true`), and the
implementation at `lib/arms.js:934-935` conforms to section 6.2. **The code
was never non-conformant on this point** - the bare directive was.

**How this was misclassified, retained because the misclassification is the
finding [revision 25].** Revision 24 treated the comparison form as an open
question, searched the PREREGISTRATION for authority, found only 6.6's
partial reach, and concluded the document had to supply a resolution -
labeling it a substantive prospective amendment and rejecting the bare form
"on the record" as though it were a live option. It was not a live option;
section 6.2 had excluded it since revision 18. Revision 24's own text even
cited section 6.2 - "the condition section 6.2 already requires every
boundary operation to be normalized against" - without opening it, which
would have shown `3.80` named in its table. **The lesson is one step earlier
than "open every section you cite": before concluding a question is
unresolved, search for what already governs it.** A silence inferred from
the sealed text is not a silence if this document has already spoken.

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

**Season scope, stated explicitly. [added at revision 35, sealing the SPEC-C
ruling of 2026-08-08]** Everything in THIS section - the qualifying weeks,
the guard, and the disclosures around it - is **2025-scoped by prereg 9.8's
own text**, and so are the sign test's `D_w` series and the evaluability
minimum ("2024 cannot rescue sparse 2025 evidence"). **The catastrophic
veto's evaluation domain is NOT so scoped**: sections 6.4/6.4a state it as
`{ subgroup player-weeks } x { the 24 salts }` with **no season qualifier,
and that unqualified form is the sealed reading** - subgroup membership is
assigned per `(season, week, blendWeight, playerId)` across BOTH
preregistered seasons. The two scopes are stated side by side here so
neither silently narrows the other: the GATES read 2025 evidence; the VETO
watches every subgroup realization the study generates. The fail-safe
direction is preserved by construction - a wider veto domain can only veto
MORE, and section 8.2a rule 6 guarantees a veto can never turn a failure
into a pass.

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

**SCOPE: COMPONENT (f). [stated explicitly at revision 29]** This section
governs the frozen-threshold comparisons that arise within component (f) -
that is, within section 6 of this document. **It does not reach the status
model's interval-boundary comparisons in section 8.2a**, which carry their
own convention on their own authority; the boundary between the two is
stated after the table below.

Revisions 15 through 28 stated no scope at all, and the omission was read
three different ways inside one document: section 6.1a as component-scoped
("matching section 6.2's convention for every other boundary in this
component"), section 6.1 as document-wide, and section 8.2a rule 3 as
neither, applying a normalization convention to non-(f) comparisons without
citing this section. A completeness declaration whose universe is unstated
cannot be checked, which is the defect corrected here.

**Every comparison - `<`, `<=`, `>`, `>=`, and equality - against a frozen
threshold applies `roundToTie` (ten-decimal, prereg 6.6) to BOTH operands
before the comparison**, not just one, so a genuine boundary value is never
misclassified by floating-point representation noise on either side. Within
component (f), the complete list of such comparisons, and nothing else:

| threshold | used by | kind |
| ---: | --- | --- |
| `0.20` | the catastrophic veto check (section 6.4) | **GATE** |
| `0.025` (`DELTA_F`) | the falsifiability guard, against the median transformed per-week bound (section 6.1a) | **GATE** |
| `3.80` | the `catastrophicCapCouldFire` transparency line | disclosure only |
| `0.30` | `weeksBelowFalsifiabilityFloor`, the per-week count (section 6.1) | **disclosure only** |
| `alpha/7 = 0.0071428571` | `exactSignTest`'s TWO `<= alpha` sites: the noninferiority decision (`p <= alpha`, `lib/arms.js:858`) and the inverted-bound index search (`binomialUpperTail(n, i) <= alpha`, `:834`, which also drives the no-finite-bound `unevaluable` branch) | **GATE** - bare in code at both sites, shown inert below |
| `0.025` (`DELTA_F`, as the sign test's margin) | `boundAgrees`, the test-vs-inverted-bound consistency flag | disclosure only - zero production consumers, shown below |

**[list completed at revision 35 - two rows added, each with its inertness
SHOWN rather than asserted.]** The declaration "and nothing else" was FALSE
as previously written: two component-(f) frozen-threshold comparisons
existed in the code and appeared in no row. Neither changes any verdict,
and the completion records why each bare form conforms rather than
rewriting the code to normalize comparisons that cannot disagree. **The
addition changes the list's EXTENT, never `3.80`'s membership, so section
6.1's classification survives on exactly the terms section 0's leg-5 note
sets for revision 29's growth of this same section:**

- **Both `<= alpha` comparisons are bare in `exactSignTest`, and
  bare-versus-normalized is PROVABLY inert over the reachable domain at
  both sites.** Every operand either site compares against `alpha` is a
  dyadic rational of the family `sum C(n,j)/2^n` with `n <= 17` (17
  evaluated weeks is the ceiling on non-tied clusters) - `p` at the
  decision site, and `binomialUpperTail(n, i)` for `i = 1..n` at the index
  search - and the closest any member of that family comes to
  `alpha/7 = 0.05/7` is `6.696e-4` (at `n = 7`, upper tail `1/128`) -
  seven orders of
  magnitude above `roundToTie`'s `5e-11` half-step resolution, so ten-decimal
  normalization of either operand can never flip either comparison for any
  `(n, i)` this study can produce. The computation is reproducible in three
  lines from the binomial upper tail. The index-search site is the one with
  the sharper consequence - no qualifying `i` means the inverted bound is
  `+infinity` and the endpoint is `unevaluable`, reachable for every
  `n <= 7` - which is why it is named in the row rather than folded into
  "the decision" silently.
- **`boundAgrees` (`lib/arms.js:865`) compares the inverted bound against
  the margin bare, and it has ZERO production consumers**: the identifier
  occurs at exactly four CODE sites - the assignment (`:865`), the
  return-object key (`:874`), and two test assertions
  (`backtestArms.test.js:390`, `:398`). Nothing published, gated, or
  disclosed reads it downstream; it exists so a test can pin that the test
  and its inverted bound never disagree. Recorded here so the completeness
  declaration is true, not to promote the flag into the contract.

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

**The boundary against section 8.2a. [added at revision 29]** Section 8.1's
passing boundaries (`+0.10`, `+0.15`, `-0.005`, `-0.01`, `-0.15`, `+0.005`,
`0`) are frozen thresholds, and none appears in the table above. That is
correct and deliberate, not an omission: they are status-model comparisons,
not component-(f) ones, and section 8.2a governs them. Specifically -

- **Straddle** (section 8.2a rule 3) applies `roundToTie` to both operands
  and is inclusive on both ends. It reaches the same convention as this
  section by its own reasoning about prereg 10.6, not by extension from
  here.
- **The pass tests** (same rule) remain **STRICT** and are deliberately NOT
  normalized, "exactly as prereg 9.2-9.7 phrase them". Section 8.2a states
  that the two conventions "differ on purpose and must not be unified", and
  this section does not overrule it.

Read without the scope sentence above, this section's "and nothing else"
asserted a completeness that contradicted section 8.2a rule 3 by name: a
one-ulp bootstrap upper bound below a passing boundary passes under 8.2a's
bare strict test and yields `threshold-not-established` (hence component
`failed`, hence cell `fail`) under a document-wide reading of this section.
**Scoping this section to component (f) removes the contradiction without
weakening either convention**, and it is the reading section 6.1a already
used.

**What this preserves for section 6.1.** Section 6.1's classification rests
on this section governing the `catastrophicCapCouldFire` comparison and on
its list being complete over an uncontested set. Both survive: `3.80` is a
component-(f) comparison, so it remains inside the universal, and the
universal's boundary is now stated rather than inferred.

**What the scope sentence repaired, stated exactly. [corrected at revision
33]** Revisions 15 through 32 said here that leg 2 of section 0's test was
"satisfied over a set that is no longer contested - which is what it
required and what the unstated scope could not supply." **That asserted leg
2 was unsatisfied before revision 29, and it was satisfied.** Leg 2's
rationale is object-specific in its own words - *"because it does not settle
whether the object is inside it"* - and no scope reading admissible at
revision 25 puts `3.80` outside this section's list, because this section is
a subsection of section 6 and section 6's heading names component (f),
identically at revisions 18, 24, 25, 28 and 32. **The object's membership was
never contested; only the set's EXTENT was**, which is the defect the
paragraph above records and the one the scope sentence fixes.

**The real defect was a completeness declaration that was FALSE read
document-wide.** Section 8.1's seven passing boundaries - `+0.10`, `+0.15`,
`-0.005`, `-0.01`, `-0.15`, `+0.005`, `0` - are frozen thresholds, are
compared in section 8.2a, and appear in none of the four rows above. A
document-wide reading of "and nothing else" was therefore untrue at its outer
edge while remaining exactly right about `3.80`. **Stating the scope makes
the declaration true rather than making leg 2 satisfiable**, and section 0's
leg-2 demonstration was correct as written at every revision.

### 6.3 Subgroup membership and averaging

Membership (`b <= 0` in the matched off-cell) is computed once per
`(season, week, blendWeight, playerId)` and reused unchanged across all 24
salts for that cell - the salt affects only `simulateDistribution`'s
residual draw, AFTER `running` (the pre-homeAway baseline `b`) is
finalized, never `running` itself, per `assertSaltAffectsOnlyHashValue`'s
own invariant. `D_w` per endpoint per week = the mean of the 24 same-salt
on-minus-off deltas (same salt on both sides, `saltPairedDelta`,
`lib/metrics.js:333`).

**Membership additionally requires prereg 4.1 eligibility. [added at
revision 35, sealing the A4/D4 ruling of 2026-08-08 - substantive
prospective amendment]** A cohort member **on bye, or whose position is
outside the six macro positions, is NOT a subgroup member**, whatever its
baseline sign. Prereg 4.1 excludes exactly these members from every scored
endpoint, so before this ruling two membership rules diverged silently in
the direction that WEAKENS the veto's evidence base: a bye player sat
inside f1's subgroup contributing exactly-zero error deltas that dilute
`D_w` toward the sign test not firing, while contributing to no scored
endpoint anywhere else. Propagating 4.1's exclusion removes the divergence
in the fail-safe direction - zero-delta diluters leave, the gate
strengthens. Frozen mechanics:

- **The exclusion applies at EVERY membership-derivation site** - the
  producer's subgroup-error emission and domain derivation, and the
  reducer's operand and veto-record derivations - through ONE shared
  predicate (`sweepPreflight.componentFSubgroupEligible`), never through
  per-site reimplementations that could diverge again.
- **Eligibility fields are ASSERTED, never coerced**: a cohort row whose
  `position` or `onBye` is missing or malformed is an artifact defect that
  throws by name. A malformed field must never read as a silent non-member,
  because a membership rule that fails open shrinks a safety gate's domain
  invisibly.
- **The asymmetry against section 5.2's permutation domain is deliberate
  and is stated there**: byes are OUT here and IN there, forced on each
  side by that layer's own invariant, and non-macro members are out of
  both.

### 6.4 The catastrophic-cap veto: one component-level check, run first

**One veto check, computed BEFORE either endpoint's evaluability minimum or
falsifiability guard runs**, over the full Cartesian set of (subgroup
player-week) x (24 salts) realizations - **the subgroup player-weeks drawn
from BOTH preregistered seasons, season-unqualified [scope sealed at
revision 35 per the SPEC-C ruling of 2026-08-08; see 6.4a]**: `inc =
|error_on| - |error_off|`,
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
(`b <= 0`, prereg 9.8, AND prereg-4.1-eligible per section 6.3), computed
once per `(season, week, blendWeight,
playerId)` and reused unchanged across all 24 salts (section 6.3).

**The domain is SEASON-UNQUALIFIED, and that is the sealed reading. [sealed
at revision 35; the SPEC-C decision, ruled by the user 2026-08-08 as Reading
B, both-season]** The product above carries no season qualifier, and none is
implied: subgroup player-weeks from BOTH preregistered seasons enter the
veto's domain, even though the gates and disclosures of sections 6.1/6.1a
are 2025-scoped by prereg 9.8's own text. The question was genuinely open -
prereg 9.8 is component (f), whose gates section 6.1 scopes to "the 2025
subgroup" - and the interim implementation carried the unscoped domain as
the fail-safe direction; the ruling makes that reading sealed rather than
provisional. **Because the veto's domain and the 2025-scoped published
subgroup can therefore differ in size, the published veto block MUST carry
the veto's OWN domain arithmetic**: its subgroup player-week count, the
expected realization count (`24 x` that), and the realization count
actually held - so this section's completeness attestation closes on the
veto's own numbers and never has to be reconciled against the 2025-scoped
subgroup row count published beside it.

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
  (`projectionModel.js:1127`, the CALL; the helper's definition is at
  `:1105`) **[locator repaired at revision 33; "around line 1104" was
  stale, and `:1104` is a blank line]**.
- **Called exactly once** per player-week that reaches the semantic point -
  not "at most once," not "zero or more times."
- **Zero calls on either early return**: `projectFromBundle`'s own `if
  (!player)` branch (`projection.service.js:270-283`) **[locator repaired at
  revision 33; `:261-277` began on a comment and ended mid-branch]** and
  `projectPlayer`'s own `if (baseline.value == null)` branch
  (`projectionModel.js:1021`, verified correct at revision 33) both
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

**Full threading** (the call graph below was re-resolved against HEAD at
revision 29; see the locator note at the end of this subsection):
`generateProjections` (`projection.service.js:417`) accepts the optional
parameter, passes it unchanged into every per-player `projectFromBundle`
call (`:467`, with the parameter forwarded at `:470`);
`projectFromBundle` (`:257`) accepts it, passes it unchanged into its own
`model.projectPlayer` call, except on its own early `!player` return, where
it is never invoked; `projectPlayer` fires it at the semantic point or
never, per its own early-return rule. Every production call site omits the
parameter, so none of the three functions' behavior changes for them. Any
future direct caller of `projectFromBundle` (today there are none besides
`generateProjections`, verified by grep) must accept and forward the same
parameter rather than re-implementing `projectFromBundle`'s own assembly
logic to reach `projectPlayer` directly.

**Locator note [added at revision 29].** Revisions 18-28 introduced this
passage with the words "verified against the real call graph" while three
of its four locators resolved to unrelated code: `generateProjections` was
cited at `:408`, which is `roof: game.roof,`; the per-player call at
`:449`, which is `season,`; and (in section 8.6.0) the return shape at
`:455-459`, which is a weather try/catch. **They were never correct in this
chain** - `projection.service.js` is byte-identical between `c04d6b1` and
HEAD, and line 408 is `roof: game.roof,` at both. The SUBSTANCE was and
remains correct: `projectFromBundle` declares at `:257` and validates at
`:266-267` before its `if (!player)` at `:270`, so validation genuinely
precedes the early return; `generateProjections` validates at `:436-437`
before the loop at `:467`. What failed was the verification CLAIM, asserted
in the same sentence as three locators that had never resolved. Section
10.2 had recorded the family as outstanding since revision 24, but that
disclosure sits outside sections 3-8, so a reviewer scoped to the approval
range met the claim without the retraction. **The retraction is stated here,
inside that range, for that reason.**

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
exceptions and no sixth bucket **[count corrected at revision 34; this read
"no seventh bucket" from the earliest anchor, where the Level-3 ordering had six
entries and the Level-4 set has always had five - section 8.2a rule 8 states
five correctly]**. For a triggered endpoint (section 4):
exact-side non-estimability (`unevaluable`) always takes precedence over a
bootstrap-side `wide-straddle` (an endpoint must be "fully evaluated" -
both procedures produced a usable result - before wide-straddle can even
apply); if both ARE evaluable and the bootstrap side is `wide-straddle`,
that outranks ordinary agreement/disagreement handling; otherwise agreement
gives `passed`/`threshold-not-established` and disagreement gives
`threshold-not-established` (never `unevaluable` - both procedures were
computed).

**Untriggered precedence: `wide-straddle` OUTRANKS `passed`. [stated at
revision 35, extracted from the reducer's actual behavior rather than
chosen]** For an untriggered bootstrap endpoint the two descriptions can
genuinely co-occur, because the pass tests are STRICT on RAW operands while
the straddle test is INCLUSIVE on ROUNDED operands (section 8.2a rule 3): an
interval whose raw upper bound sits one ulp inside the passing boundary
passes strictly raw, while `roundToTie` lands the same interval exactly on
both boundaries and the inclusive straddle fires. **The collision resolves
to `wide-straddle`, and the raw pass result is discarded, not published
alongside it** - the straddle branch is evaluated first and hardcodes the
non-pass. Reachability and ranking are both pinned by test
(`backtestArms.test.js:1297`, `'untriggered precedence: ...'`), so this
paragraph transcribes behavior the suite already enforces; it does not
introduce a choice.

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
the two sealed identity assertions, section 8.6; **a detected
salt-collision, section 3.4 item 5; or a component-(f) veto-domain
completeness or eligibility failure - section 6.4a's required runtime
assertion, surfaced as a void report by name, never as a crash and never as
a silently smaller domain [enumeration completed at revision 35]**) -
`void` is a property of
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

**Activation is scored from ONE reference salt, and the invariance is
CHECKED, not assumed. [transcribed at revision 35 from the producer
determinations register, item 5 - substantive prospective amendment: the
published counts turn on it]** Activation is evaluated from the reference
salt `SALTS[0]`'s projections: `factors.homeAway` is resolved BEFORE the
seeded simulation (`applyFactor('homeAway', ...)` precedes
`simulateDistribution`), so activation is salt-invariant by construction,
and publishing all 24 salts' projections would multiply prereg 11's
eligible/activated COUNTS by 24 while leaving the rates unchanged - and the
counts are published, which is what makes this substantive rather than
presentational. **The invariance is verified at generation time**: every
salt's `(eligible, activated)` pair is checked against the reference
salt's, per player, and a divergence throws by name. The counts published
are the un-multiplied, single-salt counts.

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

**How the comparison passes are evaluated, sealed. [transcribed at revision
35 from the producer determinations register, item 9 - mechanical
completion, with the forcing argument shown in full]** Each sensitivity
pass assembles a COMPLETE variant document, identical to the primary in
every raw record and differing only in the arm-week metrics (an
evaluation-time re-scoring over the SAME generated projections - never a
regeneration, so section 9's grid arithmetic is untouched), and computes
that variant's candidate verdicts and parsimony winner through the
REDUCER'S OWN exported claim assembly - never a re-implementation. Two
consequences are frozen:

- **The harness legs are NOT re-run per variant** - the canaries, the two
  identity assertions, the salt-collision guard, and the permutation
  control all read the `preflight` and `permutationControl` blocks, which
  are byte-identical across the variant documents, and none of them enters
  any candidate cell's verdict: each forces run-level `void`, which is
  variant-invariant. Re-running them would re-derive identical answers from
  identical bytes.
- **The comparison verdicts are computed on PLACEHOLDER sensitivity inputs**
  (`contradicted: false`, both disagreement booleans false). This is forced,
  not chosen: this section compares each cell's "own recorded verdict under
  the primary ordering" against the variants', so the verdicts being
  compared must not already carry the comparison's own output - the
  alternative feeds the check its own conclusion and is circular.

**The estimand halt is evaluated on the POST-CONTRADICTION basis.
[transcribed at revision 35 from the register, item 10 - substantive
prospective amendment: WHEN the halt fires turns on it]** After the ordering
comparison has produced the per-cell contradiction flags, BOTH estimands'
claims are recomputed from documents carrying those derived flags (the same
flags for both - the ordering sensitivities are computed once, over the
primary estimand, and their cell demotions are estimand-independent), and
the two estimands "disagree on a winner" exactly when the sealed
reconciliation halts on THOSE winners - **including when one estimand
selects a cell and the other selects none**: an estimand under which no
cell passes has not agreed that any cell is better. The basis is
load-bearing: an ordering contradiction can demote the placeholder-basis
winner and shift the final selection to a cell the force-fill estimand
never endorsed, so a halt evaluated on placeholder-basis winners can read
`false` while prereg 5.3's "NO SELECTION OCCURS" condition is true of the
selection the run will actually make. Item 9's circularity argument does
not apply here - the contradiction flags are fully computed before the halt
is evaluated, so nothing feeds the comparison its own output.

**The estimand audit trail rides the DOCUMENT and the PUBLISHED REPORT.
[added at revision 35, sealing the D6 ruling of 2026-08-08 - substantive
prospective amendment]** The evidence behind this section's two
selection-level booleans - `winnersByPass` (the parsimony winner under each
of the three passes) and `estimandReconciliation` (the halt's basis:
selection, halted, reason, detail, and both estimands' winners) - is a
REQUIRED document key (`sensitivityAudit`) and a REQUIRED key of the
published report, rendered in the Markdown beside Selection; **null on a
void run**, mirroring the cells. A halt that publishes its winners-by-pass
trail is auditable from the report alone; a console-only trail dies with
the terminal. Frozen with it:

- **The mixed basis is stated wherever the trail is published**: the two
  `ordering:*` rows of `winnersByPass` are STAGE-1 placeholder-basis
  winners (item 9's fixed point), while the estimand row is the STAGE-2
  post-contradiction winner (item 10). A reader who assumes one basis for
  all three rows mis-reads the trail, so the basis difference is part of
  the sealed schema's meaning, not a caption.
- **Internal consistency is FAIL-CLOSED at producer and reducer alike**:
  `halted` must equal the winners' disagreement under the sealed halt
  function; the run's selection must follow the halt; the document's
  `deployedPolicyDisagreement` must equal the trail's `halted`; and **the
  ordering axis carries the symmetric cross-check at BOTH layers** - the
  ordering-disagreement boolean must be consistent with the ordering rows
  of `winnersByPass` and the per-cell contradiction flags, suspended only
  while any candidate is contradicted, where the stage bases genuinely
  diverge.
- **Comparison documents carry a PLACEHOLDER audit** (item 9's fixed-point
  terms); the real trail rides only the final document.

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

**An estimand's "winner", for the halt of section 8.4, is defined here.
[transcribed at revision 35 from the producer determinations register, item
10]** It is **this section's parsimony winner computed over that estimand's
own passing set** - the full Level-5 procedure under that estimand's
claims, not a raw best-metric readout - and the reconciliation compares the
two winners so obtained, on the post-contradiction basis section 8.4
seals.

**The force-fill estimand governs BOTH sides of its regret. [transcribed at
revision 35 from the register, item 11 - substantive prospective
amendment]** Prereg 5.3 defines a "legal nine-slot lineup" ESTIMAND - a
redefinition of lineup legality under a heading that names it a regret
estimand - and regret (prereg 5.2/6.1) is best-legal-lineup minus
started-lineup. Under the force-fill estimand, force-fill legality
therefore applies to the STARTED lineup and the BEST lineup alike. A
started-side-only reading would mix legality regimes across the two sides
of one regret and can make it negative - a deployed-policy "best" may leave
a slot empty over negative actuals that force-fill's "started" must fill -
which the solver layer rejects as a defect. The both-sides reading is the
only one under which the estimand's regret is a regret.

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
configuration, so no tolerance is appropriate.

**The required procedure is `assertProjectionRunBitIdentical`
(`lib/arms.js:387`), NOT `assertControlBitIdentity`.**
`assertControlBitIdentity` (`lib/arms.js:359`, committed in Commit A6)
implements the naive run-object form of this comparison,
`canonicalJson(controlRun) !== canonicalJson(usage25OffRun)` -> throw, and
**must not be handed two `generateProjections` return values**:
`canonicalJson` serializes a `Map` to `"{}"`, so such a call would compare
`"{}"` against `"{}"` and pass vacuously, which is the failure mode this
assertion exists to prevent. `assertProjectionRunBitIdentical` is the
Map-safe procedure the bullet below specifies; it reuses
`assertControlBitIdentity` internally for the PER-PROJECTION plain-object
comparison only (`lib/arms.js:404`). **[corrected at revision 24]** Revisions
12-23 carried a sentence here endorsing `assertControlBitIdentity` as
already implementing "exactly this comparison," four lines above the bullet
that forbids exactly that use; the endorsement is withdrawn rather than
deleted silently.

- **[rev13, corrected per rejection finding 1] Comparison rule: BIT-IDENTITY
  via canonical serialization of PER-PROJECTION objects, never of the run
  object as a whole.** `canonicalJson` (`scripts/backtest/lib/snapshotStore.js:98-122`)
  serializes a plain object via `Object.keys(value).sort()`. **`Object.keys`
  on a `Map` returns `[]`** - a Map's entries live in internal slots, not
  own enumerable properties - so `canonicalJson(aMap)` returns the string
  `"{}"`, silently, with no throw. `generateProjections` returns
  `{ projections: Map<playerId, projection>, inputCutoff, sourceCoverage }`
  (`projection.service.js:475-479`), so **naively canonicalizing two whole
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

  **Note on the existing helper**: `lib/arms.js:359`'s
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

**Status of the serialization form [revision 35].** The producer takes the
ALTERNATIVE this section explicitly allows: identity-record run objects are
converted at capture to the deterministic sorted array form - entries
ascending by NUMERIC `playerId`, emitted as `[key, value]` pairs - by
`sweepPreflight.serializableProjectionRun`, the exact inverse of the
reducer's own run normalization and kept beside it. The conversion is
fail-closed on key/field disagreement, on canonical-duplicate ids (the Map
keys `7` and `'7'`), and on bare-number values, and step 1's raw-input
uniqueness still runs first, exactly as this section requires. **The
alternative is not optional hygiene here; it is what makes the records
serializable at all** - `canonicalJson` writes any `Map` as `{}` silently,
so a producer that carried the Map form into the document would serialize
every run side empty and the preflight would void the document it had just
built.

**Both sealed identity assertions ALSO run at generation time. [transcribed
at revision 35 from the producer determinations register, item 12 -
mechanical completion; the sealed invocation clause's own rationale is
served strictly better]** The producer invokes the reducer's own exported
identity coverage check - never a re-implementation - once per
`(season, week)`, the moment all 24 salts' operands exist. The sealed
invocation point above ("BEFORE any candidate cell's metrics are computed,
and before the permutation control runs") is a PREFLIGHT-block ordering the
reducer still owns and re-runs in full from the document; at generation
time a strictly-before ordering is impossible, because the assertions' own
operands include the week's generated cell runs. What the per-week
invocation preserves is the clause's stated rationale - failure aborts at
the first bad week rather than after the full grid has burned its runtime.
The reducer's full-domain conjunction is unchanged.

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
and unrelated to that field: `buildPriorGames` (`projectionFeatures.js:188`;
revisions 18-28 cited `:177-231`, whose start is a docblock line rather than
the declaration) attaches a per-row `isHome` orientation tag to a PLAYER's
PRIOR-SEASON game rows only when `useStoredHistory` (or `crossSeason`) is
true (`:193, 212, 238` **[the third re-verified at revision 35; was
`:231`]**); at the DEFAULT (`false`), those rows simply carry
`isHome: null`.

**`isHome` is the ONLY field the flag reaches, and the asymmetry that makes
that true is deliberate [revision 22; now defended in code - see the status
below].** The flag
gates two adjacent lines, and only one of them admits it **[locators
repaired at revision 35; the defending comment's landing shifted these
lines from `:230`/`:231`]**:

```
:237   opponent: trusted && (sameSeason || crossSeason)      ? trusted.opponent : null
:238   isHome:   trusted && (sameSeason || useStoredHistory) ? trusted.isHome   : null
```

`:212` DOES make `resolved` non-null in the forced-variant arm (`teamKey`
uses `(crossSeason || useStoredHistory)`), so a reader checking only `:212`
would conclude `opponent` changes too. It does not: `:237` re-gates on
`(sameSeason || crossSeason)`, which excludes `useStoredHistory`, so the
resolved opponent is computed and DISCARDED before `versusOpponent` ever
sees it. Citing only the `isHome` line - as revisions 11-21 did - leaves the
claim resting on an argument that does not cover the field most likely to be
doubted.

**Why this matters beyond citation hygiene.** The edit that
falsifies this whole passage is a one-line tidy-up making the `opponent`
gate symmetric -
`(sameSeason || crossSeason || useStoredHistory)` - made by someone with no
signal that the inconsistency is the point, after which the rationale above
would still READ as valid because it only ever argued from the `isHome`
line. **Status [revision 35]: the defending comment EXISTS.** Revisions
22-34 recorded it as the stronger protection while barring it - production
code on a post-B non-allowed path, batched into Gate 4 - and it landed at
this re-cut, exactly as batched: `projectionFeatures.js:230-236` now opens
"DELIBERATE ASYMMETRY - do not symmetrize these two gates (backtest spec
section 8.6.1)" and states that each flag reaches exactly one field, naming
the sealed no-op rationale the tidy-up would falsify. **Per the feature builder's own docblock
(`projectionFeatures.js:518-520` **[locator re-verified at revision 35;
`:512` had drifted]**): "This map is read only behind
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
add a dedicated constants builder for this variant, informed by,
not copied from, the legacy harness's `withHistory` pattern.

**Status of that requirement [revision 22; INFERENCE STRUCK and re-evidenced
at revision 35].** Revision 22 recorded MET on the evidence that `arms.js`
DEFINES and EXPORTS `resolveConstantsWithStoredHistory` (the builder) and
`assertOnlyStoredHistoryLeafDiffers` (the single-leaf guard). **That
inference is struck, not merely reworded, per the accepted round-3
disposition the preamble now carries as the status-block rule: definition
and export are never evidence of invocation.** A defined, exported,
never-called guard satisfies exactly nothing this section requires. The
status is re-written from INVOCATION evidence against the current code, and
it is MET on those terms:

- **The builder runs on the governed path**: the generation driver
  constructs every stored-twin arm's constants through
  `arms.resolveConstantsWithStoredHistory`
  (`lib/inputsGeneration.js:995`), and its own docblock records that no
  caller can hand the twin a cell built any other way.
- **The single-leaf guard runs on the governed path, against the ACTUAL
  captured constants**: `sweepPreflight.js:301` invokes
  `assertOnlyStoredHistoryLeafDiffers` inside the `homeaway-on-stored`
  identity-coverage preflight, which the reducer runs on every document and
  the producer additionally runs per `(season, week)` at generation time
  (section 8.6.0's item-12 transcription). The operands are the constants
  captured FROM the records, not re-derived - the code comment beside the
  call records that an earlier re-deriving form was a self-consistency
  check on two pure functions of one input, and an on-stored arm mis-built
  with plain `resolveConstants` passed it; the record-operand form is what
  makes the guard capable of failing.

Revisions 13-21 carried a sentence here asserting that
`resolveConstants` "does not build this third variant." **That claim went
false when the CODE changed** - the builder was added by commit `41a8a65`,
after revision 18 was approved - and it is withdrawn rather than deleted
silently.

**This is the negative-existence class, and it is why no byte-identity proof
can catch it.** Sections 3-8 changed by 149 added lines and ZERO deletions
between approved revision 18 and revision 21, so this sentence was
byte-identical to what the reviewer approved; the document did not change,
the world did. Revision 21 withdrew the identical claim in section 11.3 -
outside the review scope - and left this copy standing inside it. A claim of
the form "X does not exist" has no locator to check and goes false silently
when X is added. Section 10 carries the running inventory of such claims.

#### 8.6.2 **[rev10, completed per rejection finding 2]** The complete fresh-vs-fresh allowlist

Neither arm in the "on"/"on-stored" comparison ever touches the database
cache - both are freshly computed through the same sweep pipeline directly
via `projectPlayer`. **The full allowlist, every numeric/nullable path
verified against `projectPlayer`'s actual return shape and the factor
functions it assembles from:**

- **Top level**: `mean`, `median`, `p10`, `p25`, `p75`, `p90`,
  `activeProbability`, `sampleSize`, `effectiveGames` (`:1038`, `:1177` -
  **[locators repaired at revision 27; `:1027` and `:1156` were stale]** -
  included here, unlike the cache-compatible allowlist, since neither side
  touches persistence).
- **`factors.recentProduction`**: `perGame`, `pointsContribution`,
  `effectiveGames` (`:1081`), **`games`** (`:1080`, `baseline.sampleSize` -
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
  (`projectionModel.js:1149-1151`: `factors.role = hasRoleData ?
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
`loadCachedRows`'s own mapped shape (`projection.service.js:496`), not
derived as "the fresh list minus one field."** Deriving it by subtraction
risks silently propagating a future addition to the fresh list (a field
this document has not yet traced through the cache path) into the cache
allowlist without ever separately verifying it round-trips. Frozen
directly:

- **Top level**: `mean`, `median`, `p10`, `p25`, `p75`, `p90`,
  `activeProbability`, `sampleSize` - each verified present, under the same
  name, in `loadCachedRows`'s row-mapping (`:507`). **`effectiveGames`
  is NOT in this list**: neither `effective_games` nor `effectiveGames`
  occurs anywhere in `projection.service.js`, so the persisted row has no
  such column. **[pointer repaired at revision 22]** Revisions 12-21 cited a
  "`PROJECTION_COLUMNS` block" as the place to check. There is no column
  list under that name - `projection.service.js:545` is
  `const PROJECTION_COLUMNS = 12;`, a numeric arity constant used for
  parameter placeholders - so the verification path a reviewer would follow
  did not exist. The negative claim is true; only its locator was wrong, and
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
  - the **cache-read side** (`loadCachedRows`, `projection.service.js:496-
    524`; the `byPlayer.set` loop is at `:506-507`) **[locator repaired at
    revision 33; `:478-497` was stale, and is the range this finding
    blocked on]**: scan `result.rows` for repeated `row.player_id` values
    BEFORE the `for (const row of result.rows) { byPlayer.set(...) }` loop
    executes - `byPlayer.set(row.player_id, ...)` would otherwise silently
    keep only the last SQL row for a duplicate `(run_id, player_id)`, a
    real risk if the underlying table ever violated its own data integrity.
    Hard error on any repeat, before the Map is populated.
  - the **fresh-computed sides, for BOTH sealed assertions** - the
    `usage-25 x off` and control arms (section 8.6.0) AND the "on"/
    "on-stored" arms (section 8.6.1): scan each arm's own raw input
    `playerIds` array for repeated ids BEFORE `generateProjections`'s
    per-player loop (`projection.service.js:467`,
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
`loadCachedRows`'s `byPlayer.set(row.player_id, ...)`, `:507` **[locator
repaired at revision 34; `:496` is the function signature, eleven lines short
of the loop, and was the one sibling citation revision 33's repair of section
8.6.4 did not reach]**, silently
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

#### 8.6.6 The generation-seam wiring obligations **[added at revision 35 - mechanical completions, each forced by an existing sealed requirement; transcribed from the producer registers]**

The `--inputs` producer splits into pure modules (injected `generate`, no
`server/services/**` reach) and thin wiring that supplies the real
functions. **Five obligations bind the wiring, and each has the same
dangerous shape: a wiring that violates it produces a document that still
VALIDATES** - the schema cannot see any of them, which is why they are
sealed here as interface contracts rather than left as docblock advice.
None is a new decision; each is the stated consequence of a requirement
this document or the preregistration already seals, cited per item:

1. **`generate` MUST pass `weatherService: false`, pinned as a literal in
   the wiring itself, regardless of what arrives from any caller.** Weather
   off is the exactness precondition for component (f) - `median_on -
   median_off = b * e` holds only because weather is applied AFTER homeAway
   in the model - and the pure layer cannot verify the flag survived the
   seam: weather changes the numbers, not their shape.
2. **`generate` MUST forward `onPreHomeAwayBaseline` unchanged into
   `generateProjections`.** The callback is the ONLY source of the
   pre-homeAway baseline `b` (section 6.5); a wiring that drops it produces
   zero baseline rows, which the driver rejects by name rather than letting
   an empty subgroup look like a small one.
3. **`generate` MUST genuinely generate on EVERY call - no results cache,
   no memoization keyed on the arguments.** The 8.6.0 control receives
   arguments identical to the `usage-25 x off` cell's BY DESIGN, so a cache
   collapses exactly that pair and the 816 independent-regeneration records
   would compare an object against itself - section 9's forbidden reuse.
   The driver's `assertRunsNotAliased` rejects every non-cloning cache at
   generation time, across all three projection shapes with canonicalized
   keys; **a cache that CLONES its hits is invisible to any reference
   check by construction**, which is why genuine regeneration is sealed
   here as an obligation rather than only enforced.
4. **`generate` MUST return the WHOLE run object, never the bare
   projections Map.** Section 8.6.0's comparison consumes the explicitly
   named non-Map run fields (`inputCutoff`, `sourceCoverage`) alongside the
   projections; a wiring that unwraps the Map (as the MDE's own
   `projectPoints` correctly does for ITS consumer) silently deletes the
   fields the assertion is required to compare.
5. **The benchmark PLAYER prior-game history MUST carry `usage`.** Prereg
   7.2's
   `usage-signal` is defined over usage-bearing games; a player history
   built
   without usage counts makes the benchmark return `null` for EVERY player
   - published as a benchmark with no interval rather than surfaced as a
   wiring failure. The rosters script's own PLAYER prior-games index does
   NOT
   carry usage (its consumer never reads it), which is exactly why the
   wiring builds its own player index rather than reusing that export.
   **The DEFENSE leg is the stated exception, not a violation**: the wiring
   DOES reuse the rosters script's defense prior-games index, which carries
   no usage, and `usage-signal` is `null` for every DEF by construction -
   no DEF game is usage-bearing, so the null is the estimator's documented
   correct value there, not the wiring failure this obligation guards
   against.

**Two adversarial notes, DISCLOSED as deliberately unfixed. [revision 35]**
The QA round that closed the producer backlog recorded two theoretical
findings and left both open by decision; they are disclosed here so their
absence from the fix list reads as chosen, not overlooked. (i) **Surplus
baseline rows outside the cohort are silently ignored** by the
membership-derivation intersections - a consistent surplus passes the
cross-salt size checks; harmless to every published value today, but
contrary in spirit to the preflight's extra-input rejection posture, and a
hardening candidate if any review asks for it. (ii) **The bit-identity
guard's field set matches the reducer's exactly** - projections plus
`inputCutoff` plus `sourceCoverage`, section 8.6.0's own enumeration - so
there is no producer/reducer split to exploit; recorded because a FUTURE
field added to `generateProjections`'s return would need adding to both
sides or the guard silently narrows.

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
4. **The prereg 16 sensitivity publication is `standard` and `ppr`, ABSOLUTE
   METRICS ONLY, and its row set is exactly the absolute metrics underlying
   the (e2) scoring-profile inequalities (prereg 9.7): endpoints `regret` and
   `pairwise`, season 2025 only.** Prereg 16 extends descriptive reporting to
   those two profiles for their absolute metrics and nothing else. **Paired
   deltas, attribution composites, and the 10.6 diagnostics are NOT
   published for `standard` or `ppr`.** A reader wanting a standard-profile
   contrast has (e2)'s gates, which is what prereg 16 says those profiles
   are for. **This is not rule 1's family.** The cells are the same eight;
   what differs is that rule 4 publishes only the two (e2) scoring-profile
   endpoints rather than all seven, only absolute metrics rather than
   absolute metrics plus paired deltas, and only 2025 rather than both
   seasons. **[row set fixed at revision 22]** Revision 21
   fixed the metric-type axis and left the row set open, which admitted two
   defensible readings a 14x apart in published rows - an 8-cell parallel to
   rule 1, or (e2)'s own narrow scope - with a 100,000-draw bootstrap
   attached to every row and nothing to hard-fail either.

   **Cell scope, and why it is NOT "the selected candidate."** The rows are
   published **for the control cell and for every candidate cell that
   receives an (e2) evaluation** - 8 cells x 2 endpoints x 2 profiles. Tying
   the row set to the SELECTED candidate was considered and rejected: Level 5
   selection can return no-selection (a void run, no passing cell, or an
   ordering disagreement), which would leave rule 4's row set undefined
   exactly when the report most needs to be well-formed. A row set must not
   depend on an outcome computed after it.

5. **Activation is `half_ppr`, by inheritance, and carries exactly one
   profile coordinate.** Prereg 11 names no scoring profile, so it inherits
   prereg 4.3's formal primary exactly as rules 1-3 do. **This is
   inheritance, not invariance**: `homeAway.effect` derives from
   `homeMean`/`awayMean`, which are means of
   `calculateFantasyPoints(row.stats, rules)` (`projectionFeatures.js:197,
   :312-315, :359-361` **[locators repaired at revision 36: the second and
   third ranges read `:305-308` and `:352-354`, stale by the +7 shift of
   the revision-35 deliberate-asymmetry comment at `:230-236`; section 9's
   same-family `:418`/`:289` pair was repaired at revision 35 while these
   two, and the preamble/section-0 pair, were missed - finding S1 of the
   revision-36 systematic citation sweep, the worst of the three because
   no repaired sibling of these ranges existed anywhere]**), and
   `effect === 0` - the exact-zero event that
   defines the activation numerator - holds exactly when
   `homeMean === awayMean`, a condition that does not transfer across
   profiles. Activation is a half-PPR quantity and must be labeled one.
   **Activation is generated under the primary profile.** Exactly one
   activation row exists per `(cell, season, week, position)`; `standard` and
   `ppr` activation rows are NOT published, per rule 4's limit. The
   activation gate reads the `half_ppr` aggregate and must not read
   `standard`.

6. **[added at revision 35 - substantive prospective amendment; the SPEC-A
   decision, ruled by the user 2026-08-08: IMPLEMENT] The prereg 16
   WEEKS-2-17 sensitivity family: absolute metrics only, `half_ppr` only,
   BOTH seasons, all seven endpoints, all eight cells.** Prereg 16 mandates
   "Weeks 2-17 only, dropping Week 18, whose widespread starter rest is a
   common shock the paired contrasts already cancel (section 4.1)." Before
   this rule, that
   bullet had NO row set anywhere in this document - sections 4.6.3/4.6.4
   treated it as a mandate while rule 4's declared-fixed row set excluded it,
   which is the SPEC-A contradiction this rule resolves in the direction
   prereg 16's plain "published" requires. The row set, with every
   previously-open scope pinned:

   - **Absolute metrics only.** Prereg 16's own rationale - the common shock
     "the paired contrasts already cancel" - is the argument: the shock is
     NOT already cancelled exactly where the metric is absolute, so the
     sensitivity's information lives there, and re-publishing contrasts
     whose defect the rationale says does not exist would be rows without a
     question. (The Week-18 bullet says "Absolute" outright; this family's
     estimand scope was the genuinely open half and is pinned to match.)
   - **`half_ppr` only, NON-COMPOSING.** The bullet names no profile, so
     the family inherits prereg 4.3's primary by this section's canon - and
     the windows do NOT compose with rule 4: no `standard`/`ppr`
     week-window rows exist, per rule 4's "and nothing else".
   - **BOTH seasons** (section 4.6.1's default; the 2025-only exception is
     rule 4's scoring-profile family alone, as 4.6.1 now states).
   - **All seven endpoints over all eight cells** - rule 1's parallel. The
     benchmark arms and the 10.6 diagnostics get NO week-window rows; the
     family is the eight-cell absolute family, windowed.
   - **The rows are DERIVED from rule 1's own per-week values** - never a
     second input array - with section 4.6.2's union computed on the full
     family first and the window intersecting the surviving set. One number
     never carries two values (section 4.6.1's identity doctrine), and the
     document's evidence-input closure is unchanged.
   - **No moving-block companions** (prereg 10.5 names its own sealed
     construction and does not reach a derived re-windowing; stated so the
     absence is chosen, not inferred).
   - **Interval machinery**: section 4.6's, unchanged - nominally 16
     clusters, minus any prereg-10.4 drops the union already took, through
     the per-cluster-count shared index of section 4.6.3, with NO
     evaluability floor of its own (4.6.3's revision-35 note).

7. **[added at revision 35 - substantive prospective amendment; the other
   half of the SPEC-A decision] The prereg 16 WEEK-18-ONLY absolute family:
   the same rows as rule 6, windowed to week 18 alone.** Prereg 16: "Absolute
   Week 18 metrics are additionally published on their own." Same scope
   pins as rule 6 - absolute-only (explicit in the bullet), `half_ppr`
   only and non-composing, both seasons, seven endpoints, eight cells,
   derived from rule 1's rows, no moving-block companions. A one-cluster
   family lands in section 4.6.4's `degenerate` branch BY CONSTRUCTION -
   point published, bounds null, the bootstrap never called - and **a week
   18 that fails the union in any cell renders the whole family
   `unevaluable` for that `(season, endpoint)` across all eight cells**
   (section 4.6.2's composition rule, stated there).

   **Naming, for both window families [the vocabulary ruling].** The
   unqualified word "sensitivity" in this document's schema and code
   vocabulary (`evidence.sensitivityWeeks`, the derived `sensitivity` key,
   the "Scoring-profile sensitivity (prereg 16)" report table) remains RULE
   4's scoring-profile family ALONE. The window families are named
   **`week-window`** throughout - window identifiers exactly `weeks-2-17`
   and `week-18-only`, published under their own derived key and their own
   report table ("Week-window sensitivity (prereg 16)"), each row carrying
   its window identifier in the mandatory self-description - so the two
   prereg-16 vocabularies can never be conflated in an error message or a
   report row.

**Rule 5 pins rather than removes, and revision 21's contrary reasoning is
withdrawn. [corrected at revision 22]** Revision 21 removed the profile axis
from activation and grounded that in activation being "a property of the
model configuration, not of the scoring rules applied to the outcome
afterwards." **That premise is false** - the numerator is profile-contingent
through `calculateFantasyPoints` - and with it gone, removal stops being the
narrow reading and becomes an affirmative claim that a demonstrably
profile-varying quantity has no profile coordinate. Pinning is the narrower
move: it applies this section's own canon, that an unqualified family
inherits prereg 4.3's primary, which is derived from sealed text, whereas
removal would invent an exemption only rule 5 claims.

Removal was also actively harmful in the near term: it would delete the one
coordinate that records the live mismatch in the Gate 2 implementation, where
the activation cross-check gates on `scoringProfile === 'standard'` while
generation runs the primary. Removing the coordinate makes that mismatch
unrepresentable rather than fixed.

**"Generated under the primary profile" is NORMATIVE, not observational.**
It is a requirement the implementation must meet. The current implementation
does not determine it either way: `server/scripts/run-backtest-sweep.js`
contains no scoring-profile handling at all, and the legacy
`scripts/backtest-weekly-projections.js` carries a docblock declaring itself
SUPERSEDED for accuracy-roadmap purposes and naming the homeAway activation
question specifically as measured against `scripts/backtest/`, not against
itself. No claim about what the sweep currently does is made or relied on
here.

**This is self-consistency, not a new mechanism.** Section 8.6's routing of
`factors.homeAway.games` and the factor's `effect` through `context.homeAway`
and `buildLeagueContext` was approved at revision 18. Rule 5 follows that
same chain to its labeling consequence; it does not ask a reviewer to accept
a new one.

**The ruling holds regardless of the generation count.** If the sweep
generates once under the primary, pinning is correct labeling. If it later
generates per-profile to serve (e2) honestly, pinning says which realization
the gate reads. Removal would be wrong under both branches, because the
quantity is profile-dependent either way.

**Disclosure carried forward from the rule-5 analysis.** The activation
denominator is the candidate pool, whose ranking prereg 5.1 pins to
"re-scored from the pinned raw stats under the pinned half-PPR profile."
Rule 4 publishes `standard` and `ppr` absolute metrics computed on a
**half-PPR-selected cohort**, and the report must state that plainly
alongside those rows. **[disclosure extended at revision 35, sealing the
risk-C ruling of 2026-08-08 - substantive prospective amendment on the
published wording]** The same disclosure MUST additionally name the
OUTCOME-TRUTH pricing: the frozen Commit-A artifacts carry exactly one
`actualPointsByPlayerId` map, priced half-PPR, and re-pricing would need
raw stat lines the artifacts do not carry - so **a `standard` or `ppr`
arm-week's regret is a lineup chosen on that profile's projections,
MEASURED IN HALF-PPR POINTS**, and every rule-4 row sits on half-PPR-priced
outcome truth as well as a half-PPR-selected cohort. The report states both
halves plainly alongside those rows; the behaviour itself is fixed by the
frozen artifact and is pinned by test either way.

**Interval method. [scoped at revision 22; extended to the week-window
families at revision 35]** Every interval in the families
of **rules 1-4, 6, and 7** is section 4.6's, without exception - for rule
7 that method's own total reducer publishes the `degenerate` point with no
interval, which is the method speaking, not an exemption from it. **Rule 5's activation
rows and aggregates carry NO interval** - prereg 11.2 publishes activation as
a rate against a fixed threshold with a per-week profile, not as an estimate
with a CI - **and section 4.6 therefore does not reach them.** Revision 21's
unscoped "every family above" swept activation in while section 4.6's own
scope sentence enumerated only four families, so the two sections defined
each other's scope circularly and disagreed. Attaching a bootstrap interval
to activation would not have been a harmless addition: activation is also a
gate, since falling below 0.85 forces a cell to `inconclusive`.

**Scope limit.** This section governs DESCRIPTIVE publication only. It
changes no component endpoint, no Level 2/3/4/5 status, no activation
THRESHOLD or verdict (section 8.3 is untouched; rule 5 PINS its activation
rows to `half_ppr` and adds no threshold or verdict), and no selection.
**[corrected at revision 34]** This parenthetical read "except for the
coordinate removal in rule 5" from revision 22 through revision 33.
**[dating corrected at revision 35: the parenthetical read that way from
revision 19 (`9759a64`) through revision 33** - it entered with section
8.7's CREATION, alongside rule 5's original removal ("Activation carries NO
profile axis at all", `9759a64`'s own rule 5), and a wrap-safe search of
every anchor from `9759a64` onward finds it at each; the phrase wraps as
"coordinate / removal" across a line break, which is how a single-line grep
missed it and how "from revision 22" survived. Revision 22 REVERSED the
removal and left the parenthetical standing - that part of the revision-34
account is unchanged; what moves is the range's start, by three revisions.]
**Revision
22 is the revision that reversed the removal**: it corrected rule 5 to pin
rather than remove, added the sentence "Rule 5 pins rather than removes, and
revision 21's contrary reasoning is withdrawn", and left the scope limit
reporting the withdrawn action. The two differ materially - under removal,
section 8.3 carries no profile coordinate and `standard`/`ppr` activation rows
are unrepresentable; under pinning it carries exactly one fixed at `half_ppr`,
those rows are representable but not published, and the Gate 2 mismatch rule 5
exists to keep expressible stays expressible. An implementer taking the scope
limit at its word would build the shape rule 5 argues against. **No ruling
moves; rule 5 governed throughout.** The (e2) gates continue to evaluate
`standard` and `ppr` exactly as section 4.2 and prereg 9.7 already require -
rule 4 governs what is additionally REPORTED, never what is GATED.

---

## 9. Scale statement

**[rev13, corrected per rejection finding 2 - revision 12 understated this
by omitting the control-path arm entirely.]**

**[mechanical correction, forced by an implementation fact]** **[revision 27
- revisions 13 through 26 understated this by omitting the scoring-profile
generation axis entirely.]** This is the SECOND time this section has been
corrected for omitting a whole class of generation, and both times the
omission had the same shape: a set of runs the document assumed came free
with runs it had already counted.

**The false assumption.** Every revision through 26 counted as though
scoring profile were a REPORTING coordinate - as though one generation could
be re-scored afterwards into `standard` and `ppr`. It is a GENERATION
coordinate. Four facts, each checkable in the code:

- `loadFeatureBundle({ season, week, playerIds, rules, ... })`
  (`projectionFeatures.js:425` **[locators re-verified at revision 35;
  `:418` and `:289` had drifted]**) takes `rules` as a build-time parameter.
- Every historical stat line is re-priced through
  `calculateFantasyPoints(row.stats, rules)` at `projectionFeatures.js:197`
  and `:296`.
- That module's own docblock (`:20-23`) states the stored `fantasy_points`
  column, default half-PPR, **"is never read as an authoritative value."**
- The freeze manifest pins each of the three profiles by SHA-256 **of its
  rules bytes** and re-verifies the pin, rejecting any hash that is not
  genuinely a hash of the pinned bytes (`freezeManifest.js:199-202`). **A
  study does not hash-pin an input that cannot change its output.**

Different profile yields different features, hence a different projection.
`standard` and `ppr` cannot be produced by re-scoring a `half_ppr`
generation; they require their own.

**What determines the count is prereg 9.7's sealed (e2) gates.
[re-attributed at revision 29 - see the correction note below.]** Section
8.7 rule 4 is quoted here in full rather than cited, because a citation is
what failed the last time this document reasoned about a section it had
already compressed, and because rule 4's row set is what the publication
side of the same runs depends on:

> The rows are published **for the control cell and for every candidate cell
> that receives an (e2) evaluation** - 8 cells x 2 endpoints x 2 profiles.
> Tying the row set to the SELECTED candidate was considered and rejected:
> Level 5 selection can return no-selection (a void run, no passing cell, or
> an ordering disagreement), which would leave rule 4's row set undefined
> exactly when the report most needs to be well-formed. A row set must not
> depend on an outcome computed after it.

Rule 4 fixes its coordinates before execution: **8 cells**, 2 endpoints, 2
profiles, and - in the same rule - **season 2025 only**, since rule 4
publishes "only 2025 rather than both seasons". Nothing here is
outcome-dependent, and rule 4 forbids outcome-dependence by name.

**[corrected at revision 29]** Revisions 27 and 28 called these "all four
coordinates" and then multiplied `2 profiles x 8 cells x 24 salts x 17
weeks`. Two of those factors are not what the sentence claimed. **Endpoints
do not appear in the product at all** - both endpoints are computed from
the same generated projections, so endpoint count is a reporting
coordinate, not a generation one. **Salts do appear and are not rule 4's**;
they come from prereg 8.1. Three of rule 4's coordinates are load-bearing
for the generation count and one factor of the product comes from
elsewhere. The arithmetic below is unchanged and correct; the sentence
licensing it was not.

An (e2) component that comes back `unevaluable` produces a FAILING row
under section 8.2's table, not an absent cell. **[claim withdrawn at
revision 29]** Revisions 27 and 28 asserted here that the phrase "receives
an (e2) evaluation" occurs **exactly once** in this document. It occurs
**three** times, and it never occurred once in the bytes that asserted it:
the claim and section 9's own full quotation of rule 4 - which is what
falsifies it - entered together at revision 27. The count was true of
revision 26, verified against revision 26, and carried into bytes where
this section's own remedy for the revision-25 citation failure had already
broken it. The determinacy argument does not need the count and does not
rest on it: the restrictive clause is vacuous because prereg 9.7 carries no
applicability condition, which is checkable directly against the sealed
text. Section 10.2 records the hazard class.

**Arithmetic, therefore fully determined:**

```
2 profiles x 8 cells x 24 salts x 17 weeks (2025 only)  =  6,528
```

**Invariant, stated as a check:** `2 profiles x 17 weeks` is identically
`1 profile x 34 weeks`, so the sensitivity generation equals the primary
grid exactly - 6,528 by either route. A reader who arrives at a different
figure has erred in one of those two factors, and this identity locates
which.

**Condition 3 of section 0's category is SHOWN, not asserted - AND ITS
SHOWING IS NOW HISTORICAL. [restated at revision 35]** The paragraph below
was written at revision 27 and was true of every anchor through revision
34: the figures this section publishes had no consumer anywhere, so
correcting them could not change any verdict. **At THESE bytes that
condition is FALSE**: the `--inputs` producer pins `14,688` as a code
constant (`inputsGeneration.GRID_TOTAL`, "pinned so a plan that drifts from
the sealed table fails a test rather than a review"), the wiring's grid
check hard-aborts a run whose counts disagree with it, and the suite pins
both. That is deliberate hardening, not drift - but it means **a FUTURE
correction to this section's arithmetic would no longer be verdict-neutral
and could not take the mechanical-correction label on the strength of the
showing below**; it would have to reckon with the consumers first. The
revision-27 demonstration is retained beneath as the historical record of
the condition AT ADMISSION:

The figures
this section publishes have no consumer anywhere - no code reads them, and
nothing in this document computes from them - so correcting them cannot
change any verdict a cell reaches. Two commands, both reproducible against
the anchored bytes:

```bash
grep -n '8,160\|7,344\|6,528\|2,448\|\b816\b' PHASE5_EXECUTION_SPEC.md
grep -rn '8160\|7344\|6528\|2448' scripts/ server/ --include=*.js
```

At revision 26 the first returned 12 lines, ALL of them inside this section
or section 11.2's narration of it, and the second returned nothing. **The
word boundary on `816` is load-bearing**: without it the pattern also
matches inside blob hashes and long numerals (three spurious lines at
revision 26), which is why the pattern is recorded here with its result
rather than the result alone.

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
- **Scoring-profile generation forced by prereg 9.7's sealed (e2) gates:
  `2 x 8 x 24 x 17 = 6,528`** further salted arm-week generations, for
  `standard` and `ppr`, 2025 only. **This was omitted from every disclosure
  through revision 26.** It is neither optional nor conditional, and
  **[re-attributed at revision 29]** the authority is the sealed text, not
  section 8.7 rule 4. Prereg 9.7 carries four scoring-profile inequalities -
  standard-scoring regret and pairwise, full-PPR regret and pairwise, all
  "delta vs control", all 2025 - under a heading with **no applicability
  condition**. They are gates, part of the IUT, evaluated for every
  candidate cell. A delta-vs-control gate under `standard` requires
  `standard` generations for the candidate and for the control; across 7
  candidates plus control, 24 salts (prereg 8.1), 17 weeks of 2025 and two
  profiles, that is the identical `6,528`. Scoring profile is a generation
  coordinate, so the runs do not already exist inside the primary grid.

  **Why the previous attribution was wrong, and why the correction is
  stronger.** Revisions 27 and 28 attributed this line to "Prereg 16
  sensitivity generation (section 8.7 rule 4)". Section 8.7's own scope
  limit forbids that reading: "**rule 4 governs what is additionally
  REPORTED, never what is GATED.**" A reporting rule cannot force a
  generation. The practical test is that narrowing rule 4 to "control plus
  the selected candidate" leaves the count at `6,528`, because the sealed
  gates still require all eight cells. **The count is therefore determinate
  on sealed text alone, and more robustly than revision 27 claimed** - it no
  longer depends on rule 4's row set being determinate at all. The total
  `14,688` is unaffected, and there is no double count: the gate generations
  and rule 4's publication rows are the same runs.
- **Total, as this document currently stands: `6,528 + 816 + 816 + 6,528 =
  14,688`** salted arm-week generations. **[was `8,160` through revision 26;
  corrected at revision 27.]**
- **The one way this drops back to `13,872`** (`8,160`'s branch was
  `7,344`, the same 816-run reduction): if Gate 2 establishes an
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
- **The permutation control's own generation, recorded [revision 35]:
  `17 x 24 = 408`** further control-cell generations (2025 only, section
  5's scope), beyond every total above. The one reuse this section permits
  - the sweep's independent control arm doubling as the permutation
  control's artifact - was **NOT taken**, and the non-reuse is stated in
  the producer's own code exactly as this section requires for the reuse
  case's mirror image: the 8.6.0 independent control arm and the
  permutation control's observations are distinct generations, so the
  `14,688` stands and the reuse-disclosure obligation is not triggered.

**The generation-records checkpoint (`--records-out` / `--records-in`).
[added at revision 35, sealing determination 7 as decision D3, ruled FOR by
the user 2026-08-08 - substantive prospective amendment: the interface
appears nowhere in the sealed text, and adopting it was a real decision]**
Generation is 14,688 real projection runs plus the permutation control, and
the first-run expectations below predict the first authoritative run dies at
ASSEMBLY-side coverage arithmetic; a checkpoint between generation and
assembly makes that failure cost one assembly pass instead of a full
regeneration. Frozen terms, on the MDE artifact's model:

- **The checkpoint is an OPERATIONAL artifact, not evidence**: it is
  environment-free (asserted on the bytes as written AND as read), it is
  UNCOMMITTED, it never enters the freeze chain, and it is NOT named on the
  post-B allowlist. Nothing published cites it.
- **It carries its own identity**: the sealed `studyId` and a
  `recordsHash` - SHA-256 over its own canonical bytes - so a resume can
  prove the file is the one a generation run wrote before trusting a byte
  of it. Writer and loader hold the same shape contract, so a checkpoint
  the writer would emit and the loader would refuse is a bug caught at
  write time.
- **Flag discipline**: `--records-out` is the one OPTIONAL flag (an
  additional output, never a defaulted one). `--records-in` resumes at
  assembly and FORBIDS, by name, `--records-out` and every Commit-A input
  flag beside it - the resume path reads no Commit-A artifacts, and a flag
  no path reads is a flag that silently does nothing.
- **What a resume RE-RUNS from disk**: the digest; the identity coverage
  AND value bit-identity through the reducer's own preflight (section
  8.6.0's terms); salt-seed coverage; the phantom-member cross-check over
  the embedded cohort; the outcome-truth key discipline; and the grid
  counts against this section's constants - **the counts honestly stated as
  SELF-ATTESTED** (the writer's own tally, catching a truncated write,
  never a consistent forgery, which the digest binds to the writer
  instead).
- **What a resume CANNOT re-run, stated so the limit is sealed rather than
  discovered**: non-aliasing is UNVERIFIABLE from disk - a JSON round trip
  mints fresh objects, so the resume's non-aliasing guarantee is INHERITED
  from the writer's generation-time enforcement and bound to it by
  `recordsHash`, never re-proven. The per-generation guards' operands (the
  scored runs themselves) are not in the artifact, and WHICH sensitivity
  configuration produced each re-evaluated metrics array is the writer's
  label, hash-bound but not independently checkable from disk.
- **A checkpoint from a COMPLETED run MAY be resumed. [the D3 detail,
  settled here]** Assembly is deterministic from the checkpoint's bytes -
  the same artifact yields the same document - so a completed-run resume
  can only reproduce what the run already produced, and the loader
  validates the artifact, never the operator's reason for resuming. A rule
  against it would be enforcing intent from a file that cannot carry
  intent.

**First-run expectations, recorded so the first authoritative run's
failures read as predicted rather than surprising. [added at revision 35;
disclosures only, no rule changes]**

- **Risk A - baseline coverage is TOTAL, the callback's reach is not.** The
  preflight requires a matched-off baseline row for EVERY cohort
  player-week x every on cell, but section 6.5's callback fires only for
  player-weeks whose projection REACHES the homeAway step; a player absent
  from the feature bundle short-circuits earlier and produces no `b` at
  all. Under real data a single such player-week voids the run by coverage
  arithmetic rather than by evidence. The driver surfaces it at generation
  time with the count and the first offending coordinates named. Expect
  this first.
- **Risk B - the identity arrays are the document's bulk.** Sections
  8.6.0/8.6.1 are asserted over the full 34-week x 24-salt domain and the
  reducer re-runs them FROM THE DOCUMENT, so both sides' complete run
  objects ride in it: 816 records x 2 sides x the week's whole cohort,
  twice over. That is the approved reducer contract, not a producer choice;
  its cost is document size and driver peak memory proportional to the
  grid, disclosed here rather than worked around silently.
- **Risk D - every permutation-domain member needs a finite projected
  median under EVERY salt** (section 5.2's domain; the permutation control
  has no expression for a missing projection at all). The capture THROWS at
  capture time
  rather than assembling a document the reducer would reject hours later.
  Expect it on the first run alongside risk A, for
  the same underlying players.

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
| Revision 20 reviewer-packet correction | **not a review round** | 2026-08-04 | Revision 20 was anchored at commit `478ee5a127143fe55b848e22cf5faa18704d4f21` (SHA-256 `76672C3531CB6C72A6FDED5E1F08091EED500FB370283895C8F2A1CAB878676D`, blob `a26ff4abe93d09171578641f7429d4b224e12b9a`) and accumulated **no approvals**. Section 11's reviewer packet was found stale before any approval was solicited: 11.2's itemized summary stopped at review round thirteen, and 11.3 omitted prereg 12.1/12.2 (which section 8.7's rulings rest on), named `metrics.js` only for salt/resample helpers while section 4.6 mandates its percentile-bootstrap primitives, omitted `freezeManifest.js` where the profile identifiers are pinned, and carried a "does not yet" claim about `resolveConstants` that `resolveConstantsWithStoredHistory` had made false. **Corrected as revision 21**, which changes section 11 and this table only, and restructures 11.3 by which approval each item serves. The normative bodies of sections 4.6 and 8.7 carry over byte-identically from `9759a64` and `478ee5a`; no ruling changed. Because revision 20 held no approvals, nothing lapsed |
| Findings round against revision 21 — **Source A, pre-submission** | **NOT AN APPROVAL, and not independent** | 2026-08-04 | Three subagents spawned by the assistant, briefed from assistant-written prompts, run read-only against `ed5b001`. **Not independent of the assistant**, which authored or recommended several passages under review; explicitly never offered as an approval. Produced five blockers inside sections 3-8 that Source B did not address: the season coordinate, section 4.6's non-totality, the shared-index/varying-`n` conflict, "surviving" being undefined for a statistic with no comparator, and the stale `resolveConstants` claim. Useful as a defect filter, not as review standing |
| Findings round against revision 21 — **Source B, styled an independent review** | **NO APPROVAL ISSUED** | 2026-08-04 | Relayed into the working conversation. **The assistant did not observe its execution and cannot attest to its origin — this is a different provenance from R1-R5, each of which was transcribed from a named external reviewer's own message.** Recorded here at that standing and no higher. Findings: CRITICAL 1 (rule 4 fixed a metric-type axis but no row set), CRITICAL 2 (the moving-block carve-out contradicted prereg 10.5's sealed precondition), CRITICAL 3 (rule 5's removal of activation's profile axis rested on a false premise about `calculateFantasyPoints`), WARNING 3 (section 4.6 mislabeled sealed prereg 10.1 content as amendable), WARNING 4 (sections 4.6 and 8.7 defined each other's scope circularly and disagreed about activation), WARNING 5 (the half-PPR-selected cohort underlying rule 4's rows must be disclosed). **Addressed as revision 22.** No approval was sought or issued |
| Revision 21 → 22 | **not a review round** | 2026-08-04 | Revision 21 was anchored at `ed5b001496a5ffcf1338a431ea4a177b75ce79b4` (SHA-256 `DB9971B8385D17B6039ADF5DF9F4B6EAAACB26607681B80EFE55230EAA0A9E01`, blob `94ae4b746a6a964adf407f3160f30e7a2e774eb4`) and accumulated **no approvals**, so nothing lapsed. **Revision 22 is the first revision since 18 to change a RULING** — sections 1, 4.6, 8.6.1, 8.6.2, and 8.7 all carry normative changes, so the byte-identity shortcut that applied to revisions 20 and 21 does NOT apply here and a reviewer must re-read those sections rather than diffing them. Four of the findings answered originate in assistant-authored text (recorded below), which is why Source A cannot carry review standing on its own |
| Revision 22 → 23 | **not a review round** | 2026-08-04 | Revision 22 was anchored at `3bac26345ad7d912bae9f0080865dd62b3e9b669` (SHA-256 `B835B5982FA0573777F47285855DA445E765DFAB1526C546FE098D4EE3065C44`, blob `9b452737b523c11ddd1c2c682aed04abaa3901be`) and accumulated **no approvals**, so nothing lapsed. A review round against it found four pieces of false or self-contradictory scaffolding beneath conclusions that all survive: section 4.6.1's "eight of the thirteen" (e2) inequalities for 2024, which is FOUR; rule 4's "NOT the eight-cell factorial grid," contradicted by the same rule nine lines later and by section 4.6.2; section 4.6.1's unqualified both-seasons claim, which rule 4's 2025-only family contradicts without any deferral clause; and two unsupported citations in section 4.6.4 - whole-week undefinedness attributed to prereg 6.6, which is "Null and tie conventions (global)" and says no such thing, and a rho total-ties rule that appears nowhere in the preregistration. **Addressed as revision 23. NO RULING CHANGED**, so unlike the 21 to 22 step the byte-identity check IS available: sections 4.6.2, 4.6.3, and all five of section 8.7's rules are byte-identical to `3bac263` |
| Statistical review of revision 23 | **NO APPROVAL ISSUED** | 2026-08-04 | Reviewed revision 23 at anchor `3939a278e6c23a7a82298149ba8e573c42866362` (SHA-256 `9222E1F31F71E95DEB29F2DCBB14644C92A2BF424092B8027BB85F0DD5C8F649`, blob `a52c8cfaafae6c444306d5895ad517cf7ec008f3`). **Raised findings and issued no approval**; per the convention R1-R5 established, a round that issues no approval warrants no row in `APPROVAL_LEDGER.md`, and none was written. Revision 23 accumulated **no approvals**, so nothing lapsed when revision 24 superseded it. Three rounds of adversarial reading produced **no finding against any ruling** - every defect was in the scaffolding beneath them. Findings answered: four satisfied directives still written as pending (section 4.4 items 1-2, section 6.1's constants and evaluability guard); a present-tense endorsement in section 8.6.0 of `assertControlBitIdentity` as implementing "exactly this comparison," four lines above the bullet forbidding that exact use; ten stale `file.js:NNN` locators; and four defects in section 10.2's own locator inventory. **Addressed as revision 24** |
| Statistical review of revision 25 | **NO APPROVAL ISSUED** | 2026-08-05 | Reviewed revision 25 at anchor `7c5aa846a858e92668d3be9c1633fdac6b3bc776` (SHA-256 `57F7C4F0E39E1141B8CAFDBAB74BBF1C6F6DE4F5ACFB2BC21C64F3CEF22EE7D3`, blob `f5c96136bcaf3f95199e9275ca8b61f5371cfe64`). **Raised three findings and issued no approval**; per the R1-R5 convention a round issuing no approval warrants no ledger row, and none was written. **No finding impugned the category's sole member or any ruling** - all three were DURABILITY defects in section 0's new three-leg test, each a way the test could admit a FUTURE contradiction it should exclude: (i) nothing required that only ONE passage satisfy the legs, so two passages each governing and directing different things would each qualify; (ii) the contested-set qualifier that does the real work sat 31 lines below the legs, in the non-member discussion, where a drafter applying them in order would never reach it; (iii) no leg tested WHEN the governing passage came to exist, so a drafter could add a passage, observe the contradiction it created, and withdraw the older rule as "mechanical" - manufacturing the forcing condition. **Addressed as revision 26** |
| Revision 25 → 26 | **not a review round** | 2026-08-05 | Revision 25 was anchored at `7c5aa846a858e92668d3be9c1633fdac6b3bc776` (SHA-256 `57F7C4F0…`, blob `f5c96136…`) and accumulated **no approvals**, so nothing lapsed. **NO RULING CHANGED, and the category's sole member keeps its classification** - section 6.1's comparison form remains `[mechanical correction, forced by an internal contradiction]`. Section 0's test goes from three legs to five: leg 2 absorbs the contested-set qualifier, leg 4 adds uniqueness, leg 5 adds priority-and-immutability with identity to be SHOWN not asserted. Both new legs are demonstrated for the sole member in section 0 itself, since leg 5's own text forbids asserting compliance. Also: the section 4.6 characterization is tightened (it DOES contain a universal, over a set section 8.7 defines, so leg 2 fails rather than the section being silent), and two stale INTERNAL line citations introduced by revision 25 are removed, with the hazard recorded in section 10.2. **Byte-identity per region**: sections 4.6, 8.7, 6.1a and **6.2** are byte-identical to `7c5aa84`; sections 0 and 6.1 changed and must be read |
| Findings round against revision 24 | **NO APPROVAL ISSUED** | 2026-08-04 | Reviewed revision 24 at anchor `227c2e0` (SHA-256 `475ED9CA…`). **Raised findings, issued no approval**; no ledger row was written, per the convention R1-R5 established. One finding is substantive and is disclosed in section 10.3: revision 24's new section 6.1 amendment was **misclassified and misgrounded**, because section 6.2 of this document already compelled the tie-rounded `catastrophicCapCouldFire` comparison and named `3.80` in a list declared complete. **Addressed as revision 25**, which reclassifies the change, regrounds it on section 6.2, adds the missing taxonomy category to section 0, and makes the disclosure in 10.3 |
| Revision 27 → 28 | **not a review round** | 2026-08-05 | Revision 27 was anchored at `8cbd439e2c2480a9180d648b0d6586b0379df97e` (SHA-256 `239F1A4F…`, blob `ce89dd25…`) and accumulated **no approvals**, so nothing lapsed. **NO RULING, NO CLASSIFICATION, AND NO NUMBER CHANGED.** Revision 27's repair record named section **8.6.1** as the home of the fresh-vs-fresh allowlist whose locators it had just repaired; that allowlist is section **8.6.2's**. Six sites corrected: the preamble, this table's revision 26 → 27 row, three rows of section 10.2's repair table, and that table's prose. The locators, the repair, the `inside sections 3-8` claim and the 2-modified-1-added delta were all correct; only the subsection number was wrong. Section 10.2 records it as a **FOURTH hazard class** - a section attribution RESOLVES, just to the wrong section, so neither the locator check nor a byte-identity proof can catch it - together with the mechanical rule that a slice terminator must match every heading level at or above the target's, since a terminator matching only `###` and `##` does not match `####` and makes section 8.6.1 measure 374 lines where it has 107. **Both the drafting and the audit of revision 27 committed the error, with different probes.** Sections 3-8 are byte-identical to `8cbd439` |
| Revision 26 → 27 | **not a review round** | 2026-08-05 | Revision 26 was anchored at `51c0458abf36974966d065d2e384af9614035814` (SHA-256 `668BB9A7…`, blob `ee9c915f…`) and accumulated **no approvals**, so nothing lapsed. **NO RULING CHANGED.** Section 9's scale disclosure is corrected from `8,160` to **`14,688`** (branch `7,344` → `13,872`) by counting the prereg 16 sensitivity generation that section 8.7 rule 4 requires: scoring profile is a GENERATION coordinate, not a reporting one, so `standard` and `ppr` cannot be produced by re-scoring a `half_ppr` run. Labeled **`[mechanical correction, forced by an implementation fact]`** - the **FIRST member that category has ever had**, so section 0 now carries its boundary decision (the definition's "sealed text" is read DESCRIPTIVELY, since section 9's count sits in this document), its three conditions shown in order, and the **provenance disclosure** that the member was admitted in the round that found it, by the party that drafted it. Five errata ride along: section 2 named `sweepEvaluator.js` as consuming `ALL_CELLS`/`SELECTION_FAMILY`/`CONTROL_CELL`, which it references zero times while seven other modules do; four `projectionModel.js` `effectiveGames` locator sites; section 11.2's review-history currency claim, which pointed readers away from section 10.3; and section 1's "zero occurrences". **Sections 3-8 are NOT byte-identical at this step**: two lines change in section 8.6.2's allowlist locators. No ruling, endpoint, status, or selection is affected |
| Revision 24 → 25 | **not a review round** | 2026-08-04 | Revision 24 was anchored at `227c2e096934c22a423f7470be44f09b53d3c82f` (SHA-256 `475ED9CADC1E0A094DCC34BF86130375F2C8391FE4B56DDF00C346B91C786C7D`, blob `a89da3af5384b008869d9b57aa9a995ca7cc0393`) and accumulated **no approvals**, so nothing lapsed. **NO RULING CHANGED IN SUBSTANCE** - the tie-rounded comparison form stands exactly as revision 24 adopted it; what changed is its CLASSIFICATION (substantive prospective amendment → mechanical correction forced by an internal contradiction), its GROUNDS (prereg 6.6 → this document's own section 6.2), and the disclosure that the contradiction it resolves was present in approved bytes. Sections changed: preamble, 0, 6.1, 10. **Sections 4.6, 8.7, 5, 6.1a, and 6.2 are byte-identical to `227c2e0`** - 6.2 in particular is untouched, since revision 25 adopts what it already said rather than editing it |
| Revision 23 → 24 | **not a review round** | 2026-08-04 | **NO RULING CHANGED.** Byte-identity is available **PER REGION, not document-wide** - this step is neither of the two regimes the ledger's earlier entries established. Sections 4.6 (all four items and all four subsections) and 8.7 (all five rules, including rule 4's row set and cell-scope paragraph and rule 5's activation pinning) are byte-identical to `3939a27` and may be diffed. Sections 4.4, 6.1, 8.6.0, 8.6.2, 10.2, 11.2, 1, and the preamble all changed and must be read. **Section 6.1 additionally carries a NEW substantive amendment** - the `catastrophicCapCouldFire` comparison form - which no diff against revision 23 can shortcut. A reader who carries either earlier entry's regime forward gets the wrong answer for half this document. **Sequencing**: revision 24 had to anchor BEFORE any approval was commissioned. That constraint does not arise from the amendment - section 6 was always inside the statistical review's sections 3-8 scope, and the status blocks change section 6's bytes under any reading, so the hash moves either way. What the amendment changes is the COST of getting the order wrong: a status-block-only revision would have let a prior approval be re-issued against the new hash after a byte-identity check, whereas a new substantive amendment inside the reviewer's own scope requires a fresh review of text they have never seen |
| Independent statistical review of revision 28 | **NO APPROVAL ISSUED** | 2026-08-05 | Reviewed revision 28 at anchor `d0d0def` (SHA-256 `e6db125c…e372b`, blob `d962ca8d…`), scope sections 3-8, lines 843-3102. **Raised eight findings and issued no approval**; per the R1-R5 convention a round issuing no approval warrants no ledger row, and none was written. **PROVENANCE, stated by its three properties rather than by analogy to an existing row**: the review arrived as the reviewer's own first-person account carrying its process, and was transcribed by the assistant into `REVIEW-FINDINGS-revision-28.md`; **the assistant did not observe its execution**; **the reviewer is not named**. That is the text-standing of R1-R5 without their named-reviewer property, and it is not Source B's unattested-origin standing. Transcription to disk does not alter it. **The reviewer withheld approval on independence grounds independently of the findings**, disclosing that an auto-loading persistent memory index written by prior sessions inside this workstream was in context before any choice was made, and that commission section 7 named the expected weak point. **The headline target HELD**: section 8.7 rule 4's row set is determinate at 8 cells, unfalsifiable on the reviewer's probe, because prereg 9.7 carries no applicability condition where 9.3/9.4/9.8 each do. Findings: 1 BLOCKER (section 6.2's unstated scope, read three ways across 6.1/6.1a/8.2a, reaching leg 2 rather than only the comparison); 3 SUBSTANTIVE (the 64-vs-32 composition vector; section 6.5's "verified against the real call graph" alongside three locators that never resolved; section 9's 6,528 attributed to rule 4 when section 8.7's own scope limit forbids a reporting rule forcing a generation); 4 MINOR (`seedFrom`'s locator, later upgraded on the phantom-entry ground; "all four coordinates"; "occurs exactly once"; `buildPriorGames`'s docblock start). **Findings 2 and 3 are SUBSTANTIVE with MECHANICAL REPAIRS** - the axis whose collapse triggered revision 25. **Addressed as revision 29** |
| Revision 32 → 33 | **INDEPENDENT STATISTICAL REVIEW, NO APPROVAL** | 2026-08-05 | Revision 32 was anchored at `9a037217348117c82d23cc522706dbbd1750dc6c` (SHA-256 `9269EDDA…`, blob `0641d0f0…`) and accumulated **no approvals**, so nothing lapsed. An independent statistical review of sections 3-8, run from a clone outside the project directory with the path disclosed, returned **NO APPROVAL on eight findings** across an original report and three amendments. **UNLIKE revisions 30-32, THIS ONE MOVES THE APPROVAL SCOPE**: sections 4.3, 4.6, 6.2, 6.5 and 8.6.4 change, so a reviewer must READ them rather than diff them. **F2 carried the rejection**: section 8.6.4 cited `projection.service.js:478-497` for `loadCachedRows`, a range that is mostly `findRun` and EXCLUDES the `byPlayer.set` loop at `:506-507` that the frozen requirement is about; repaired to `:496-524`, with section 6.5's two locators repaired to `:1127` and `:270-283`. **F7 was the other substantive**: the packet omitted five sealed sections its own rulings rest on - prereg 3.3, 5.1, 6.2, 7.1, 7.2 - so a reviewer was asked to judge rulings against text they had not been given. **F1 corrected an overstatement, not a label**: section 6.2's closing clause said leg 2 was unsatisfied before revision 29; it was satisfied, no admissible scope reading puts `3.80` outside the list, and the real repair was a completeness declaration false read document-wide. **F3** relabelled section 4.6 item 3, which claimed to amend a level its own body said it inherited unchanged - an error in the SAFE direction. **F4** scoped section 4.3's `n >= 15` premise, false of component (f) whose sealed minimum is prereg 9.8's 8 clusters and 30 rows. **F8** split section 10.2, whose heading had named an inventory for eight growths while holding the instruments; 10.2 keeps the inventory and all ten hazard classes, 10.2a takes the checks, and nothing renumbers |
| Revision 31 → 32 | **not a review round** | 2026-08-05 | Revision 31 was anchored at `e4774b17875214e7700e74a2eef20bac15bea77c` (SHA-256 `585E992D…`, blob `24fb6d36…`) and accumulated **no approvals**, so nothing lapsed. **NO RULING CHANGED, no classification changed, and SECTIONS 3-8 ARE UNTOUCHED** - 2,352 lines at revision 31 and 32, 0 differing. All three changes land in section 10.2, plus this row and the preamble. **(a)** The `server/` figure is restated under ONE definition: of 182 commits touching `server/`, **159** touch neither `backtest-artifacts/` nor `scripts/backtest/`; revision 31 gave a floor of 140 and named two other boundaries, and one definition applied consistently beats three offered for comparison. The 21-commit gap to the artifact-only boundary is exactly the Gate 2 implementation commits. **(b)** The `.js` invariant filter is widened from commit SUBJECT to PATH. The two agree at every measurement taken, so **this corrects no undercount** - it makes the check test what the claim means, since a study commit typed `fix(backtest)` is caught by the path form and missed by the subject form. **(c)** A count over that population **rots by construction**: it grows with the commit that anchors the revision making the claim. Corrective entries 14 and 15 and the revision-31 ledger commit recorded 24, 25 and 26 respectively; all three were true when written, the invariant never moved, and quoting such a number now requires naming the anchor it was measured at. **This is the LAST revision before the review is commissioned**, under a stopping rule recorded in the preamble: section 10.2 refinements surfacing after this point ride to a revision AFTER commissioning, because 10.2 is outside the approval scope and its improvements change nothing a reviewer reads or approves |
| Revision 30 → 31 | **not a review round** | 2026-08-05 | Revision 30 was anchored at `eda85eb` and accumulated **no approvals**, so nothing lapsed. **NO RULING CHANGED, no classification changed, and SECTIONS 3-8 ARE UNTOUCHED** - the whole revision lands in sections 10.2, 11.2, this table, and the preamble. Five corrections, all of one family: **a claim or an instrument that measures something ADJACENT to what it asserts.** (1) Section 10.2 gains an **EIGHTH class - a closed-form correction to an unversioned claim rots again**: section 11.2's currency bullet read "extended at every revision through 27", which was *itself* revision 27's repair of a five-revisions-stale predecessor and had gone stale by three, sitting inside a bracketed note explaining that the predecessor "stopped five revisions short". The rule is to DELETE the endpoint, since "current as of the anchored bytes" is self-verifying and cannot rot. (2) The same treatment for section 11.2's two `14-21` bounds, whose heading already fixes the covered range at 1-13. (3) Section 11.2's preamble bullet pointed at "the revision-21 paragraph", which **does not exist** - the preamble was rewritten across revisions 27-30 and no paragraph stating what revision 21 changed survives; a reader following this document's own instruction for the rounds-14-onward account was sent to absent text, so the reference is made structural rather than by title. (4) Section 10.2 gains a **NINTH class - range standing in for authorship**: the confinement diff `c04d6b1..HEAD -- scripts/backtest server` returns 0 files and is offered for "the document revisions touched no code", but it isolates by range and path while the claim is about authorship, and those coincide only while the range holds one party's commits. Commit `972c53e`, an unrelated 17-file client feature, entered the range and the check returned the same 0 - **a check whose validity rests on a property it does not test reports the same answer before and after that property fails.** (5) **The SEVENTH class fired again inside the revision that recorded it**: revision 30 specified the confinement check and repaired revision 29's preamble while shipping its own status line as **"revision 29"** at both sites, in published bytes. The confinement check saw the preamble change and could not see the number inside it go false, because a structural check reports which sections moved, never whether a sentence in one is still true |
| Revision 29 → 30 | **not a review round** | 2026-08-05 | Revision 29 was anchored at `b7ccf186d3f6688079b42d26634bb028d91f173c` (SHA-256 `693ECFC8…`, blob `8bc45564…`) and accumulated **no approvals**, so nothing lapsed. **NO RULING CHANGED, no classification changed, and SECTIONS 3-8 ARE UNTOUCHED** - the whole revision lands in section 10.2, this table, and the preamble. It adds ONE thing: **the confinement check, specified**. Map every changed line to its nearest preceding heading at ANY level, and compare the resulting set against the set the revision claims, **as a set equality in both directions** - a subset check passes the actual defect, since revision 29's first confinement paragraph missed section 8.6.0 by never claiming it either way. The check is primary because it has no boundary to resolve and therefore none to get wrong; slicing stays secondary, confirming each claimed-identical section. It was validated retrospectively against `0762738..b7ccf186`, where it reproduces the known answer including the 8.6.0 the prose had missed, after a first implementation returned an empty set that a subset check would have accepted. `check-locators.js` stays BARRED until Gate 4's B3 re-cut; the specification is in force now, the script is not. **FORWARD CLAUSE FOR REVISION 29, whose row cannot be edited** (rows are left unedited so the record of what happened stays intact): **section 6.2 grew 27 lines to 74 at revision 29 and must be READ, NOT DIFFED.** "No ruling changed" and "section 6.2 is not byte-identical" are both true, and a reviewer should not have to combine two statements from two rows to reach that. The scope sentence documents a boundary that already held - all four thresholds in its table are component-(f) items, so no comparison entered or left the list |
| Revision 28 → 29 | **not a review round** | 2026-08-05 | Revision 28 was anchored at `d0d0def` (SHA-256 `e6db125c…`, blob `d962ca8d…`) and accumulated **no approvals**, so nothing lapsed. **NO RULING CHANGED, AND THE MECHANICAL CATEGORY KEEPS ITS SOLE MEMBER.** Section 6.2 gains an explicit **component-(f) scope** and a stated boundary against section 8.2a; this is the reading section 6.1a already used, and it preserves section 6.1's classification because `3.80` is itself a component-(f) comparison and stays inside the universal, which is now checkable rather than open-ended. **Finding 4 STRENGTHENS the mechanical classification rather than threatening it**: the 6,528 is forced by prereg 9.7's sealed gates, so the count is determinate on sealed text alone and no longer depends on rule 4's row set at all - the propagation the commission predicted runs the other way. Sections changed: preamble, 3.2, 6.1, 6.2, 6.5, 8.6.0, 8.6.1, **8.6.3**, 8.6.4, **8.6.5**, 9, 10.2, 10. **Sections 4.6, 8.6.2 and 8.7 are byte-identical to `d0d0def`**, verified by mapping every changed line of the diff to its owning heading rather than by slicing (a slice that truncates identically on both sides reports IDENTICAL without proving it). **The FOURTH hazard class recurred twice at this revision and was caught only by that mapping**: the review's own finding-3 table filed the `loadCachedRows` sites at `:2757`/`:2766` under section **8.6.2**, and this row's first draft repeated it. They are in **8.6.3** (the cache-compatible allowlist), and the third site at `:2914` is in **8.6.5** (cache-persistence QA). **Section 8.6.2 was never touched at this revision.** Both misattributions resolved to real, adjacent, plausible sections, which is precisely why neither the locator probe nor a byte-identity proof can catch the class Section 10.2 records three further hazard classes: the **BARE locator** (10 of 15 in scope were never in the inventory; the probe has never caught one), the **self-referential count that rots** (section 9's "exactly once" and the quotation falsifying it entered in the same revision), and the **status line** (the preamble read "revision 26" across two re-anchors, in bytes a reviewer authenticated, outside the scope where they would have met it) |
| **Independent implementation review** | **pending, strictly last, after Gate 2 code exists** | | scope, complete: the runtime salt-collision guard and its two-level unit/runtime split (section 3.4); the exact-trigger implementation defects, including the (f) no-finite-bound amendment label (section 4.4); the restored permutation-control definitions and aggregation (section 5); the rounding-boundary mutation tests and ten-decimal boundary normalization (section 6.1-6.2); the callback's per-receiver validation, exactly-once invocation, and exception propagation (section 6.5); the S3 non-estimable disclosure (section 7); the signed-boundary table and the exhaustive endpoint/component/cell/run truth table, including the (f)-unevaluable unification (sections 8.1-8.2); **activation's exact numerator/denominator (available && effect!==0, per-position including DEF, over eligible/non-neutral/known-orientation projections) and its precedence against `fail` (section 8.3)**; the restored cell-level ordering-inconclusive behavior and **Level-5 selection precedence, including the provably-unreachable winner-only branch (sections 8.4-8.5)**; **BOTH sealed identity assertions - the `usage-25 == control` bit-identity assertion (section 8.6.0: the Map-safe per-projection canonical-byte comparison and its named prohibition on passing a `Map` to `canonicalJson`, byte-equality with no allowlist and no tolerance, the explicitly-named non-Map run fields, its full player-week/salt scope, its pre-flight invocation point before the permutation control, its run-void disposition, and its seven mutation tests including the Map-serialization regression) and the `homeaway-on-stored` point-identity assertion** (section 8.6.1: its usage-25-only scope, the corrected `useStoredHistory` mechanism explanation, its single-leaf-difference guard), the complete fresh-vs-fresh allowlist (including `homeGames`/`awayGames`, `availability.activeProbability`, `role.pointsContribution`), the independently-frozen and explicitly-enumerated cache-compatible allowlist, **the ordered field-level comparator semantics with per-side type/finiteness validation running BEFORE any cross-side comparison, and raw-input duplicate detection running BEFORE any Map-building loop on both sides of every comparison**, and the descriptive-only cache-QA disposition (section 8.6) |
| Revision 33 → 34 | **not a review round; row restored at revision 35** | 2026-08-06 | **This step's record previously lived only in ledger corrective entry 18; the table's row practice resumes here without editing any prior row.** Revision 33 was anchored at `37b9f7d` (SHA-256 `023C4B6A…`, blob `9fe2fb6c…`) and accumulated **no approvals**, so nothing lapsed. An independent statistical review of revision 33 - run from a fresh clone outside the project directory, by a party with no prior involvement - returned **NO APPROVAL** on three findings (one SUBSTANTIVE, two MINOR), all in text revision 33 did not touch. **F-A carried it**: section 8.7's scope limit still reported rule 5's WITHDRAWN coordinate removal. Revision 34's response: net +18 in scope across sections 8.7 (the scope-limit parenthetical), 8.6.5 (the `byPlayer.set` sibling locator `:496` → `:507`), and 8.2 ("no seventh bucket" → "no sixth bucket" against the five-member Level-4 set); outside scope, the preamble's status correction (labeled there "the FOURTH recorded instance" - a count the revision-35 preamble correction re-counts as five stale revisions across three runs) and section 10.2a's identifier-consistency specification. Confinement returned exactly `{preamble, 8.2, 8.6.5, 8.7, 10.2a}`. **Revision 34 then accumulated ALL FOUR approvals - rows 7 (2026-08-06, independent statistical review), 8 and 9 (2026-08-06, the two user attestations), and 10 (2026-08-07, the independent implementation review) - each authenticating blob `e339020a`, SHA-256 `5EA91A5E…`** |
| **Forward clause for the "Independent implementation review — pending, strictly last" row above, whose row cannot be edited** | **OVERTAKEN: the review ISSUED as ledger row 10** | 2026-08-07 | The pending row above predates the approval and stays as written, per this table's discipline. The review issued 2026-08-07 against revision 34 (blob `e339020a`), recorded as **ledger row 10** with a reach note assigning what sits outside its reviewed bytes to "the B3 re-cut and Gate 3's verification". **Row 10 LAPSES at revision 35's anchor** with rows 7-9, per the deferral plan; the re-issued implementation review runs strictly last, against the freeze-candidate head |
| Revision 34 → 35 | **not a review round - THE B3 RE-CUT'S SPEC STEP** | 2026-08-08 | Revision 34 was anchored at `81289fa` (SHA-256 `5EA91A5E…`, blob `e339020a`) and accumulated **all four approvals (rows 7-10); ALL FOUR LAPSE at this anchor**, knowingly, per the deferral plan of ledger entry 21 item (4) - the first supersession since 18 to lapse live approvals and the first ever to lapse an implementation review. Revision 35 resolves the deferral batch: the six user rulings of 2026-08-08 (D1 SPEC-C both-season with the veto's own domain arithmetic published; D2 SPEC-A implemented as 8.7 rules 6-7; D3 the records checkpoint sealed in section 9; D4 prereg-4.1 eligibility into 6.3 with the 5.2 asymmetry stated; D5 the outcome-truth pricing disclosure; D6 the estimand audit trail into the published schema), the determinations register transcribed (items 1-5 and 7-12 at their owning sections; **item 6 is WITHDRAWN-CONFORMANT** - the earlier filing misquoted sealed 6.1 text, the code was and is conformant, the number is retained so the register stays dense, and the question is NOT re-opened before any reviewer), the wiring obligations sealed as 8.6.6, the seven inert findings closed, sections 1 and 9 re-stated in non-rotting form, first-run expectations A/B/D recorded, the four 10.2a instruments recorded LANDED, and every locator re-verified against this tree. **The preamble's revision-35 paragraph enumerates the changed-section set; a reviewer must READ those sections.** All four approvals must be re-issued against this revision's anchor; the re-approval terms live in the ledger's corrective entry for this step |
| Revision 35 → 36 | **INDEPENDENT STATISTICAL REVIEW, NO APPROVAL** | 2026-08-09 | Revision 35 was anchored at `f87f023` (SHA-256 `22726566…`, blob `12d51f85…`) and accumulated **no approvals**, so nothing lapses at this step. The commission reached the row-7 reviewer at the FOURTH delivery attempt - the first to arrive as byte-exact attached files under ledger entry 25's send-step control, so the manifest check ran and PASSED for the first time (entries 24 and 25 record the three misdelivered rounds). The review returned **NO APPROVAL on one SUBSTANTIVE finding, G-A**: section 6.1's `lib/arms.js:891-892` citation for the tie-rounded comparison, stale against the anchor's 1,757-line `arms.js` (the comparison at `:934-935`; revision 35's sweep updated four sibling citations and missed this one) - and the locator instrument reported 76/0, its identifier-window tier structurally unable to engage a citation that opens its line. **The pass is incomplete by the reviewer's own statement**: thirteen of the twenty-two changed regions went unread, including D1, D2, D5, D6, 8.6.6 and most of the transcribed register - nothing marked clean covers them. The reviewer withdrew one of their own delivery flags once the manifest verified, and recommended the next round go to a **DIFFERENT reviewer** whatever it contains - the prescribe-then-authenticate chain across revisions 33-35, not any single link; the ledger's corrective entry for this step carries the response verbatim. (The briefing-exposure disclosure of the misdelivered rounds is the ROW-10 reviewer's, recorded at ledger entry 25 - a different party's, standing separately.) **The study owner ACCEPTED the rotation**: the next commission goes to a fresh reviewer with no prior exposure, who reads the full scope cold, the thirteen unread regions included. Revision 36's response: the three in-scope stale locators repaired (6.1's `:891-892`; 8.7 rule 5's `:305-308`/`:352-354`, surfaced by the systematic sweep the review's method forced and the worst of the three, no repaired sibling having existed anywhere); the out-of-scope preamble/section-0 `:418`/`:289` pair; the O-3 status-line count raised at revision 34, deferred, re-verified against every anchor and corrected; and 10.2a's locator paragraph rewritten for the instrument's claim-expression tier, continuation extraction and sealed self-validation - until which the "each with a known-answer self-validation" packet claim was false of the fourth instrument. The confinement result for this step is recorded in its corrective entry |

No candidate cell may be computed while any item above remains unresolved.

### 10.1 Findings answered by revision 22 that originate in assistant-authored text **[added at revision 22]**

Recorded because it bears on how much weight a pre-submission read by the
same author can carry, and because the pattern is the reason Source A above
is not review standing.

| finding | origin |
| --- | --- |
| CRITICAL 2, the moving-block carve-out | An assistant performance note about `deriveMovingBlock` double-computing, spec'd without being checked against prereg 10.5 |
| CRITICAL 3, rule 5 removing the profile axis | An assistant recommendation argued as "the narrowest reading"; its premise about the code was never verified |
| Section 4.6's "two of the seven published endpoints are bounded" | An assistant sentence. Understated: `pairwise` is also a proportion, and `regret`/`mae`/`rmse`/`wis` are bounded below. Corrected at revision 22; the ruling survived |
| Revision 21's "section 11 ... and nothing else" | The assistant audited revision 21, verified confinement, and approved the claim in the same turn |

### 10.2 The negative-existence inventory **[added at revision 22]**

A claim of the form "X does not exist" goes false when X is ADDED, and **no
locator check and no byte-identity proof can catch it** - there is no locator
to check, and the document does not change. This is why the
`resolveConstants` claim survived twenty-one revisions and why revision 21's
withdrawal of the identical claim in section 11.3 did not propagate to the
copy in section 8.6.1. Hand-maintained; keep it small.

| location | claim | status |
| --- | --- | --- |
| §8.6.1, the `useStoredHistory` no-op passage | "there is no field it currently changes at all" | TRUE. Rationale completed at revision 22 to cite `projectionFeatures.js:230` as well as `:231` |
| §8.6.1, the constants builder | `resolveConstants` "does not build this third variant" | **WAS FALSE** — withdrawn at revision 22 |
| §8.6.2, the persisted column list | `effectiveGames` is not persisted | TRUE. Locator repaired at revision 22 |
| §1, the freeze-state barrier | "no `sweep` mode exists" | TRUE at Commit B2, **FALSE at HEAD** — reference frame stated explicitly at revision 22 |

Dropped as a false positive: "do not yet compare them" elsewhere in section 8
is a step-ordering instruction inside an algorithm, not an assertion about
code, and no code change can falsify it.

**INTERNAL line citations to THIS document are a distinct hazard, and
revision 25 introduced two [recorded at revision 26].** Revision 25 wrote
"Its opening rule (lines 1424-1428) reads" and "the table's third row (line
1434)" in section 6.1, citing section 6.2 by line. Both were correct against
revision 24's numbering **and were invalidated by the very edit that wrote
them**, because that edit inserted text above section 6.2 and pushed it from
line 1422 to 1558. At revision 25 the cited range landed inside section 6.1a,
an unrelated section - a citation resolving to real, plausible, wrong text,
which is the same failure as `arms.js:213` but internal to this file.

**What separates these from the safe internal citations**: section 10.3's
disclosure table cites "section 6.2, lines 845-847" and "section 6.1, line
697", and those remain correct, because each is **qualified by the revision
it is against** - the table's own column header is "where, in revision 18". A
line citation that names its version is a historical fact and cannot rot. **An
unqualified line citation to "this document" rots at every revision, including
the one that writes it**, since a document cannot know its own final line
numbers while it is being edited. Revision 26 removes both unqualified
citations rather than repairing them: the section number plus the quoted text
locates the passage without coordinates that expire.

**SECTION ATTRIBUTION is a FOURTH hazard, distinct from the three above, and
revision 27 committed it. [recorded and repaired at revision 28]** Revision
27's own repair record named **section 8.6.1** as the home of the
fresh-vs-fresh allowlist it had just repaired. That allowlist is **section
8.6.2's**; 8.6.1 is "Scope: the `homeaway-on-stored` assertion names one
pair" and ends before it begins. Six sites carried the wrong number: the
preamble, section 10's history row, three rows of the repair table below, and
that table's own prose.

**Everything else in that record was correct** - the locators, the repair,
the "inside sections 3-8" claim, and the description of what the allowlist
fixes all hold of 8.6.2. **That is exactly what makes this a separate
class.** A stale `file.js:NNN` locator points at a line and fails to resolve
to the named symbol. A section attribution points at a SECTION NUMBER, and
the number **resolves** - to the wrong section. The locator check below
cannot catch it, because there is nothing unresolvable to find, and no
byte-identity proof can, because both sections exist and neither changed.
Worse, 8.6.1 is the scope section for the **same assertion pair**, so a
reader following it lands on the most plausible available wrong text: the
failure mode this section records for `arms.js:213`, committed by the section
whose function is to be the work-list against it.

**The cause is mechanical, and the rule that prevents it is worth stating
outright.** The region was read by LINE OFFSET and attributed to a subsection
without ever resolving the enclosing heading. **A slice terminator must match
every heading level at or above the target's.** A terminator of
`/^(### |## )/` does not match `####`, so a slice starting at section 8.6.1
runs to section 8.7 and measures **374 lines where the section has 107** -
267 extra, silently absorbing 8.6.2, 8.6.3, 8.6.4 and 8.6.5. Section 8.6
alone has **six** `####` subsections exposed to that hole.

**Both the drafting and the audit of revision 27 committed this, with
different probes**, which is why it is recorded as a class rather than an
incident: one attributed a range without resolving its heading, and the other
verified that attribution with a span too coarse to discriminate between the
two candidate sections, and so confirmed the wrong label. **A probe that
cannot distinguish the right answer from the wrong one does not become
evidence by returning the expected result.**

**THE INSTRUMENT SPECIFICATIONS MOVED TO SECTION 10.2a AT REVISION 33.** The
locator check, the confinement check, the packet-coverage check, the
validate-against-a-known-answer requirement, and the barring of scripted
forms until B3 are **not inventory entries** and are no longer kept here.
**This section is the INVENTORY**: what is claimed, what went stale, and the
classes of failure the instruments do not catch. **The hazard classes stay
here, because they describe what the instruments MISS** - the eighth and
ninth cite this inventory's own failures by name.

**Repaired at revision 24** - ten sites, all drifted because the citations
were taken against Commit A6 rather than HEAD:

| section | cited | true |
| --- | --- | --- |
| 3.4 item 6 | `arms.js:173` | `:225` |
| 4.4 item 2 | `arms.js:368-403` | `:765` |
| 6.1 | `arms.js:448-449` | `:882` |
| 6.1 | `arms.js:456` | `:751` (constant), `:891-892` (comparison) |
| 6.1 | `arms.js:366` | `:743` |
| 6.5 | `projectionModel.js:1012` | `:1021` |
| 8.6.0 (x2) | `arms.js:213` | `:359` |
| 8.6.2 | `projectionModel.js:1128-1130` | `:1149-1151` |
| 11.2 | `arms.js:213` | `:359` |

`arms.js:213` was the costliest of the ten, and it was wrong at three
sites: that line holds a live `if (!SALTS.includes(salt)) throw` salt guard,
so a reader following the citation landed on real, plausible, unrelated code
rather than on nothing at all. A locator that resolves to something is worse
than one that resolves to nothing.

**Repaired at revision 27** - the `projectionModel.js` `effectiveGames`
family, at four sites carrying six citations, drifted the same way and by a
near-uniform `+11`:

| section | cited | true |
| --- | --- | --- |
| 8.6.2, top-level allowlist | `projectionModel.js:1027`, `:1156` | `:1038`, `:1177` |
| 8.6.2, `factors.recentProduction` | `:1070` | `:1081` |
| 8.6.2, `factors.recentProduction.games` | `:1069` | `:1080` |
| 11.3 | `:1027`, `:1070`, `:1156` | `:1038`, `:1081`, `:1177` |

**All three cited lines resolve to real, unrelated code** - `:1027` is
`modelVersion,`, `:1070` is a comment, `:1156` is
`factors.expertConsensus = null;` - which is the same "resolves to
something" hazard recorded above for `arms.js:213`, and it recurred after
being named.

**Two facts about these four sites matter more than the repair.**

**First, they were inside sections 3-8.** Section 8.6.2's allowlist is
normative text: it fixes which fields must be bit-identical across the
`homeaway-on` / `homeaway-on-stored` comparison. The fields are named by
name, so the allowlist's MEANING never depended on the locators, and no
ruling changes here. But every prior statement that a revision left sections
3-8 byte-identical was true of bytes that already carried these.

**Second, THIS INVENTORY MISSED THEM, and this inventory exists to catch
exactly this class.** They appear in neither the repaired table above nor
the outstanding list below, so section 10.2 reported the
`projectionModel.js` position as fully mapped when four sites were open.
**They were found because a stale locator happened to match a regex during
an unrelated read** - not by the instrument built to carry the class. A
hand-maintained inventory inherits the blind spot of whoever maintained it,
which is the argument for the mechanical LOCATOR check named above and
against treating this list as a completeness bound.

**REPAIRED AT REVISION 29**: the `projection.service.js` family. Revisions
24 through 28 carried it as "still outstanding" at five sites, and the
work-list itself was wrong in two ways. Resolved against HEAD and repaired:

| site | cited through rev 28 | actual | was on the rev-24 list |
| --- | --- | --- | --- |
| 6.5 | `:408` `generateProjections` | **`:417`** | yes |
| 6.5 | `:449` per-player call | **`:467`** (param forwarded at `:470`) | only under 8.6.4 |
| 8.6.0 | `:455-459` return shape | **`:475-479`** | yes |
| **8.6.3** | `:478-497` `loadCachedRows` | **`:496`** | yes |
| **8.6.3** | `:483-495` row-mapping | **`:507`** | **no, missed** |
| **8.6.3** | `:545` `PROJECTION_COLUMNS` | `:545`, correct | n/a |
| 8.6.4 | `:449` per-player loop | **`:467`** | yes |
| **8.6.5** | `:478-497` `byPlayer.set` | **`:496`** | yes, as `:478-` |

**Section attributions in this table are the FOURTH hazard class, and it
fired again here.** The revision-28 review's own finding-3 table filed the
first three rows under section **8.6.2**, and the first draft of this table
copied it. They are in **8.6.3** (the cache-compatible allowlist) and
**8.6.5** (cache-persistence QA); **8.6.2 carries none of them and was not
edited at revision 29.** Every attribution above was re-derived by mapping
the line to the nearest preceding heading of any level, not by recall.

Two further corrections to the rev-24 list itself. **It missed `:483-495`**,
which is a real site: `:483` and `:495` are blank lines and `loadCachedRows`
opens at `:496`, so that span sits entirely BEFORE the function whose
row-mapping it claims to cite. **And it under-attributed `:449`**, filing it
under 8.6.4 only when section 6.5 cites it too. The list was offered "so the
next pass inherits a work-list rather than a phrase", immediately after
faulting revision 22 for naming one member and hiding four; **the
replacement hid one and under-attributed another.** Its own replacement
figure was also loose: it gave the return as `:476-478`, which is the
interior of a statement that runs `:475-479`.

**Withdrawn at revision 29: the "removed as a phantom" entry for
`projectionModel.js:1113`.** Revisions 24-28 recorded that this locator
"occurs in this document exactly once - inside that list. It is cited
nowhere, so there was never anything to repair or to check." **That
negative-existence claim was false.** `:1113` was cited at section 3.2, as
the bare form `` (`:1113`) `` under the file anchor set earlier in that
section, and section 3.2 is INSIDE the sections 3-8 approval scope. A probe
on the qualified string `projectionModel.js:1113` returns exactly the
"occurs once" the inventory reported, because the real citation is bare.
**A false negative-existence claim was used to delete a live, in-scope
defect from the work-list**, and the stated lesson inverts: dropping the
entry made the inventory less complete, not more. The locator is repaired
in section 3.2 at this revision.

**A FIFTH hazard class, measured at revision 29: the BARE locator.** Inside
sections 3-8 there are 36 qualified `file.js:NNN` citations and 15 bare
`` (`:NNN`) `` ones. **Ten of the fifteen bare locators appear nowhere in
this inventory.** The five that do appear are there for unrelated reasons.
**This inventory's probe has never once caught a bare locator.** All ten
were resolved at revision 29 and nine are correct to the line, so the gap
concealed one defect rather than ten - but the accuracy was luck rather
than method, and `:1113` is where the luck ran out. Any future probe must
run against the bare form under its governing file anchor, not only against
qualified strings.

**A SIXTH hazard class: the self-referential count that rots.** Section 9
asserted that a phrase "occurs exactly once in this document" while quoting
that phrase two more times in the same section. The claim and the
quotation that falsifies it **entered in the same revision**, so it was
never true in the bytes asserting it: it was true of revision 26, verified
against revision 26, and carried into revision 27 where section 9's own
new full quotation had already broken it. That quotation is deliberate -
section 9 quotes rule 4 in full "because a citation is what failed the last
time this document reasoned about a section it had already compressed."
**The fix for the revision-25 citation failure is what created the
revision-27 count failure.** A count over the document's own text is
invalidated by any later edit to that text, including the edit that fixes
something else. Prefer a check that cannot rot, or no check at all.

**A SEVENTH hazard class: the status line.** The preamble asserted
"revision 26" from revision 26 through revision 28, across two re-anchors,
in the document's two most prominent sentences. Revisions 27 and 28 each
edited the preamble for other reasons without updating it. A status line
has no locator to resolve and no arithmetic to check, so neither the
locator probe nor a per-region byte-identity proof can see it go stale, and
it sits outside the sections 3-8 scope where an independent reviewer would
have met it. Corrected at revision 29.

**[recurrence, revision 31] This class fired again in the revision that
recorded it.** Revision 30 - whose entire subject is specifying the
confinement check, and which repaired revision 29's preamble - shipped with
its own status line reading "revision 29" at both sites, in published bytes.
The confinement check does not catch it and was never going to: the preamble
IS in revision 30's changed set, so the check correctly reported the section
as moved. **A structural check reports WHICH sections changed, never whether
a sentence inside one is still true.** The status line has no locator, no
arithmetic, and now demonstrably no structural signal either. It needs a
reader. Corrected at revision 31.

**An EIGHTH hazard class, added at revision 31: a CLOSED-FORM CORRECTION to
an unversioned claim rots again.** This inventory already records that an
unqualified claim rots. What it did not record is that the obvious repair
reproduces the defect with a fresher number, and that the repair reads as
more careful than the original precisely because it is more specific.

The worked instance is section 11.2's currency bullet. Through revision 26
it read "extended at revisions 20, 21, and 22, and current as of the last of
those", which had gone five revisions stale. Revision 27 corrected it to
"extended at every revision through 27, and current as of the anchored
bytes" - **the same open-population claim carrying a newer number**. It was
stale again two revisions later, and by revision 30 it was stale by three,
inside a bracketed note that explains the previous version "stopped five
revisions short." **The correction and the defect now sit in one sentence.**

The rule: **delete the number rather than update it.** "Current as of the
anchored bytes" already does the whole job, is self-verifying against
whatever the anchor is, and cannot go stale; "through 27" is a rotting
appendage bolted to a durable clause. Where an endpoint carries no
information - "revisions 14 onward", against a heading that already fixes
the covered range at 1-13 - the endpoint is the entire defect. Corrected at
revision 31 at all three sites.

**A NINTH hazard class, added at revision 31: RANGE STANDING IN FOR
AUTHORSHIP.** The standing confinement evidence for this arc is a
path-scoped diff - `git diff --name-only c04d6b1..HEAD -- scripts/backtest
server`, which returns **0 files** - offered in support of "the document
revisions touched no code". The diff is true and the conclusion has held,
but the instrument does not measure what the sentence asserts. It isolates
by RANGE and PATH; the inference it is asked to support is about
AUTHORSHIP, and those coincide only while the range happens to contain one
party's commits.

That precondition has now lapsed and the instrument did not notice, which is
the whole point of recording it: commit `972c53e` (a 17-file client feature,
a different workstream entirely) sits inside `c04d6b1..HEAD`. The check
still returns 0, because that feature touched neither scoped path - so the
number is unchanged while the reason for it has moved from "nothing in this
arc changed code" to "nothing in this arc changed code AND the unrelated
work in the range happened to miss these two directories." **A check whose
validity rests on a property it does not itself test reports the same answer
before and after that property fails.**

**The obvious repair is path-scoping, and it fails the same way one level
over. [corrected before anchoring at revision 31]** `-- scripts/backtest
server` returns 0 today while the unscoped form is false at 20 files, so
path-scoping looks like the fix. **It is not.** `server/` is live application
code - `account.service.js`, `adp.service.js`, `projection.service.js`,
`scoring.service.js` and dozens more - and **159 commits in this repository's
history that do not belong to this study have touched it. [figure restated
under one definition at revision 32]** Of 182 commits touching `server/`,
159 touch neither `backtest-artifacts/` nor `scripts/backtest/`, which is
this document's definition of a study commit. **The 21-commit difference from
the 180 an artifact-only boundary yields is exactly the Gate 2
implementation commits**, which live under `scripts/backtest/` and touch no
artifact. Revision 31 stated a floor of 140 under a third boundary and named
two others; **one definition, applied consistently, is better than three
offered for comparison**, which invites a reader to average figures that
answer different questions. The
next one breaks the path-scoped form exactly as `972c53e` broke the unscoped
one. **Replacing a range dependency with a path dependency is not a fix:
both are preconditions nobody restates, and the second is no less likely to
lapse than the first.** An earlier draft of this paragraph prescribed exactly
that repair, which is the eighth class firing inside the ninth.

**Scope the check by AUTHORSHIP, because authorship is what the claim
asserts**: no commit belonging to this study changed code. That is invariant
to what any other party lands, in any range, under any path.

**Identify study commits by PATH, not by commit subject. [widened at revision
32]**

```bash
for C in $(git log --format='%H' c04d6b1..HEAD); do
  git show --name-only --format='' "$C" \
    | grep -qE '^(backtest-artifacts/|scripts/backtest/)' || continue
  git show --name-only --format='' "$C" | grep -q '\.js$' && echo "VIOLATION $C"
done            # expect no output
```

**Revision 31 filtered on a `docs(backtest)` subject prefix.** The two
filters agree exactly at every measurement taken so far, with no difference
between them, **so this is not a correction of a live undercount** - it is a
filter that tests what the claim means. A study commit typed `fix(backtest)`,
`feat(backtest)` or `test(backtest)` is caught by the path form and missed by
the subject form, and the nineteen Gate 2 implementation commits are all
typed that way. **A convention about commit messages is not the thing being
asserted; touching the study's paths is.**

**A COUNT OVER THIS POPULATION ROTS BY CONSTRUCTION, and quoting one without
its anchor is the eighth class again. [recorded at revision 32]** The
population grows with every study commit, including the commit that anchors
the revision making the claim. Corrective entry 14 recorded "24 study
commits, 0 touching `.js`"; entry 15 recorded 25; at the revision-31 ledger
commit it was 26. **Every one of those was true when written and none was
wrong** - the invariant never moved, the population did.

**So wherever a number is quoted, state the population AND the anchor it was
measured at.** "0" means nothing without "across N study commits in
`c04d6b1..<anchor>`", and **N is not a property of the study; it is a
property of when you looked.**

**The eighth and ninth classes belong to one family with the fourth, fifth,
sixth and seventh: a claim or an instrument that measures something ADJACENT
to what it asserts.** A section attribution that resolves to the wrong
section, a probe that has never seen a bare locator, a count over text the
same revision edits, a status line nothing checks, a fresher number in an
unversioned clause, a range read as an authorship boundary. In every case
the probe returns a well-formed answer to a neighbouring question, which is
exactly why the answer does not read as wrong.

**Revision 22's blanket claim that "locator drift is a citation defect, not
a claim defect - the underlying statements remain true" is WITHDRAWN. It is
false whenever the citation sits inside a DIRECTIVE.** A directive carries a
present-tense claim about the state of the code, so a drifted locator
travels with a claim that can be false on its own terms. Section 4.4 item
2's `:368-403` and section 6.1's `:366` and `:456` each anchored a
requirement whose accompanying description of the code had already been
overtaken by the code - claim defects, repaired at revision 24 by the status
blocks in those sections. A stale locator with no directive attached -
section 3.4's `:173`, section 8.6.2's `:1128-1130` - is the citation-only
case the original sentence described, and costs a reviewer only the ability
to check a statement that remains true.

**How the directive defects were found, and the reach of that search
[revision 24].** One text pattern was run over this document:

```
the current code|currently (does|implements|touches|builds)|does not yet|must add a|already implements
```

Against the anchored bytes of revision 23 it matches **3 lines within
sections 3-8** and **5 lines document-wide** (5 occurrences either way; no
line carries two). Of the five, **two are the real defects** - section 4.4
item 2's "the current code computes" and section 8.6.0's "already implements
exactly this comparison" - and three are correctly not defects: two
historical narrations of the already-withdrawn `resolveConstants` claim (the
preamble and this section's own table) and one explicit disclaimer in
section 8.7 that makes no claim about the sweep's current behaviour.

**The pattern did NOT find the other four satisfied directives.** Section
4.4 item 1 and section 6.1's three met requirements are phrased as
imperatives ("Count distinct...", "Required Gate 2 code changes") with no
present-tense assertion about existing code, so no wording in the pattern
appears in them; they were found by reading the directive text itself.
**Six directive requirements were assessed in total: five MET, one NOT MET**
(section 6.1's test that the constant is referenced by nothing returning a
status).

**A second, wider sweep was reported during the revision-24 round as
yielding 8 document-wide hits, but its pattern text was not preserved, so
that count is NOT reproducible and is not relied on here.** It is recorded
as an unverified claim rather than dropped, because dropping it would hide
that a wider search was attempted. The reproducible bound is the pattern
above, and it is a bound on *directive-shaped phrasings*, not on satisfied
directives: nothing in this document forces a directive into any particular
wording, so a requirement met and described in language neither this pattern
nor a reader anticipated would appear in no count at all.

### 10.2a Instrument specifications **[split from 10.2 at revision 33]**

**Section 10.2 accreted these while keeping a revision-22 heading that named
an inventory.** It grew from 31 lines at revision 22 to 462 at revision 32, and
nine-tenths of that growth was not inventory. A reviewer read the title,
reasoned correctly from it, and reached a wrong conclusion about where a check
belongs - **which is the SEVENTH hazard class applied to a heading**: a status
line has no locator to resolve and no arithmetic to check, so nothing in this
document could notice that it had been false for eight growths.

**These are the checks. They are mechanical, they run at any anchor, and they
are findable by someone looking for a check rather than an inventory.**

**A LOCATOR check is mechanically automatable and should run on every
re-anchor**: extract every `file.js:NNN` citation in this document and assert
the named symbol still resolves at or near that line.

**THE CONFINEMENT CHECK, SPECIFIED. [added at revision 30]** The fourth hazard
class has now fired four times, by four different parties, and **the fourth
occurred inside the revision correcting the third**. That is past the point
where care is the remedy. **Every re-anchor must run this check before the
anchor is taken, and its result belongs in the commit message or the
corrective entry**:

> **Map every changed line to its nearest preceding heading, and compare the
> resulting set against the set the revision claims.** Take the new-side line
> numbers of every hunk from `git diff -U0 <prev-anchor> <candidate>`, and for
> each one scan upward for the nearest line matching `^#{1,6} ` - **any
> heading level, including the document's `#` title, under which the preamble
> falls.** The result is the set of sections that actually changed.

**It is a SET EQUALITY, in both directions, and one direction is the one that
has failed.**

- Every section the revision claims **byte-identical** must have **zero**
  changed lines mapped to it.
- Every section with changed lines mapped to it must appear in the revision's
  **claimed-changed** list.

**A subset check passes the actual defect.** Revision 29's first confinement
paragraph named four changed sections and missed a fifth: section 8.6.0
carried a locator repair and appeared in neither list. Checking only that the
claimed-identical sections are clean would have passed it, because 8.6.0 was
never claimed either way. **The second direction is what catches an omission,
and an omission is what happened.**

**Why this is the PRIMARY check rather than one option of two: it has no
boundary to resolve, so it has no boundary to get wrong.** A slice-based
byte-identity proof is perfectly correct when its terminator is right. The
failure mode is that getting the terminator right is a per-call judgment
nobody re-makes, and a wrong one fails silently in the passing direction. The
mapping check asks only "which heading precedes this line", which admits no
such judgment.

**"Every level" is literal, and here is the pattern that failed.** A
terminator of `/^(### |## )/` does not match `####`. Under it, a slice
beginning at section 8.6.1 runs to section 8.7 and measures **374 lines where
the section has 107**, silently swallowing 8.6.2, 8.6.3, 8.6.4 and 8.6.5.
**Section 8.6 alone has six `####` subsections.** An implementation that
enumerates only two heading levels reproduces the bug while following this
instruction.

**Slicing keeps a secondary role.** For each section claimed byte-identical, a
diff of the extracted region confirms the mapping check's answer
independently. Mapping is the belt; slicing is the braces. Do not run slicing
alone.

**This specification was validated against a known case before being
adopted**, which is the only evidence that distinguishes a usable check from a
plausible one. Run retrospectively over `0762738..b7ccf186` - revision 28 to
29 - it returns exactly `preamble, 0, 1, 3.2, 6.1, 6.2, 6.5, 8.6.0, 8.6.1,
8.6.3, 8.6.4, 8.6.5, 9, 10, 10.2` and excludes 4.6, 8.6.2 and 8.7, reproducing
the known answer **including the 8.6.0 that the prose had missed**. Its first
implementation returned an EMPTY set through a hunk-header parsing error, and
an empty set satisfies a subset check vacuously; only the known expected
answer exposed it. **A confinement check must itself be validated against a
diff whose answer is already known, or it is one more instrument nobody has
tested.**

**THE PACKET-COVERAGE CHECK, SPECIFIED. [added at revision 33]** Section
11.3(a) supplies the sealed sections a reviewer needs. Nothing checked that
the supply set covered the citations, and at revision 32 **five cited
sections were missing** - prereg 3.3, 5.1, 6.2, 7.1 and 7.2 - each carrying a
ruling inside the review's own scope. The gap survived from revision 21's
restructuring to revision 33 because **the only instrument that detects a
packet gap is reading past the packet**, which is what a packet exists to
make unnecessary.

> **Enumerate every `prereg N(.M)?` cited within the approval scope.
> Enumerate section 11.3(a)'s supply set, ranges expanded. Assert the
> difference is empty.**

Both enumerations are in the anchored bytes, so it runs on the document alone
with no external state. **Three requirements, each learned from a probe that
failed while this check was being derived:**

1. **Range expansion is mandatory.** `4.1-4.2`, `5.2-5.3`, `6.6-6.7`,
   `8.1-8.3`, `9.1-9.7`, `10.1-10.6`, `11.1-11.2` each supply every member.
   A pattern blind to ranges returned **27 against a true 35**.
2. **Match `prereg N.M`, not bare decimals.** A `\b(\d+\.\d+)\b` sweep
   harvests `4.6`, `6.1` and `8.7` out of section 11.3(a)'s own dependency
   annotations, which are SPECIFICATION section numbers, not prereg ones.
   That returned **38 against a true 35**.
3. **Validate against the known answer before trusting it.** Run against
   revision 32 it must return exactly `{3.3, 5.1, 6.2, 7.1, 7.2}`. **A run
   returning the empty set is broken, not clean** - which is exactly how a
   subset check passed revision 29's first confinement paragraph.

**Requirement 3 is the same clause the confinement check carries, and for the
same reason: a second run of a broken probe is not a check.** Two of the
three requirements above exist because a probe returned a well-formed number
that was wrong, and neither wrong number looked wrong.

**THE IDENTIFIER-CONSISTENCY CHECK, SPECIFIED. [added at revision 34]** The
seventh hazard class - the status line - has fired across FIVE stale
revisions in three episodes **[count corrected at revision 36: this sentence
read "has now fired four times" from revision 34, a number matching neither
the episode count nor the stale-revision count, and its enumeration glossed
that revision 26's reading was CORRECT at revision 26 - a miscount inside
the passage specifying the check built to catch stale identifiers, the
recursion this document keeps recording about itself; raised as O-3 by the
revision-34 statistical review and verified against every anchor before
this correction]**: the preamble was correct at revision 26, then read "26"
stale at revisions 27 and 28, "29" stale at revision 30, and "31" stale at
revisions 32 and 33 - corrected at 29, 31, and 34. **The revision-30
episode fired INSIDE the revision that recorded the class, and the 32-33
episode after it**, which is what establishes that recording a class is
not an instrument aimed at it. No locator resolves, no arithmetic checks, and
byte-identity is silent because the line does not change.

```
for every artifact that quotes this document's anchor - the preamble, the
handoff, the memory index, the reviewer scope document, the commission:
  extract its (commit, blob, SHA-256, revision number) tuple
  compare each element to `git rev-parse` and `sha256sum` at the named anchor
  assert every element matches, and assert the revision number matches the
  preamble's
```

**It is a set comparison, like the other three, and it runs on the document
plus `git` with no external state.** Two properties matter. **First, it must
cover artifacts outside this repository** - the memory index sat three
revisions stale while every check in this document returned green, and the
scope and commission documents are untracked by design, so a check scoped to
tracked files misses exactly the artifacts that tell a reviewer where the
bytes are. **Second, it must be run before the anchor commit, not after**: the
preamble's revision number is the one element that cannot be derived from
`git`, so it is the element a post-anchor check would confirm against itself.

**A presence test is not this check.** Asserting that the correct identifier
appears somewhere in an artifact passes while a second, wrong occurrence sits
elsewhere in the same file. **Every hash-shaped token in the artifact must
resolve** - `git cat-file -e` on each - and every one that names this anchor must
equal it. The first run of this check reported an artifact OK while it carried a
malformed short hash produced by a careless substitution, because a correct hash
appeared on a different line.

**Validated against a known case, per the requirement above**: run against
revision 33 it must report the preamble at "31" against an anchor of 33. A run
reporting no mismatch on those bytes is broken.

**`check-locators.js`, any scripted form of the packet-coverage check, the
identifier-consistency check, and any scripted form of the confinement check
remain BARRED from the repository
until Gate 4's B3 re-cut**, because a new tracked file extends the open
prereg 17 `B..final-head` allowlist violation. **The specifications above are
the durable half and are in force now**; the scripts are a convenience that
rides with the other batched guards at B3. Nothing here licenses landing a
tracked file.

**[BAR SATISFIED at revision 35 - this IS Gate 4's B3 re-cut, and the four
scripts LANDED as tracked files at `scripts/backtest/instruments/`
(2026-08-08), each validated against its sealed known answer BEFORE being
trusted, per the standing clause above.]** The paragraph above is retained
as the record of the bar's terms; its condition is now met, and the open
allowlist violation the scripts ride inside is the one the freeze-chain
re-cut closes. The validations, recorded:

- **`check-confinement.js`** reproduces the revision 28 -> 29 known answer
  exactly - the 15-section set THIS section's validation clause records
  above, INCLUDING the section 8.6.0 the prose had missed. **A discrepancy
  in the historical record is disclosed while landing it**: section 10's
  own 28 -> 29 row enumerates only 13 of those sections - it omits 0 and 1,
  which genuinely changed at that step and which the retrospective run
  includes. Rows are never edited; the omission is recorded here, and this
  section's 15-section enumeration is the authoritative known answer.
- **`check-packet-coverage.js`** returns exactly `{3.3, 5.1, 6.2, 7.1,
  7.2}` against revision 32 (`9a03721`) and an empty difference against the
  current bytes.
- **`check-identifier-consistency.js`** reports the preamble at "31"
  against an anchor of 33 when run at revision 33 (`37b9f7d`). **Its
  scripted form is the MECHANICAL ASSISTANT to this section's check, not
  its replacement**: the full four-element tuple comparison across the
  out-of-repo artifacts remains the manual half, disclosed in the script's
  own docblock.
- **`check-locators.js`** **[rewritten at revision 36]** resolves every
  citation through three tiers: in-range; a 30-line identifier window when
  a backticked identifier precedes the citation; and a CLAIM-EXPRESSION
  test - when a backticked code expression rides the citation, before or
  after it, at least one of its identifiers must appear within 2 lines of
  the cited range ITSELF. The third tier exists because of **finding G-A
  of the revision-35 statistical review**: section 6.1's `:891-892`
  citation went stale by 43 lines of `arms.js` growth while every claimed
  identifier stayed inside the 30-line window, and the citation opened its
  line so no preceding identifier engaged - the reviewer proved a 76/0
  clean report can carry a stale citation the old tiers could not see.
  Bare `` `:NNN` `` continuations and embedded multi-part citations (one
  file heading several comma-joined ranges - the form finding S1 hid in)
  are now extracted, with in-paragraph file inheritance, an exemption for
  quotations inside historical brackets, and demotion of out-of-range
  bare citations to unattributed; a multi-part citation's non-head ranges
  carry no testable claim of their own, so an S1-class uniform shift that
  stays in-range remains visible only to the semantic sweep - the
  instrument extracts and range-checks those parts, nothing more. It
  reports per-basis counts - a clean
  run states how many citations rest on the weakest, in-range-only tier -
  and it carries `--self-validate`, replaying the sealed G-A escape from
  `f87f023` in both directions before any live run is trusted; until
  revision 36 it was the ONE instrument of the four with no known-answer
  self-validation, while two packet documents claimed all four had one.
  Remaining disclosed limit: a symbol surviving only in a nearby comment
  still passes - it assists the re-anchor reading, never replaces it.
  History: its first full run found `arms.js:882`, repaired at revision
  35; the revision-36 systematic sweep that confirmed G-A found two
  same-family siblings in section 8.7 rule 5 (the +7 comment shift) and
  the out-of-scope preamble/section-0 pair, all repaired at revision 36.
  **CARRY-FORWARD DISCLOSURE, from the revision-35 review**: the source
  tree moved 15,588 lines across 43 files between the revision-34 and
  revision-35 anchors while spec sections stayed byte-identical -
  byte-identity of a section does NOT carry its locator verifications
  forward, which is why this check runs against the CURRENT tree at every
  anchor.

### 10.3 DISCLOSURE: revision 18 was APPROVED carrying an internal contradiction **[added at revision 25]**

**This is stated for the benefit of whoever issues the next approvals, and
it is not a defect in any ruling.** It is a defect in how this document
described one of its own rules for seven revisions.

**The contradiction.** Revision 18 - SHA-256
`5A0D6E54B2D84494C5D39093C44204A79F32A4DD813F03909C1094339A52BCF8`, anchored
at `85842e70a19b14fb6c5fb8cdfb0bca6a7a367774`, **APPROVED 2026-08-03 as
ledger rows 4-6** - contained both of the following:

| where, in revision 18 | what it said |
| --- | --- |
| section 6.2, lines 845-847 | every comparison against a frozen threshold "applies `roundToTie` ... to BOTH operands", in "the complete list of such comparisons, and nothing else" |
| section 6.2's table, line 857 | that list includes `3.80`, "the `catastrophicCapCouldFire` transparency line" |
| section 6.1, line 697 | the Gate 2 directive prescribing the BARE form: `Number(maxAbsBaseline) > (CATASTROPHIC_CAP - 0.01) / MAX_EFFECT` |

Section 6.2 named the comparison and required both operands rounded; section
6.1 directed the opposite for the same comparison, four hundred lines
earlier. **Both were inside the approved bytes**, and the contradiction
survived revisions 19, 20, 21, 22, 23, and 24 without being noted by any
review round, including the one that approved revision 18.

**What it did and did not affect.** No verdict, cell status, run status, or
selection depends on `catastrophicCapCouldFire` - section 6.1 states it is
disclosure-only and section 6.2's table classifies it as such. The
implementation at `lib/arms.js:934-935` **[locator re-verified at revision
35; `:891-892` had drifted]** follows section 6.2, so **no code
was ever non-conformant on this point and no published number changes**. The
harm was to reviewability: a reader could follow either passage and believe
the document required something the other forbade.

**How it was found, and how it was nearly missed again.** Revision 24 treated
the comparison form as an unresolved question, searched the preregistration
for authority, found prereg 6.6 reaching it only partially, and labeled the
resolution a substantive prospective amendment - while citing section 6.2 in
its own supporting text without opening it. Revision 25 corrects the
classification and the grounds, and section 0 now carries the category whose
absence left no honest label available.

**No general rule is drawn from this.** An earlier draft of this section
asserted one - that the lesson generalizes to "before concluding a question
is unresolved, search for what already governs it" - and cited sections 4.6
and 8.7 at revision 21 as a second instance of the same shape. **That
precedent does not hold**: measured against section 0's forcing test at the
bytes where it existed, section 4.6 declared no completeness and never
named activation, so neither passage governed and revision 22's substantive
classification was correct. With the precedent withdrawn, the proposed rule
rests on a single case. It may well be sound; it is not yet evidenced, and
this document has repeatedly found confident generalizations from thin
evidence to be its weakest material. What is recorded here is the instance.

---

## 11. Reviewer packet

### 11.1 Honesty caveat

The correction summaries in this document are author-written, not an
attached verbatim transcript of any reviewer's original message; SHA-256
values in the table above record hashes the reviewer stated in
conversation, not hashes independently recomputed against an attached
artifact.

### 11.2 Itemized correction summary, REVIEW ROUNDS 1-13 ONLY (author-written)

**Scope warning, added at revision 21.** The summary below covers review
rounds 1 through 13 and stops there. It has NOT been extended to cover
revisions 14 onward, and deliberately so: manufacturing after-the-fact summaries
of rounds this author did not summarize contemporaneously would produce
exactly the kind of author-written narrative section 11.1 already cautions
about, and revision 19's preamble demonstrated how such a narrative can
overstate. **For revisions 14 onward, use these instead:**

- **Section 10's review-history table** - extended at every revision, and
  current as of the anchored bytes. **[corrected at revision 31: revisions
  27 through 30 read "extended at every revision through 27", which was
  itself revision 27's repair of "extended at revisions 20, 21, and 22"
  and had gone stale by three. The endpoint is deleted rather than
  refreshed: "current as of the anchored bytes" is self-verifying and
  cannot rot. Section 10.2's EIGHTH hazard class records the pattern.]** It
  records R1-R5 with their blocking findings and hashes, revision 18's
  approval, the Gate 2 implementation review that produced revision 19, and
  each subsequent self-correction. **Section 10.3 was added at revision 25,
  and section 1 makes it required reading before any approval.** A reader who
  trusted the stale sentence was pointed away from text they are required to
  read, which is what makes this a DIRECTIONAL error rather than a stale
  number.
- **`APPROVAL_LEDGER.md`** - the sole authoritative approval record, and its
  corrective entries carry the anchor chain and the reasoning for each
  supersession.
- **This document's preamble** - its per-revision paragraphs state what each
  re-anchor changed, and the current revision's paragraph is always the last
  of them. **[corrected at revision 31: revisions 21 through 30 pointed at
  "'What revisions 19 and 20 add' and the revision-21 paragraph". The first
  still exists; the second does NOT - no paragraph stating what revision 21
  changed survives in the preamble, which was rewritten across revisions 27
  to 30. A reader following this bullet for the rounds-14-onward account was
  sent to text that is not there. Named paragraphs are an unversioned claim
  about the document's own contents and rot exactly as a line citation does;
  the reference is made structural rather than by title.]**

A reader who needs the account for revisions 14 onward should read those
three, not this section.

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
already implemented as `assertControlBitIdentity` (`lib/arms.js:359`) but
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

### 11.3 Packet contents, BY APPROVAL **[restructured at revision 21]**

Two different approvals read this document, and they need different
material. Revision 21 splits the packet accordingly, because the previous
single undifferentiated list invited the statistical reviewer to audit
implementation code that is separately reviewed, currently known
non-conformant, and about to change by design.

#### (a) For the INDEPENDENT STATISTICAL REVIEW - scope: sections 3-8

This approval judges whether the RULINGS are sound against the sealed text.
It does not review implementation conformance.

- **This document, in full**, with sections 3-8 normative.
- **`PREREGISTRATION.md` sections**: 1.1 (fetcher contract), 3.1 (roster
  status -> cohort class), **3.3 (the six macro positions)**, 4.1-4.2
  (cohort and injury policy), **4.3 (outcome truth, and the scoring-profile
  primary that section 8.7 rests on)**, **5.1 (candidate-pool ranking)**,
  5.2-5.3 (regret estimands), **6.2 (the pairwise macro-average)**, 6.3,
  6.6-6.7 (metric conventions and contrast construction; **6.6's FOURTH
  bullet, the ten-decimal tie rule and its single named extension, is what
  section 6.1's comparison-form amendment turns on**), **7.1-7.2 (the cell
  family and the benchmark arms)**, 7.3 (arms/benchmarks/controls), 8.1-8.3
  (salts and seeds), 9.1-9.7 (the IUT and components (a)-(e2)), 9.8
  (component (f) in full), 10.1-10.6 (the CI contract; **10.1 is what
  section 4.6 extends, and 10.5-10.6 establish that section 10 reaches
  non-gating output**), 11.1-11.2 (factor-activation mechanism and
  thresholds), **12.1 (the factorial family, which section 8.7 rule 1
  governs), 12.2 (the attribution composites, rule 2)**, 12.3 (parsimony
  total order), **16 (the sensitivity register, whose scoring-profile entry
  sets the limit in rule 4)**, 17 (freeze/reproduction mechanics).

**Five sections were added at revision 33**, each carrying a ruling inside
the review's own scope. They were cited within sections 3-8 and not supplied,
so a reviewer was asked to judge rulings against sealed text they had not
been given:

| added | what rests on it |
| --- | --- |
| **6.2** | section 4.6.4, a frozen classification rule resting "on prereg 6.2 and prereg 16 alone" - with 16 supplied and 6.2 not; and a passage opening **"Sealed"** |
| **7.1** | section 8.2b, a substantive amendment turning on 7.1/12.1 naming the control as distinct from the seven non-control cells |
| **7.2** | section 4.6.2, the `control-naive` qualification the section itself calls "not optional" |
| **5.1** | section 8.7, the activation denominator's ranking |
| **3.3** | section 5.1, the six macro positions, load-bearing for the `cellKey` byte string that feeds the permutation seed |

**A bare `prereg 11` citation is not a sixth entry**: prereg section 11 has
exactly 11.1 and 11.2, and both were already supplied.

**Adding five sections closes this instance and not the class.** Nothing
checked that the packet covered the citations, which is why the gap survived
from revision 21's restructuring to revision 33. **Section 10.2a specifies
the check that would have caught it.**
- **Sealed constants the rulings pin**, for checking the rulings are
  internally coherent - not for code review:
  `scripts/backtest/lib/freezeManifest.js` (`SCORING_PROFILE_NAMES`,
  `PRIMARY_SCORING_PROFILE`, and the primary-enforcement check) and
  `backtest-artifacts/pit-sweep-2024-2025/freeze/FREEZE_MANIFEST.json`,
  which carry the three profile identifiers and the Commit B digests section
  8.7's table reproduces; `scripts/backtest/lib/metrics.js`'s
  `BOOTSTRAP_DRAWS`, `BOOTSTRAP_SEED`, `bootstrapMean`, `percentileBound`,
  `MOVING_BLOCK_SEED`, and `movingBlockBootstrap`, which are the primitives
  section 4.6 mandates and the one it distinguishes itself from;
  `scripts/backtest/lib/numbers.js`'s `TIE_DECIMALS` and `roundToTie`, which
  are what section 6.1's comparison-form amendment adopts.
- **`APPROVAL_LEDGER.md`**, for the anchor chain and what each prior
  approval attached to.

#### (b) For the INDEPENDENT IMPLEMENTATION REVIEW - strictly last

This approval judges whether the CODE conforms to the approved rulings. It
cannot usefully occur until (a) has issued and the implementation round has
brought the code into conformance.

- **Everything in (a)**, plus:
- **The Gate 2 modules**: `scripts/backtest/lib/sweepEvidence.js`,
  `sweepPreflight.js`, `permutationControl.js`, `sweepEvaluator.js`,
  `sweepInference.js`, `sweepReport.js`, and
  `server/scripts/run-backtest-sweep.js`.
- **The `--inputs` PRODUCER modules [extended at revision 35 - the packet
  must reach the code the review is asked to approve]**:
  `scripts/backtest/lib/inputsAssembly.js`, `inputsGeneration.js`,
  `inputsPermutationCapture.js`, `inputsSensitivity.js`,
  `armWeekEvaluator.js`, `policy.js`, `ordering.js`, `naive.js`,
  `outcomes.js`, and the wiring
  `server/scripts/run-backtest-inputs.js` (the generation seam, the
  canary run, the checkpoint writer/loader of section 9, and the
  generation-seam wiring obligations of section 8.6.6).
- **The four instrument scripts [extended at revision 35]**:
  `scripts/backtest/instruments/check-locators.js`,
  `check-confinement.js`, `check-packet-coverage.js`, and
  `check-identifier-consistency.js`, with their known-answer validations
  (section 10.2a's bar paragraph records each).
- **`scripts/backtest/lib/arms.js`** (all cited functions, including
  `resolveConstantsWithStoredHistory`, which builds the
  `useStoredHistory`-forced variant - **an earlier revision of this packet
  said it did not yet exist; that claim is withdrawn as of revision 21**),
  `scripts/backtest/lib/numbers.js` (`isFiniteNumber`, `roundToTie`),
  `server/services/projectionModel.js` (`projectPlayer`, `scoringHash`,
  `seedFrom`, `mulberry32`, `simulateDistribution`, `NEUTRAL`,
  `opponentEffect`, `versusOpponentEffect`, `homeAwayEffect`,
  `weatherEffect`; the `effectiveGames` locators `:1038`, `:1081`, `:1177`
  **[repaired at revision 27; `:1027`, `:1070`, `:1156` were stale]**;
  the `useStoredHistory` default at `:241`; the median-rounding line `:884`),
  `server/services/projectionFeatures.js` (`buildPriorGames` at `:188` and
  its `useStoredHistory`/`crossSeason` gating through `:238`, incl. the
  section 8.6.1 defending comment at `:230-236` **[range re-verified at
  revision 35; `:177-231` was stale]**),
  `server/services/projection.service.js`
  (`projectFromBundle`, `findRun`, `loadCachedRows`, `upsertRun`,
  `saveProjections`), `scripts/backtest-weekly-projections.js`
  (`withHistory`, DEFINED at `:250`; `:210-234` are CALL SITES **[corrected
  at revision 27]**), `scripts/backtest/lib/snapshotClient.js`
  (confirms the sweep never touches the live cache),
  `scripts/backtest/lib/asOfView.js`, `scripts/backtest/lib/cohort.js`.
- **`GATE2_REVIEW_PACKAGE.md`** (uncommitted by convention), which carries
  the traceability matrix and the disclosed defects.

**Standing caveat for (b):** at the time revision 21 was anchored, the Gate 2
code did NOT conform to sections 4.6 and 8.7, by the author's own disclosure
(section 1). Reviewing it before the implementation round completes would
spend a single-use approval on known-non-conformant code.
