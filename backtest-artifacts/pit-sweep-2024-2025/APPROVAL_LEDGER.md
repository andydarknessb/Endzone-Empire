# APPROVAL_LEDGER.md — the external, append-only approval record

Study id: `pit-sweep-2024-2025`.

**Why this file exists** (independent implementation review, round 2,
critical finding): approvals were previously recorded *inside*
`PHASE5_EXECUTION_SPEC.md` itself, in its own section 10 approval table.
Recording an approval in the approved document **changes the document's
bytes**, so the hash the approver authenticated no longer matches the file
that carries the approval. That is not a paperwork detail — it means the
deviations from the sealed preregistration that the spec authorizes have no
authenticated approval attached to them.

**The rule this file establishes, going forward:**

1. An approval is recorded **here**, never in the approved document.
2. The approved document is **not edited** after the hash is taken.
3. Each row records the exact SHA-256 of the bytes that were reviewed, who
   approved, when, and the precise scope of what was approved.
4. This file is **append-only**. A superseded row is never edited or
   deleted; a new row is appended and the old one marked superseded.

---

## Current document hashes (recorded 2026-08-02)

> **The `2026-08-02` date in this heading applies ONLY to the original
> records written on that date.** It does not date any later appended entry.
> Every entry appended after that date carries its own date; the heading is
> not a timestamp for the file as a whole. See corrective entry 2.
>
> **The `PHASE5_EXECUTION_SPEC.md` status cell below is SUPERSEDED by
> corrective entry 2** (approval rows 4-6, 2026-08-03). It is retained
> unedited as the append-only record of the state that then obtained.

| document | SHA-256 of current bytes | status |
| --- | --- | --- |
| `PREREGISTRATION.md` | `653d98841a5c8e19af2d2d0d94ce58d677223dddee2b1433486a3dee8e3f802e` | SEALED, never edited since Phase 0 — hash is of the sealed bytes |
| `PHASE5_EXECUTION_SPEC.md` | see the anchor commit for the revision under review — do NOT treat any hash in this file as "the current bytes" | **NO APPROVAL IN FORCE, AND NOTHING IS AUTHORIZED.** Revision 13's chain is broken (below). Its successor blob `0661eafc95…` was REJECTED (R1); revision 14 (`49620ec2…`) R2; revision 15 (`e507d0c4…`) R3; revision 16 (`8bd263cd…`) R4; revision 17 (`f7d6b31f…`) R5. **Revision 18 awaits all three fresh approvals.** Gate 2 implementation work is not authorized; candidate-cell execution is not authorized. |

**Hash the BLOB, not the working file.** This repository has
`core.autocrlf=true` and no `.gitattributes` covering these artifacts, so a
checkout on Windows rewrites the working copy's line endings and it will
not match the recorded hash. The committed blob is unaffected. Always use:

```
git show <anchor-commit>:backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md | sha256sum
```

---

## The broken approval chain, stated plainly

The independent statistical review of revision 13 authenticated SHA-256
`25DFFCEC77EB5DFE17150020C04465B546F0584919916FD686CCFE77FA17258F`. Its
immediate successor blob hashed to
`0661eafc951406d22c74fe45a47f8a789d025ab9ae74d583a65148f9866cc2eb`.
**(`0661eafc95…` is NOT current and has not been since revision 13's
successor was rejected as R1 — see the corrective entry below. It is named
here only to identify the divergence.)**

**These are different documents.** The divergence was caused by edits made
*after* that approval, to record the approvals themselves in the document's
own section 10 table and preamble (see the conversation record of
2026-08-02).

**This cannot be repaired retroactively, and I am not going to pretend
otherwise.** The bytes that hashed to `25DFFCEC…` were overwritten. There is
no copy of them: the file is untracked in git (`git status` shows it as `??`,
never committed), so there is no object in the repository to recover them
from, and no backup was taken before the edits. I cannot reconstruct them
exactly — the edits were not byte-reversible, and reconstructing them "close
enough" would produce a *different* document that I would then be asserting
was the approved one, which is precisely the failure this ledger exists to
prevent.

**What this means concretely:** every deviation from the sealed
preregistration that `PHASE5_EXECUTION_SPEC.md` authorizes — the §4.2 AND
rule, the 0.50→0.30 falsifiability floor, the "either identity assertion
suffices to void" resolution, the (f) no-finite-bound inconclusive mapping,
the S3 non-estimable deviation — currently rests on an approval of bytes
that no longer exist.

### Required remedy (only the user/approver can perform it)

The **then-current** bytes had to be re-approved as they stood, by the same
approval chain that approved revision 13:

1. Independent statistical re-review of the then-current bytes.
2. User re-approval of the S3 deviation and of the remainder, against those
   same bytes.
3. Both recorded **in this file**, not in the spec document.

**Status of that remedy:** step 1 has been attempted five times and has
REJECTED every time (R1-R5), so steps 2 and 3 have never been reached. The
document has been corrected after each rejection, so the bytes needing
approval are no longer revision 13's successor - they are whatever the
latest anchor commit carries. **Substituting a specific hash into steps 1-2
above would go stale on the next revision, which is exactly the failure the
corrective entry below addresses; the remedy is therefore stated without
one.**

Until that is done, Gate 0's fourth-approval condition cannot be satisfied
regardless of the implementation's own quality, because the spec the
implementation is being verified against is not itself authenticated.

---

## Review history — NOT approvals

*(Kept deliberately separate from the approval rows below. A review that
did not approve must never occupy an approval row. Append only.)*

| # | document | SHA-256 reviewed | reviewer | date | outcome |
| ---: | --- | --- | --- | --- | --- |
| R1 | `PHASE5_EXECUTION_SPEC.md` rev 13-successor | `0661eafc951406d22c74fe45a47f8a789d025ab9ae74d583a65148f9866cc2eb` (git blob `f6c398c5aeb900be8f15a04856c2718acf372a89`, anchored in commit `03a36768bf04106425b5a308f56c43fcaeb61b1a`) | independent statistical re-review | 2026-08-02 | **REJECT** — four blockers: (1) component-(f) falsifiability used pooled seasonwide mean `\|b\|` where the estimand is a median of week-level deltas; (2) permutation control under-specified (PRNG, shuffle, canonical player ordering, state consumption, blockwise construction) and therefore able to change the run-level VOID decision; (3) reducer not formally total; (4) player-week × salt catastrophic veto was an unlabeled substantive amendment. **No approval rows were appended for this hash, at the reviewer's explicit direction.** |
| R2 | `PHASE5_EXECUTION_SPEC.md` rev 14 | `49620ec20fc35e76c5029f266494fa099371bb34ca5a0e4a0d83af86bf8b6739` (git blob `ee6800ecdb4484f5cc599ef6a67c1a77fc9f1068`, anchored in commit `152f225bb8691cc54488dd79bfc0f8604e89ba7a`) | independent statistical review | 2026-08-02 | **REJECT** — five blockers: (1) the optional `0.30` shortcut is not rounding-equivalent to the transformed-bound comparison; (2) permutation still under-specified (complete mulberry32 transition, `b = 0…9999`, hash-input encoding, source-to-target assignment direction); (3) no Level-3 `not-applicable` state, and intentionally absent endpoints risked being reported as Level-4 `missing`; (4) approval language contradictory (Gate 2 claimed authorized; section 10 read as supplying approval); (5) outcome-changing rules misclassified as mechanical — permutation construction, harmful-boundary definitions, inclusive wide-straddle contacts, zero-margin straddle disabling. **Accepted as statistically coherent**: median-aligned weekly (f) bound and even-week aggregation; inclusive unfalsifiability equality; Cartesian veto completeness and independent retention; S3 deviation disclosure; wide-straddle quantiles and natural-sign mechanics; activation, Level 5, control baseline, both identity assertions. **No approval rows or user attestations were warranted for this hash.** |

| R3 | `PHASE5_EXECUTION_SPEC.md` rev 15 | `e507d0c453802cbf785402462de898a906ee8dc0667b844e0a9f4e900e97da15` (git blob `4f5f21a8bbb8b95c432816311f27bd1a7c2e6937`, anchored in commit `da4b205521e3662bbf3dd51388b643d8912c8af3`) | independent statistical review | 2026-08-03 | **REJECT** — two substantive blockers: (1) component (f) contradicted itself — the evaluability gate correctly used only the transformed `0.025` comparison, but other sections still mandated a `0.30` falsifiability-floor comparison; (2) component (f) veto status not total — one rule required independently retained `vetoed` while Level 3 ordered `missing > vetoed` with exactly one status, so a `missing` sibling endpoint silently masked a fired veto. Plus documentary corrections (stale revision-14 references, an obsolete instruction identifying `0661…` as current, and an over-broad "strictly more likely to veto" claim). **Passed review**: fully pinned permutation, not-applicable reducer behavior, median-aligned weekly bound, Cartesian completeness, substantive classifications, activation, selection, control baseline, identity assertions. **No approval row or user attestation was warranted for this blob.** |

| R4 | `PHASE5_EXECUTION_SPEC.md` rev 16 | `8bd263cd133c7dcea533c7ae7bd2cc9efea1a3ec42340aa1fb4b9f467d7c4396` (git blob `9dc2a70dbd709a4fb4f5b65f91184a72493228e2`, anchored in commit `906dfe26667d237734d9eb8f253d8e89c0c27fd1`) | independent statistical review | 2026-08-03 | **REJECT** — two blockers: (1) revision and approval routing still contradictory — several sections called revision 14 current or awaiting review, and two approval questions still pointed at historical §10 despite the document declaring the external ledger solely authoritative; (2) the salted hash construction `scoringHash + ':' + salt` (§3.2) was misclassified as mechanical — it was never sealed, and delimiter/order alternatives produce different seeds and potentially different verdicts. **Confirmed corrected**: transformed `0.025` gate, disclosure-only `0.30`, independent catastrophic-veto flag, narrowed Cartesian comparison, total reducer, complete permutation, activation, selection, control baseline, identity assertions. **No approval row or user attestation was warranted for this blob.** |

