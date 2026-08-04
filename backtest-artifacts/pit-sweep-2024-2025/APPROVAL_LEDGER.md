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