| R5 | `PHASE5_EXECUTION_SPEC.md` rev 17 | `f7d6b31f6ba338fdecaea40187b27300a66808f176234b28646250508475397e` (git blob `281b1f0e707c510b557b114174deae6003ae6b19`, anchored in commit `6c1a873b8d0149319b92879bc9f6cdc60eeb3b37`) | independent statistical review | 2026-08-03 | **REJECT** — single blocker: §3.2 promised a pinned salt-composition test vector but supplied no literal inputs or expected output, so the required test had nothing to assert against. Non-blocking cleanup: rename §4.5 to "Applies to every bootstrap inequality"; remove a duplicated revision-16 heading and a dangling sentence fragment near the preamble (both introduced by revision 17's own splice). **All other statistical and approval-routing provisions passed review.** **No approval row or user attestation was warranted for this blob.** |

### CORRECTIVE ENTRY 1 — superseding obsolete "current bytes" instructions

*(Appended 2026-08-03, before the R5 response. Its "awaiting ALL THREE fresh
approvals" paragraph and its count-specific supersession language are
themselves superseded by corrective entry 2 below; the entry is retained
unedited.)*

**Any instruction anywhere in this repository or its history that
identifies `0661eafc95…` as "the current bytes" of
`PHASE5_EXECUTION_SPEC.md` is OBSOLETE and superseded by this entry.**
That hash was revision 13's successor blob; it was rejected as R1, and has
since been superseded twice more (revision 14 → `49620ec2…`, rejected as
R2; revision 15 → `e507d0c4…`, rejected as R3). **No hash recorded in this
file should ever be treated as "current"** — the current revision is
whichever blob the most recent anchor commit carries, and it is identified
there, not here. This file records what was REVIEWED, not what exists now.

Revision 18 is the response to R5. **It is awaiting ALL THREE fresh
approvals** — the independent statistical review, the user's S3-deviation
attestation, and the user's remainder attestation — none of which has been
issued against it or against any predecessor whose bytes still exist. No
approval attaches to revision 18 until each is issued and recorded in the
approval rows below.

**Approval routing is exclusive to this file.** No section of
`PHASE5_EXECUTION_SPEC.md` records, supplies, evidences, or requests an
approval; every approval question in that document routes here. A future
edit that reintroduces an approval question pointing at the spec's own
section 10 reintroduces the hash-invalidating practice this ledger exists
to end.

### CORRECTIVE ENTRY 2 — appended 2026-08-03, at the direction of the approver

Recorded alongside approval rows 4-6. Three clarifications, each superseding
earlier language in this file that is now obsolete.

**(1) Count-specific supersession language is obsolete.** Corrective entry 1
says `0661eafc95…` "has since been superseded twice more" and enumerates the
two successors by name. That enumeration was accurate when written and is
not now — the chain has continued through revisions 16, 17, and 18. **No
statement in this file that counts revisions, or that names the most recent
successor, should be read as current.** The rule stated in corrective entry
1 stands unchanged and is the one that generalizes: the current revision is
whichever blob the most recent anchor commit carries, identified there and
not here. This file records what was reviewed. Future entries must not
restate a count.

**(2) The `0.30` value is disclosure-only.** The broken-chain narrative above
lists "the 0.50→0.30 falsifiability floor" among the deviations resting on
the lost approval. That characterization is superseded. As of revision 16
and continuing through the approved revision 18, **`0.30` is not a gate and
no verdict turns on it.** It is reported for disclosure only. The
component-(f) evaluability gate is the **transformed weekly-median bound
compared against `0.025`** — the two forms are equal in exact arithmetic but
not under `roundToTie`, which is why only the transformed comparison is
normative. Any earlier text in this file or in prior spec revisions that
describes `0.30` as a floor, gate, or threshold is describing a superseded
construction.

**(3) The `2026-08-02` heading dates only the original records.** See the
note under that heading. Entries appended later carry their own dates.

**Approval state as of this entry:** revision 18 (SHA-256
`5A0D6E54B2D84494C5D39093C44204A79F32A4DD813F03909C1094339A52BCF8`) has
received all three approvals — rows 4, 5, and 6 below. Corrective entry 1's
statement that revision 18 "is awaiting ALL THREE fresh approvals" is
superseded as of those rows. **The current-hashes table's
"NO APPROVAL IN FORCE, AND NOTHING IS AUTHORIZED" status cell is likewise
superseded**; Gate 2 implementation is authorized against revision 18's
bytes. **Gate 0 is unchanged and still in force**: candidate-cell execution,
real-data access, authoritative sweep generation, and result inspection
remain prohibited pending the final independent implementation review.

---

## Approval rows

*(Append only. No row is ever edited or deleted.)*

| # | document | SHA-256 reviewed | approver | date | scope | status |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `PHASE5_EXECUTION_SPEC.md` | `25DFFCEC77EB5DFE17150020C04465B546F0584919916FD686CCFE77FA17258F` | independent statistical review | 2026-08-02 | revision 13, sections 3-8 | **SUPERSEDED — reviewed bytes no longer exist (see above)** |
| 2 | `PHASE5_EXECUTION_SPEC.md` | `25DFFCEC77EB5DFE17150020C04465B546F0584919916FD686CCFE77FA17258F` | user | 2026-08-02 | S3 non-estimable deviation | **SUPERSEDED — reviewed bytes no longer exist** |
| 3 | `PHASE5_EXECUTION_SPEC.md` | `25DFFCEC77EB5DFE17150020C04465B546F0584919916FD686CCFE77FA17258F` | user | 2026-08-02 | remainder of revision 13; Gate 2 implementation only, no candidate execution | **SUPERSEDED — reviewed bytes no longer exist** |
| 4 | `PHASE5_EXECUTION_SPEC.md` | `5A0D6E54B2D84494C5D39093C44204A79F32A4DD813F03909C1094339A52BCF8` | independent statistical review | 2026-08-03 | revision 18, sections 3-8; exact git blob `147a2e0d1f284403b59d96d7e2f82c2da74989e4` at commit `85842e70a19b14fb6c5fb8cdfb0bca6a7a367774` | **APPROVED** |
| 5 | `PHASE5_EXECUTION_SPEC.md` | `5A0D6E54B2D84494C5D39093C44204A79F32A4DD813F03909C1094339A52BCF8` | user | 2026-08-03 | S3 structurally non-estimable prospective deviation; no S3 estimate | **APPROVED** |
| 6 | `PHASE5_EXECUTION_SPEC.md` | `5A0D6E54B2D84494C5D39093C44204A79F32A4DD813F03909C1094339A52BCF8` | user | 2026-08-03 | remainder of revision 18, sections 3-8; Gate 2 implementation only; no candidate execution | **APPROVED** |

**No row below this line is filled in.** Row 7 is reserved for the Gate 2
independent implementation review, once it actually occurs. It must be added
by, or at the explicit direction of, the approver — never pre-filled in
anticipation.

**Rows 4-6 restore the approval chain broken above.** They authenticate
bytes that still exist and are retrievable from the anchor commit, which is
what rows 1-3 could not offer. The re-approval remedy described under
"Required remedy" is, with these rows, complete.

---

### CORRECTIVE ENTRY 3 — appended 2026-08-04

**This entry creates NO approval row.** It records an anchor and a
supersession only. No approval described below has issued.

**(1) A new anchor exists, and rows 4-6 no longer authorize anything.**
`PHASE5_EXECUTION_SPEC.md` was revised and anchored:

| | |
| --- | --- |
| SHA-256 | `16F29146F7CFCC6F9FE5F93199D5291A5CE5BD2E58EBF9A945C26AF498D97DFE` |
| git blob | `88ac16980445565eb8fb74dfd178e00686a76d62` |
| anchor commit | `9759a64f4d39cf170cf449f3e2635942e425646d` |

Rows 4, 5, and 6 authenticate
`5A0D6E54B2D84494C5D39093C44204A79F32A4DD813F03909C1094339A52BCF8`. Those
bytes are no longer the bytes carried by the most recent anchor commit, so
**all three approvals lapse as authorities** and must be re-issued against
the hash above. Rows 4-6 are NOT edited; they remain the accurate record of
what was approved and when. Per corrective entry 2 rule (1), this entry
names an anchor, not a count — the bytes under approval are always
whichever blob the most recent anchor commit carries, identified at that
commit and not here.

**(2) Corrective entry 2's authorization statement is superseded.** Entry 2
recorded that "Gate 2 implementation is authorized against revision 18's
bytes." That is no longer true of the current anchor. **Gate 2
implementation work is not authorized** pending fresh approvals. The Gate 2
code already written under row 6 was not withdrawn and was not invalidated
by having been written; it is simply **not conformant** to the newly
anchored bytes, and is described as such in the spec's section 1.

**(3) Why the spec was revised, in one line each.** Two conformance defects
were found in the Gate 2 code built under row 6, both in
`scripts/backtest/lib/sweepEvidence.js` at commit `c04d6b1`. **Each has a
core that the sealed text already covered plainly, and an edge where the
sealed text was silent; the silences are what required a spec revision
rather than only a code fix:**

- the **descriptive scoring-profile axis** — prereg 4.3 names `half_ppr` the
  formal primary and the implementation admitted only `standard`, which 4.3
  covers plainly. The silence was how far prereg 16's additional descriptive
  reporting extends. Resolved by the spec's new section 8.7.
- the **descriptive interval method** — prereg 10.1 fixes a percentile
  cluster bootstrap and the implementation published a normal approximation.
  For the paired deltas and the 12.2 attribution composites, 10.1 covers this
  plainly, since those are deltas. The silence was the absolute metrics,
  which are not. Resolved by the spec's new section 4.6.

Neither changes a component verdict, a cell status, a run status, or the
selection.

**(4) The row-7 reservation is released, without cancelling what it
reserved.** Row 7 was reserved for the Gate 2 independent implementation
review on the assumption that it was the next approval to issue. Three
approvals now precede it: the independent statistical review of the newly
anchored sections 3-8, and the two user attestations (the S3 deviation,
unchanged in substance, and the remainder). **Rows are assigned strictly in
the order approvals actually issue.** The implementation review is still
required, still strictly last, and still cannot be self-performed; it simply
no longer holds a specific row number in advance. As before, no row is
pre-filled in anticipation of any of these.

**(5) Gate 0 is unchanged and still in force.** Candidate-cell execution,
real-data access, authoritative sweep generation, and result inspection all
remain prohibited.

---

### CORRECTIVE ENTRY 4 — appended 2026-08-04

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 3 and records why. **Entry 3 is not edited**; it remains the
accurate record of what was anchored at `9759a64` and of the reasoning that
obtained then.

**(1) The anchor has moved.** `PHASE5_EXECUTION_SPEC.md` was revised again
and re-anchored:

| | |
| --- | --- |
| SHA-256 | `76672C3531CB6C72A6FDED5E1F08091EED500FB370283895C8F2A1CAB878676D` |
| git blob | `a26ff4abe93d09171578641f7429d4b224e12b9a` |
| anchor commit | `478ee5a127143fe55b848e22cf5faa18704d4f21` |

**Entry 3's anchor table is superseded as a pointer to the current bytes**,
and remains correct as the record of the anchor that preceded this one. Per
corrective entry 2 rule (1), this entry names an anchor, not a count.

**(2) Nothing lapsed.** The superseded anchor
(`9759a64…` / `16F29146…`) **accumulated no approvals** during its existence.
No approval attached to it, so none was lost by re-anchoring. The approval
state is unchanged from entry 3: rows 4-6 remain lapsed against their own
superseded bytes, and **three fresh approvals are still required** against
the hash in (1) before implementation work may resume.

**(3) Why it was re-anchored.** The superseded revision's PREAMBLE asserted,
in four places, that both conformance defects were "traceable to silences"
in the spec. **That claim did not hold and overstated the specification's
share of the fault.** Prereg 4.3 names `half_ppr` the formal primary in plain
text, and prereg 10.1's percentile rule plainly reaches every delta-valued
descriptive family — including the paired deltas and the prereg 12.2
attribution composites, which are contrasts. Only the edges were genuinely
silent: how far prereg 16's additional descriptive reporting extends, whether
activation carries a profile axis, and what interval an ABSOLUTE metric
carries. **Entry 3 paragraph (3) already stated the corrected account; the
specification now matches it.**

**(4) No ruling changed, and that is mechanically checkable.** The normative
bodies of the two new sections are carried over **byte-identically** between
the two anchors:

| section | lines | verified |
| --- | ---: | --- |
| 4.6 (descriptive interval method) | 67 | identical, `9759a64` vs `478ee5a` |
| 8.7 (descriptive publication contract) | 88 | identical, `9759a64` vs `478ee5a` |

```
diff <(git show 9759a64:backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md \
        | awk '/^### 4\.6 /,/^## 5\. Permutation control/') \
     <(git show 478ee5a:backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md \
        | awk '/^### 4\.6 /,/^## 5\. Permutation control/')
```

The whole-document diff is 60 insertions and 34 deletions, confined to the
preamble, section 1, and section 10's historical table. **A reviewer who
already read the superseded bytes need not re-read the rulings** — the
command above settles it.

**(5) Gate 0 is unchanged and still in force**, and the fourth approval
remains strictly last, single-use, and not self-performable. As with entry 3,
no row is pre-filled for any approval that has not issued, and rows are
assigned in the order approvals actually issue.

---

### CORRECTIVE ENTRY 5 — appended 2026-08-04

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 4. **Entries 3 and 4 are not edited**; each remains the
accurate record of the anchor that obtained when it was written.

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `DB9971B8385D17B6039ADF5DF9F4B6EAAACB26607681B80EFE55230EAA0A9E01` |
| git blob | `94ae4b746a6a964adf407f3160f30e7a2e774eb4` |
| anchor commit | `ed5b001496a5ffcf1338a431ea4a177b75ce79b4` |

**(2) Nothing lapsed.** The superseded anchor (`478ee5a…` / `76672C35…`)
accumulated no approvals, as its predecessor had not. The approval state is
unchanged from entries 3 and 4: rows 4-6 remain lapsed against their own
superseded bytes, and **three fresh approvals are still required** against
the hash in (1) before implementation work may resume.

**(3) Why it was re-anchored: the REVIEWER PACKET was stale, and it was
found before any approval was solicited.** Section 11 is the section
addressed to reviewers, and a packet is *used* rather than audited — a
reviewer works from it and never checks it, so a defect there misdirects
silently and is never caught by the review it feeds. Section 11 sits outside
the statistical review's "sections 3-8" scope, which is a reason to correct
it proactively rather than to leave it. Four omissions and one false claim:

- **prereg 12.1 and 12.2 were absent** while section 8.7's rulings rest on
  them directly — the packet listed 12.3 and skipped past the two sections
  the ruling governs.
- **`metrics.js` was listed only for `SALTS`/`saltPairedDelta`/
  `buildBootstrapResamples`**, while section 4.6 mandates `bootstrapMean`,
  `percentileBound`, `BOOTSTRAP_SEED`, and distinguishes itself from
  `movingBlockBootstrap`.
- **`freezeManifest.js` was absent**, where the three scoring-profile
  identifiers and the Commit B digests section 8.7 reproduces are pinned.
- **The seven Gate 2 modules were absent**, having not existed when the list
  was written.
- **A false claim was withdrawn**: the packet stated `resolveConstants`
  "does not yet build the `useStoredHistory`-forced variant."
  `arms.js`'s `resolveConstantsWithStoredHistory` does exactly that. The
  claim is withdrawn explicitly in the text rather than deleted silently.

Section 11.2's itemized summary was additionally relabeled to state plainly
that it covers **review rounds 1-13 only** and was deliberately NOT extended
to revisions 14-21 — writing retrospective summaries of rounds nobody
summarized contemporaneously would produce precisely the author-written
narrative section 11.1 cautions about. It routes readers to section 10's
table, this ledger, and the document preamble instead.

**(4) Section 11.3 is now split BY APPROVAL.** The previous single list
invited the statistical reviewer to audit implementation code that is the
separate fourth approval's subject, is currently known non-conformant, and is
about to change by design. Part (a) carries the rulings' sources for the
statistical review; part (b) carries the code for the implementation review,
under a standing caveat that reviewing it before the implementation round
completes would spend a single-use approval on known-non-conformant code.

**(5) No ruling changed, across FOUR anchors now.** The normative bodies of
sections 4.6 and 8.7 are byte-identical at `9759a64`, `478ee5a`, and
`ed5b001`. Section 11.1 and section 11.2's rounds 1-13 text are likewise
unaltered. Verify with the terminator excluded, since the range's closing
header legitimately changes between revisions:

```
diff <(git show 478ee5a:backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md \
        | awk '/^### 4\.6 /,/^## 5\. Permutation control/' | sed '$d') \
     <(git show ed5b001:backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md \
        | awk '/^### 4\.6 /,/^## 5\. Permutation control/' | sed '$d')
```

**(6) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 6 — appended 2026-08-04

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 5. **Entries 1-5 are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `B835B5982FA0573777F47285855DA445E765DFAB1526C546FE098D4EE3065C44` |
| git blob | `9b452737b523c11ddd1c2c682aed04abaa3901be` |
| anchor commit | `3bac26345ad7d912bae9f0080865dd62b3e9b669` |

**(2) Nothing lapsed.** The superseded anchor (`ed5b001…` / `DB9971B8…`)
accumulated no approvals, as neither of its two predecessors had. Rows 4-6
remain lapsed against their own superseded bytes, and **three fresh approvals
are still required** against the hash in (1).

**(3) THE BYTE-IDENTITY SHORTCUT DOES NOT APPLY TO THIS ANCHOR.** Corrective
entries 4 and 5 could tell a reviewer that the rulings had not moved and a
one-command diff would prove it. **That is false here.** Revision 22 is the
first revision since 18 to change a RULING. Measured between `ed5b001` and
`3bac263`:

| section | revision 21 | revision 22 | differing lines |
| --- | ---: | ---: | ---: |
| 4.6 | 66 | 223 | 251 |
| 8.7 | 87 | 158 | 115 |

Sections 1, 8.6.1, and 8.6.2 also carry normative changes. **A reviewer must
RE-READ those sections rather than diffing them.** Anyone who carries the
habit established by entries 4 and 5 into this anchor will conclude nothing
changed, and will be wrong.

**(4) Why it was re-anchored.** A findings round against revision 21 produced
three CRITICAL and three WARNING findings plus five further blockers, all
inside sections 3-8. The substantive corrections: section 8.7 rule 4 now
fixes a ROW SET rather than only a metric-type axis, which had left two
defensible readings a 14x apart in published rows; **rule 5 now PINS
activation to `half_ppr` rather than removing its profile axis**, because the
removal rested on a false premise - activation's numerator is profile-
contingent through `calculateFantasyPoints`, so removal asserted invariance
that does not hold; section 4.6 no longer claims the sealed text is silent
about absolute-metric intervals, since prereg 10.1's first five bullets
already bind them and only bullet 6's bound is delta-phrased; and section 4.6
gained a season coordinate, a total reducer, a definition of "surviving" for
a statistic with no comparator, and a correct account of shared resamples
when `n` varies. Sections 1, 8.6.1, and 8.6.2 repair three claims that went
false when the CODE changed.

**(5) Provenance of those findings, recorded at its true standing.** Neither
source was an independent statistical review, and **neither is an approval**:

- **Source A** was three subagents spawned by the assistant from
  assistant-written prompts. NOT independent - the assistant authored or
  recommended several passages under review, including two of the CRITICAL
  findings' subject text.
- **Source B** was relayed into the working conversation. The assistant did
  not observe its execution and cannot attest to its origin. This is a
  different provenance from R1-R5, each of which was transcribed from a named
  external reviewer's own message.

Both are recorded in the specification's section 10 at that standing and no
higher. **The three fresh approvals this anchor requires are unaffected by
either.**

**(6) One deviation from the offered solution text, flagged deliberately.**
Section 8.7 rule 4's cell scope does NOT follow the wording offered by Source
B, which tied the row set to "the selected candidate cell." Level 5 selection
can return no-selection - a void run, no passing cell, or an ordering
disagreement - which would leave the row set undefined exactly when the
report must be well-formed. Rule 4 instead fixes the row set at the control
plus every candidate receiving an (e2) evaluation, and the specification
records the rejection in its own text. **A reviewer should be pointed at this
directly**: a deviation discovered unflagged reads very differently from one
the document announces.

**(7) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 7 — appended 2026-08-04

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 6. **Entries 1-6 are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `9222E1F31F71E95DEB29F2DCBB14644C92A2BF424092B8027BB85F0DD5C8F649` |
| git blob | `a52c8cfaafae6c444306d5895ad517cf7ec008f3` |
| anchor commit | `3939a278e6c23a7a82298149ba8e573c42866362` |

**(2) Nothing lapsed.** The superseded anchor (`3bac263…` / `B835B598…`)
accumulated no approvals, as none of its predecessors back to revision 18
had. Rows 4-6 remain lapsed against their own superseded bytes, and **three
fresh approvals are still required** against the hash in (1).

**(3) THE BYTE-IDENTITY CHECK IS AVAILABLE FOR THIS STEP.** This is the
inverse of corrective entry 6's warning, and it is stated explicitly because
these entries alternate on this point and a reviewer must not have to guess
which regime applies. **Revision 23 changes NO ruling.** Verified between
`3bac263` and `3939a27`, with the terminator excluded and every extraction's
line count printed:

| body | rev 22 | rev 23 | result |
| --- | ---: | ---: | --- |
| section 4.6 heading through frozen items 1-4 | 43 | 43 | identical |
| section 4.6.2 | 68 | 68 | identical |
| section 4.6.3 | 20 | 20 | identical |
| section 4.6.4's frozen classification | 15 | 15 | identical |
| section 8.7, whole section | 158 | 161 | one hunk, edit 2 only |

Section 8.7's rules 1, 2, 3, and 5 are untouched, as are rule 4's row set,
its cell-scope paragraph, and the pinned scoring-profile identifier table.
The single hunk replaces two lines with five inside rule 4.

**(4) Why it was re-anchored.** A review round against revision 22 found four
pieces of false or self-contradictory scaffolding sitting beneath conclusions
that all survive unchanged:

- Section 4.6.1 stated that 2024 carries "eight of the thirteen" (e2)
  inequalities. It carries **four**. Prereg 9.7's nine rows yield thirteen
  endpoint-season inequalities: coverage at 2025 is one, the MAE/RMSE/rho/WIS
  rows evaluated at "2025 and 2024" contribute eight across BOTH seasons, and
  the four scoring-profile rows are 2025-only.
- Section 8.7 rule 4 stated "This is NOT the eight-cell factorial grid" while
  the same rule specifies eight cells nine lines later, and section 4.6.2
  names rule 4's family as one of exactly two absolute-metric families
  published across the eight cells. The cells are the same; the endpoint
  count, the absolute-only limit, and the season are what differ.
- Section 4.6.1 claimed both seasons unqualifiedly while rule 4 restricts its
  family to 2025 only, with no deferral clause anywhere in 4.6.1. The
  carve-out is now stated at the source rather than left to
  specific-governs-general.
- Section 4.6.4 cited two supports that do not hold: whole-week undefinedness
  was attributed to prereg 6.6, which is "Null and tie conventions (global)"
  and says nothing about whole weeks, and a rho total-ties rule was asserted
  that appears nowhere in the preregistration. Both are restated at their
  real standing. The branch they support now rests on prereg 6.2 and prereg
  16, which suffice because both concern EVALUATED weeks - unlike the
  preregistration's only explicit whole-week-undefined passage, which
  concerns 2024 Week 1, a week prereg 4.1 excludes from the evaluation window
  in both seasons.

**(5) Sections 1 and 10 also changed**, as they must at every re-anchor:
section 1 carries the authorization-state lines naming the current revision,
and section 10 records the step. Neither is a ruling.

**(6) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 8 — appended 2026-08-04

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 7. **Entries 1-7 are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `475ED9CADC1E0A094DCC34BF86130375F2C8391FE4B56DDF00C346B91C786C7D` |
| git blob | `a89da3af5384b008869d9b57aa9a995ca7cc0393` |
| anchor commit | `227c2e096934c22a423f7470be44f09b53d3c82f` |

**(2) Nothing lapsed.** The superseded anchor (`3939a27…` / `9222E1F3…`)
accumulated no approvals. It received a statistical review that **raised
findings and issued no approval**; per the convention R1-R5 established, a
round issuing no approval warrants no row here, and none was written. Rows
4-6 remain lapsed against their own superseded bytes, and **three fresh
approvals are still required** against the hash in (1).

**(3) THE BYTE-IDENTITY CHECK IS AVAILABLE PER REGION, NOT DOCUMENT-WIDE.**
This is neither of the two regimes the prior entries established. Entry 6
answered the question "unavailable" for the whole document; entry 7 answered
it "available" for the whole document. **Entry 8 answers it both ways, by
region**, and a reviewer who carries either prior entry's regime forward
gets the wrong answer for half of this document.

Verified between `3939a27` and `227c2e0`, with the terminator excluded,
start anchors asserted unique in both revisions, and every extraction's line
count printed:

| body | rev 23 | rev 24 | differing lines |
| --- | ---: | ---: | --- |
| section 4.6, whole (items 1-4, subsections 4.6.1-4.6.4) | 254 | 254 | **0 - identical** |
| section 4.6.2 | 68 | 68 | **0 - identical** |
| section 4.6.3 | 20 | 20 | **0 - identical** |
| section 8.7, whole (all five rules) | 161 | 161 | **0 - identical** |
| section 5, whole | 206 | 206 | **0 - identical** |
| section 6.1a, whole | 132 | 132 | **0 - identical** |

**Sections that CHANGED and must be read rather than diffed**: the preamble,
1, 3.4, 4.4, 6.1, 6.5, 8.6.0, 8.6.2, 10, 10.2, 11.2, and 11.3.

**Section 6.1 carries a NEW substantive amendment and cannot be diffed
past** - the `catastrophicCapCouldFire` comparison form. No byte-identity
proof reaches it, because the bytes are new.

Confinement was cross-checked by a second, independent method: all 25 hunk
offsets were confirmed arithmetically to fall outside section 4.6 (anchor
lines 630-883) and section 8.7 (2366-2526). Two methods, one conclusion.

**Amendment-label check.** Exactly one label was added:
`**[substantive prospective amendment]**` goes 14 to 15, and no existing
label changed type or count. **The total depends on the counting pattern** -
18 to 19 counting unqualified forms only, 20 to 21 including qualified forms
such as section 7's "deviation, chosen", 44 to 46 counting every `**[...]**`
marker, the second of those being a `**[corrected at revision 24]**` in
section 8.6.0. The invariant holds under all three, which is why it is
recorded as the invariant rather than as a total.

**(4) Why it was re-anchored.** A statistical review of revision 23 produced
**no finding against any ruling**. Every defect was in the scaffolding
beneath the rulings - citations, counts, and directives - which is precisely
the material a byte-identity proof is trusted to cover and cannot see. What
revision 24 repairs:

- **Five satisfied directives were written as pending** (section 4.4 items 1
  and 2; section 6.1's `0.30` constant, `3.80` constant, and
  evaluability-guard rewrite). Each now carries a dated status block beneath
  the preserved requirement text. **One further directive is recorded NOT
  MET** in the same form - section 6.1's required test that
  `FALSIFIABILITY_FLOOR` is referenced by nothing returning a status - so
  the blocks distinguish done from pending rather than only ever saying MET.
- **Section 8.6.0 endorsed `assertControlBitIdentity` as implementing
  "exactly this comparison"** four lines above the bullet forbidding that
  exact use, which would compare `"{}"` against `"{}"` and pass vacuously on
  two `Map`-carrying run objects. The endorsement is withdrawn, with
  `assertProjectionRunBitIdentical` (`arms.js:387`) named as the required
  procedure.
- **Ten stale `file.js:NNN` locators**, all taken against Commit A6 rather
  than HEAD. `arms.js:213` was wrong at three sites and is the costliest of
  the ten: that line holds a live salt guard, so a reader following it landed
  on real, plausible, unrelated code rather than on nothing at all.
- **Four defects in section 10.2's own locator inventory**, including a
  phantom entry (`projectionModel.js:1113`) cited nowhere in the document,
  and a blanket claim that locator drift never carries a false statement -
  untrue wherever the citation sits inside a directive, since a directive
  carries a present-tense claim about the code that can be false on its own
  terms.

**(5) The status-block form is now ADOPTED by decision**, not by
propagation. Revision 22 introduced it at one site; revision 24 applies it at
six more and says so in its own narrative, because a convention that becomes
standing by repetition is harder to revisit than one adopted explicitly.

**(6) SEQUENCING: revision 24 had to anchor BEFORE any approval was
commissioned, and the reason is cost, not scope.** The constraint does not
arise from the new amendment. Section 6 was always inside the statistical
review's sections 3-8 scope, and revision 24's status blocks change section
6's bytes under any reading, so the hash moves either way and an approval
commissioned against `9222E1F3…` would have lapsed regardless. **What the
amendment changes is the COST of getting the order wrong**: a
status-block-only revision would have let a prior approval be re-issued
against the new hash after a byte-identity check on the rulings, whereas a
new substantive amendment inside the reviewer's own scope requires a fresh
review of text they have never seen. The first reason is checkable and
false; this entry records the second.

**(7) Two deviations from the drafting brief, flagged deliberately.**

- **The brief instructed that section 6.1's evaluability-guard rewrite be
  marked NOT MET. It is MET**, and is recorded as MET. `arms.js:924-938`
  implements section 6.1a's transformed-bound median comparison, and
  `FALSIFIABILITY_FLOOR` occurs at only `:743`, `:883`, and `:1624`, none of
  them inside the guard. Following the brief would have written a satisfied
  directive as pending **inside the revision whose purpose is repairing
  exactly that**. Only the accompanying negative-reference test is missing,
  and it is recorded as missing.
- **Section 11.3 was amended although the brief did not list it.** Prereg 6.6
  was already in the reviewer packet but described only as "metric
  conventions and contrast construction", which would not lead a reviewer to
  the fourth bullet the new amendment turns on. That pointer was added, along
  with `numbers.js`'s `TIE_DECIMALS` and `roundToTie`. A packet is USED
  rather than audited, so a stale one misdirects silently and is never caught
  by the review it feeds.

**(8) One completeness claim is recorded as UNVERIFIED rather than
inherited.** The directive sweep that found the scaffolding defects was
reported during the revision-24 round as yielding 8 document-wide hits, but
the wider pattern's text was not preserved. The one pattern that was supplied
matches 3 lines within sections 3-8 and 5 document-wide against the
revision-23 bytes. **Section 10.2 records the reproducible pattern with its
counts, and records the 8 as an unverified claim**, rather than carrying an
unreproducible number into a completeness bound. The pattern bounds
*directive-shaped phrasings*, not satisfied directives: four of the six
requirements assessed were found by reading the directive text, not by the
pattern.

**(9) Sections 1 and 10 also changed**, as they must at every re-anchor:
section 1 carries the authorization-state lines naming the current revision,
and section 10 records the step. Neither is a ruling.

**(10) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 9 — appended 2026-08-05

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 8, and it carries a DISCLOSURE about bytes that WERE
approved. **Entries 1-8 are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `57F7C4F0E39E1141B8CAFDBAB74BBF1C6F6DE4F5ACFB2BC21C64F3CEF22EE7D3` |
| git blob | `f5c96136bcaf3f95199e9275ca8b61f5371cfe64` |
| anchor commit | `7c5aa846a858e92668d3be9c1633fdac6b3bc776` |

**(2) Nothing lapsed.** The superseded anchor (`227c2e0…` / `475ED9CA…`)
accumulated no approvals. It drew a findings round that **raised findings and
issued no approval**; per the convention R1-R5 established, no row was
written. Rows 4-6 remain lapsed against their own superseded bytes, and
**three fresh approvals are still required** against the hash in (1).

---

**(3) DISCLOSURE — REVISION 18 WAS APPROVED CARRYING AN INTERNAL
CONTRADICTION. This item has standing independent of any spec revision, and
is the reason this entry exists.**

Revision 18 — SHA-256
`5A0D6E54B2D84494C5D39093C44204A79F32A4DD813F03909C1094339A52BCF8`, anchored
at `85842e70a19b14fb6c5fb8cdfb0bca6a7a367774`, **APPROVED 2026-08-03 and
recorded here as rows 4, 5, and 6** — contained two passages directing
different things about the same comparison:

| where, in revision 18 | what it said |
| --- | --- |
| section 6.2, lines 845-847 | every comparison against a frozen threshold "applies `roundToTie` … to BOTH operands", within "the complete list of such comparisons, and nothing else" |
| section 6.2's table, line 857 | that list includes `3.80`, "the `catastrophicCapCouldFire` transparency line" |
| section 6.1, line 697 | the Gate 2 directive prescribing the BARE form: `Number(maxAbsBaseline) > (CATASTROPHIC_CAP - 0.01) / MAX_EFFECT` |

Section 6.2 named the comparison and required both operands rounded.
Section 6.1 directed the opposite for the same comparison, roughly one
hundred and fifty lines earlier. **Both were inside the bytes that rows 4-6
approved.**

**The contradiction survived revisions 19, 20, 21, 22, 23, and 24**, and was
noted by no review round — including the round that approved revision 18,
and including the pre-submission reads and findings rounds against revisions
21, 22, 23, and 24.

**What it did and did not affect.** `catastrophicCapCouldFire` is
disclosure-only by both sections' own terms; no verdict, cell status, run
status, or selection depends on it. The implementation at
`lib/arms.js:891-892` follows section 6.2, so **no code was ever
non-conformant on this point and no published number changes**. The harm was
to reviewability: a reader could follow either passage and believe the
document required what the other forbade.

**Why a future approver needs this.** Rows 4-6 are cited throughout this
ledger as the last approvals that issued. This entry records that those
approvals passed over an internal contradiction, so their weight as evidence
that the document is internally consistent should be discounted
accordingly — not because the approvers were careless, but because the
contradiction spanned two sections a reader is unlikely to hold in view at
once.

---

**(4) Why the anchor moved: revision 25 changes NO ruling.** It corrects how
revision 24 classified and grounded one change, and adds the disclosure in
(3).

- **Section 6.2 of the document already compelled the tie-rounded
  `catastrophicCapCouldFire` form.** Revision 24 treated the question as
  open, searched the PREREGISTRATION for authority, found prereg 6.6
  reaching the comparison only at its boundary, and labeled its resolution a
  substantive prospective amendment. Revision 24's own supporting text cited
  section 6.2 **without opening it**; the table there names `3.80`.
- **The tie-rounded form itself is unchanged.** What changed is the LABEL
  (substantive prospective amendment → mechanical correction forced by an
  internal contradiction) and the GROUNDS (prereg 6.6 → section 6.2).
- **Section 0 gains the category**, which did not previously exist.

**(5) The downgrade is honest, and the bar is stated so a reviewer can test
it.** Reclassifying substantive → mechanical makes a revision easier to
approve, so section 0's new category states its forcing condition in the
label itself. All three legs must hold: the governing passage's subject is
that class of decision, it declares its scope complete, and it names the
object explicitly. **If a reasonable reader could reach the governing
passage and still resolve the question the other way, the forcing condition
fails and the change is substantive.**

**The category has ONE member and ONE explicitly excluded case.** The
exclusion is recorded because it draws the edge:

- **Member**: the section 6.1 / 6.2 contradiction above. All three legs hold.
- **NOT a member**: sections 4.6 and 8.7 at revision 21, which contradicted
  each other about whether activation carried section 4.6's interval. This
  was drafted into revision 25 as a second member and **then failed the
  category's own test**, measured at `ed5b001`: section 4.6's 66 lines
  contain no completeness declaration and never mention activation. Section
  8.7 does declare completeness — "Every interval in every family above is
  section 4.6's, without exception" — and rule 5 does name activation, but
  *whether activation was one of the families above was the dispute itself*.
  **A completeness declaration over a set whose membership is contested
  forces nothing.** Neither passage governed, so the choice genuinely was
  one a reasonable reader could resolve differently. **Revision 22 was right
  to classify it as substantive**, and revision 25 says so.

**(6) One generalization was WITHDRAWN IN TEXT rather than deleted.** An
earlier draft of section 10.3 asserted a general lesson — "before concluding
a question is unresolved, search for what already governs it" — supported by
the section 6.2 case plus the 4.6/8.7 case as a second instance. When the
second instance failed the category's test, the rule was left resting on a
single case. Section 10.3 now records that the rule was asserted, that its
precedent did not hold, and that one case does not evidence it, closing:
"What is recorded here is the instance." The reasoning stays visible so the
next reader can re-derive the rule rather than inherit it.

**(7) BYTE-IDENTITY IS AVAILABLE PER REGION**, as at entry 8, and verified
between `227c2e0` and `7c5aa84` with each section's boundaries resolved
**independently in each version**. That method matters here: revision 25
inserts section 10.3, which moves section 10.2's terminator, so a shared
awk range would silently compare different spans.

| body | rev 24 | rev 25 | differing |
| --- | ---: | ---: | --- |
| section 4.6, whole | 254 | 254 | **0** |
| section 8.7, whole | 161 | 161 | **0** |
| **section 6.2, whole** | 27 | 27 | **0** |
| section 6.1a, whole | 132 | 132 | **0** |
| section 10.1 | 13 | 13 | **0** |
| section 10.2, content only | 106 | 106 | **0** |

**Section 6.2 being byte-identical is the load-bearing row.** Revision 25
adopts section 6.2's authority; it does not edit it. A correction that
rewrote its own governing passage would prove nothing.

**Sections that CHANGED and must be read**: the preamble, 0, 1, 6.1, and 10.

**(8) Label counts, each stated with the pattern that produced it** — the
convention entry 8 adopted, and necessary here because the counts move in
opposite directions:

| pattern | rev 24 | rev 25 |
| --- | ---: | ---: |
| `**[substantive prospective amendment]**`, bracketed | 15 | 14 |
| `**[mechanical correction, forced by an internal contradiction]**`, bracketed | 0 | 2 |
| `substantive prospective amendment`, any mention including prose | 20 | 22 |

The bracketed count falls by one because a label was replaced; the
any-mention count rises because sections 0, 6.1, and 10.3 now *discuss* the
label without applying it. Either figure alone misleads.

**(9) Confinement.** One tracked file, 235 insertions / 46 deletions, 13
hunks, landing only in the preamble, section 0, section 1, section 6.1, and
section 10. `scripts/backtest/` and `server/` remain byte-identical to
`c04d6b1`; no code has been touched at any point in the revision 19-25 arc.

**(10) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 10 — appended 2026-08-05

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 9. **Entries 1-9 are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `668BB9A7118A6A56D8FC18FD7F4CFD869C88152F892B8A429571CFDFE915FDA0` |
| git blob | `ee9c915f57de8569e741c65a860d0b86d96719ef` |
| anchor commit | `51c0458abf36974966d065d2e384af9614035814` |

**(2) Nothing lapsed.** The superseded anchor (`7c5aa84…` / `57F7C4F0…`)
accumulated no approvals. It drew a statistical review that **raised three
findings and issued no approval**; per the convention R1-R5 established, no
row was written. Rows 4-6 remain lapsed against their own superseded bytes,
and **three fresh approvals are still required** against the hash in (1).
**The disclosure recorded as item (3) of corrective entry 8 stands
unchanged** and still applies to rows 4-6.

**(3) NO RULING CHANGED, AND NO CLASSIFICATION CHANGED.** This is the first
re-anchor in this sequence where that is true of both. Revision 26 changes
the TEST that section 0 uses to license a classification; it does not apply
it to anything new. The label counts confirm it, under both patterns:

| pattern | rev 25 | rev 26 |
| --- | ---: | ---: |
| `**[substantive prospective amendment]**`, bracketed | 14 | 14 |
| `**[mechanical correction, forced by an internal contradiction]**`, bracketed | 2 | 2 |
| `substantive prospective amendment`, any mention including prose | 22 | 22 |

**(4) What the three findings were.** All were **durability defects** — ways
revision 25's three-leg test could admit a FUTURE contradiction it should
exclude. **None impugned the category's sole member**, whose classification
stands.

- **Uniqueness was not required.** The test said "one of them governs" and
  then gave three legs, but nothing required that only ONE passage satisfy
  them. Two passages each governing and directing different things would
  each independently qualify as "the governing passage", so a drafter could
  adopt either and label the result mechanical — licensing a mechanical
  label on exactly the case the category exists to prevent, since choosing
  between two decisions is itself a decision.
- **The contested-set qualifier was not in a leg.** The sentence doing the
  real work — a completeness declaration over a set whose membership is
  itself disputed forces nothing — sat thirty-one lines below the legs, in
  the non-member discussion. A drafter applying the three legs in order
  would never reach it, and leg 2 passed on its literal terms without it.
- **No leg tested WHEN the governing passage came to exist.** This is the
  one exploitable deliberately rather than reached by error.

**(5) Leg 5 and the manufactured-authority attack it closes.** Without a
temporal leg, a drafter owing a substantive label and an approval could, in
a single revision: add a passage whose subject is that class of decision,
declare its list complete, and name the object, specifying the outcome they
wanted; observe that it now contradicts the older rule; and withdraw the
older rule as a "mechanical correction, forced by an internal
contradiction." At the post-edit bytes every other leg holds — **including
the new uniqueness leg, precisely because the older rule was withdrawn** —
and "the document had already decided" becomes true only in the sense that
it decided four paragraphs earlier, in the same revision, for this purpose.

Leg 5 requires the governing passage to **predate the correction, be
unmodified by it, and have that identity SHOWN rather than asserted.**

**(6) The two new legs are DEMONSTRATED for the sole member, in section 0
itself.** A revision that added a "shown, not asserted" requirement while
asserting its own compliance would be self-refuting.

- **Leg 4, by enumeration.** Every completeness declaration in the document
  was enumerated and every mention of `3.80` and `catastrophicCapCouldFire`
  inspected. The other completeness declarations rule on different classes
  of decision — section 4.6.2's surviving-week partition, 5.1's generator
  pinning, 8.2's status truth table, 8.6.1's single-leaf constants diff,
  8.7's scoring-profile assignment, 3.4's runtime salt check — and **none
  names either.** The only other passages carrying both are quotations OF
  section 6.2; a quotation of the governing passage is not a second
  governing passage.
- **Leg 5, by diff across eight anchors.** Section 6.2 is byte-identical at
  revisions 18, 19, 20, 21, 22, 23, 24, and 25 — **0 differing at every
  step**, each version's boundaries resolved independently, 27 lines
  heading-through-section-end and 26 lines body with trailing blanks
  stripped. **Revision 26 does not modify it either**, which is checkable
  against `7c5aa84` and is what makes leg 5 satisfied by the very revision
  that introduces it.

**(7) A stale-citation hazard this document had not recorded.** Revision 25
introduced two INTERNAL line citations in section 6.1 — "Its opening rule
(lines 1424-1428) reads" and "the table's third row (line 1434)" — pointing
at section 6.2. Both were correct against revision 24's numbering **and were
invalidated by the same edit that wrote them**, because that edit inserted
text above section 6.2 and pushed it from line 1422 to 1558. At revision 25
the cited range landed inside section 6.1a, an unrelated section: a citation
resolving to real, plausible, wrong text.

**The distinction that makes the fix general** is already present in this
document. Section 10.3's citations — "section 6.2, lines 845-847", "section
6.1, line 697" — remain correct because each is **qualified by the revision
it is against** (the table's column header is "where, in revision 18"). A
line citation naming its version is a historical fact and cannot rot. **An
unqualified line citation to "this document" rots at every revision,
including the one that writes it**, since a document cannot know its own
final line numbers while being edited. Revision 26 REMOVES both rather than
repairing them — a repaired line number is correct only until the next
insertion above it — and records the hazard in section 10.2 beside the
code-locator one.

**(8) THE TEST IS NOT CLAIMED CLOSED, and section 0 says so in its own
text.** Three shapes were found and closed; a fourth was searched for and
not found. **That is "we looked and did not find one", which is exactly the
evidence that was available before the third was found.** No claim is made
that five legs are sufficient. If the test is ever relied on for a second
member, the right question is not only "does it pass the five legs" but
"what would a drafter who wanted the wrong answer do with them."

**(9) One scope asymmetry is now recorded in section 1**, unresolved and
deliberately so. Section 0's test sits OUTSIDE sections 3-8, the independent
statistical review's scope; the label it licenses sits INSIDE that scope, at
section 6.1. **The review can therefore examine whether the label was
correctly applied, but not whether the test licensing it is sound.** The
document records the fact and does not resolve it, because the remainder
attestation's scope is the approver's decision. This is the sharpest
instance of what turns on that decision.

**(10) Byte-identity is available PER REGION**, verified between `7c5aa84`
and `51c0458` with each version's boundaries resolved independently:

| body | rev 25 | rev 26 | differing |
| --- | ---: | ---: | --- |
| **section 6.2, whole** | 27 | 27 | **0** |
| section 4.6, whole | 254 | 254 | **0** |
| section 8.7, whole | 161 | 161 | **0** |
| section 6.1a, whole | 132 | 132 | **0** |

**Sections that CHANGED and must be read**: the preamble, 0, 1, 6.1, and 10.

**(11) Confinement.** One tracked file, 205 insertions / 38 deletions, 16
hunks, landing only in the preamble, section 0, section 1, section 6.1, and
section 10. **Zero `.js` files have changed against `c04d6b1` across the
entire revision 19-26 arc.**

**(12) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 11 — appended 2026-08-05

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 10. **Entries 1-10 are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `239F1A4FCCC2220C4DBFAAAE46DA71EA3C529C5194DD4BF2A1948E9438658115` |
| git blob | `ce89dd25c5ca882ea6c422a59da8097d9de441f0` |
| anchor commit | `8cbd439e2c2480a9180d648b0d6586b0379df97e` |

**(2) Nothing lapsed.** The superseded anchor (`51c0458…` / `668BB9A7…`)
accumulated no approvals. It drew a reading of sections 1, 2, 9, 10 and 11
that **raised six findings and issued no approval**; per the convention
R1-R5 established, no row was written. Rows 4-6 remain lapsed against their
own superseded bytes, and **three fresh approvals are still required**
against the hash in (1). **The disclosure recorded as item (3) of corrective
entry 8 stands unchanged** and still applies to rows 4-6.

**(3) NO RULING CHANGED — BUT A PUBLISHED NUMBER DID, AND THAT IS NEW.**
Every re-anchor in this sequence so far corrected scaffolding, a
classification, or a test. **Revision 27 is the first that corrects a
DISCLOSED QUANTITY.** Section 9's scale statement was wrong in every revision
from 13 onward:

| | through revision 26 | revision 27 |
| --- | ---: | ---: |
| total salted arm-week generations | `8,160` | **`14,688`** |
| the documented lower branch | `7,344` | **`13,872`** |

The omission was the **prereg 16 sensitivity generation**:
`2 profiles x 8 cells x 24 salts x 17 weeks = 6,528`. Section 9 had counted
as though scoring profile were a REPORTING coordinate, so that one generation
could be re-scored afterwards into `standard` and `ppr`. It is a GENERATION
coordinate — `loadFeatureBundle` takes `rules` as a build-time parameter and
every historical stat line is re-priced through it — so those runs do not
already exist inside the primary grid. **The understatement was eighty
percent.**

**(4) The count is determined, and section 8.7 rule 4 is what determines
it.** Rule 4 fixes the row set at 8 cells, 2 endpoints, 2 profiles, and 2025
only, and **rejects outcome-dependent row sets by name**. Nothing in the
corrected figure waits on a result. An arithmetic check is recorded with it:
`2 profiles x 17 weeks` is identically `1 profile x 34 weeks`, so the
sensitivity generation equals the primary grid exactly, `6,528` by either
route.

**(5) THE THIRD CATEGORY HAS ITS FIRST MEMBER EVER, and that is
ledger-relevant.** `[mechanical correction, forced by an implementation
fact]` had **zero members through revision 26** — it occurred once in the
document, in its own definition. Revision 27 admits the first, which means
revision 27 is where its boundary was set. Three things are recorded in
section 0 rather than left implicit:

- **The boundary decision.** The definition says "the sealed text's OWN
  derivation". Section 9's count sits in THIS document, not sealed prereg
  text, so the reading had to be settled before the category could take a
  member. It is read **descriptively**: the three conditions test why the
  number is wrong, whether the fix is determinate, and whether it can move a
  verdict, and **which file the number sits in bears on none of the three.**
- **The three conditions, shown in order**, with condition 3 demonstrated
  rather than asserted.
- **The provenance.** The member was admitted **in the round that found the
  defect, by the party that drafted the correction, under a boundary reading
  settled in that same round.** This is the shape leg 5 of the fourth
  category exists to catch. Leg 5 does not formally bind this category, and
  that is not a reason to behave as though the hazard is absent.

**(6) Label counts, each stated with the pattern that produced it.**

| pattern | rev 26 | rev 27 |
| --- | ---: | ---: |
| `**[mechanical correction, forced by an implementation fact]**`, bracketed | 1 | **2** |
| `**[substantive prospective amendment]**`, bracketed | 14 | 14 |
| `**[mechanical correction, forced by an internal contradiction]**`, bracketed | 2 | 2 |
| `substantive prospective amendment`, any mention | 22 | 22 |

The first row moves from 1 to 2 because the definition itself matches the
bracketed pattern; the second occurrence is the first application. **A
drafting defect was caught by this exact check mid-round**: the label was
first written with both brackets inside one `**…**` span, so the greppable
form never appeared and the count returned 1 to 1. That is the same defect
revision 24 made, found by the same instrument.

**(7) SECTIONS 3-8 ARE NOT BYTE-IDENTICAL AT THIS STEP.** Every prior entry
in this sequence could offer byte-identity for the statistical review's
scope, and that argument was used to bound re-review cost. **It is not
available here**, and the reason matters: two of four stale
`projectionModel.js` locators sat inside **section 8.6.1's normative
allowlist**, which fixes which fields must be bit-identical across the
`homeaway-on` / `homeaway-on-stored` comparison.

| | rev 26 | rev 27 |
| --- | ---: | ---: |
| sections 3-8, span | 2,259 | **2,260** |
| lines modified | | 2 |
| lines added | | 1 |

The allowlist names its fields **by name**, so its meaning never depended on
the locators and **no ruling, endpoint, status, or selection changes**.
Repairing only the out-of-scope copy in section 11.3 was considered and
rejected: it would have left a stale locator inside reviewed normative text
on the strength of a scope boundary.

**(8) Byte-identity IS available per region**, verified between `b95f860`
and `8cbd439` with each version's boundaries resolved independently:

| body | rev 26 | rev 27 | differing |
| --- | ---: | ---: | --- |
| **section 8.7, whole** | 161 | 161 | **0** |
| **section 6.2, whole** | 26 | 26 | **0** |
| section 4.6, whole | 254 | 254 | **0** |
| section 6.1a, whole | 132 | 132 | **0** |

**Section 8.7 being unedited is the load-bearing row this time.** Section 9's
corrected figure derives from rule 4; a correction that edited its own
governing passage would prove nothing. Section 6.2 remains byte-identical
across **nine** revisions, 18 through 27, which keeps the fourth category's
leg-5 demonstration true of the current bytes.

**(9) The rule 4 block quote was verified verbatim.** Section 9 introduces it
as quoted in full rather than cited. An audit found the quote had **added
bold emphasis to one sentence** that is plain in section 8.7 — the sentence
section 9 leans on for determinacy. **Fixed before anchoring**, and the whole
quote then checked word-for-word against its source (480 bytes each side,
identical after whitespace normalization). The anchored bytes carry a
verbatim quote. It is recorded because fidelity is that block's entire claim
and section 11.1 already caveats author-written material presented as
transcribed.

**(10) Five errata, none touching a ruling.** Section 2 named
`sweepEvaluator.js` as consuming three `arms` exports it references **zero**
times, while seven other modules do; because it does require `arms`, the
error did not announce itself. Four `projectionModel.js` locator sites
repaired. Section 11.2 described section 10's table as current five revisions
ago, **pointing readers away from section 10.3**, which section 1 makes
required reading before any approval — a directional error, not a stale
number. Section 1 claimed "zero occurrences" where the obvious grep returns
one.

**Section 10.2 now records that this inventory MISSED those four sites**
while existing to catch exactly that class, and that they surfaced because a
stale locator happened to match a regex during an unrelated read, not because
the instrument found them.

**(11) A second scope asymmetry is recorded in section 1, opposite in shape
to the first and milder.** Section 9's correction and the section 0 category
licensing it both sit OUTSIDE sections 3-8, so no approval reaches either.
**But rule 4, the premise the entire correction rests on, sits INSIDE that
scope.** A reviewer can therefore falsify the correction without being able
to approve it. Where the first asymmetry leaves section 0's test
unexaminable, this one leaves the load-bearing premise examinable.

**(12) Confinement.** One tracked file, 261 insertions / 18 deletions, 19
hunks, landing only in the preamble, sections 0, 1, 2, 8.6.1, 9, 10 and 11.
**Zero `.js` files have changed against `c04d6b1` across the entire revision
19-27 arc.**

**(13) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 12 — appended 2026-08-05

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 11, **and it corrects two statements made in entry 11
itself**, which is append-only and therefore stands unedited. **Entries 1-11
are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `E6DB125C14ACF54E6A8AA52DD17777FB7447F555742A12BD656B6537A35E372B` |
| git blob | `d962ca8df3539a244e813691c8a99b27396a106a` |
| anchor commit | `0762738d9d64800c140b4c318ea06f95bc825c7f` |

**(2) Nothing lapsed.** The superseded anchor (`8cbd439…` / `239F1A4F…`)
accumulated no approvals. Rows 4-6 remain lapsed against their own superseded
bytes, and **three fresh approvals are still required** against the hash in
(1). **The disclosure recorded as item (3) of corrective entry 8 stands
unchanged.**

---

**(3) CORRECTION TO ENTRY 11. Entry 11 names the wrong section, twice.**

Entry 11 item (7) states that two stale locators "sat inside **section
8.6.1's normative allowlist**", and item (12) lists the changed sections as
"the preamble, sections 0, 1, 2, **8.6.1**, 9, 10 and 11".

**Both should read section 8.6.2.** The allowlist in question is section
8.6.2, "The complete fresh-vs-fresh allowlist". Section 8.6.1 is "Scope: the
`homeaway-on-stored` assertion names one pair" and ends before the allowlist
begins.

**Everything else entry 11 states about that repair is correct**: the
locators (`:1038`, `:1177`, `:1081`, `:1080`), the repair itself, the claim
that the affected text sits INSIDE sections 3-8, the span moving 2,259 to
2,260, and the 2-modified-1-added delta. **Only the subsection number is
wrong.** No count, no scope statement, and no ruling in entry 11 is affected.

**The ledger is append-only, so entry 11 is not edited.** This item is the
correction of record. A reader of entry 11 should carry it forward.

---

**(4) The same error stood at six sites in revision 27's anchored bytes**,
and revision 28 corrects all six: the preamble, section 10's revision 26 → 27
history row, three rows of section 10.2's repair table, and that table's
prose. **All thirteen pre-existing `8.6.1` references in the document are
correct and were not touched.**

**(5) Why a wrong section number was worth a re-anchor.** Section 8.6.1 is
the scope section for the **same assertion pair** as 8.6.2, so a reader
following the pointer lands on real, plausible, closely-related, wrong text.
That is the exact failure section 10.2 already records for `arms.js:213` —
"a locator that resolves to something is worse than one that resolves to
nothing" — committed three paragraphs above by the table whose function is to
be the work-list against it. **The section that exists to inventory
misdirection was the section misdirecting.**

**(6) Section 10.2 now carries this as a FOURTH hazard class.** It is not any
of the three already inventoried — stale `file.js:NNN` locators,
negative-existence claims, and unqualified internal line citations:

- A stale `file.js:NNN` locator **fails to resolve** to its named symbol, so
  a mechanical locator check finds it.
- **A section attribution RESOLVES.** It just resolves to the wrong section.
  There is nothing unresolvable to find, both sections exist, and neither
  changed — **so neither the locator check nor any byte-identity proof can
  catch it.**

**(7) The mechanical rule, recorded with the class.** The cause was reading a
region by LINE OFFSET and attributing it to a subsection without resolving
the enclosing heading. **A slice terminator must match every heading level at
or above the target's.** A terminator matching only `###` and `##` does not
match `####`, so a slice starting at section 8.6.1 runs to section 8.7 and
measures **374 lines where the section has 107** — 267 extra, silently
absorbing 8.6.2, 8.6.3, 8.6.4 and 8.6.5. **Section 8.6 alone has six `####`
subsections exposed to that hole.**

**(8) BOTH THE DRAFTING AND THE AUDIT OF REVISION 27 COMMITTED THIS, WITH
DIFFERENT PROBES.** One attributed a range without resolving its heading. The
other verified that attribution with a span too coarse to discriminate
between the two candidate sections — the audit's slice contained the changed
lines, so it confirmed the label while being structurally incapable of
testing it. **A probe that cannot distinguish the right answer from the wrong
one does not become evidence by returning the expected result.** Two
independent parties reaching the same wrong answer by different routes is the
argument for recording a class rather than an incident.

**(9) SECTIONS 3-8 ARE BYTE-IDENTICAL to `8cbd439`**, span 2,260 both sides,
**0 differing**. Entry 11 had to record the loss of that property; it is
restored here, and the restoration is checkable rather than asserted.

**(10) Byte-identity per region**, verified between `8cbd439` and `0762738`
with each version's boundaries resolved independently **and with a terminator
matching `####`**, which is the rule item (7) records:

| body | rev 27 | rev 28 | differing |
| --- | ---: | ---: | --- |
| **sections 3-8, whole** | 2,260 | 2,260 | **0** |
| **section 8.6.2, whole** | 78 | 78 | **0** |
| section 6.2, whole | 26 | 26 | **0** |

Section 6.2 is now byte-identical across **eleven** revisions, 18 through 28
inclusive: 26 lines, 0 differing at every step, with the `### 6.2` start
anchor asserted unique in each and each version's terminator matching `####`.

**(11) Confinement.** One tracked file, 75 insertions / 10 deletions,
landing only in the preamble, section 1, section 10 and section 10.2. **Zero
`.js` files have changed against `c04d6b1` across the entire revision 19-28
arc.**

**Noted for the record**: unrelated in-flight work modified
`src/lib/draftSim/engine.js` in the working tree during this round, alongside
four untracked new files under `src/lib/`. **None of it was staged or
committed here**, and the committed invariant is unaffected — every commit in
this arc stages the spec or the ledger by explicit path, never `git add -A`.

**(12) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 13 — appended 2026-08-05

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 12. **Entries 1-12 are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `693ECFC88C2BD708EA984C568893942CF24134D6E1D23D4EA1ABD80FB9088994` |
| git blob | `8bc455643d8178a4c913a3a5810e43c1bccc7bd8` |
| anchor commit | `b7ccf186d3f6688079b42d26634bb028d91f173c` |

**(2) Nothing lapsed.** The superseded anchor (`0762738…` / `E6DB125C…`)
accumulated no approvals. It drew **an independent statistical review that
issued NO APPROVAL and raised eight findings**; per the convention R1-R5
established, no row was written. Rows 4-6 remain lapsed against their own
superseded bytes, and **three fresh approvals are still required** against the
hash in (1). **The disclosure recorded as item (3) of corrective entry 8
stands unchanged.**

**(3) THIS IS THE FIRST RE-ANCHOR SINCE REVISION 18 THAT ANSWERS A REVIEW
RATHER THAN A SELF-CORRECTION.** Revisions 19 through 28 answered readings,
pre-submission passes, and the drafting party's own findings. Revision 29
answers eight findings from an independent statistical review of sections 3-8.
**One ruling changed**: section 6.2 gains an explicit component-(f) scope.
Everything else repairs a claim the document made about code or about itself.

**(4) Byte-identity is available PER REGION**, verified between `0762738` and
`b7ccf186` **by mapping every changed line to its nearest preceding heading**,
not by slicing. That method is the point of item (7) below.

| region | rev 28 | rev 29 | differing |
| --- | ---: | ---: | --- |
| section 4.6 with subsections | 253 | 253 | **0** |
| **section 8.6.2** | 78 | 78 | **0** |
| section 8.7 | 160 | 160 | **0** |

**Sections that CHANGED and must be read**: the preamble, 0, 1, 3.2, 6.1, 6.2,
6.5, 8.6.0, 8.6.1, 8.6.3, 8.6.4, 8.6.5, 9, 10 and 10.2. Sections 3-8 grow from
**2,260 to 2,352 lines**.

**The five section 8.6.x changes are locator repairs and nothing else:**

| section | repair |
| --- | --- |
| 8.6.0 | `projection.service.js:455-459` -> `:475-479` |
| 8.6.1 | `projectionFeatures.js:177-231` -> `:188` |
| 8.6.3 | `:478-497` -> `:496`, and `:483-495` -> `:507` |
| 8.6.4 | `:449` -> `:467` |
| 8.6.5 | `:478-497` -> `:496` |

No requirement, allowlist entry, field name, or comparator changes in any of
them. The allowlists name their fields **by name**, so their meaning never
depended on the citations.

**(5) THE ANCHOR WAS AMENDED BEFORE PUBLICATION, and the superseded commit is
named here so the record is complete.** An earlier commit of these bytes
(`16b0c50` / blob `5a50676e` / SHA-256 `B643503B…`) carried a **false
confinement claim in its preamble**: it named sections 8.6.1 and 8.6.3-8.6.5
as byte-identical to revision 28 when all four had changed, omitted 8.6.2
which is the one untouched section of the five, and named 8.6.0 neither way.
**That commit was never pushed, no remote branch contained it, and no ledger
entry referenced it.** It was amended rather than superseded by a revision 30,
because amending an unpublished commit that nothing references finishes a
commit rather than rewriting shared history. **The ledger's append-only rule
is not implicated: it protects the published record, and nothing was
published.**

**(6) The corrected paragraph is the round's own defect class, committed
inside the summary of the round that documents it.** It asserted a
byte-identity set that a single command falsifies, in the preamble, in the
revision whose subject is claims this document makes about itself. **The
commit message shipped with it was correct throughout** - it named 4.6, 8.6.2
and 8.7 - so an accurate statement of the same fact sat beside the false one.
It also inverted the **same** 8.6.2 attribution that this revision records as
having already travelled three hops: section 10.2's outstanding list filed the
`loadCachedRows` sites under 8.6.2, the review inherited that, and the
findings file transcribed it. They live in 8.6.3 and 8.6.5. **A fourth
recurrence, inside the correction for the third.**

---

**(7) THE STRUCTURAL GAP THIS ROUND SURFACED, which has no other home in this
project's records.**

**This document's instruments are complete over the artifact and empty over
the reviewer.** Section 10.2 inventories seven hazard classes, every locator is
checkable, every count is reproducible, and byte-identity is provable per
region. **There is no instrument of any kind aimed at whether a review was
performed under conditions that let it be independent.**

**This round's review was contaminated, and it was caught only because the
reviewer volunteered a disclosure against their own interest before any
finding existed to justify it.** That is not a mechanism. It is a
disposition, and it is not repeatable: a reviewer who did not volunteer, or
who did not notice, would have produced a review indistinguishable from a
clean one on every axis this document can measure. **Every instrument here
would have returned green.**

**Corrective entry 9 is the precedent for recording this.** It creates no
approval row and carries a disclosure about how review failed, on the
reasoning that a future approver needs to know what the prior approvals did
not see. The same reasoning applies with more force here: entry 9's disclosure
concerned bytes, which are checkable afterward. **This one concerns
conditions, which are not.**

**What follows from it is a precondition, not a finding**, and it belongs to
the approver rather than to this document: the first approval requires a
genuinely independent party, and independence is a fact about the conditions
of the review, which no artifact-side check can establish.

---

**(8) VERSIONED CONTAMINATION DISCLOSURE.** This project directory carries an
auto-loading memory index that records the drafting party's conclusions,
including classification rulings. It loads into any session opened in this
directory, including a reviewer's.

**Captured as command output at the moment this entry was written,
2026-08-05T13:09:27-05:00:**

```
MEMORY.md                              9726 bytes   sha256 0fd53bb5ab942291b4029a60028cef60
accuracy-roadmap-backtest-rebuild.md  99858 bytes   sha256 5d12af20bbb42b08605fa8d3acd69fb0

names as current anchor:   revision 28, `0762738` / `E6DB125C…`
mentions revision 29:      0 occurrences in either file
```

**The version matters and is the reason this is stated as bytes rather than
as a description.** That index is rewritten as work proceeds - twice on this
date alone - so a disclosure naming "the memory index" without naming its
state describes a contaminant that no longer exists by the time anyone checks.
**An unversioned contamination disclosure is the sixth hazard class this
revision adds to section 10.2**, and an entry recording that class must not
commit it.

Note what the capture shows: at the moment revision 29 was anchored, the index
still named **revision 28** as current and did not mention revision 29 at all.
A reviewer loading it would have been primed with the previous round's
conclusions, not this one's.

**(9) Confinement.** One tracked file, 357 insertions / 69 deletions, staged
by explicit path. **Zero `.js` files have changed against `c04d6b1` across the
entire revision 19-29 arc.** Eight files belonging to an unrelated
roster-feature workstream were dirty in the working tree throughout and **none
was staged**; every commit in this arc names its paths.

**(10) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 14 — appended 2026-08-05

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 13. **Entries 1-13 are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `31D3D89D7BA20335381855BFDEC17245B05EB5C65946E4EEC32679FAE3CD001B` |
| git blob | `c2ce70cbc13572f208f5d3ebdb7935bb32b03d71` |
| anchor commit | `eda85eb1b6f6d257a3d723cd1a015fa95beae42d` |

**(2) Nothing lapsed.** The superseded anchor (`b7ccf186…` / `693ECFC8…`)
accumulated no approvals. Rows 4-6 remain lapsed against their own superseded
bytes, and **three fresh approvals are still required** against the hash in
(1). **The disclosure recorded as item (3) of corrective entry 8 stands
unchanged.**

**(3) SECTIONS 3-8 ARE UNTOUCHED.** No ruling, classification, or number
changed. **2,352 lines in revision 29 and in revision 30, 0 differing.** The
entire revision lands in the preamble, section 10.2, and section 10's table -
88 insertions, 0 deletions, one tracked file staged by path.

**This is the first re-anchor in the sequence whose only content is a
PROCESS STEP.** Every prior one corrected something already written.

**(4) What it adds: the confinement check, specified.**

> Map every changed line to its nearest preceding heading at **any** level -
> including the document's `#` title, under which the preamble falls - and
> compare the resulting set against the set the revision claims.

**It is a set equality in BOTH directions**, and the second direction is the
one that has failed. Every section claimed byte-identical must have zero
changed lines mapped to it; every section with changed lines must appear in
the claimed-changed list.

**(5) Why the second direction is load-bearing.** Revision 29's first
confinement paragraph named four changed sections and **missed a fifth**:
section 8.6.0 carried a locator repair and appeared in **neither** list.
A check that only verifies the claimed-identical sections are clean **passes
that defect**, because 8.6.0 was never claimed either way. An omission is
invisible to a subset check by construction, and an omission is what happened.

**(6) It is primary because it has no boundary to resolve, and therefore none
to get wrong.** A slice-based byte-identity proof is perfectly correct when
its terminator is right. The failure mode is that choosing the terminator is a
per-call judgment nobody re-makes, and a wrong one **fails silently in the
passing direction**. The mapping check asks only which heading precedes a
line. Slicing keeps a secondary role, confirming each claimed-identical
section independently.

**"Every level" is literal, and the failing pattern is named in the
specification** so an implementer does not reproduce the bug while following
the instruction: `/^(### |## )/` does not match `####`, under which a slice
beginning at section 8.6.1 runs to section 8.7 and measures **374 lines where
the section has 107**. Section 8.6 alone has six `####` subsections.

**(7) THE SPECIFICATION WAS VALIDATED AGAINST A KNOWN CASE BEFORE ADOPTION,
and this is the part worth carrying forward.** Run retrospectively over
`0762738..b7ccf186` - revision 28 to 29 - it returns exactly

```
preamble, 0, 1, 3.2, 6.1, 6.2, 6.5, 8.6.0, 8.6.1, 8.6.3, 8.6.4, 8.6.5, 9, 10, 10.2
```

and excludes 4.6, 8.6.2 and 8.7. **That is the known answer, including the
8.6.0 that the prose had missed.** Run on revision 30's own diff it returns
`preamble, 10, 10.2` with **zero** changed lines inside sections 3-8.

**Its first implementation returned an EMPTY set**, through a hunk-header
parsing error that read `@@` as the whole header. **An empty set satisfies a
subset check vacuously** and would have been reported as a pass. Only the
known expected answer exposed it. **A confinement check must itself be
validated against a diff whose answer is already known, or it is one more
untested instrument** - which is the condition this document keeps
discovering it is in.

**(8) `check-locators.js` and any scripted form remain BARRED** until Gate 4's
B3 re-cut, because a new tracked file extends the open prereg 17
`B..final-head` allowlist violation. **The specification is the durable half
and is in force now**; the script is a convenience that rides with the other
batched guards at B3. Nothing in revision 30 licenses landing a tracked file,
and none was landed.

**(9) A FORWARD CLAUSE FOR REVISION 29, because rows are not edited.** Section
10's rows are left unedited so the record of what happened stays intact, so
revision 29's row cannot carry this and revision 30's does:

**Section 6.2 grew from 27 lines to 74 at revision 29 and must be READ, NOT
DIFFED.** "No ruling changed" and "section 6.2 is not byte-identical" are both
true, and a reviewer should not have to combine two statements from two rows
to reach that. All four thresholds in section 6.2's table are component-(f)
items - `0.20` at 6.4, `0.025` at 6.1a, `3.80` and `0.30` at 6.1, and section
6 **is** component (f) - so the scope sentence documents a boundary that
already held and **no comparison entered or left the list**.

**(10) Confinement.** One tracked file, 88 insertions / 0 deletions, staged by
explicit path.

**THE `.js` INVARIANT HOLDS, BUT THE COMMAND THAT VERIFIED IT NO LONGER
TESTS IT.** Every entry from 11 through 13 stated it as
`git diff c04d6b1..HEAD -- '*.js'` returning zero, and that was true when each
was written. **It is no longer true, and nothing about the study changed.**
Commit `972c53e`, an unrelated roster-feature commit, landed on `integration`
between corrective entry 13 and revision 30, bringing six `.js` files into the
range:

```
git diff c04d6b1..HEAD -- '*.js'        ->  6 files, ALL from 972c53e
```

**The invariant is about AUTHORSHIP, not about a range**, and stated correctly
it holds:

```
24 study commits examined (docs(backtest) in c04d6b1..HEAD)
 0 touching any .js file
```

**The range-based command isolated the study only for as long as the range
contained study commits exclusively.** It was never testing what it was taken
to test; a third party's commit was always sufficient to break it, and one
finally arrived. **Entries 11-13 are accurate as written and are not edited** -
they record a command that returned zero, and it did.

**This is the sixth hazard class, applied to an instrument rather than to a
sentence**: a check whose meaning silently depends on a condition nobody
restated. Future rounds must verify the `.js` invariant **per commit by
authorship**, not by diffing the range endpoints. Files belonging to that same
roster-feature workstream also remained dirty in the working tree throughout
revision 30 and none was staged.

**(11) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.
