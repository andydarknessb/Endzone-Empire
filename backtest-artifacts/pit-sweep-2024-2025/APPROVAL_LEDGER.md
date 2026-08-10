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
| 7 | `PHASE5_EXECUTION_SPEC.md` | `5EA91A5E23602101E725C5560DAE071BD6A81659AD33E48EC25F64BA6E959F78` | independent statistical review | 2026-08-06 | revision 34, sections 3-8; exact git blob `e339020a3e61bfc32a20a3acd2f1f246f155a8b8` at commit `81289fa0e980f5b71dbf7c660f036cfa253e44ae`. **Reach as stated by the approver**: the three repaired sections and the changed bytes were read directly; the 2,407 carried-over scope lines were NOT re-read and rest on that reviewer's revision-33 examination plus verified byte-identity | **APPROVED** |
| 8 | `PHASE5_EXECUTION_SPEC.md` | `5EA91A5E23602101E725C5560DAE071BD6A81659AD33E48EC25F64BA6E959F78` | user | 2026-08-06 | S3 structurally non-estimable prospective deviation (section 7): reserve-class rows are excluded at roster construction under the frozen active-only cohort before any injury-status mapping, so prereg 4.2's rule has no row to apply to. **No S3 estimate is published**; exclusion counts may be published as context, never as a substitute S3 result; disclosed as an explicit prospective deviation from prereg 4.2. Unchanged in substance from row 5 | **APPROVED** |
| 9 | `PHASE5_EXECUTION_SPEC.md` | `5EA91A5E23602101E725C5560DAE071BD6A81659AD33E48EC25F64BA6E959F78` | user | 2026-08-06 | remainder of revision 34, all provisions outside row 8's S3 deviation. **Scope of authorization: Gate 2 IMPLEMENTATION only — does NOT authorize candidate-cell execution**, which remains gated on the fourth approval. Attested after being shown section 10.3's disclosure and the two known-wrong counts recorded at corrective entry 19 item (5); the approver attested with knowledge of both, not in ignorance of them | **APPROVED** |
| 10 | `PHASE5_EXECUTION_SPEC.md` | `5EA91A5E23602101E725C5560DAE071BD6A81659AD33E48EC25F64BA6E959F78` | independent implementation review | 2026-08-07 | Gate 2 implementation conformance to revision 34, sections 3-8 (lines 1060-3487; spec blob `e339020a3e61bfc32a20a3acd2f1f246f155a8b8` at anchor `81289fa0e980f5b71dbf7c660f036cfa253e44ae`), **reviewed at implementation commit `6e9411b8760525ea56182f47a7733a69ad0dd7c2`** on branch `integration`; reviewer of rounds 3-6, no authorship of any repair in the range. **Bounded as stated by the approver**: by the round-6 reach statement — four standing UNCHECKED items (real `seedFrom` output, section 4.6.2's contrast producers, the Semgrep scanner verdict, the microbenchmark) and the non-existence of the `--inputs` producer, so generation-side requirements are verified only as far as the reducer reaches — and by two open MINOR findings (H: `movingBlockBootstrap`'s unguarded accumulator; I: a mis-attributed diagnostic), neither reachable through the production entry point, which the approver expects closed or answered rather than silently carried. **Does NOT authorize candidate-cell execution**: Gate 4's B3 re-cut carrying the complete Phase 5 implementation and Gate 3's verification of it remain, per specification section 1 | **APPROVED** |
| 11 | `PHASE5_EXECUTION_SPEC.md` | `DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43` | independent statistical review | 2026-08-09 | revision 38, sections 3-8; exact git blob `44fae65bce063e9eff2912e0827b868061bf7a15` at commit `d65bc1086227c76f3a0991cd31c577f2b2c9e96d`. **Reach as stated by the approver**: the reviewer who issued the revision-36 and revision-37 findings continued in the same session from `/home/claude/review-clone-r36/ez`; the eight changed in-scope regions and dependency surface were read anew, with the byte-identical remainder carried from that reviewer's prior two reads. Four MINOR findings F-1 through F-4 are inert and do not prevent approval. **Independence limitation**: the reviewer cannot audit whether other drafting sessions used the same assistant model; model-level novelty remains unresolved and is not represented here as proven | **APPROVED** |
| 12 | `PHASE5_EXECUTION_SPEC.md` | `DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43` | user | 2026-08-09 | S3 structurally non-estimable prospective deviation, section 7: reserve-class source rows receive injury-status mapping first; cohort exclusion and counting occur second; excluded rows never reach downstream roster construction or scoring. **No S3 estimate is published**; disclosed as an explicit prospective deviation from preregistration section 4.2. Exact git blob `44fae65bce063e9eff2912e0827b868061bf7a15` at commit `d65bc1086227c76f3a0991cd31c577f2b2c9e96d` | **APPROVED** |
| 13 | `PHASE5_EXECUTION_SPEC.md` | `DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43` | user | 2026-08-09 | all remaining provisions of revision 38, sections 3-8, outside row 12's S3 deviation; exact git blob `44fae65bce063e9eff2912e0827b868061bf7a15` at commit `d65bc1086227c76f3a0991cd31c577f2b2c9e96d`. **Scope of authorization: implementation work only — does NOT authorize candidate-cell execution** | **APPROVED** |
| 14 | `PHASE5_EXECUTION_SPEC.md` | `DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43` | independent implementation review | 2026-08-10 | Gate 2 implementation conformance to revision 38, sections 3-8; exact git blob `44fae65bce063e9eff2912e0827b868061bf7a15` at anchor `d65bc1086227c76f3a0991cd31c577f2b2c9e96d`, **reviewed at implementation commit `a85f6a67c99d27740018b77a5324c0841ce5a99a`**. N-2 is closed and the reviewer independently reproduced 379 passing synthetic tests. Semgrep run `31410073445` executed and failed; the identified source statements were dispositioned as nonblocking false positives and a suppression gap. **MINOR N-1 remains open**: only a direct handmade call to `sweepReport.buildReport` can produce the visible null; the production path emits and validates veto evidence, so no validated document changes status. Residual observations O-1 and O-2 are unverified non-conformance observations. **Independence limitation**: model-level novelty remains unresolved. **Does NOT authorize candidate-cell execution or lift Gate 0**; Gate 4's replacement freeze sequence and Gate 3 verification remain | **APPROVED** |
| 15 | `PHASE5_EXECUTION_SPEC.md` | `DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43` | independent implementation review | 2026-08-10 | Gate 2 implementation conformance to revision 38, sections 3-8; exact git blob `44fae65bce063e9eff2912e0827b868061bf7a15` at anchor `d65bc1086227c76f3a0991cd31c577f2b2c9e96d`, **reviewed at implementation commit `2716934def4ba5eef155113d458f5b20a58cf97d`**. The same historical row-10 and row-14 reviewer verified that the post-row-14 delta changes only the ledger, four same-line rule-specific Semgrep annotations with byte-identical executable statements, and the CI checkout depth. Semgrep run `31417720395` and CI run `31417719882` succeeded at the exact target; the reviewer reproduced the synthetic locator checks and 19/19 instrument tests. **MINOR N-1 remains open** with its previously stated direct-handmade-call reach; **MINOR N-3 is open and inert** because the line-100 suppression rationale says `SEARCH_ROOTS` is frozen when it is instead module-private and never mutated. O-1 and O-2 remain unverified, unasserted observations; authenticated run identities and outcomes do not independently verify their unavailable log bodies. **Does NOT authorize candidate-cell execution or lift Gate 0**; Gate 4's replacement freeze sequence and Gate 3 verification remain | **APPROVED** |

**Row 7's earlier reservation is superseded — see corrective entry 19.** The
paragraph that follows was written at corrective entry 2, when rows 4-6 were
live and the implementation review was the only approval still outstanding.
That premise lapsed at corrective entry 3, when rows 4-6 lapsed with the
bytes they authenticated. The reservation named which approval was expected
next, not a numbering rule; rows are appended in the order approvals issue,
so the Gate 2 implementation review now takes row 8. **The substantive rule
it carried is untouched and was honored here**: no row is pre-filled in
anticipation, and row 7 was written only after the approver issued an
approval naming the revision, the scope, the blob and the commit.

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

---

### CORRECTIVE ENTRY 15 — appended 2026-08-05

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 14. **Entries 1-14 are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `585E992D89C3828685F45C9FB6B305BEF9617D4AF11E269D326A3AF9F1F9F8D8` |
| git blob | `24fb6d36d392f2b77ca3889c34866edc7941daf1` |
| anchor commit | `e4774b17875214e7700e74a2eef20bac15bea77c` |

**(2) Nothing lapsed.** The superseded anchor (`eda85eb…` / `31D3D89D…`)
accumulated no approvals. Rows 4-6 remain lapsed against their own superseded
bytes, and **three fresh approvals are still required** against the hash in
(1).

**(3) SECTIONS 3-8 ARE UNTOUCHED**, 2,352 lines at revision 30 and at
revision 31, **0 differing** under both the mapping check and the slicing
confirmation. **No ruling, classification, or number changed.**

**(4) The confinement check specified at revision 30 had its first
application to a revision it did not author.** Changed lines map to the
preamble, section 1, section 10, section 10.2 and section 11.2, and to
nothing else. **The check was run before the anchor was taken, and the
mapped set was predicted in advance and matched** - which is the difference
between running a check and consulting one.

**(5) Six items closed.** Revision 30 left four; two more were established
before drafting.

| item | what it closed |
| --- | --- |
| item 1 | EIGHTH hazard class: a closed-form correction to an unversioned claim rots again |
| item 2 | section 11.2's stale bounds, `14-21` and `through 27` |
| item 3 | section 11.2's bullet pointing at a superseded revision-21 paragraph |
| item 4 | NINTH hazard class: a range read as an authorship boundary |
| item 5 | section 10's own row-currency statement |
| item 6 | **section 1's authorization block, which was byte-identical to revision 30** |

**(6) Item 6 is the one that mattered, and it was nearly missed.** Section 1's
block opened "as of revision 28" while the document stood at 31, bounded the
no-approval run at "19 through 27", enumerated "23, 24, 25, 26, and 27"
without 28, and closed **"revision 28 awaits all three fresh approvals"**.
That is a false statement about authorization, **in the block whose only job
is to say what is authorized, inside the revision that adds two hazard
classes about claims going stale.**

**The endpoints were DELETED, not refreshed.** Refreshing them is the eighth
class this same revision adds, and doing it here would have been its third
recursion. The replacements are true by construction at every anchor: "as of
THE ANCHORED BYTES", "every revision since 18 accumulated no approvals", the
enumeration dropped in favour of section 10's table, and "THIS REVISION
awaits all three fresh approvals".

**(7) THE ANCHOR WAS AMENDED ONCE BEFORE PUBLICATION.** An earlier commit of
these bytes (`e265bc2` / blob `1b64047b` / SHA-256 `8B2069BD…`) omitted item
6 and carried an unmethodded `server/` figure. **It was never pushed, no
remote branch contained it, and no ledger entry referenced it.** Amending an
unpublished commit finishes it rather than rewriting history anyone has seen.

**(8) A DISPUTED FIGURE RECONCILED EXACTLY, and the reconciliation is worth
more than the figure.** The ninth hazard class cites how many commits have
touched `server/` without belonging to this study. Two parties produced 180
and 159 and each was correct:

```
182  commits touch server/
180  ...touching no backtest-artifacts/                        definition A
159  ...touching neither backtest-artifacts/ nor scripts/backtest/   definition B
 21  the gap: commits under scripts/backtest/ only, 180 - 21 = 159
```

**Neither count was wrong. The definition of "study commit" differed**, and
the gap is exactly the Gate 2 implementation commits, which live under
`scripts/backtest/` and touch no artifact. **Definition B is the better one**
- a commit under `scripts/backtest/` is unambiguously study work - and the
anchored paragraph currently states a floor of 140 under a third, weaker
boundary, with its method named. **Correcting it to 159 under definition B is
parked for revision 32** rather than taken in a second amend.

**(9) A COUNT IN CORRECTIVE ENTRY 14 HAS ALREADY ROTTED, exactly as the
eighth class predicts, and entry 14 is not edited.** Entry 14 records "24
study commits examined, 0 touching any `.js` file". **At this anchor the
count is 25**, because revision 31's own commit joined the population. The
figure was true as written and against the anchor it was written at; it is
the *population* that moved, not the invariant.

**The invariant itself holds at every measurement**: 25 study commits in
`c04d6b1..e4774b1`, **0 touching any `.js` file**. Verified under BOTH
filters, which agree exactly with no difference between them:

- by subject, commits whose message begins `docs(backtest)`: **25**
- by path, commits touching `backtest-artifacts/` or `scripts/backtest/`: **25**

**A bare count of a population that grows with the anchor must name the
anchor it was measured at**, or it will be read later as a claim that has
gone false when nothing has.

**(9a) THIS ENTRY BROKE THE APPROVAL-ROW CHECK WHILE BEING WRITTEN, and the
fix is a rule.** The table in item (5) was first drafted with a numeric first
column - `| 1 |`, `| 2 |` - which is **indistinguishable from an approval row
under the pattern every audit in this ledger uses**, `^\| [0-9]+ \|` scoped
after the `## Approval rows` heading. Corrective entries are appended after
that heading, so the check returned **12 approval rows against a true 6**.

Nothing was wrong with the ledger. **The entry documenting a family of
instruments that answer a neighbouring question had made the ledger's own
instrument answer one**, before the entry was even committed.

**The rule: no table in a corrective entry may use a bare integer as its
first column.** This one now reads `| item 1 |`. The approval-row check
returns 6 again, and the six real rows remain at lines 206-211, which is
where they have been since they were written.

**(10) Parked for revision 32**, none urgent and none making the current
bytes false:

1. The `server/` figure restated as **159 under definition B**, dropping the
   140 floor and the two weaker boundaries.
2. **The invariant's filter widened from subject to path.** The two agree
   today and there is no undercount, but a future study commit typed
   `fix(backtest)` would be caught by the path filter and missed by the
   subject one. The check should test what it means.
3. This item (9), recorded in section 10.2 rather than only here.

**(11) Confinement.** One tracked file, 187 lines changed, staged by explicit
path. **No study commit has changed a `.js` file at any point in the arc** -
25 examined at this anchor, 0 violations. Files from an unrelated
roster-feature workstream remained dirty in the working tree throughout and
none was staged.

**(12) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 16 — appended 2026-08-05

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 15. **Entries 1-15 are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `9269EDDA72D90D4006F65AB207297F8D6EDF1E2D03E3AAAE82633530115BFF54` |
| git blob | `0641d0f034eb340368b7b41335249f51b976b2e4` |
| anchor commit | `9a037217348117c82d23cc522706dbbd1750dc6c` |

**(2) Nothing lapsed.** The superseded anchor (`e4774b1…` / `585E992D…`)
accumulated no approvals. Rows 4-6 remain lapsed against their own superseded
bytes, and **three fresh approvals are still required** against the hash in
(1).

**(3) SECTIONS 3-8 ARE UNTOUCHED**, 2,352 lines at revision 31 and at
revision 32, **0 differing** under both the mapping check and the slicing
confirmation. **No ruling and no classification changed.** The confinement
check returns the preamble, section 10 and section 10.2, and nothing else -
predicted before it was run, and matched.

**(4) Three items closed, all inside section 10.2.**

- **The `server/` figure is restated under ONE definition.** Of 182 commits
  touching `server/`, **159** touch neither `backtest-artifacts/` nor
  `scripts/backtest/`. Revision 31 stated a floor of 140 and named two other
  boundaries. **The durable form is the rule, not the number: one
  definition, applied consistently, is better than three offered for
  comparison, which invites a reader to average figures that answer
  different questions.** The 21-commit gap to the artifact-only boundary is
  exactly the Gate 2 implementation commits.
- **The `.js` invariant's filter is widened from commit SUBJECT to PATH.**
  The two agree at every measurement taken, so **this corrects no live
  undercount**; it makes the check test what the claim means. A study commit
  typed `fix(backtest)` is caught by one form and missed by the other, and
  the nineteen Gate 2 implementation commits are all typed that way.
- **A count over that population rots by construction**, recorded in section
  10.2 rather than only here. See (5).

**(5) THE COUNT SERIES, EACH MEASUREMENT WITH THE ANCHOR IT WAS TAKEN AT.**
This is the concrete evidence for the class, and it is stronger than the
class stated abstractly:

| measured at | anchor | study commits | touching `.js` |
| --- | --- | ---: | ---: |
| revision 30 | `eda85eb` | 23 | 0 |
| corrective entry 14 | `7a9b930` | 24 | 0 |
| revision 31 | `e4774b1` | 25 | 0 |
| corrective entry 15 | `ca55b61` | 26 | 0 |
| revision 32 | `9a03721` | 27 | 0 |

**Every one of those was true when taken, and none contradicts another.** The
population grows by exactly one with each study commit, including the commit
that anchors the revision making the claim - so a revision cannot state a
count of this population that survives its own ledger entry. **Entry 14's 24
and entry 15's 25 were both correct against the anchors they named**, and
neither is edited.

**The invariant itself never moved**: the right-hand column is 0 at every
measurement. **N is not a property of the study; it is a property of when you
looked.** Quoting it without its anchor is section 10.2's eighth class.

**(6) A hazard class whose own first draft committed the hazard.** The ninth
class - a range read as an authorship boundary - was first drafted
prescribing **path-scoping** as its remedy, which fails the same way one
level over, since `server/` is live application code touched by 159 commits
that are not this study's. Section 10.2 records that the draft did this,
rather than quietly shipping the corrected version. **A class whose first
draft fired the class is worth more as evidence than any number of clean
examples**, because it demonstrates that the failure survives the attention
of someone actively writing about it.

**(7) THE STOPPING RULE, now in force and recorded in the preamble.**

> The scope document is built when no known-open item would change sections
> 3-8 or a structural claim the document makes about itself. Section 10.2
> refinements that surface after that point ride to a revision **after** the
> review is commissioned.

**Section 10.2 is outside the approval scope.** Its improvements make the
drafter's checks better; they change nothing a reviewer reads, verifies, or
is asked to approve. Letting them gate the commission trades a real cost -
**the review not happening** - against an improvement the reviewer never
sees.

**What makes the rule principled rather than arbitrary is the record.**
Revisions 27 and 29 moved sections 3-8 by 3 and 92 lines, so deferring the
scope document was correct both times: a document written before them would
have described the wrong delta, and two were in fact discarded for exactly
that. **Revisions 30, 31 and 32 moved zero lines there.** That is the
difference between a rebuild and a find-and-replace, and it is the evidence
that the document has converged where a reviewer's obligation lives.

**Revision 32 is therefore the last revision before commissioning.** The only
thing that reopens an anchor first is something touching sections 3-8 or a
self-description a reviewer relies on.

**(8) No bare integer heads a column in this entry's tables**, per the rule
corrective entry 15 adopted after its own item table returned 12 approval
rows against a true 6 under `^\| [0-9]+ \|`. The approval-row check returns
**6**.

**(9) Confinement.** One tracked file, 71 insertions / 14 deletions, staged
by explicit path. **No study commit has changed a `.js` file at any point in
the arc** - 27 examined at `9a03721`, 0 violations, under the path filter
adopted at this revision. Files from an unrelated roster-feature workstream
remained dirty in the working tree throughout and none was staged.

**(10) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 17 — appended 2026-08-05

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 16. **Entries 1-16 are not edited.**

**(1) The anchor has moved again.**

| | |
| --- | --- |
| SHA-256 | `023C4B6A7C680608CC92D5F805E2A5F79A21D7001AB8A397684B866C00D7C230` |
| git blob | `9fe2fb6c17cb6246c3e87b0cc34be8d565a49815` |
| anchor commit | `37b9f7d06d0202fb7dcf4b7f48b620e0d82db9fc` |

**(2) THE ROUND'S OUTCOME: an independent statistical review of sections 3-8
returned NO APPROVAL on eight findings**, across an original report and three
amendments. **The reviewer ran from a clone outside this project directory
and disclosed the path**, which is the bar section 12 of the scope document
states and the first time it has been met. Nothing lapsed: the superseded
anchor (`9a03721…` / `9269EDDA…`) held no approvals, rows 4-6 remain lapsed
against their own bytes, and **three fresh approvals are still required.**

**(3) THIS REVISION MOVES THE APPROVAL SCOPE, and the three before it did
not.** Sections 4.3, 4.6, 6.2, 6.5 and 8.6.4 change - **86 lines inside
1010-3361**. A reviewer must READ them rather than diff them. Eleven sections
claimed unchanged verify at **0 differing**: 3.2, 6.1, 6.1a, 8.6.0, 8.6.1,
8.6.2, 8.6.3, 8.6.5, 8.7, 4.6.1, 4.6.4.

**(4) The two substantive findings.**

**F2 carried the rejection.** Section 8.6.4 cited
`projection.service.js:478-497` for `loadCachedRows`. Measured at the anchor,
that range is `478-480` the tail of `generateProjections`, `484` a constant,
`486-494` **the whole of `findRun`**, and only `496-497` `loadCachedRows` -
and it **excludes the `byPlayer.set` loop at `:506-507` that the frozen
requirement is about.** An implementation reviewer opening it to verify a
duplicate-detection rule finds a function with no `result.rows` iteration at
all. Repaired to `:496-524`.

**F7: the packet omitted five sealed sections its own rulings rest on** -
prereg 3.3, 5.1, 6.2, 7.1, 7.2. Section 4.6.4 rests a frozen classification
rule on *"prereg 6.2 and prereg 16 alone"* with 16 supplied and 6.2 not.
**A reviewer was asked to judge rulings against text they had not been
given.**

**(5) F1 corrected an overstatement, NOT a label, and the distinction
matters.** Section 6.2's closing clause asserted leg 2 was unsatisfied before
revision 29. **It was satisfied.** Leg 2's rationale is object-specific in
its own words, and no scope reading admissible at revision 25 puts `3.80`
outside the list, because section 6.2 is a subsection of section 6 and
section 6's heading names component (f). **What the scope sentence actually
repaired is a completeness declaration that was FALSE read document-wide**,
since section 8.1's seven passing boundaries are frozen thresholds absent
from the table. **Section 6.1's classification label is unchanged and section
0's leg-2 demonstration was correct as written at every revision.**

**(6) F8 split section 10.2, whose heading had been false for eight
growths.** It read "The negative-existence inventory [added at revision 22]"
while holding the confinement check, the locator check and eight further
hazard classes - **31 lines at revision 22, 462 at revision 32.** Section
10.2 keeps the inventory and all ten hazard classes, because they describe
what the instruments MISS; **section 10.2a takes the checks.** Nothing
renumbers.

**The reference audit ran in BOTH directions**: no surviving "section 10.2"
reference points at moved content, and no "10.2a" reference points at content
that stayed. **This is the fourth hazard class applied to the operation that
creates it**, and it was run as a set comparison rather than by reading.

**(7) ONE REFERENCE THE REVIEW'S OWN AUDIT MISCLASSIFIED.** The audit filed
fifteen "section 10.2" references and concluded fourteen needed no change.
**One of the fourteen did.** The stopping rule - *"section 10.2 refinements
that surface after this point ride to a revision after the review is
commissioned"* - names only 10.2, and **the split moved every instrument that
rule was written to govern into 10.2a.** Left alone it would have covered the
inventory and not the checks. Scope extended to both.

**It was found by reading the fifteen lines rather than trusting their
classification**, which is the same method that has produced every finding in
this workstream that a probe did not.

**(8) THE BOUNDARY OBSERVATION, which has no other home.** Findings have now
arrived from outside the assigned boundary **four rounds running**:

| round | finding | came from |
| --- | --- | --- |
| revision 29 | the rule-4 attribution | reading past the assigned scope |
| revision 33 | F7, the packet gap | reading past the packet |
| revision 33 | F1's resolution | testing a demonstration rather than accepting it |
| revision 33 | F8 | a reviewer error the drafting party caught |

**Nothing in this document is aimed at that seam, in either direction.**
Errors inside the boundary get caught by the party on the other side, and
findings arrive from outside it - and in every case the detector was a person
who happened to look, not a check that fired.

**This is the third instance of one geometry.** Section 12 records that the
instruments are complete over the artifact and empty over the reviewer. F7
extends it: empty over the packet. This item extends it again: **empty over
the boundary itself.** A boundary cannot report that it is drawn in the wrong
place, because everything that would show it is on the other side. **What has
worked four times is a second party with a different assignment and
permission to look outside it** - a property of how the work is staffed, not
of anything the document can specify, and recorded here as a limit rather
than as an open item someone later tries to close with a check.

**(9) THE PROVENANCE OF F8, recorded as the reviewer recorded it.** The
evidence is theirs - they reasoned from section 10.2's title and reached a
wrong conclusion about where a check belongs. **The finding is the drafting
party's.** Counting it as the review's would inflate the round's record, and
**a review that counts findings it walked into as findings it made is
measuring the wrong population.**

**(10) Confinement.** One tracked file, 297 insertions / 119 deletions,
staged by explicit path. The confinement check returns the preamble, sections
4.3, 4.6, 6.2, 6.5, 8.6.4, 10, 10.2, 10.2a and 11.3(a), and nothing else -
predicted before it was run and matched. **Label counts reconcile exactly**:
`[substantive prospective amendment]` 14 to 13 and
`[restates prereg 10.1, not amendable here]` 2 to 3, one label moved by F3,
all others unchanged. **No study commit has changed a `.js` file at any point
in the arc**, verified by the path filter at this anchor.

**(11) Gate 0 is unchanged and still in force**, the fourth approval remains
strictly last, single-use, and not self-performable, and no row is pre-filled
for any approval that has not issued.

---

### CORRECTIVE ENTRY 18 — appended 2026-08-06

**This entry creates NO approval row.** It re-points the anchor recorded by
corrective entry 17 and records the outcome of an independent statistical review
that issued no approval. **Entries 1-17 are not edited.**

**(1) The anchor has moved.**

```
from   37b9f7d06d0202fb7dcf4b7f48b620e0d82db9fc   revision 33
       blob 9fe2fb6c17cb6246c3e87b0cc34be8d565a49815
       SHA-256 023C4B6A7C680608CC92D5F805E2A5F79A21D7001AB8A397684B866C00D7C230

to     81289fa0e980f5b71dbf7c660f036cfa253e44ae   revision 34
       blob e339020a3e61bfc32a20a3acd2f1f246f155a8b8
       SHA-256 5EA91A5E23602101E725C5560DAE071BD6A81659AD33E48EC25F64BA6E959F78
```

Revision 33 accumulated **no approvals**, so nothing lapsed.

**(2) An independent statistical review of revision 33 returned NO APPROVAL.**
It ran from a fresh clone at `/tmp/r33-independent-review/Endzone-Empire`,
outside any project directory, with the path disclosed - the second round to meet
the section 12 bar and the first performed by a party with no prior involvement.
Three findings: one SUBSTANTIVE, two MINOR, no BLOCKER. All three were in text
revision 33 did not touch.

**(3) F-A is the finding that carried the rejection, and its provenance is the
part worth recording.** Section 8.7's scope limit read *"section 8.3 is untouched
except for the coordinate removal in rule 5"* while rule 5 PINS rather than
removes. **Revision 22 is the revision that reversed the removal and also wrote
the parenthetical**: it corrected rule 5 to pin, added *"Rule 5 pins rather than
removes, and revision 21's contrary reasoning is withdrawn"*, and left the scope
limit reporting the withdrawn action. The parenthetical then stood unchanged
through revisions 24, 26, 28, 29, 30, 31, 32 and 33.

**It survived two independent reviews and every confinement check, and the reason
is structural: byte-identity detects movement, and this text never moved.** The
revision-32 reviewer examined section 8.7, verified its pinned digests against the
freeze manifest and rule 4's determinacy on all four coordinates, and did not read
the closing scope limit against rule 5's body. A reviewer who diffed rather than
read would have found none of this round's three findings.

**(4) The fifth instance of a remedy producing the hazard it addresses**, after
section 9's block quote, the memory index warning, section 11.2's revision-27 fix,
and the ninth hazard class's path-scoped first draft. **This is the first where
the contradiction was created BY the correction rather than alongside it.**

**(5) The seventh hazard class fired a fourth time.** The preamble read
"revision 31" at revisions 32 and 33, having read "29" at revision 30 and "26"
from revision 26 through 28. **Three of the four occurred after section 10.2
recorded the class**, which establishes that recording a class is not an
instrument aimed at it.

**(6) Section 10.2a now specifies the identifier-consistency check.** It extracts
each artifact's (commit, blob, SHA-256, revision) tuple and compares against `git`
at the named anchor. Two properties are load-bearing: **it must cover artifacts
outside this repository**, because the memory index sat three revisions stale
while every check in the specification returned green; and **it must run before
the anchor commit**, because the preamble's revision number is the one element
`git` cannot supply.

**Validated against its known case before being relied on**, per the same clause
the confinement and packet-coverage checks carry: run against revision 33 it
reports the preamble at 31 against an anchor of 33; run against revision 34 it
matches. A run reporting no mismatch on revision 33's bytes is broken. **On its
first real run it reported all four auxiliary artifacts stale**, which is correct
at the moment of anchoring and is the condition item (8) records.

**(7) What revision 34 changed.** In scope, net **+18** across three sections,
**no ruling changed**: section 8.7 (+12, F-A), section 8.6.5 (+3, F-B, the
`byPlayer.set` locator from `:496` to `:507`), section 8.2 (+3, F-C, "no seventh
bucket" to "no sixth bucket" against a five-member set). Outside scope: the
preamble (+11) and section 10.2a (+32). The confinement check returns exactly
`{preamble, 8.2, 8.6.5, 8.7, 10.2a}` and the heading set is identical at 58.

**Sections 8.2, 8.6.5 and 8.7 were all in revision 33's byte-identical column and
are not in revision 34's.** A reviewer must read them.

**(8) The auxiliary artifacts are stale at the moment of this entry** and are
re-pinned immediately after it: the handoff, the memory index, and the reviewer
scope and commission documents, which are untracked by design and transmitted out
of band.

**(9) Zero of four approvals are in force.** No revision after 18 has ever been
approved. Per the R1-R5 convention a rejection warrants no approval row, and none
was written for this round. Gate 0 is unchanged and still in force.

---

### CORRECTIVE ENTRY 19 — appended 2026-08-06

**This entry records the FIRST APPROVAL TO ISSUE SINCE REVISION 18**, and
creates approval row 7. **Entries 1-18 are not edited.**

**(1) An approval has issued.** An independent statistical review of revision
34, sections 3-8, returned APPROVED against:

```
SHA-256   5EA91A5E23602101E725C5560DAE071BD6A81659AD33E48EC25F64BA6E959F78
git blob  e339020a3e61bfc32a20a3acd2f1f246f155a8b8
anchor    81289fa0e980f5b71dbf7c660f036cfa253e44ae
```

All three identifiers were verified against git before the row was written.
The approver wrote no row and drafted none, per the standing convention;
row 7 was written by the commissioning party at the approver's explicit
direction, after the approval issued.

**(2) The status block near the top of this file is SUPERSEDED, not edited.**
The `PHASE5_EXECUTION_SPEC.md` row there reads **"NO APPROVAL IN FORCE, AND
NOTHING IS AUTHORIZED."** That statement is now false in its first clause and
still true in its second. **One of four approvals is in force**; the two user
attestations and the Gate 2 independent implementation review are not. **Gate 0
is unchanged and remains in force**: no candidate-cell execution, no real-data
access, no sweep generation, no result inspection. Gate 2 implementation work
is still unauthorized, because it requires all three specification approvals
against the same bytes and only one exists.

**(3) The approval's reach is narrower than "sections 3-8 were re-read", and
the approver said so unprompted.** The three repaired sections and the changed
bytes were read directly. The remaining **2,407 carried-over scope lines were
not re-read**; they rest on that reviewer's revision-33 examination plus
verified byte-identity, and on the fact that no tracked source file changed
between the two anchors, which is what carries their 85 locator verifications
forward. This is recorded because a later reader must not mistake row 7 for a
fresh reading of all 2,428 lines.

**(4) The approver was arguably conflicted, proceeded, and mitigated it — and
the exit route this party offered them did not exist.** They had specified
F-A's repair at drafting precision in the prior round. Before reading the
repair, they re-derived what section 8.3 must carry from prereg 11 (which names
no scoring profile), prereg 4.3, and the code chain `homeMean`/`awayMean` ->
`calculateFantasyPoints(row.stats, rules)`, concluding that activation is
profile-contingent and inherits the primary, so rule 5 **pins** a coordinate
rather than removing one. That reaches F-A's conclusion without relying on F-A.

**The commission's offered exit was defective.** It invited them to withdraw
"on section 8.7 specifically," but this ledger's own convention scopes every
approval to sections 3-8 **as an indivisible unit**, so disqualification on one
section is disqualification on the whole. **A commission must not offer an exit
the approval convention forbids**, and this one did.

**(5) Two counts in the anchored bytes are WRONG and are deliberately NOT
corrected here.**

| where | says | measured |
| --- | --- | --- |
| section 8.7, the F-A correction note | stale parenthetical present "revision 22 through revision 33" | present from **revision 19** (`9759a64`) through revision 33 (`37b9f7d`) |
| preamble, status-line provenance | "the FOURTH recorded instance", over a three-member enumeration | **five stale revisions** (27, 28, 30, 32, 33) across **three** carry-forward runs |

Both were found by the approving reviewer, who judged neither worth
withholding on. **Correcting either would change the blob and lapse the
approval recorded above** — which is the mechanism this ledger exists to
enforce, and it operates against corrections this party would like to make just
as it operates against everyone else. **They ride with the next re-anchor made
for a substantive reason.** Until then, row 7's bytes contain two known-wrong
counts, and that is the honest state of the record.

The second is the sharper of the two: the miscount sits inside the passage that
records the status-line hazard class, adjacent to the identifier-consistency
check added at revision 34 to catch stale identifiers. **A passage specifying an
instrument is not itself subject to that instrument** — the check resolves
hashes, and nothing counts the enumeration the prose summarizes.

**(6) Three packet defects, found by the same reviewer reading past the
packet.** Two are corrected; one is a convention this file should state.

- The packet gave the document as **4,567 lines**; it is **4,575**. Corrected
  in both untracked packet documents.
- The packet gave this ledger as **2,111 lines / eighteen entries**, its size
  at branch HEAD, while directing the reviewer to check out the anchor, where
  it is **2,021 lines / seventeen entries**. The revision-33 packet made the
  identical error one commit earlier. **The gap is structural: the corrective
  entry that re-points the ledger to an anchor names that anchor, so it can
  only be committed after it, and no anchor can ever carry its own re-pointing
  entry.** Packets must therefore state the ref alongside any ledger figure.
- The packet listed the commission and scope documents among section 11.3(a)
  contents without noting they are untracked and hand-delivered. They are kept
  out of the repository deliberately: committing drafting-party framing into the
  clone a reviewer is asked to review from would defeat the clone-based
  independence remedy. The commission now says so.

**(7) A stale statement in this file, superseded.** The hashing guidance near
the top states that this repository has `core.autocrlf=true` and **"no
`.gitattributes` covering these artifacts."** A tracked
`backtest-artifacts/.gitattributes` carrying `* text eol=lf` has existed since
2026-08-02 and is present at anchor `81289fa`, so these artifacts ARE
normalized and a working-tree hash coincides with the blob hash. The guidance's
instruction — hash the blob — remains correct and is the safer habit
regardless; only its stated reason is obsolete. Not edited.

**(8) Two probe failures disclosed by the approver, recorded because the
pattern is this project's most persistent.** Their section parser keyed
`### 8.2a` as `8.2` and overwrote it, so the first run reported F-C unrepaired,
which was false. And a line-bounded grep missed the section 8.7 parenthetical
because it wraps across a newline — that first result would have **supported**
this party's provenance claim, and the corrected probe is what refuted it.
Every structural conclusion in that review was then cross-checked by a raw
line-level diff using no section parsing: **3 hunks, 22 added, 4 removed,
2,407 of the scope lines carried over.** The net, +18, agrees with this party's
independent measurement; the span figures differ by one because the two parties
terminate the scope range on different sides of the section 9 heading. **Only
the net is a property of the document**, which section 2b of the scope document
already states.

**(9) One of four approvals is in force.** Row 7 stands against
`5EA91A5E…`. Still required: two user attestations against these same bytes,
and the Gate 2 independent implementation review, which now takes row 8. **Any
change to `PHASE5_EXECUTION_SPEC.md` lapses row 7 automatically.** Gate 0 is
unchanged and still in force.

---

### CORRECTIVE ENTRY 20 — appended 2026-08-06

**This entry creates approval rows 8 and 9**, the two user attestations
against revision 34. **With row 7, three of four approvals are now in force
against the same bytes. Entries 1-19 are not edited.**

**(1) Both attestations issued against the same bytes row 7 authenticates.**

```
SHA-256   5EA91A5E23602101E725C5560DAE071BD6A81659AD33E48EC25F64BA6E959F78
git blob  e339020a3e61bfc32a20a3acd2f1f246f155a8b8
anchor    81289fa0e980f5b71dbf7c660f036cfa253e44ae
```

All three approvals in force therefore attach to one identical hash, which is
the condition the specification requires and which rows 4-6 last satisfied at
revision 18.

**(2) WHAT GATE STATE THIS PRODUCES, stated exactly.** Specification lines
971 and 1008-1010 govern. **Gate 2 IMPLEMENTATION work is now authorized** —
it had been paused since revision 19 and every revision since restated the
pause. **Candidate-cell execution is NOT authorized** and is separately and
additionally gated on the fourth approval, the independent implementation
review of the resulting Gate 2 code, which does not yet exist. **Gate 0 is
unchanged and still in force**: no execution of any candidate cell against any
freeze state, no real-data access including `backtest-data/snapshot/`, no
sweep generation, no result inspection. Row 9 states the same limit in its own
scope text so the constraint survives reading the table alone.

**(3) The approver attested with disclosure, and what was disclosed is
recorded.** Before either row was written, the approver was shown: section
10.3's disclosure that revision 18 was approved carrying an internal
contradiction between sections 6.1 and 6.2 that six subsequent revisions and
the approving round did not catch; the boundary geometry at specification
lines 979-1003, whose fourth row is the instance where BOTH halves sat inside
sections 3-8 and four rounds still missed the contradiction; and **the two
counts in these bytes that are known to be wrong** — section 8.7's "revision
22" against a measured revision 19, and the preamble's "FOURTH recorded
instance" against a measured five stale revisions across three carry-forward
runs. **These attestations are therefore made with knowledge of two defects in
the attested bytes, not in ignorance of them**, which is the deliberate price
of not lapsing row 7. Section 10.3 could not itself carry that disclosure
because the defects postdate it.

**(4) The scope of row 9 was the approver's decision, and they made it.**
Specification line 1003 assigns the remainder attestation's scope to the
approver and names the boundary geometry as what turns on it. The approver
chose the revision-18 precedent: **Gate 2 implementation only, no candidate
execution.** An alternative was offered and declined — attesting to the
provisions while withholding implementation authorization until the B3 re-cut
repairs `POST_B_ALLOWED_PATHS` — so implementation is authorized while the
`backtest-reproduction` workflow is red for a reason specification section 1
already assigns to Gate 4. **That is a known and accepted condition, not an
oversight**, and it is recorded here so no later reader mistakes it for one.

**(5) ENTRY 19'S ROW-8 ASSIGNMENT IS SUPERSEDED, AND THIS IS THE SECOND TIME
THIS LEDGER HAS MADE THIS EXACT MISTAKE.** Entry 19 stated that the Gate 2
implementation review "now takes row 8." It does not: the two user
attestations issued next and took rows 8 and 9. **Entry 19 made that
assignment in the same breath as superseding corrective entry 2's reservation
of row 7 for that same implementation review — it diagnosed the error and
committed it in one paragraph.**

The failure is identical both times: **a row number was assigned by predicting
which approval would issue next, and the prediction is not the drafting
party's to make.** Entry 2's prediction survived from 2026-08-03 to 2026-08-06
before being falsified; entry 19's survived a matter of hours.

**The rule, stated once and generally, superseding both instances: rows are
numbered in the order approvals issue, and NO FUTURE ROW NUMBER IS EVER NAMED
IN ADVANCE.** The Gate 2 implementation review takes whatever number is next
when, and if, it issues. Nothing is reserved for it. The substantive rule both
predictions carried alongside — never pre-fill a row in anticipation — is
unaffected, was honored on all three rows now in force, and is the part that
was always doing the real work.

**(6) What remains.** One approval: the independent implementation review of
the Gate 2 code, which cannot be commissioned until that code exists and is
conformant. The specification's own section 1 records the code as currently
non-conformant by the author's disclosure, and two open defects in
`sweepEvidence.js` were raised by a pre-submission review and remain unfixed
as amendment-class work. **Any change to `PHASE5_EXECUTION_SPEC.md` lapses
rows 7, 8 and 9 together**, since all three attach to one hash.

---

### CORRECTIVE ENTRY 21 — appended 2026-08-07

**This entry records the FOURTH AND FINAL OUTSTANDING APPROVAL and creates
approval row 10.** With rows 7, 8 and 9, **all four approvals are now in
force against the same bytes** — the condition the specification requires
and which has never previously obtained. **Entries 1-20 are not edited.**

**(1) The approval issued.** The independent implementation review of the
Gate 2 code (its sixth round; the same reviewer performed rounds 3 through
6 and authored no repair in the range) returned APPROVAL of implementation
commit `6e9411b8760525ea56182f47a7733a69ad0dd7c2` on branch `integration`,
for conformance to sections 3-8 of revision 34:

```
SHA-256   5EA91A5E23602101E725C5560DAE071BD6A81659AD33E48EC25F64BA6E959F78
git blob  e339020a3e61bfc32a20a3acd2f1f246f155a8b8
anchor    81289fa0e980f5b71dbf7c660f036cfa253e44ae
reviewed  6e9411b8760525ea56182f47a7733a69ad0dd7c2   (implementation commit)
```

All identifiers were verified against git before the row was written. The
approver wrote no row, drafted none, and named no number, closing their
report with "recording it is the commissioning party's" — which is the
explicit direction under which row 10 was written, after the approval
issued. **Row 10 is the number because it was next when the approval
issued**; per entry 20 item (5)'s rule, no number had been named in advance,
and none is named now for anything future.

**(2) WHAT GATE STATE THIS PRODUCES, stated exactly.** All four approvals
attach to one identical hash. **Candidate-cell execution remains NOT
authorized.** Specification section 1's remaining preconditions are
unchanged by this row and are named in the approval itself: Gate 4's B3
re-cut carrying the complete Phase 5 implementation, and Gate 3's
verification of it. **Gate 0 is unchanged and still in force**: no execution
of any candidate cell against any freeze state, no real-data access
including `backtest-data/snapshot/`, no sweep generation, no result
inspection. A reader holding this entry alone must not conclude the study
can run; four approvals are necessary and are now present, and they are
still not sufficient.

**(3) The approval's reach, recorded so row 10 is not over-read.** The
approver bounded it explicitly: the four standing UNCHECKED items (real
`seedFrom` output; section 4.6.2's contrast producers including
`control-naive`; the Semgrep scanner verdict; the 15.2 µs benchmark on
drafting hardware) and the fact that **the `--inputs` producer does not
exist**, so every requirement about how the document's raw records are
generated is verified only as far as the reducer can reach. Two MINOR
findings are open at the reviewed commit — H, `movingBlockBootstrap`'s
accumulator lacking the strict-typeof guard its sibling `bootstrapMean`
received in the same range, and I, a missing-realization diagnostic naming
a missing salt where a player row is missing — neither reachable through
the production entry point, neither changing any status on a document that
passes validation, and both expected by the approver to be closed or
answered rather than silently carried. **Their closure will land in commits
after `6e9411b` and is therefore outside row 10's reviewed bytes**; the B3
re-cut and Gate 3's verification are where the complete implementation,
including any such commits, is examined as a whole.

**(4) The lapse arithmetic, restated over four rows.** Any change to
`PHASE5_EXECUTION_SPEC.md` lapses rows 7, 8, 9 and 10 together, since all
four attach to one hash. The deferral plan already accepts this: SPEC-C
(the veto's season scope, a decision item) and the seven inert
specification findings ride at Gate 4's B3 re-cut, and resolving them will
move the specification bytes. **When that happens, all four approvals lapse
and must be re-issued against the new anchor — a known and accepted cost of
the deferral plan, recorded here so no later reader mistakes the lapse for
an accident.**

**(5) One process defect this round, disclosed by the approver and recorded
with its remedy.** The round-6 packet first reached the reviewer incomplete
— six of eleven files, without the commission — and the reviewer stopped
before reading any code, said so, and received the complete packet on
request. This is the second firing of the packet-assembly class (round 3's
packet promised attachments it did not deliver). **Standing remedy: every
packet delivery now includes a SHA-256 manifest of its files, and the
reviewer verifies receipt against it before starting.** The round-6
manifest was so delivered, and the reviewer's own report records that no
code was read before the commission was in hand.

---

### CORRECTIVE ENTRY 22 — appended 2026-08-07

**This entry corrects two statements in corrective entry 21, found by the
drafting party's own post-append audit the same day. No approval row is
created or altered; row 10 stands as written. Entries 1-21 are not
edited.**

**(1) Entry 21 item (5) overstated the manifest remedy, twice, and the
overstatements are withdrawn.** What that item asserts: a standing remedy
under which "the reviewer verifies receipt against it before starting",
and that "the round-6 manifest was so delivered". The corrections:

- **The manifest did not exist when the round-6 packet was first
  delivered.** It was created FOR the corrective re-delivery, after the
  reviewer had already reported the packet incomplete. The remedy is a
  forward-looking policy plus one corrective re-delivery — not a practice
  the round-6 review ran under from the start, which is what "was so
  delivered" invites a reader to conclude.
- **The reviewer-verification clause states the remedy's DESIGN, not an
  observed behavior.** The round-6 report does not mention the manifest at
  all. What it records — and what item (5)'s final clause accurately rests
  on — is that the reviewer stopped on the incompleteness itself, read no
  code, and proceeded only once the commission was in hand. That clause's
  sourcing is the reviewer's report; the two preceding sentences' sourcing
  is the drafting party's own intent, and the evidentiary weight belongs
  where the sourcing is. A later auditor must not conclude from item (5)
  that manifest verification was an observed, in-force reviewer practice
  during round 6.

**(2) Entry 21 item (3)'s gloss enumerates five of the six bounds** the
approver's reach statement places on row 10. The sixth, omitted there and
restored here: **the modules not read beyond the constants sections 3-8
cite** — `mde.js`, `rosterGeneration.js`, `asOfView.js`, `cohort.js`,
`snapshotClient.js`, `lineupOptimizer.js`. Row 10's own scope cell is
unaffected: it incorporates the approver's reach statement whole rather
than enumerating it, so the omission lived only in the narrative gloss
whose stated purpose was preventing over-reading.

**(3) Provenance of these corrections.** Both were found by the drafting
party's standing post-work audit — an agent commissioned to verify entry
21 against the approval report it records — within hours of the append,
before any delivery of the round-6 response document. The same audit
verified entry 21's substance clean against the report: the append pure,
no future row number named, no widening of the approval's scope, and all
four recorded identifiers resolving against git. These two statements were
the only substantive misses, and the correction is made in the
immediately-next entry, per this ledger's own precedent.

---

### CORRECTIVE ENTRY 23 — appended 2026-08-08

**This entry records the revision 34 -> 35 re-anchor - the B3 re-cut's spec
step - and THE LAPSE OF ALL FOUR APPROVALS (rows 7-10).** It creates no
approval row and pre-fills none. **Entries 1-22 are not edited.**

**(1) The anchor has moved.**

```
from   81289fa0e980f5b71dbf7c660f036cfa253e44ae   revision 34
       blob e339020a3e61bfc32a20a3acd2f1f246f155a8b8
       SHA-256 5EA91A5E23602101E725C5560DAE071BD6A81659AD33E48EC25F64BA6E959F78

to     f87f023f2fb9e5b9cea3884dcf282f908dfabf53   revision 35
       blob 12d51f858a29c5b0c494b8d7d03b061394cb932b
       SHA-256 2272656621E76EE10F5038D29B33E778026906C473ADD7596F9DE8C67C8615F0
```

**(2) ALL FOUR APPROVALS LAPSE.** Rows 7, 8, 9 and 10 each authenticate
SHA-256 `5EA91A5E…` (blob `e339020a…`); those bytes are superseded, so all
four lapse as authorities - the first supersession since revision 18 to lapse
live approvals, and the first ever to lapse an implementation review. **Per
the deferral plan recorded at entry 21 item (4): known, accepted, not an
accident.** Gate 0 is unchanged; zero approvals are in force and nothing is
authorized.

**(3) What revision 35 is.** The B3 re-cut's spec step, resolving the
deferral batch: the six user rulings of 2026-08-08 sealed (D1 SPEC-C
both-season with the veto's own domain arithmetic published at 6.1a/6.4/6.4a;
D2 SPEC-A implemented as section 8.7 rules 6-7 with nine scope ambiguities
pinned; D3 the generation-records checkpoint sealed in section 9, including
the completed-run-resume detail; D4 prereg-4.1 eligibility propagated into
6.3 with the section-5.2 asymmetry stated; D5 the half-PPR outcome-truth
disclosure added to 8.7; D6 the estimand audit trail carried into the
published schema at 8.4/8.5); the producer determinations register
transcribed at its owning sections (items 1-5 and 7-12; item 6 is
WITHDRAWN-CONFORMANT, recorded in section 10's table and NOT re-opened
before any reviewer); the generation-seam wiring obligations sealed as
section 8.6.6 with the two deliberately-unfixed adversarial notes disclosed;
the seven inert findings closed (eight edits); sections 1 and 9 re-stated in
non-rotting form; first-run expectations A, B and D recorded; section 10's
table row practice restored (a 33 -> 34 record, the overtaken
implementation-review row's forward clause, and the 34 -> 35 row); the four
10.2a instruments recorded LANDED with their known-answer validations; and
every `file.js:NNN` locator re-verified against the tree the revision will
freeze with. **The preamble's revision-35 paragraph enumerates the exact
changed-section set; a reviewer must READ those sections, not diff them.**

**(4) The instruments ran BEFORE the anchor, each validated against its
sealed known answer first.** Confinement: self-validation reproduces the
28 -> 29 known set including 8.6.0; against the candidate it returns exactly
the preamble's claimed set, set-equal in both directions, zero violations
(result recorded in the anchor commit's message). Locators: 76 citations, 0
failures - the one genuinely stale locator its first full run found
(`arms.js:882`) is repaired at this revision, and the pinning test now
asserts full cleanliness. Packet-coverage: 36 cited sections, missing set
empty. Identifier-consistency: self-validated on revision 33's known case
(reports the stale "31"); the auxiliary artifacts are stale at the moment of
this entry, per item (9). A standing two-agent QA round (adversarial +
claims-fidelity) also ran on the anchor candidate: zero fabrications; every
confirmed finding was folded in before this anchor; and the one
review-blocking-class adversarial claim (that the confinement known-answer
validation was false) was itself REFUTED against 10.2a's sealed validation
clause, which records the 15-section set the instrument embeds - the
genuine residue, the 28 -> 29 history row's enumeration omitting sections
0 and 1, is disclosed in 10.2a's bar paragraph.

**(5) A correction to entry 18's item (3), recorded here because entries are
never edited.** Entry 18 stated that revision 22 "also wrote the
parenthetical" whose stale content carried F-A. A wrap-safe search - the
phrase wraps as "coordinate / removal" across a line break, which is how
single-line greps missed it - finds the parenthetical at EVERY anchor from
revision 19 (`9759a64`) onward: it entered with section 8.7's CREATION,
alongside rule 5's original removal ("Activation carries NO profile axis at
all", revision 19's own rule 5). Revision 22 reversed the removal and left
the parenthetical standing - that half of entry 18's account is unchanged;
the range's start moves back by three revisions. The spec's 8.7 scope-limit
note carries the corrected dating with the same evidence.

**(6) The re-approval requirements** - stated without hashes and without row
numbers, per corrective entry 2 rule 1 (counts) and entry 20 item (5) (no future row number is ever named in advance); no row is pre-filled:

- an independent statistical review of sections 3-8;
- a user attestation of the S3 deviation (unchanged in substance);
- a user attestation of the remainder;
- an independent implementation review, strictly last, of the COMPLETE
  implementation at the intended freeze-candidate head.

**(7) Sequencing, adopted as proposal (i) and flagged for the reviewer.**
All four rows are appended BEFORE the Gate 4 freeze chain (A' -> M' -> B3)
is cut, so `POST_B_ALLOWED_PATHS` stays output-only and no post-B3 ledger
append is needed. The hold's "that implementation has passed Gate 3" is read
as satisfied by review of the FREEZE-CANDIDATE HEAD - B3's tree differs from
it only by the regenerated MDE artifact and the freeze manifest, both
generated outputs - and revision 35's section 1 states that reading rather
than leaving it silent. If the reviewer rules that the reviewed object must
be B3 itself, the fallback is naming `APPROVAL_LEDGER.md` on the repaired
allowlist, disclosed as such and defensible (the ledger is append-only and
append-purity is auditable by numstat and ordered-subsequence, never
byte-prefix).

**(8) Packet-delivery terms.** Every packet ships with a SHA-256 manifest of
its contents. The round-1/2 reviewer remains recused; their branch is
withheld.

**(9) The auxiliary artifacts are stale at the moment of this entry** and
are re-pinned immediately after it: the handoff and the memory index. The
reviewer scope and commission documents ride with the re-approval
commissioning, untracked by design and transmitted out of band.

### CORRECTIVE ENTRY 24 — appended 2026-08-08

**This entry records a routing event: the revision-35 statistical-review
packet was delivered to a party it is not addressed to, and that party
declined it.** It creates no approval row, pre-fills none, adds no recusal,
and re-addresses nothing. **Entries 1-23 are not edited.**

**(1) What happened.** The revision-35 statistical-review packet (the
commission and scope documents of 2026-08-08, shipped under entry 23 item
(8)'s manifest terms) is addressed to the reviewer who holds row 7 - the
independent statistical review of revision 34. It was delivered out of band
twice, and by the recipient's account both deliveries reached the reviewer
who holds row 10 - the independent implementation review - not the
addressee, and both arrived as transcribed message text rather than files.
The row-10 reviewer declined the commission before reading any reviewed
byte and supplied the declination below for this record. **The row-7
reviewer has not received the commission**; their availability is untested,
and nothing about their standing changes here.

**(2) The declination, verbatim as supplied by the declining reviewer**
(reviewer-authored text transmitted through the commissioning channel -
carried whole because this ledger otherwise holds author-written summaries,
the limitation the specification's section 11.1 discloses):

> The revision-35 statistical-review commission of 2026-08-08 was delivered
> to the reviewer who holds row 10 — the independent implementation review
> of Gate 2, rounds 3-6, appended 2026-08-07 — and not to the reviewer who
> holds row 7, to whom it is addressed. The row-10 reviewer declined it,
> before reading any reviewed byte, on two grounds.
>
> **(1) Misaddressing, verified against this ledger at `608fcc6`.** The
> commission addresses "the reviewer who reviewed revisions 33 and 34 and
> whose approval of revision 34 was recorded 2026-08-06 as ledger row 7."
> Row 7 records the independent statistical review, dated 2026-08-06; row
> 10 records the independent implementation review, dated 2026-08-07.
> Corrective entry 19 items (4), (5) and (8) attribute the F-A
> prescription, the two known-wrong counts, and the two disclosed probe
> failures to the row-7 approver. None of those are the row-10 reviewer's.
> That reviewer has never examined this specification as a statistical
> reviewer, and never saw revision 33.
>
> **(2) A disqualifying independence conflict, distinct from the one the
> commission disclosed.** Corrective entry 23 item (6) enumerates four
> re-approvals, of which the statistical review is first and the
> independent implementation review, strictly last, is fourth; the
> commission's own sections 1 and 3 hold them apart and assign the fourth
> to "a separate reviewer." The row-10 reviewer is that separate reviewer.
> Sealing the rulings and later certifying that the code implements them
> is a self-check, and no disclosure repairs it.
>
> The conflict the commission did pose — authenticating corrections to the
> 8.7 provenance range and the preamble staleness count — is not this
> reviewer's to settle, having specified neither.
>
> **This declination says nothing about the row-7 reviewer**, who has not
> received this commission and whose availability is untested.

**(3) What this changes, and what it does not.** The commission remains
addressed to the row-7 reviewer, unchanged. Entry 23 item (8)'s recusal -
the round-1/2 implementation reviewer, branch withheld - is unchanged, and
**no recusal arises from this declination**: a party declining a seat it
was never commissioned for withdraws from nothing it holds. The row-10
reviewer states the declination was made before reading any reviewed byte
and states continued availability for the independent implementation
review, strictly last, at the intended freeze-candidate head; that seat is
untouched by this entry. The declining reviewer also re-verified the
packet's structural claims from a clone at a disclosed path
(`/home/claude/rev35/repo`, at `608fcc6`) and reports them sound and
delivery-independent: spec blob `12d51f85…` at `f87f023`, SHA-256
`2272656621E76EE1…C8615F0`, identical at HEAD; `608fcc6` touching only
this ledger, append-pure 112/0; ledger 2,467 lines / 22 entries / 10 rows
at the anchor and 2,579 / 23 / 10 at `608fcc6`; the specification 5,413
lines. Whoever takes the seat inherits correct bytes.

**(4) The delivery-mechanism defect, and its repair.** Entry 23 item (8)
requires every packet to ship with a SHA-256 manifest. At both deliveries
the packet arrived as transcribed text, so `sha256sum` on the files as
delivered could not run and the manifest check was unperformable - a dead
check at exactly the step it exists to protect, discovered only because a
recipient tried to run it. The mechanism binds only when packets ship as
byte-exact attached files. **Henceforth packet documents are delivered AS
FILES, and the manifest states that requirement on its face.** This
clarifies item (8)'s operation; no term changes.

**(5) A near-miss, recorded because the record nearly carried a false
fact.** Before this entry was written, the commissioning party's
conversational routing summary - built from a relayed, unattributed
declination - misidentified the declining party as the row-7 reviewer and
proposed recording that reviewer's "withdrawal," which would have entered
a false fact into an unedited ledger and struck a qualified, unasked
reviewer from consideration. The error was corrected by the declining
reviewer before drafting, because the entry was held for the declination's
own text rather than written from the relay. The practice that saved the
record is stated so it survives: **no entry summarizes a party's position
without that party's own words.**

**(6) Packet refresh, forward.** The packet documents state ledger figures
with their refs, per entry 19 item (6)'s convention; this entry changes
those figures at HEAD. Before any further delivery the packet is refreshed
against the ref that includes this entry and its manifest re-cut, with the
as-files delivery requirement stated. The reviewed bytes are untouched and
the addressee is unchanged; whether delivery to that addressee proceeds is
the study owner's call, made on this entry's corrected facts.

### CORRECTIVE ENTRY 25 — appended 2026-08-08

**This entry records a third routing event: the revision-35
statistical-review packet, re-cut under entry 24 item (6), was again
delivered to the reviewer who holds row 10, again as transcribed text,
and this time incomplete - and that reviewer declined it again.** It
creates no approval row, pre-fills none, adds no recusal, and
re-addresses nothing. It also carries, in the declining reviewer's own
words, a disclosure that reviewer placed on the record. **Entries 1-24
are not edited.**

**(1) What happened.** After entry 24 was appended and pushed, the packet
was refreshed against `1c3f9fc` per item (6) of that entry: commission
SHA-256 `3a72ba94…`, scope document SHA-256 `00f15307…`, manifest carrying
both hashes and the as-files delivery requirement on its face. The study
owner ruled that delivery to the row-7 addressee proceeds, and the three
packet files left the drafting side as three distinct byte-exact files,
hashes verified at hand-off. What arrived at the third out-of-band
delivery, by the recipient's account: it reached the reviewer who holds
row 10 - not the addressee - for the third time; it arrived as pasted
text, not files, for the third time; and the set was wrong in a way the
first two deliveries were not - `REVIEWER-COMMISSION-revision-35.md`
twice, `REVIEWER-SCOPE-revision-35.md` not at all. The row-10 reviewer
declined again before reading any reviewed byte, on entry 24's grounds
unchanged, and supplied the declination below. **The row-7 reviewer has
still not received the commission**; their availability remains untested,
and nothing about their standing changes here.

**(2) The declination, verbatim as supplied by the declining reviewer**
(reviewer-authored text transmitted through the commissioning channel,
carried whole per entry 24 item (5)'s rule; line wrapping is this
ledger's, every word the reviewer's):

> Declined again — same grounds, unchanged. Entry 24 carries my
> declination verbatim; no new text is needed. Repository re-checked:
> `origin/integration` still `1c3f9fc`, 24 entries, 2,683 lines, spec
> blob unmoved. Nothing has re-addressed this commission.
>
> **Three delivery defects on this round.**
>
> **1. Misrouted for the third time, after the record was cut to prevent
> exactly this.** The refreshed commission still opens *"This goes to the
> reviewer who reviewed revisions 33 and 34... ledger row 7."* Entry 24
> item (1) records that I hold row 10 and am not that party. You stated
> the remedy yourself: *"recipient verified as the row-7 approver before
> sending."* That verification did not run.
>
> **2. It arrived as pasted text.** Entry 24 item (4) requires byte-exact
> attached files. The commission's own §6, amended at this refresh,
> says: *"If it arrives as pasted text instead, that is a delivery
> defect; request the files before reading further."* The manifest states
> the same on its face and adds *"a hash of transcribed text evidences
> nothing."* Both hashes — `3a72ba94…` and `00f15307…` — remain
> unverifiable for the third consecutive delivery.
>
> This one is worth more than its own bullet. The repair was diagnosed,
> drafted, appended to an unedited ledger, pushed, and written onto the
> manifest's face — and the next delivery violated it. **A requirement
> stated on the artifact cannot enforce itself; whatever performs the
> send has to.** The manifest is a check the recipient runs after the
> failure has already occurred. Until the send step verifies addressee
> and attachment before transmitting, entry 24 item (4) is documentation,
> not a control.
>
> **3. The packet is incomplete, and in a way that would block even the
> right recipient.** The manifest names two files. What arrived is
> `REVIEWER-COMMISSION-revision-35.md` **twice** and
> `REVIEWER-SCOPE-revision-35.md` **not at all**. The commission's own
> reading order is *"this first, then `REVIEWER-SCOPE-revision-35.md`,
> then the specification"*; §7 routes the round's disclosures, the
> silence-filling table, and the twelve cautions into the scope document;
> §2 of that document is what enumerates the twenty-two changed regions.
> Absent it, the addressee has no submission to review. Under the
> standing packet-completeness rule, the correct response is to stop
> before reading code — which is what I am doing, for a different
> reason.
>
> **One disclosure to put on the record before my own seat comes up.** I
> have now read this commission three times. It is a briefing document by
> the definition §12 gives — *"a contaminant this bar does not reach"*
> — and I have absorbed the drafting party's framing of D1 through D6,
> the twelve sealed silence-fillings, and the round's disclosures without
> ever being commissioned to evaluate them. I do not think this
> disqualifies me from the implementation review: that seat tests code
> against the specification's text, which I would read as the reference
> regardless, and the framing I absorbed concerns whether the rulings are
> *sound*, which is not my question. But it is a real exposure, it
> accrued through no choice of mine, and it should sit in the record now
> rather than surface as a discovery when the fourth approval is
> commissioned. Record it or don't — that is yours — but you have it.
>
> Gate 0 unchanged. No reviewed byte read. My seat still waits for its
> turn.

**(3) What this changes, and what it does not.** The commission remains
addressed to the row-7 reviewer, unchanged. No recusal arises - entry 24
item (3)'s reasoning applies unchanged: a party declining a seat it was
never commissioned for withdraws from nothing it holds - and the ledger's
only recusal remains entry 23 item (8)'s (the round-1/2 implementation
reviewer, branch withheld). The row-10 reviewer again states the
declination was made before reading any reviewed byte, and their seat for
the independent implementation review, strictly last, is untouched by the
declination itself.

**The disclosure in the declination's penultimate paragraph is hereby on
the record, in the reviewer's own words**: three reads of the
commission - a briefing document by the commission's own definition; the
words the declination quotes for it sit in the commission's section 2 -
accrued through misdeliveries the reviewer did not choose, with the
drafting party's framing of the rulings absorbed without a commission to
evaluate them, and no reviewed byte read. The reviewer's
own assessment of what it means for their seat is part of the quoted
text. This entry records the fact and assesses nothing; whatever weight
it carries is weighed when the independent implementation review is
commissioned, in that commission's conflict question, which now must
cite this entry.

**(4) The control finding: a requirement stated on the artifact cannot
enforce itself.** Entry 24 item (4) diagnosed the dead manifest check,
sealed the as-files requirement, and wrote it onto the manifest's face -
and the very next delivery violated it, adding a set defect: one listed
file delivered twice, the other absent. The manifest's own line-driven
procedure does catch absence - "do not begin the review until both
match" is unsatisfiable with a listed file missing - but duplication of
a listed file passes every per-file hash comparison, and on this
delivery no recipient-side check of any kind could run, because it again
arrived as text. The declination's diagnosis is
adopted as this ledger's rule: **the manifest is the recipient's check
and runs after the failure; the send step needs its own, run by whatever
performs the send, before transmitting.**

**Henceforth, for every packet delivery**: immediately before the send,
the sending party runs a send-step check that verifies (a) the recipient
is the commission's addressee, confirmed against the addressee
description in the commission's opening - for this packet, the reviewer
who reviewed revisions 33 and 34 and whose approval of revision 34 is
recorded as ledger row 7, and not the reviewer who holds row 10; and
(b) the attachment set is
exactly the manifest's listed files plus the manifest itself - correct
count, all names distinct and matching, every SHA-256 matching the
manifest - staged as files. The check ships beside the packet as a
runnable script, so the sender executes it rather than remembers it. Its
honest limit is disclosed rather than papered over: the script verifies
the STAGED set and records the sender's addressee attestation; no script
on the drafting side can observe what a mail client actually transmits,
so the send-step procedure ends with the sender confirming, in the
outgoing item itself, three attachments bearing the three verified names
before sending. This clarifies the operation of entries 23 item (8) and
24 item (4); no term changes.

**(5) Packet refresh, forward.** The packet documents state ledger
figures with their refs, per entry 19 item (6)'s convention - at
`1c3f9fc` those figures were 2,683 lines, twenty-four corrective entries,
ten approval rows, and this entry changes them at HEAD. Before any
further delivery the packet is refreshed against the ref that includes
this entry, its manifest re-cut, and the send-step check run clean
against the re-staged set. The reviewed bytes are untouched and the addressee is
unchanged; whether a fourth delivery attempt proceeds is the study
owner's call, made on this entry's facts, with the send-step control in
place.

### CORRECTIVE ENTRY 26 — appended 2026-08-09

**This entry records the outcome of the revision-35 statistical-review
round: the packet's fourth delivery attempt succeeded under entry 25's
send-step control, the review returned NO APPROVAL on one substantive
finding, and revision 36 is anchored in response.** It creates no
approval row (a round that issues no approval warrants no row, per the
R1-R5 convention - entry 8 item (2), restated in the specification's
section 10 review history), pre-fills none, adds no recusal, and records the
reviewer-rotation decision the study owner made on the response's
recommendation. **Entries 1-25 are not edited.**

**(1) The delivery that worked.** The fourth attempt was the first to run
entry 25 item (4)'s send-step check: it verified the staged set against
the manifest and the addressee against the commission's opening
immediately before the send, the sending party's attestation was
recorded, and the three files went as byte-exact attachments to the
row-7 addressee - whose identity was verified against their own
revision-34 approval text before sending. On receipt the manifest check
ran and PASSED, the first verified delivery in four rounds; the reviewer
then withdrew their own outstanding delivery flag, in their words below.
The control operated as specified.

**(2) The response, verbatim as supplied by the reviewer** (carried whole
per entry 24 item (5)'s rule; line wrapping is this ledger's, every word
the reviewer's):

> Manifest check **passes** — and my two-versus-three flag was wrong.
> Withdrawing it below. Fixing my sort bug and running confinement.
>
> §5.1 was my probe artifact — their caution 5 called it exactly.
> Confinement verifies set-equal both ways. Running their instruments
> now, and testing whether the self-validations actually discriminate.
>
> Working tree is still at the old anchor — the instrument files don't
> exist there. Checking out f87f023.
>
> `check-locators.js` has **no** `--self-validate` — it errors on the
> flag and runs ungated. Checking what §10.2a claims, and running my own
> sweep rather than relying on it.
>
> Confinement instrument agrees with the scope document exactly, and
> excludes §5.1 — confirming my probe artifact. Now the substantive
> read.
>
> §10.2a says the locator run found `arms.js:882` "genuinely stale" —
> a citation I verified as *correct* at revision 33. That reconciles only
> if the source tree moved. Checking, because if it did, my
> carried-forward locator verifications are void.
>
> The source tree moved 15,588 lines between anchors while spec sections
> stayed byte-identical. Testing whether locators inside *unchanged* spec
> sections went stale — the carry-forward basis doesn't cover that.
>
> Possible live finding in §4.4 — whose sole driver this revision was
> locator re-verification. Reading it.
>
> §4.4 is correctly re-verified — my spot-check used a remembered
> locator, not the r35 text. Correcting course: systematic sweep of every
> citation into the three *moved* source files, across the whole scope.
>
> Two citations resolve to implausible lines — `arms.js:743` → `}`
> and `:891-892` → `endpoint,`, both in §6.1 where siblings *were*
> re-verified. Reading them in context.
>
> Confirmed a live one. Verifying its extent and why the instrument
> passed it.
>
> **NO APPROVAL** — revision 35, §§3–8, blob
> `12d51f858a29c5b0c494b8d7d03b061394cb932b` at `f87f023`. No row written
> or drafted.
>
> **Manifest passes.** Both files hash exactly to the manifest once they
> arrived as attachments. **I withdraw my earlier "two versus three
> files" claim** — it was wrong. "Two" counts the hashed documents,
> "three" counts those plus the manifest, and the pre-send attestation
> says so plainly. I called it too fast.
>
> **G-A, SUBSTANTIVE.** §6.1 line 2110 still reads
> *"`lib/arms.js:891-892` instead computes `roundToTie(…) >
> roundToTie(…)`"*. At this anchor `arms.js:891-892` is `endpoint,` /
> `weekDeltas,`; the comparison is at `:934-935`. `arms.js` grew 1,668
> → 1,757 lines between anchors. Five live sites needed that update —
> four got it, this one didn't — and two brackets in the document
> (spec:2044, spec:5136) tell the reader `:891-892` "had drifted" and was
> re-verified. §6.1's mechanical-correction label rests on the code
> computing the tie-rounded form, and this is the sentence that
> establishes it.
>
> **Why your instrument passed it, which is the more useful half.**
> `check-locators.js` reports 76 citations, 0 failures. Its proximity
> test fires only when a citation is immediately preceded by a
> *backticked identifier*; at 2110 the citation opens the line and the
> preceding span is an expression, so only the in-range test applied —
> 891 ≤ 1757, pass. That's caution 8 from your own list. It also skips
> bare `` `:NNN` `` citations by design, and it has no `--self-validate`
> at all (it errors on the flag and runs ungated), so the commission's
> "each with a known-answer self-validation" and the scope doc's "refuses
> trust until its self-validation passes" aren't true of the fourth one.
>
> **Confinement verifies both ways** — and my first derivation was
> wrong, adding a spurious §5.1. The new §5.2 moves §5.1's terminator;
> your caution 5 is what made me look, and your instrument had it right.
> **A carry-forward gap worth stating:** the source tree moved 15,588
> lines across 43 files, which can stale a locator inside a spec section
> that never changed. I tested it — the other cited files are
> unchanged, and `arms.js:225` and `metrics.js:333` still resolve — so
> no live defect, but byte-identity alone didn't establish that.
>
> **This pass is incomplete and I've said so in the file.** I stopped at
> G-A. Thirteen of the twenty-two changed regions went unread, including
> D1, D2, D5, D6, §8.6.6 and most of the transcribed register. Nothing I
> marked clean covers them.
>
> **Recommendation, repeated harder:** send the next round to a different
> reviewer whatever it contains. I prescribed three repairs at 33,
> authenticated them at 34, prescribed two more, and am now
> authenticating those at 35. No link is disqualifying; the chain is.

**(3) Verification.** Every checkable claim in the response was verified
against the repository before being acted on, and all held. At `f87f023`
the specification's line 2110 cited `lib/arms.js:891-892` for the
tie-rounded comparison while `arms.js` is 1,757 lines there, those two
lines are parameter-list entries, and the cited comparison's sole site
is `:934-935`; revision 35's sweep had updated four sibling citations -
the four `:934-935` occurrences in the anchored bytes - and missed this
one. The locator instrument's 76/0 clean report is explained,
not excused: its proximity tier engages only when a backticked identifier
precedes the citation, and this citation opens its line. The instrument
had NO `--self-validate` and errored on the flag, so the packet's
statements that all four instruments carry a known-answer self-validation
- the commission's instruments paragraph and the scope document's
"refuses trust until its known-answer self-validation passes" - were
FALSE of the fourth instrument as delivered. That is a packet defect,
disclosed here; the next packet states instrument status as of revision
36. The response's `arms.js:743` observation resolved to text the
specification brackets as historical to its issuing - not a second live
defect - exactly as the reviewer's own stopping point implied.

**(4) The response taken.** Revision 36 is anchored at `d52b0be`, spec
blob `0950c6a3a8137a97dd207bddbc421a82a818c0e5`, SHA-256
`D07B92075817B04D9355DD375B9B18243D5DE507CD504D82C70F503B0E45198C`; the
instrument rebuild precedes it at `deacfd8`. It changes NO ruling, and
zero approvals were in force, so nothing lapses. The systematic citation
sweep the review's method forced - sixty-one qualified citations and
about one hundred seventy-five bare occurrences, each resolved against
`f87f023` and judged - found two further stale citations INSIDE sections
3-8 (section 8.7 rule 5's `:305-308`/`:352-354`, a +7 comment shift with
no repaired sibling anywhere, the worst of the three) and one
out-of-scope pair (the preamble/section-0 `:418`/`:289`); all are
repaired at revision 36 with inline brackets. The revision-34 review's
deferred O-3 count was re-verified against every anchor from 26 through
34 and corrected in section 10.2a. The locator instrument now carries the
claim-expression tier, continuation and bare-citation extraction, and a
sealed self-validation replaying this round's own escape in both
directions; its remaining limits are disclosed in its docblock and in
section 10.2a rather than left to be found. Confinement for
`f87f023` -> `d52b0be`: set-equal in both directions, exactly {preamble,
0, 6.1, 8.7, 10, 10.2a}. Locators at the anchor: 79 qualified + 83
attributed bare citations, zero failures. Identifier-consistency: status
revision 36, zero stale identifiers (a replay of that command exits
FAILED on two unresolvable hash-shaped tokens - section 3's worked-example
fixtures, present at every anchor and expected; the status and staleness
checks it exists for are clean). Suite 2183/2180/0/3, measured in the
isolated worktree, where the parked snapshot-manifest test early-returns
on the absent local `backtest-data/`.

**(5) The incomplete pass, on the record.** The reviewer stopped at G-A
and says so: thirteen of revision 35's twenty-two changed regions went
unread, including D1, D2, D5, D6, 8.6.6 and most of the transcribed
register, and nothing marked clean covers them. No one should read this
round as a partial endorsement of revision 35's substance; its one
finding was verified, its coverage was one finding deep. The next review
reads the full scope cold.

**(6) The rotation.** The response recommends the next round go to a
different reviewer whatever it contains, on grounds quoted whole above.
**The study owner ACCEPTED the recommendation 2026-08-09, ruling in the
words of their selection: "Fresh reviewer" - the next independent
statistical commission is addressed to a reviewer with no prior contact
with this study.** No recusal arises or is recorded - the
reviewer's standing is what their own words state, and the ledger's only
recusal remains entry 23 item (8)'s. Entry 25 item (3)'s obligation -
the independent implementation review's commission must cite entry 25's
exposure disclosure in its conflict question - is unchanged by this
entry.

**(7) Packet, forward.** The packet figures rot at this entry, per entry
19 item (6)'s convention - at `0efc1cb` the ledger was 2,844 lines,
twenty-five corrective entries, ten approval rows, and this entry changes
those figures at HEAD. Every packet cut to date is SUPERSEDED and none
may be delivered: the pairs `3973608f…`/`59fd71c3…`,
`188cb5a7…`/`e0cd968d…`, `3a72ba94…`/`00f15307…` and
`a1335572…`/`cd936994…` are all addressed to the row-7 reviewer, against
refs this entry supersedes. The next packet is cut fresh against the ref that includes
this entry, addressed to the new reviewer, states instrument status as of
revision 36, and ships only under the send-step control, whose staleness
gate binds the manifest to the ledger head. Whether and when it is
delivered is the study owner's call.

### CORRECTIVE ENTRY 27 — appended 2026-08-09

**Scope.** This entry records the fresh independent statistical review of
`PHASE5_EXECUTION_SPEC.md` revision 36, the resulting **NO APPROVAL**,
the revision-37 response, and the delivery-set deviation discovered by the
reviewer. Entries 1-26 remain byte-for-byte untouched. The review produced
six SUBSTANTIVE findings and twelve enumerated MINOR findings (M-1 through
M-12). Its opening sentence says "ten MINOR"; its table, cheapest-path
paragraph, and identifiers enumerate twelve. This entry preserves that
sentence verbatim below and uses twelve as the operative count. Per the
commission, a round issuing NO APPROVAL warrants no approval row. Zero of
four approvals are in force, and nothing lapses.

**(1) Receipt, independence, and delivery control.** The reviewer disclosed
a fresh clone at `/home/claude/review-clone-r36/ez`, checkout
`d52b0be7dd93873d208449b4937ca53a87e92c05`, and no prior contact within
that session. They also disclosed that session-level freshness cannot prove
model-level novelty. The review proceeded under the commission's explicit
fresh-environment bar; the study owner retains the interpretation question
if model-level novelty was intended. The reviewer confirmed the commission
and scope hashes, name-to-hash pairing, LF bytes, superseded-pair exclusion,
the `bca7fda` staleness gate, the revision-36 Git blob and SHA-256, the
commit chain, packet counts, all four self-validations, and the full
3,020-line approval scope.

The delivered item contained **four files, not the manifest's exactly three**:
the three packet files plus
`PRESEND-ATTESTATION-20260809T133848Z.txt`. The attestation itself said
"Outgoing item visually confirmed: exactly 3 attachments," which the
delivered item falsified. The reviewer treated this as nonblocking because
the three required files were each present once and hash-correct, but the
control output must not ship inside the set it certifies. The revision-36
packet is therefore SUPERSEDED. Any future send control must keep its
attestation outside the packet outbox and perform the exact-set check after
all packet attachments are staged.

**(2) Reviewer response — reproduced verbatim in full.**

> # Independent statistical review — PHASE5_EXECUTION_SPEC.md revision 36, sections 3–8
>
> **Decision: NO APPROVAL.** Six SUBSTANTIVE findings, ten MINOR.
>
> ---
>
> ## 0. Threshold matters
>
> ### 0a. The commission's opening question
>
> **Confirmed, with one limit I cannot evidence and therefore disclose rather than
> resolve.**
>
> Within this session I have had no prior contact with this study, its documents,
> or the drafting party's conclusions. The session began with the four packet
> files; the container held nothing else; no directory-keyed memory index was
> loaded, because the working directory was never mounted or opened. The clone is
> fresh, at the path disclosed below.
>
> **The limit.** I cannot audit whether the drafting party, or the reviewer seat
> held across revisions 33–35, was occupied by the same assistant model in other
> sessions. I retain nothing across sessions, so "fresh" is true of *this session*
> and is not a claim I can make about *the model*. Ledger entry 26 item (6)
> records the study owner's selection as "Fresh reviewer"; whether a fresh session
> of a possibly-recurring model satisfies that intent is the study owner's ruling,
> not mine to assume away. I proceeded because the bar at commission section 2 is
> explicitly a constraint on *where the review runs*, which I met and can evidence.
> If the owner reads the rotation as requiring model-level novelty, discount this
> round accordingly — that is a decision available to them now, before anything is
> recorded.
>
> ### 0b. Independence bar — path disclosed
>
> ```
> clone      /home/claude/review-clone-r36/ez
> origin     https://github.com/andydarknessb/Endzone-Empire.git
> checkout   d52b0be7dd93873d208449b4937ca53a87e92c05
> ```
>
> Outside the project working directory (which this environment never had). All
> reads and all instrument runs were performed there.
>
> ### 0c. Receipt checks
>
> | check | result |
> | --- | --- |
> | `REVIEWER-COMMISSION-revision-36.md` SHA-256 | `db413f3e890852ba8138605164aa539e00daebb87b8ab3d1e14dca1c03b63797` — **matches** |
> | `REVIEWER-SCOPE-revision-36.md` SHA-256 | `8bee783f6342699e959e5c2ea46f0a49373e6180f1a1859577e72090a849b88c` — **matches** |
> | name↔hash pairing | correct (commission→`db41…`, scope→`8bee…`) |
> | line endings | LF; zero CR bytes in all four files |
> | superseded-pair check | neither file matches any of the four superseded hash pairs |
> | delivered as attached files, not pasted text | satisfied |
> | **SET check** | **deviation — four files received, not three** (see below) |
> | staleness gate (entry 26 item (7)) | **satisfied**: `git ls-remote origin integration` → `bca7fda4aab8e3e7fda2adec68a3bc9aa99725fa`; origin has not moved past `bca7fda` |
>
> **Set deviation, reported because the manifest requires the set be confirmed.**
> The manifest specifies "exactly three files received, each name once." Four
> arrived: the three listed, plus `PRESEND-ATTESTATION-20260809T133848Z.txt`, which
> is not on the manifest and is not hashed by it. The failure mode the set check
> exists for did **not** occur — neither hashed document is duplicated or absent,
> and the manifest is present once. But the attestation's own closing line reads
> "Outgoing item visually confirmed: exactly 3 attachments," which the delivered
> item falsifies. The entry 25 item (4) control verified a three-item staged set
> and a fourth item was then added: the control's output shipped inside the thing
> it certifies. Not blocking; the send-step check should either stage its own
> output or run after it.
>
> Filenames arrived with hyphens stripped (`REVIEWERCOMMISSIONrevision36.md`). That
> is transport normalisation, not a sender defect, and the hash pairing makes the
> name check satisfiable by content.
>
> ### 0d. Byte verification
>
> ```
> $ git cat-file blob d52b0be:backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md | sha256sum
> d07b92075817b04d9355dd375b9b18243d5de507cd504d82c70f503b0e45198c
> $ git rev-parse d52b0be:.../PHASE5_EXECUTION_SPEC.md
> 0950c6a3a8137a97dd207bddbc421a82a818c0e5
> $ git rev-parse bca7fda:.../PHASE5_EXECUTION_SPEC.md
> 0950c6a3a8137a97dd207bddbc421a82a818c0e5      # byte-identical at HEAD, as stated
> $ git check-attr text eol -- .../PHASE5_EXECUTION_SPEC.md
> text: set    eol: lf
> ```
>
> All match commission section 11. Document is 5,493 lines; section 3 opens at
> 1189, section 9 at 4209, so the scope is 1189–4208 = 3,020 lines, as stated.
> Total headings 61.
>
> **Chain from `f87f023`** verified commit-by-commit and matches the commission's
> account exactly, including the disclosure that it is *not* all ledger-only:
> `608fcc6`, `1c3f9fc`, `0efc1cb` touch only `APPROVAL_LEDGER.md`; `deacfd8`
> touches `check-locators.js` and `backtestInstruments.test.js`; `d52b0be` touches
> the specification and a test; `bca7fda` touches only the ledger. Ledger is 2,844
> lines at the anchor and 3,044 at HEAD, ten approval rows at both, corrective
> entries through 25 and 26 respectively. **Every count in the packet's own
> front-matter is accurate.**
>
> ### 0e. Instrument runs — all four self-validations pass
>
> The revision-35 round's false claim (scope section 0b) is repaired and I confirm
> it: `check-locators.js --self-validate` now exists and passes
> (`{"ok":true,"staleReported":true,"repairedPasses":true}`). Live runs reproduce
> the packet's reported results: confinement six regions / zero violations
> (`preamble, 0, 6.1, 8.7, 10, 10.2a`), locators `79 + 83, failureCount 0`, packet
> coverage `missing: []`, identifier consistency `statusRevisions:[36]`,
> `staleRevisions:[]`, exiting FAILED on exactly the two worked-example fixtures at
> spec `:1258–1260`, which are indeed inside section 3. **Every instrument claim in
> the packet checks out.** See finding S-1 for what that does *not* establish.
>
> ---
>
> ## 1. SUBSTANTIVE findings
>
> ### S-1 — §8.7 rule 5, lines 4020–4029: the repaired citation names a call site the claim does not rest on, and the repair's own justification is false
>
> **Specification** (`:4020–4029`):
>
> > `homeAway.effect` derives from `homeMean`/`awayMean`, which are means of
> > `calculateFantasyPoints(row.stats, rules)` (`projectionFeatures.js:197,
> > :312-315, :359-361` **[locators repaired at revision 36: … finding S1 of the
> > revision-36 systematic citation sweep, the worst of the three because no
> > repaired sibling of these ranges existed anywhere]**)
>
> **The code.** `calculateFantasyPoints` has exactly two call sites in that file:
>
> ```
> $ grep -n 'calculateFantasyPoints' server/services/projectionFeatures.js
> 197:    const points = calculateFantasyPoints(row.stats, rules);
> 296:    const points = calculateFantasyPoints(row.stats, rules);
>
> line 197 -> enclosing: 188: function buildPriorGames({
> line 296 -> enclosing: 270: function buildLeagueContext({ rows, rules, defenseGamesByTeam }) {
> line 312 -> enclosing: 270: function buildLeagueContext({...
> line 359 -> enclosing: 270: function buildLeagueContext({...
> ```
>
> `:296`'s `points` accumulates into `bucket.homePoints`/`bucket.awayPoints`
> (`:312–315`) and becomes `homeMean`/`awayMean` (`:359–361`). `:197` is in a
> different function, `buildPriorGames`, and its `points` never reaches them.
>
> **What goes wrong.** The second and third members of the triple were repaired at
> revision 36; the first was never right and was not repaired. A reader auditing
> rule 5's profile-contingency argument follows `:197`, finds text matching the
> quoted expression *verbatim*, and concludes the claim is verified — while the
> call site the argument actually depends on is never cited in rule 5 at all.
>
> **The repair bracket's stated justification is also false.** It claims "no
> repaired sibling of these ranges existed anywhere." The document cites the
> correct `(:197, :296)` pair in three other places, including one twenty lines
> below in the same section:
>
> ```
> $ grep -n ':296' PHASE5_EXECUTION_SPEC.md
> 86:  section 0's `:418`/`:289` -> `:425`/`:296` pair …
> 395:  through it (`:197`, `:296`) **[locators repaired at revision 36 …
> 814:  into feature construction and `:197`/`:296` re-price every historical
> 4231: and `:296`.
> ```
>
> `:4230–4231` names both call sites for the same expression. Rule 5 names one.
>
> **Why the instrument does not catch it.** `check-locators.js` reports
> `failureCount: 0`. `:197` genuinely contains
> `calculateFantasyPoints(row.stats, rules)`, so the identifier-window tier
> matches. This is scope section 10 caution 8 realised exactly: a probe that
> cannot distinguish the right answer from the wrong one did not become evidence by
> returning the expected result. It is also the same defect class as G-A, in one of
> the two in-scope regions revision 36 exists to repair.
>
> The substantive ruling survives — `:296` is a `calculateFantasyPoints` call, so
> `homeMean`/`awayMean` are profile-contingent and activation is a half-PPR
> quantity. Only the citation and its justification are wrong.
>
> **VERIFIED.**
>
> ---
>
> ### S-2 — §6.2, line 2406: "and nothing else" is still false, at a comparison that gates cell status
>
> **Specification** (`:2402–2406`):
>
> > **Every comparison … against a frozen threshold applies `roundToTie` … to BOTH
> > operands before the comparison** … Within component (f), the complete list of
> > such comparisons, and nothing else:
>
> followed by a six-row table, and at `:2418–2422`:
>
> > The declaration "and nothing else" was FALSE as previously written: two
> > component-(f) frozen-threshold comparisons existed in the code and appeared in
> > no row.
>
> **Sealed text** (`PREREGISTRATION.md:886–887`):
>
> > **Evaluability minimum**: at least **8 distinct 2025 season-week clusters** with
> > subgroup rows in both cells, AND at least **30 subgroup rows in total**.
>
> **The code** — a third such comparison, in no row:
>
> ```
> $ awk 'NR>=954&&NR<=958{printf "%d: %s\n",NR,$0}' scripts/backtest/lib/arms.js
> 954:   if (clusters < MIN_F_CLUSTERS || subgroupRows < MIN_F_ROWS) {
> 955:     return {
> 957:       status: 'unevaluable',
> 958:       claimVerdict: 'inconclusive',
> $ awk 'NR==761||NR==762{...}' scripts/backtest/lib/arms.js
> 761: const MIN_F_CLUSTERS = 8;
> 762: const MIN_F_ROWS = 30;
> $ grep -n '^function' scripts/backtest/lib/arms.js | awk -F: '$1>=880 && $1<=1120'
> 890:function componentFEndpoint({
> 1029:function assertVetoRealizationCoverage({
> ```
>
> `:954` is inside `componentFEndpoint` (890–1028), compares two sealed frozen
> thresholds, and is a **GATE** — it returns `status: 'unevaluable'`,
> `claimVerdict: 'inconclusive'`. §6.2's only stated carve-out (`:2465–2478`) is for
> §8.2a status-model comparisons; this is not one.
>
> **What goes wrong.** §6.2 directs two incompatible things about `:954`: the
> unconditional rule says normalise both operands, and the list declared exhaustive
> says it is not one of the comparisons. Unlike the two rows added at revision 35
> (both disclosure-only), this one gates a cell status. The declaration is also
> load-bearing beyond §6.2 — leg 2 of section 0's five-leg test (`:860–864`)
> licenses §6.1's `[mechanical correction, forced by an internal contradiction]`
> and turns on this list's completeness.
>
> No verdict moves (both operands are integer counts; ten-decimal normalisation
> cannot flip an integer comparison), so the repair is additive — one row with its
> inertness shown, exactly as revision 35 did for the `<= alpha` sites.
>
> **VERIFIED.**
>
> ---
>
> ### S-3 — §5.2, lines 2022–2028: the bye leg is labelled "forced" when the producer register this section transcribes left it open, and a third reading is already implemented in the code
>
> **Sealed text** (`PREREGISTRATION.md:354–355`):
>
> > - **Bye players are excluded from point-accuracy scoring and included in
> >   rosters**, so the deployed-policy wrapper's bye handling is exercised.
>
> **Specification** (`:2022–2028`):
>
> > It does NOT propagate the bye exclusion here, because this domain is **forced**
> > the other way by the every-rostered-player-needs-an-observation invariant. …
> > so the two domains differ in exactly one leg, and that leg's direction is
> > **forced** on each side by its own layer's invariant.
>
> **The invariant's own error text** (`permutationControl.js:99–103`) shows what it
> constrains:
>
> > `week ${week} roster player ${playerId} has no observation. It would score ZERO
> > in both the started and the best lineup rather than being absent, which is a
> > measured zero standing in for missing evidence.`
>
> That is a **regret/lineup**-side constraint on domain membership. It says nothing
> about which rows enter the pairwise macro-average. A third reading satisfies both
> it and prereg 4.1 — keep byes in the observation domain and in the shuffle cells,
> skip `onBye` rows when building pairwise rows — and the sweep **already does
> exactly that** in two other evaluators:
>
> ```
> $ grep -n "onBye" scripts/backtest/lib/controlCellEvaluator.js scripts/backtest/lib/armWeekEvaluator.js
> controlCellEvaluator.js:122:  if (member.onBye) continue; // excluded from point-accuracy scoring, prereg 4.1
> armWeekEvaluator.js:118:      if (member.onBye) continue; // excluded from point-accuracy scoring, prereg 4.1
> ```
>
> **The register this section transcribes says the question is open**
> (`inputsPermutationCapture.js:59–63`):
>
> > whether 4.1's exclusion SHOULD propagate into section 5's cells is a spec
> > question of the same family as the component-(f) membership question the QA
> > pass filed (A4), and **it rides with this determination rather than being
> > silently decided by either reading**.
>
> **What goes wrong.** The transcription converts an explicitly open question into a
> forced one. An approver reading "forced" is told there is no choice on the exact
> leg where the departure from prereg 4.1 bites. Prereg 4.1's exclusion is
> unqualified; §5.2 narrows it to "the sweep's own" point-accuracy scoring, and
> pairwise accuracy is a point-accuracy metric and one of prereg 7.3's two
> co-primary endpoints. The section header does carry
> `[substantive prospective amendment]` and the consequence is stated head-on at
> `:2013–2015`, which is why this is SUBSTANTIVE rather than a BLOCKER: what fails
> is the forcing justification, not the disclosure.
>
> **VERIFIED.**
>
> ---
>
> ### S-4 — §4.6, lines 1466–1470 vs 1488–1504: the amendment label sits on the sealed sentence that needed no extension, and the sentence that did is closed to the reviewer
>
> **Sealed text** (`PREREGISTRATION.md:948–952`) — bullet 6, two sentences with
> *different* scopes:
>
> > **Percentile CIs.** The one-sided `1 - alpha/7` upper bound is the
> > `0.9928571429` empirical quantile of the 100,000 bootstrap **deltas**; the lower
> > bound is the `0.0071428571` quantile.  ← delta-scoped
> > Quantiles use the order statistic at index `ceil(q * 100000)` clamped to
> > `[1, 100000]`, a fixed rule with no interpolation.  ← **not** delta-scoped
>
> **Specification**, the gap statement (`:1466–1470`):
>
> > What the sealed text does not supply is the **BOUND** for a non-delta statistic:
> > bullet 6 phrases the percentile rule over bootstrap **deltas** only …
>
> **Specification**, the disposition (`:1488–1504`): item 3 — the *bound*, i.e. the
> delta-scoped sentence — is `**[restates prereg 10.1, not amendable here]**`, and
> item 4 — the *order statistic*, the sentence carrying no delta scope — is
> `**[substantive prospective amendment]**`. Closing at `:1503–1504`:
>
> > **Only item 4 is amended, and only as to its application.** Items 1-3 restate
> > prereg 10.1 and are not open to a reviewer to resolve differently.
>
> **What goes wrong.** The clause quoted at `:1468–1469` as evidence that the sealed
> text supplies no bound for a non-delta statistic **is item 3's content**. The
> document therefore declares a gap at item 3's clause and, twenty-five lines later,
> declares item 3 sealed and closed to the reviewer, while attaching the amendment
> label to item 4, whose sealed sentence is already general. A reviewer relying on
> `:1503–1504` will not review the confidence-level choice for descriptive absolute
> rows — a choice prereg 12.1 ("with CIs") leaves open and which this section's own
> gap statement identifies as unsupplied. This runs in the unsafe direction: it
> removes an item from the approval surface. Impact is bounded because §4.6.4 makes
> descriptive rows verdict-inert.
>
> **VERIFIED.**
>
> ---
>
> ### S-5 — §7, lines 2753–2757: both halves of the stated mechanism are false about the code
>
> **Specification** (`:2753–2757`):
>
> > The frozen cohort (prereg 4.1) is active-class only (`ACT`/`INA`, prereg 3.1);
> > reserve-class rows (`RES`, `RET`, `EXE`, `E01`) are excluded **at roster
> > construction, before any injury-status mapping happens**, so S3's rule (treat
> > reserve-class roster status as `IR`, prereg 4.2) **has no row to apply to**.
>
> **The code:**
>
> ```
> $ awk 'NR>=430&&NR<=445{...}' scripts/backtest/lib/asOfView.js
> 433:   const injuryStatus = resolveInjuryStatus({ policy, injuryIndex, rosterEntry: entry, … });
> 442:     inCohort: isActiveClass(entry) && entry.fantasyPosition !== null,
> 444:       ? `status-class-${entry.statusClass}`
> $ awk 'NR>=357&&NR<=361{...}' scripts/backtest/lib/asOfView.js
> 359:   if (policy === INJURY_POLICIES.S3_RESERVE_AS_IR) {
> 360:     return isReserveClass(rosterEntry) ? 'IR' : null;
> ```
>
> 1. The exclusion happens at **cohort** construction (`inCohort`, `:442`;
>    `status-class-reserve`, `cohort.js:56`), not roster construction. Prereg 3.1/4.1
>    is cohort; prereg 5.1 is roster construction, downstream of it.
> 2. Injury-status mapping runs **first**, not after: `resolveInjuryStatus` is
>    called at `:433`, nine lines before `inCohort` is computed at `:442`.
> 3. Under S3 that call returns `'IR'` for reserve entries (`:359–361`). S3's rule
>    therefore demonstrably **does** have rows to apply to. What makes S3
>    non-estimable is that those rows are then excluded from the cohort and never
>    scored.
>
> **What goes wrong.** The conclusion (S3 structurally non-estimable, no estimate
> published) is unaffected and follows from the cohort filter alone. But §7 is an
> in-scope section whose deviation carries its own user sign-off (`APPROVAL_LEDGER.md`
> row 8), and this sentence is the mechanism that sign-off rests on. A reader
> auditing it against the code finds both particulars false. By the calibration this
> study already set — G-A was a stale citation that changed no ruling and carried
> NO APPROVAL — this is SUBSTANTIVE.
>
> **VERIFIED.**
>
> ---
>
> ### S-6 — §4.6 line 1479 vs §8.7 line 4166: §4.6's frozen definition does not reach the families §8.7 says it governs
>
> ```
> $ grep -n "rules 1-4" PHASE5_EXECUTION_SPEC.md
> 1479:of section 8.7 rules 1-4 - absolute metrics, paired deltas, attribution
> 4166:of **rules 1-4, 6, and 7** is section 4.6's, without exception - for rule
> ```
>
> Those are the document's only two occurrences of the string, and they disagree.
> §4.6's **Frozen definition** (`:1478–1480`) scopes itself to "the descriptive
> families of section 8.7 rules 1-4." §8.7's **Interval method** (`:4164–4166`)
> states that every interval in the families of "rules 1-4, 6, and 7" is §4.6's
> "without exception," and rule 6 (`:4077`) says "**Interval machinery**: section
> 4.6's, unchanged."
>
> **What goes wrong.** §4.6's four numbered items are the only statement of interval
> construction for descriptive families. By §4.6's own scope sentence that
> construction does not reach the two week-window families added at revision 35, so
> rules 6–7 cross-reference a section that excludes them. This is the same shape
> §8.7 records itself as having repaired at revision 22 — "the two sections defined
> each other's scope circularly and disagreed" (`:4173–4174`) — reintroduced from
> the opposite side.
>
> Mitigating, and the reason this is not a BLOCKER: §4.6.1 (`:1541`), §4.6.2
> (`:1580–1588`), §4.6.3 (`:1683–1692`) and §4.6.4 (`:1744–1745`) were each updated
> at revision 35 and name the week-window families explicitly, so intent is
> recoverable. Only the parent scope sentence — and §4.6.2's exhaustiveness sentence
> at `:1654–1657`, which inherits it — was missed.
>
> *Found independently by two of the three readers on this pass, from
> single-token sweeps.*
>
> **VERIFIED.**
>
> ---
>
> ## 2. MINOR findings
>
> | # | location | finding | status |
> | --- | --- | --- | --- |
> | M-1 | §6.2, `:2509–2511` | "appear in none of **the four rows above**" — the table has had **six** data rows since revision 35 added two, said eight lines earlier at `:2417`. Self-referential count that rotted, the hazard §10.2 records. | VERIFIED |
> | M-2 | §6.2, `:2509–2511` and `:2465–2467` | "§8.1's **seven** passing boundaries" enumerates seven but §8.1's passing column carries **eight** distinct values; `+0.025` ((f) f1/f2, `:2819`) is dropped without a stated reason. Argument survives either way. | VERIFIED |
> | M-3 | §7, `:2766` | "recorded EXCLUSIVELY in `APPROVAL_LEDGER.md`, **never in this document**" — the sign-off appears verbatim in this document at `:4508`. §10's preamble disclaims that table as void authority, which is the defensible reading, but §7 tells the reader there is nothing here to distrust. | VERIFIED |
> | M-4 | §6.1a, `:2259–2260` | Inside quotation marks attributed to the seal: "a favorable sign **there is** structurally uninformative"; `PREREGISTRATION.md:918` reads "a favorable sign **is therefore** structurally uninformative". | VERIFIED |
> | M-5 | §6.1a, `:2355` | Quoted as "prereg 9.8's own text": "2024 **cannot** rescue sparse 2025 evidence"; `PREREGISTRATION.md:890` reads "2024 **can never** rescue sparse 2025 evidence." The quoted form matches the *code's* paraphrase (`arms.js:961`), not the seal. | VERIFIED |
> | M-6 | §6.1, `:2058–2070` | The per-week disclosure threshold changes a sealed published count from `0.50` to `0.30`. Stated and justified, but carries **no section-0 class label**, while the adjacent `3.80` bullet is labelled "mechanical rounding correction" — itself not one of section 0's four class names. The only classification of the pair sits at `:5301`, inside §11.2, scoped "REVIEW ROUNDS 1-13 ONLY" and outside the approval range. | VERIFIED |
> | M-7 | §8.1, `:2776–2777` | "each is a sealed margin restated verbatim from **prereg 9.2-9.7**" — the table's last row, (f) `+0.025`, is sealed at prereg **9.8** (`PREREGISTRATION.md:841`), which that range excludes. All other values match. | VERIFIED |
> | M-8 | §8.6.2, `:3650` | `projectionModel.js:754-786` cited for `availabilityFor` "present as a key in EVERY branch"; the function spans `:754–791` and the `activeProbability: 1` branch is at `:790`, outside the cited range. Also, there is no "computed value" branch — the default is exactly `1`. | VERIFIED |
> | M-9 | §8.6.4, `:3810` | `projection.service.js:467` cited for `projections.set(playerId, ...)`; `projections.set(` is at `:465` and `:467` is `projectFromBundle({`. Inside the same call expression, so the substance holds; the pairing is off by two. | VERIFIED |
> | M-10 | §8.5, `:3260–3264` | Register item 10's transcription carries **no** mechanical/substantive classification, while the other five revision-35 register transcriptions in section 8 each carry one. It names and rejects a real alternative ("not a raw best-metric readout"). The label appears to be owed and *mechanical* (prereg 12.3 forecloses the alternative); it is absent, not wrong. | VERIFIED |
> | M-11 | §4.6.2, `:1595` | "`control-naive` IS a contrast (this section says so **above**)" — the only passage asserting it is at `:1642`, forty-seven lines **below**. Revision 35's insertion placed the claim ahead of its ground. | VERIFIED |
> | M-12 | §3.2, `:1280–1283` | "Section 3.4's test 4 … is what would have collided with the 64-character literal had both been executed." Test 4 compares the unsalted path against `model.scoringHash(rules)` (`:1305–1307`); the §3.2 vector test asserts equality of two **literals** (`:1256–1263`). Neither reads the other's operand, so no collision occurs at any stand-in width. | VERIFIED |
>
> ---
>
> ## 3. On the locator instrument — an observation, not a finding against the scope
>
> The packet reports the locator run as "79 qualified + 83 attributed bare
> citations, zero failures." That is accurate. It is also a smaller denominator
> than it reads as:
>
> ```
> qualified                79
> bare citations found    196
> bare attributed          85
> bare reported            83     (2 demoted)
> bare never checked      113     = 57.7% of bare citations
> ```
>
> Two mechanisms remove citations from the reportable surface. Bare citations with
> no reachable qualified antecedent are never attributed and never checked (111).
> And an attributed bare citation that fails **out-of-range** is reclassified as
> unattributed rather than failed (`check-locators.js:326–331`) — so that failure
> class is unreportable by construction for bare citations.
>
> I checked both demotions at this anchor and **both are benign**: each is a
> `:1127` citation whose paragraph shifts from `projection.service.js` (786 lines)
> to §6.5's `projectionModel.js` (1,208 lines) without re-naming the file, exactly
> the misattributed inheritance the demotion exists to absorb. Both sit outside the
> approval scope (`:174`, `:4533`). So no live failure is hidden today, and the
> design choice is defensible.
>
> The point is what finding S-1 demonstrates: `failureCount: 0` was returned over a
> document containing a citation that names the wrong function, because that
> citation's line does contain the quoted expression. The instrument is accurate
> about what it tests. Scope section 10's own caution 8 states the inference
> problem precisely, and the packet's characterisation of the run does not carry the
> denominator that would let a reader apply it. Worth a sentence in §10.2a on the
> next re-anchor; not a finding against sections 3–8.
>
> ---
>
> ## 4. Categories that are clean
>
> Stated explicitly, because silence is not a finding.
>
> - **The G-A repair holds.** `arms.js:934–935` contains exactly the tie-rounded
>   comparison §6.1 attributes to it; the constant is at `:781` as cited. No sibling
>   drift in §6.1/§6.2: all 17 qualified and 24 bare locators in 2041–2771 were
>   opened individually and resolve.
> - **Ruling D1 (§6.1a/6.4/6.4a).** The "code already implemented BOTH seasons"
>   claim is true — `componentFVetoRecords` filters with no season predicate and
>   `assertVetoRealizationCoverage` is season-agnostic, while the *gate* operands are
>   2025-scoped, so the two scopes genuinely differ as the document says. §6.4a's
>   attestation arithmetic closes: `expectedCount = 24 × subgroupPlayerWeekCount`,
>   hard error on any missing or unexpected composite key.
> - **Ruling D6 (§8.4/8.5).** Every claimed fail-closed check exists at **both**
>   layers — producer `inputsAssembly.js:813–821`, `:900–913`; reducer
>   `run-backtest-sweep.js:254–268`, `:504–525`. `sensitivityAudit` is a required
>   document and report key, null on void.
> - **Ruling D2 (§8.7 rules 6–7).** Both carry explicit substantive labels; each pin
>   is disclosed as a pin and defensible against sealed prereg 16 and 10.5. Rule 4's
>   "and nothing else" is profile-scoped, so the half-PPR-only window families sit
>   outside it rather than violating it. Arithmetic checks: weeks 2–17 = 16 clusters;
>   week 18 alone = 1 → `degenerate`; seven endpoints; eight cells.
> - **Ruling D5 (§8.7 rule 4).** Outcome-truth pricing disclosure is factually
>   sound and pinned by test either way.
> - **§8.6.6 — all five "mechanical completion" labels hold.** Each was tested
>   individually. Item 1 is the one that could have failed and does not: weather-off
>   is explicitly sealed at `PREREGISTRATION.md:810–813`.
> - **§8.2 / §8.2a / §8.2b / §8.3 / §8.6.0 / §8.6.1.** Every code claim verified
>   against the reducer, including the untriggered `wide-straddle`-beats-`passed`
>   precedence, the `SALTS[0]` invariance throw, the five Level-1 void causes, and
>   the re-evidenced §8.6.1 invocation.
> - **§3 (salt derivation).** Reclassification to substantive at `:1197–1226` is
>   correct and its reasoning holds; §5.1's `mulberry32` transcription is
>   byte-identical to the code; the 24-salt list matches prereg 8.1 element for
>   element.
> - **§4.6.1's exception-scope note** — the item the packet flagged — is **sound**.
> - **§6.3's asymmetry** is sound against prereg 4.1 and symmetric in its labels;
>   `componentFSubgroupEligible` is one shared predicate used at all four derivation
>   sites and asserts rather than coerces.
> - **The inertness computation reproduces exactly**: closest reachable binomial
>   upper tail `1/128 = 0.0078125` at `n=7`, gap `6.6964e-4`, against `roundToTie`'s
>   `5e-11` half-step. Seven orders of magnitude.
> - **All other arithmetic and counts recomputed**, including the thirteen (e2)
>   inequalities, 34 season-weeks, 816 = 34 × 24, seven §8.6 subsections, five
>   Level-4 statuses, and the 1,437-line §8 extraction.
>
> ---
>
> ## 5. Reach of this read
>
> **Read in full:** specification lines **1189–4208**, all 3,020 lines, across three
> independent readers with non-overlapping assignments (3–5: 1189–2040; 6–7:
> 2041–2771; 8: 2772–4208), each reading contiguously with terminators excluded and
> extraction line counts printed. Every SUBSTANTIVE finding above was then
> re-verified by me directly against the cited source, from the clone, with the
> commands shown.
>
> **Also read** for cross-reference: spec preamble and §0 (78–92, 786–1010), §1,
> §9's opening, §10 (4481–4546), §11.2; `PREREGISTRATION.md` in the sections the
> rulings rest on (3.1, 3.3, 4.1–4.3, 5.1–5.3, 6.1–6.7, 7.1–7.3, 8.1–8.3, 9.1–9.8,
> 10.1–10.6, 11, 12.1–12.3, 16); `APPROVAL_LEDGER.md` corrective entries 23–26 and
> the approval rows.
>
> **Code opened at cited lines:** `arms.js`, `metrics.js`, `permutationControl.js`,
> `inputsPermutationCapture.js`, `outcomes.js`, `controlCellEvaluator.js`,
> `armWeekEvaluator.js`, `sweepPreflight.js`, `projectionModel.js`,
> `projectionFeatures.js`, `projection.service.js`, `asOfView.js`, `cohort.js`,
> `inputsGeneration.js`, `inputsAssembly.js`, `inputsSensitivity.js`,
> `run-backtest-sweep.js`, `run-backtest-inputs.js`, `run-backtest-rosters.js`,
> `sweepReport.js`, `snapshotStore.js`, `scoring.service.js`, `numbers.js`, and the
> named test files.
>
> **Patterns swept:** every `file.js:NNN[-MMM]` and bare `` `:NNN` `` locator in
> 1189–4208, extracted mechanically and each opened; every `prereg N.N` citation in
> scope compared verbatim against the sealed file; all markdown tables; all
> `N-M | count` rows; `void|VOID`; `rules 1-4`; `week-window`; `frozen threshold`;
> and per caution 6, distinctive single tokens rather than phrases throughout — two
> findings (S-1 and S-6) came only from single-token sweeps.
>
> **Not reached.** Sections 0, 1, 2, 9, 10, 10.2a and 11 were read only where an
> in-scope claim depends on them; I did not audit their own citations, and this
> report is silent about them except where noted. I did not execute the test suite,
> so tests are verified to exist with matching names and bodies, not to pass. I did
> not check §8.7's Commit B SHA-256 values against the freeze manifest. I did not
> review the implementation for conformance to the rulings — that is the fourth
> approval, with a separate reviewer.
>
> **Gate 0 held throughout.** No candidate cell executed against any freeze state;
> `backtest-data/snapshot/` and all result artifacts untouched; no sweep output
> generated; no result inspected. The only execution was the four read-only §10.2a
> instruments and arithmetic written from scratch in `node -e`.
>
> ---
>
> ## 6. Decision
>
> **NO APPROVAL.**
>
> Six SUBSTANTIVE findings prevent it: **S-1** (§8.7 rule 5's repaired citation
> names the wrong call site, and the repair's justification is false against the
> document's own three other citations of the correct pair), **S-2** (§6.2's
> completeness declaration is still false at a gate comparison), **S-3** (§5.2
> labels "forced" a leg its own producer register left open, with a third reading
> already implemented in two evaluators), **S-4** (§4.6's amendment label sits on
> the wrong sealed sentence, closing the genuinely open one to review), **S-5**
> (§7's stated mechanism is false about the code in both particulars), and **S-6**
> (§4.6's frozen definition does not reach the families §8.7 says it governs).
>
> No ruling I examined is wrong. Every finding is scaffolding — a citation, a
> completeness declaration, a forcing claim, a label, a scope sentence — which is
> where this document's findings have historically been, and S-1 is the same defect
> class, in the same repair, as the finding that ended the previous round.
>
> Per commission section 4, a round issuing no approval warrants no row, and I have
> not drafted one.
>
> **Cheapest path to approvable bytes**, offered as fact rather than direction: S-2,
> S-6, and all twelve MINOR items are additive or one-line scope repairs. S-1 needs
> `:296` added and the bracket's sibling claim struck. S-3 and S-4 need a label
> changed, not a ruling changed — S-3 restated as a disclosed choice rather than a
> forced one, S-4's amendment moved to the bullet sentence that carries the delta
> scope. Zero of four approvals are in force, so a correcting revision costs one
> re-anchor and one ledger entry and lapses nothing.

**(3) Finding-by-finding disposition.** All six substantive findings and
M-1 through M-12 were independently checked against the cited specification,
sealed preregistration, and implementation. Revision 37 changes no
statistical ruling:

- S-1 cites the operative `projectionFeatures.js:296` call and removes the
  false no-sibling justification.
- S-2 adds the 8-cluster/30-row integer gate to section 6.2's exhaustive
  frozen-threshold table and proves `roundToTie` inert there.
- S-3 states the bye-domain leg as a disclosed substantive choice, not a
  forced consequence, and cites the two existing `onBye` skips.
- S-4 places the substantive-amendment label on the delta-scoped confidence
  bound, leaving the already-general order-statistic rule as a restatement.
- S-5 states the actual sequence: reserve-status mapping occurs first; the
  active-class cohort filter later makes S3 non-estimable.
- S-6 extends section 4.6's parent definition and exhaustive sentence to
  rules 1-4, 6, and 7.
- M-1 through M-12 are corrected at their cited sites. The same-class
  spillovers in sections 4.4 and 8.2a are corrected with them.

**(4) Locator denominator disclosure.** The locator instrument now reports
the bare-citation denominator directly and retains the old names as
backward-compatible aliases. At revision 37 the live result is:
`bareFound=201`, `bareAttributed=88`, `bareReported=86`,
`bareDemoted=2`, `bareUnchecked=115`, with 85 total qualified citations
and zero failures. Section 10.2a records the revision-36 review denominator
(`196`, `85`, `83`, `2`, `113`) separately, so the historical observation
is not rewritten using revision-37 counts.

**(5) Revision-37 anchor and verification.** The specification-only anchor
is commit `72d43ac` (`docs(backtest): anchor PHASE5_EXECUTION_SPEC revision
37`). Its specification blob is
`3e3524626dda7ce5b0e8a4bf50beeaca5b78163a`; SHA-256 is
`8F87852A45A7339BE258408DC2AD62F68FB7569978F16F3BFBA8C05DACD98A57`;
the document is 5,552 lines. The supporting instrument commit is
`66e3a67` (`feat(backtest): expose locator bare-citation denominator`).
The revision-36-to-37 changed-section set is exactly
`["10","10.2a","3.2","4.4","4.6","4.6.2","5.2","6.1",
"6.1a","6.2","7","8.1","8.2a","8.5","8.6.2","8.6.4",
"8.7","preamble"]`. Final confinement reports that exact set with zero
violations; packet coverage reports `missing: []`; identifier consistency
reports `statusRevisions:[37]` and `staleRevisions:[]`. The only
unresolvable identifier tokens are the two declared worked examples.

**(6) Gate and forward state.** Gate 0 remains active. No candidate cell,
frozen snapshot, sweep, report, or result was executed or inspected. No
statistical approval, user attestation, or implementation-conformance
approval may be inferred from this corrective entry. The next statistical
packet must be freshly cut from a ref containing this entry and the
revision-37 anchor, with its manifest bound to that ledger HEAD. Recipient
selection and delivery remain the study owner's call.

### CORRECTIVE ENTRY 28 — appended 2026-08-09

**Scope.** This entry records the same reviewer's independent statistical
review of `PHASE5_EXECUTION_SPEC.md` revision 37, the resulting **NO
APPROVAL**, and the revision-38 corrective response. Entries 1-27 remain
byte-for-byte untouched. The review issued three new SUBSTANTIVE findings
(N-1 through N-3) and seven new MINOR findings (N-4 through N-10), while
confirming that S-1 through S-6 were answered in substance and M-1 through
M-12 were closed. Per the commission, no approval row accompanied this
response. Zero of four approvals are in force, and this correction lapses
nothing.

**Delivery and identity checks.** The reviewer reproduced the packet hashes
`50300e1a08cec18817a36748ec9d75f80596e763b7b18985d28e20b542fa46e8`
and `f19bbf57866a650c07c74a55cdb9d1c6d196bd22672c468bc835cc9b49496db6`;
confirmed the exact clean three-file set, with each name once; confirmed
that no attestation, wizard, or fourth item travelled; and observed
`origin/integration` at
`270dffb1995810dff89eb0c957eb8a2963801fb7`. The same reviewer continued
the revision-36 review in the same disclosed external clone and independently
reproduced the chain, blob, line, heading, ledger, confinement, locator,
coverage, and identifier figures. The reviewer's unchanged inability to
audit whether other drafting sessions used the same assistant model remains
a disclosed owner-level limitation, not an approval.

**Reviewer response, preserved verbatim:**

> # Independent statistical review — PHASE5_EXECUTION_SPEC.md revision 37, sections 3–8
>
> **Decision: NO APPROVAL.** Three new SUBSTANTIVE findings, seven new MINOR.
>
> All six prior SUBSTANTIVE findings are answered in substance and all twelve MINOR
> items are closed. The bar is not met because one closure **inverted a true
> statement into a false one**, one repair's same-class sweep **failed at the
> section its own text cross-references**, and one repair is **incomplete against
> the standard the same section already applies to itself**.
>
> ---
>
> ## 0. Threshold matters
>
> ### 0a. Addressee and independence
>
> I am the reviewer who issued the revision-36 findings, in the same session, with
> that report in context. Prior exposure is expected and is the premise of this
> round.
>
> **The limit I disclosed at revision 36 stands unchanged and unresolved**: I
> cannot audit whether the drafting party, or the revisions 33–35 seat, was
> occupied by the same assistant model in other sessions. Corrective entry 27 does
> not record a ruling on it. That remains the study owner's call.
>
> Work path, disclosed: **`/home/claude/review-clone-r36/ez`** — the same external
> clone used for revision 36, outside any drafting project directory, fetched and
> checked out at `72d43ac`. No directory-keyed memory index is loaded here.
>
> ### 0b. My own revision-36 error, confirmed
>
> The commission and scope document both flag that my revision-36 report's opening
> sentence read "Six SUBSTANTIVE findings, ten MINOR" while its table and closing
> paragraph enumerate twelve. **That is correct and the error is mine.** The
> delivered chat summary said twelve; the file header said ten. Twelve is the
> operative count, the ledger adopted it, and no finding was lost. Noted rather
> than passed over, since a miscount in a findings report is the same defect class
> this review keeps raising against the specification.
>
> ### 0c. Receipt and delivery
>
> | check | result |
> | --- | --- |
> | `REVIEWER-COMMISSION-revision-37.md` | `50300e1a08cec18817a36748ec9d75f80596e763b7b18985d28e20b542fa46e8` — **matches** |
> | `REVIEWER-SCOPE-revision-37.md` | `f19bbf57866a650c07c74a55cdb9d1c6d196bd22672c468bc835cc9b49496db6` — **matches** |
> | SET | **three files, each name once — clean.** The revision-36 defect is fixed; no attestation, wizard, or fourth item travelled |
> | line endings | LF; zero CR bytes |
> | superseded check | neither file matches the revision-36 pair `db413f3e…`/`8bee783f…` |
> | staleness gate | `git ls-remote origin refs/heads/integration` → `270dffb1995810dff89eb0c957eb8a2963801fb7` — **exact** |
>
> The revision-36 packet files remain visible in the shared upload area from the
> prior turn. They were not re-delivered with this packet and are not part of it.
>
> ### 0d. Bytes, chain, counts — all verified
>
> ```
> $ git cat-file blob 72d43ac:.../PHASE5_EXECUTION_SPEC.md | sha256sum
> 8f87852a45a7339be258408dc2ad62f68fb7569978f16f3bfba8c05dacd98a57
> $ git rev-parse 72d43ac:.../PHASE5_EXECUTION_SPEC.md   → 3e3524626dda7ce5b0e8a4bf50beeaca5b78163a
> $ git rev-parse 270dffb:.../PHASE5_EXECUTION_SPEC.md   → 3e3524626dda7ce5b0e8a4bf50beeaca5b78163a
> $ git check-attr text eol -- ...                        → text: set   eol: lf
> ```
>
> Chain `66e3a67` (locator instrument + test) → `72d43ac` (specification only) →
> `270dffb` (ledger only): each commit's touched paths match the commission
> exactly. Document 5,552 lines, 61 headings; section 3 opens at 1212, section 9 at
> 4258, so the scope is 1212–4257 = 3,046 lines. Ledger 3,044 lines at the anchor
> and 3,721 at HEAD, ten approval rows at both, entry 27 present. Diff is 156
> insertions / 97 deletions. **Every count in the packet's front matter is
> accurate.**
>
> ### 0e. Instruments — all four self-validations pass, all live results reproduce
>
> | check | reported | reproduced |
> | --- | --- | --- |
> | confinement | exact 18-region set, zero violations | ✓ identical, set-equal both directions |
> | locators | 85 / 201 / 88 / 86 / 2 / 115 / 0 failures | ✓ identical |
> | packet coverage | `missing: []` | ✓ |
> | identifier | `[37]`, no stale, two declared tokens, nonzero exit | ✓ |
>
> The denominator disclosure at §10.2a is **accurate against the code**:
> `bareUnchecked = bareFound − bareReported`, `failures` is drawn only from
> qualified plus `bareReported`, and the recorded revision-36 figures
> (196/85/83/2/113) reproduce exactly when the instrument is run against the
> revision-36 blob. The section states the counts as anchor-specific rather than as
> frozen expectations, which is the non-rotting form. **This repair is done
> properly and it is the one I would have been least surprised to see fudged.**
>
> ---
>
> ## 1. Disposition of the revision-36 findings
>
> | prior | verdict | note |
> | --- | --- | --- |
> | **S-1** wrong call site, §8.7 rule 5 | **REPAIRED** | `:296` now cited and traced; false sibling claim withdrawn. Sweep of all four `projectionFeatures.js` citations in scope, and of all qualified citations against their enclosing function, is clean. New MINOR **N-5** (garbled bracket). |
> | **S-2** false completeness declaration, §6.2 | **REPAIRED BUT INCOMPLETE** | Seventh row is accurate; the integer-inertness argument is sound. Two decision-bearing sibling comparisons remain absent — **N-3**. |
> | **S-3** choice mislabelled forced, §5.2 | **REPAIRED IN §5.2, SWEEP FAILED** | §5.2's own text is now correct and the choice is submitted for approval. §6.3 still asserts the struck framing — **N-2**. New MINOR **N-4** (wrong-function citation introduced by the repair). |
> | **S-4** amendment label on wrong sentence, §4.6 | **REPAIRED** | Item 3 now carries the label for the delta-scoped bound; item 4 restates the unqualified order-statistic sentence. Checked item-by-item against `PREREGISTRATION.md:948-952`. §4.4 spillover correct. MINORs **N-7**, **N-8**. |
> | **S-5** false mechanism, §7 | **REPAIRED IN THE MECHANISM SENTENCE** | Call order and S3 branch verified; downstream exclusion traced through `cohort.js:266-277` → `rosterGeneration.js`. Identical false location survives eight lines later — **N-6**. |
> | **S-6** interval-method scope | **REPAIRED — CLEAN** | Both scope statements now read "rules 1-4, 6, and 7"; §4.6.1–4.6.4 consistent; **rule 4's "and nothing else" clause is byte-unchanged and still profile-scoped**, which was the risk this edit carried. |
> | **M-1 … M-12** | **ALL CLOSED** | Each recounted or re-derived from current sources, not carried from the packet. M-2's closure is what produced **N-1**. |
>
> ---
>
> ## 2. New SUBSTANTIVE findings
>
> ### N-1 — §6.2, lines 2507–2511 and 2551–2553 (and preamble line 200): the M-2 repair converted a true statement into a false one
>
> **This is a regression introduced by revision 37.**
>
> **Specification, revision 37** (`:2507–2511`):
>
> > Section 8.1's passing boundaries (`+0.10`, `+0.15`, `-0.005`, `-0.01`,
> > `-0.15`, `+0.005`, **`+0.025`**, `0`) are frozen thresholds, and **none appears
> > in the table above**. That is correct and deliberate, not an omission: **they
> > are status-model comparisons, not component-(f) ones, and section 8.2a governs
> > them.**
>
> and (`:2551–2553`):
>
> > Section 8.1's **eight** passing boundaries — … **`+0.025`**, `0` — are frozen
> > thresholds, **are compared in section 8.2a**, and **appear in none of the seven
> > rows above**.
>
> **All three assertions are false of `+0.025`:**
>
> ```
> $ awk 'NR>=2443&&NR<=2449' spec | grep -n '0.025'
> 2444: | `0.025` (`DELTA_F`) | the falsifiability guard, against the median
>       transformed per-week bound (section 6.1a) | **GATE** |
> 2448: | `0.025` (`DELTA_F`, as the sign test's margin) | `boundAgrees` … |
> ```
>
> 1. It **does** appear in the table above — in two of the seven rows.
> 2. It is **not** a status-model comparison. It is component (f)'s own sealed
>    noninferiority margin: `PREREGISTRATION.md:841` — "**Noninferiority margin:
>    delta_F = 0.025 points per week [sealed here].**"; `arms.js:759` —
>    `const DELTA_F = 0.025;`.
> 3. §8.2a does **not** govern it. §8.1 at `:2848–2850`: "**Component (f) has no
>    wide-straddle case**"; the table row at `:2865` reads
>    `| (f) f1, f2 | noninferiority, exact-only | +0.025 | n/a - no wide-straddle case |`.
>
> **Revision 36 was correct here.** Its "seven" excluded `+0.025` precisely because
> it is the one §8.1 boundary that *does* appear in §6.2's table — which is what
> made "none appears in the table above" true. My M-2 said the enumeration "silently
> drops a member" and stated in terms that "the argument survives either way —
> `0.025` being in the table supports the claim rather than defeating it." The
> repair that M-2 called for was **a sentence explaining the exclusion**. Revision
> 37 instead added the member to a list whose predicate is that none of its members
> is in the table.
>
> **What goes wrong.** §6.2 exists to make a completeness declaration checkable, and
> this paragraph tells an implementer which normalization convention governs which
> threshold. Taken at its word, a reader routes `DELTA_F` to §8.2a, whose rule 3
> holds that the pass tests "remain **STRICT** and are deliberately NOT normalized."
> Applying that to `arms.js:985` — `roundToTie(medianWeeklyBound) <=
> roundToTie(DELTA_F)`, which §6.1a calls the sole evaluability gate for component
> (f) — de-normalizes it. On a median transformed bound one ulp from `0.025` that
> flips the endpoint from `unevaluable` to evaluable and, under §8.2, flips the cell
> out of `inconclusive`. The same reading contradicts the table three lines above,
> which classes that comparison a **GATE** requiring `roundToTie` on both operands.
>
> Three copies carry the defect: `:200` (preamble, out of scope), `:2507`, `:2551`.
>
> **VERIFIED.** *Found independently by two readers on this pass.*
>
> ---
>
> ### N-2 — §6.3, lines 2593–2596: the S-3 repair's same-class sweep failed at the section §5.2 points to
>
> **Specification, §5.2 as repaired** (`:2057–2059`):
>
> > Section 6.3's direction is fail-safe for its gate; **this section's direction is
> > chosen, disclosed, and open to approval rather than forced by an invariant**
> > that does not reach the pairwise-row construction.
>
> **Specification, §6.3, untouched at revision 37** (`:2593–2596`):
>
> > **The asymmetry against section 5.2's permutation domain is deliberate and is
> > stated there**: byes are OUT here and IN there, **forced on each side by that
> > layer's own invariant**, and non-macro members are out of both.
>
> ```
> $ git diff d52b0be 72d43ac -- spec | grep -c "byes are OUT"
> 0        # §6.3 was not in the changed-section set
> ```
>
> Both legs of §6.3's sentence are now wrong. The 5.2 leg is exactly what S-3
> struck. The 6.3 leg is also not invariant-forced: §6.3's own heading text at
> `:2569–2571` labels its bye exclusion `[added at revision 35, sealing the A4/D4
> ruling of 2026-08-08 - substantive prospective amendment]` and justifies it at
> `:2578–2580` as a **fail-safe direction choice**.
>
> **What goes wrong.** A reviewer who reaches §6.3 — including one sent there by
> §5.2's own cross-reference — is told the bye leg is not a choice on either side,
> so there is nothing to approve or reject. That closes the question §5.2 now
> submits for approval, and licenses a later implementer to treat §5.2's domain as
> non-amendable. The producer register the ruling was transcribed from
> (`inputsPermutationCapture.js:59-63`) kept the question open in terms.
>
> The commission's decision test, item 4, requires sweeping the defect class across
> sections 3–8. This sweep failed at the nearest possible sibling.
>
> **VERIFIED.**
>
> ---
>
> ### N-3 — §6.2 table, lines 2441–2449: the completeness declaration is still false, at the sign test's own gate comparisons
>
> **Specification** (`:2439`): "Within component (f), the complete list of such
> comparisons, **and nothing else**."
>
> **Sealed text** (`PREREGISTRATION.md:866–868`):
>
> > **Tie/zero handling**: weeks with `S_w` exactly zero (on values rounded to 10
> > decimal places, section 6.6) are DROPPED. Let `n` be the number of remaining
> > weeks and `k = #{w : S_w < 0}`.
>
> **The code** (`arms.js:807–817`):
>
> ```
> 807:   const sign = favorablePositive ? -1 : 1;
> 808:   const effectiveMargin = sign * margin;
> 813:     return { x, shifted: roundToTie(x - effectiveMargin) };
> 815:   const nonTiedPairs = pairs.filter((p) => p.shifted !== 0);
> 817:   const k = nonTiedPairs.filter((p) => p.shifted < 0).length;
> ```
>
> `shifted` folds the frozen margin into the operand, so `:815` and `:817` are the
> tie-drop and sign-count **against `DELTA_F`**, expressed in shifted form. They
> determine `n` and `k`, hence `p`, hence `passes`. Neither appears in any of the
> seven rows. The table's only DELTA_F-as-sign-test-margin row (`:2448`) names
> `boundAgrees` and classes it "disclosure only - **zero production consumers**".
>
> **What goes wrong.** The section's inclusion standard is its own: it admits a flag
> with zero production consumers purely "so the completeness declaration is true."
> By that standard, two comparisons that produce the p-value belong in it. As
> written, a reviewer auditing component (f) against the list, or an implementer
> applying §6.2's "both operands" form to the sign test, has no row telling them
> which convention governs the tie drop — and `roundToTie(D_w) === roundToTie(delta_F)`
> is a different tie set from the sealed `roundToTie(D_w - delta_F) === 0` on
> straddling operands.
>
> **Stated fairly:** the comparison is *literally* against `0`, and the left operand
> is already normalized at `:813`, so the code conforms to §6.2's rule either way
> and nothing miscomputes today. The defect is the completeness declaration, not a
> live error — which is precisely the standing of the two rows revision 35 added and
> the one revision 37 added in response to S-2. The code's own comment at
> `:809–810` cites "Section 4.4 item 1" for this normalization, so the site is
> already understood as spec-governed.
>
> **VERIFIED.**
>
> ---
>
> ## 3. New MINOR findings
>
> | # | location | finding | status |
> | --- | --- | --- | --- |
> | **N-4** | §5.2, `:2041–2042` | The S-3 repair cites two sites for skipping byes "**when constructing pairwise rows**": `controlCellEvaluator.js:122` (correct, inside `pairwiseRowsByPosition`) and `armWeekEvaluator.js:118` — which is inside `intervalRows` (`:114`), a coverage/WIS builder. `armWeekEvaluator` constructs no pairwise rows; it delegates at `:227` to `controlCellEvaluator.pairwiseRowsByPosition`. This is the **S-1 defect class introduced by the S-3 repair**: right expression, wrong function. The substance (byes skipped for point-accuracy) holds at both sites. | VERIFIED |
> | **N-5** | §8.7 rule 5, `:4070–4071` | The repaired bracket reads "revision 36 **repaired** the second and third ranges **read** `:305-308` and `:352-354`" — two finite verbs, no conjunction; revision 37 prefixed "revision 36 repaired" to the revision-36 clause without inserting "which". The available parse asserts the ranges *are* `:305-308`/`:352-354`, contradicting `:312-315, :359-361` on the line above. The rest of the bracket is accurate. | VERIFIED |
> | **N-6** | §7, `:2808` | Eight lines after S-5's repair, the same paragraph still says the report "publishes the exclusion counts **already tracked at roster construction**." The `status-class-reserve` tally is produced only by `cohort.buildCohort` (`cohort.js:56`, `:276`, `:353-367`); `rosterGeneration.js` returns `{season, week, artifact, freezeHash}` and carries no counts, and `rosters.js` has no exclusion accounting. Same false pipeline location S-5 just corrected, left standing in the repaired paragraph. It is a publication obligation, not narration. | VERIFIED |
> | **N-7** | §4.6, `:1533` | "Revision 33 removed item 3's amendment label and **put it on item 4**." At the revision-32 anchor `9a03721`, item 4 **already carried** `[substantive prospective amendment]` and the closing read "Only items **3-4** are amended." Revision 33 removed one label; it moved nothing. Separately, revision 37 **removes item 4's substantive label** (present revisions 32–36) and records that nowhere — the revision-33 note it replaced is deleted without a successor. The relabel is substantively right; its provenance is unrecorded, and it narrows the approval surface. | VERIFIED |
> | **N-8** | §4.6, `:1493–1495` | The prereg 10.1 quotation drops `1 - 0.0071428571 = ` with no ellipsis: quoted as "the `0.9928571429` empirical quantile of the 100,000 bootstrap deltas"; sealed at `PREREGISTRATION.md:948-950` as "the **`1 - 0.0071428571 = 0.9928571429`** empirical quantile…". Inert on the ruling, but item 3's amendment label was just restored **on the strength of this quotation**, so it is the first thing a reviewer will diff. | VERIFIED |
> | **N-9** | §8.2a rule 2, `:2933–2935` | `"the interval spans both margins"` is attributed to prereg 10.6 in quotation marks. Sealed text (`PREREGISTRATION.md:994-995`) reads "spans both the favorable and harmful **margin**" — singular, with the two margins named. Rule 3 twenty lines later quotes the same sentence correctly. | VERIFIED |
> | **N-10** | §6.5, `:2783` | "`generateProjections` validates at `:436-437` before **the loop at `:467`**." The loop is `:464`; `:465` is `projections.set(`; `:467` is `projectFromBundle({`. The ordering claim is true and `:467` is the right locator for the *call*, but not for the loop. Notable because revision 37 corrected the sibling citation in §8.6.4 from `:467` to `:465` (M-9) and did not revisit this one, and because this paragraph's whole subject is locators that were never correct. | VERIFIED |
>
> ---
>
> ## 4. Carry-forward boundary, stated explicitly
>
> **Carried forward** on byte-identity: my revision-36 examination of every in-scope
> region outside the fifteen changed ones. That examination is my own work, the
> bytes are unchanged, and I re-confirmed byte-identity from the diff rather than
> from this packet's account of it.
>
> **Not carried, and re-read in full at revision 37**: `3.2`, `4.4`, `4.6`,
> `4.6.2`, `5.2`, `6.1`, `6.1a`, `6.2`, `7`, `8.1`, `8.2a`, `8.5`, `8.6.2`,
> `8.6.4`, `8.7`, each read contiguously through its next peer-or-higher heading,
> plus the out-of-scope `preamble`, `10`, `10.2a`.
>
> **One prior clean statement does NOT survive, and byte-identity is why it looked
> like it should.** At revision 36 I marked §6.3's asymmetry "sound and symmetric in
> its labels." §6.3's bytes are unchanged, so a byte-identity rule would carry that
> forward. It must not: §6.3's sentence was consistent with §5.2's *then-forced*
> framing and is contradicted by §5.2's *repaired* framing. **A dependency changed
> under an unchanged region.** That is finding N-2, and it is the general lesson of
> this round — the carry-forward test is byte-identity of the region *and* of every
> region its claims rest on.
>
> Prior clean statements re-authenticated locally where the packet flagged a
> dependency change: §3.2 (M-12), §8.2a (spillover), §8.1 (M-7), and the
> descriptive-family dependencies behind §4.6/§8.7 (S-6). All hold.
>
> ---
>
> ## 5. Clean — stated explicitly
>
> - **S-6 is fully clean.** Every interval-method and scope statement in the
>   document now agrees; §4.6.1–4.6.4 carry no stale scope; and rule 4's "and
>   nothing else" clause is byte-unchanged and still profile-scoped. The risk this
>   edit carried — silently widening a closed row set — did not materialise.
> - **All twelve MINOR items are genuinely closed**, each recounted from current
>   sources: §6.2's table has seven data rows; §8.1's passing column has eight
>   distinct values; both sealed quotations (M-4, M-5) are now verbatim including
>   punctuation; `[mechanical correction, forced by an implementation fact]` and
>   `[substantive prospective amendment]` are **exact** members of section 0's
>   closed class set, and `3.80` satisfies all three conditions of its class;
>   `availabilityFor` really does span `:754-791` with `activeProbability: 1` at
>   `:790` and no "computed value" branch; `projections.set(` really is at `:465`;
>   register item 10's `[mechanical completion]` is the **correct** label, not
>   merely a present one (prereg 12.3 forecloses the rejected alternative by name);
>   M-11's pointer now reads "below" and the qualification is 48 lines below.
> - **The §10.2a denominator disclosure is accurate against the code**, and its
>   statement of what a zero-failure result does and does not cover matches the
>   implementation exactly.
> - **The §4.4 and §8.2a spillovers are correct and complete.** §8.2a's only prereg
>   range citation was updated to 9.2-9.8, and the extension is substantively right:
>   prereg 9.8's pass test is also strict (`PREREGISTRATION.md:878`).
> - **Citation sweep across sections 3–8 is otherwise clean.** Every qualified
>   `file.js:NNN` citation in 1212–4257 was resolved to its enclosing function and
>   checked against its claim; the only wrong-function instance is N-4. Every
>   self-referential count in scope was recounted and is correct.
> - **All prior D-rulings, §8.6.6's five mechanical labels, and §§8.2/8.2b/8.3/
>   8.6.0/8.6.1 remain clean** on byte-identity plus dependency check.
>
> ---
>
> ## 6. Reach of this read
>
> Read at revision 37: all fifteen changed in-scope regions in full, contiguously,
> extraction counts printed; the three changed out-of-scope regions; and the
> complete `d52b0be..72d43ac` diff line by line. Sealed text re-established at
> `PREREGISTRATION.md` sections 4.1, 4.2, 4.3, 5.1–5.3, 6.2, 6.6, 6.7, 7.2, 7.3,
> 9.1–9.8, 10.1, 10.4, 10.6, 11, 12.1–12.3, 16. Ledger read at `270dffb`, entry 27.
>
> Code opened at cited lines: `arms.js`, `metrics.js`, `permutationControl.js`,
> `inputsPermutationCapture.js`, `controlCellEvaluator.js`, `armWeekEvaluator.js`,
> `projectionFeatures.js`, `projectionModel.js`, `projection.service.js`,
> `asOfView.js`, `cohort.js`, `rosterGeneration.js`, `rosters.js`,
> `run-backtest-sweep.js`, `check-locators.js`, and the named test files.
>
> Same-class sweeps completed: wrong-function citations (all qualified citations in
> scope); completeness declarations (every component-(f) comparison enumerated from
> the implementation, not the table); forced-vs-chosen language (single-token sweep
> of `forced|forces|force|compel|invariant` across 1212–4257, 22 hits triaged);
> pipeline-ordering claims (eleven with locators, each traced); stale
> self-referential counts; non-verbatim sealed quotations; directional pointers (77
> resolved); classification labels (every bracket in scope mapped to section 0's
> closed set).
>
> **Gate 0 held.** No candidate execution, no `backtest-data/snapshot/` or result
> access, no sweep or report generation. Only the four read-only instruments and
> arithmetic written from scratch.
>
> ---
>
> ## 7. Decision
>
> **NO APPROVAL** on **N-1**, **N-2**, and **N-3**.
>
> Revision 37 is a substantial improvement and its repairs are, with the exceptions
> above, done correctly and honestly — including the one I expected to be softened
> (the §10.2a denominator, which is disclosed against the drafting party's own
> interest and is accurate). Every prior finding was engaged rather than deflected.
>
> What prevents approval is that the round reproduced, in miniature, the three
> failure modes it was answering. **N-1** is a count repair that inverted the
> statement it was correcting — the same class as M-1/M-2 themselves. **N-2** is a
> sweep that stopped at the cited instance, which is the failure S-1 and S-3 both
> described. **N-3** is a completeness declaration still short of the standard the
> section applies to itself, which is S-2 unfinished.
>
> Per commission section 5, a round issuing no approval warrants no row, and I have
> not drafted one.
>
> **Cheapest path.** N-1 is a two-sentence revert-plus-explanation: restore the
> seven-member enumeration and state why `+0.025` is excluded (it is component (f)'s
> own margin, it is in the table, and §8.2a does not reach it), in all three copies.
> N-2 is one sentence in §6.3. N-3 is one additive table row with its inertness
> shown, exactly as the three prior additions were done. All seven MINORs are
> single-line edits. Zero of four approvals are in force, so a correcting revision
> costs one re-anchor and one ledger entry and lapses nothing.
>
> **One item for the study owner, outside my scope but material.** Ledger row 8 —
> the S3 sign-off — records the *pre-repair* mechanism, stating that reserve rows
> are excluded at roster construction before any injury-status mapping. §7 now
> repudiates that description as false. The sign-off's recorded rationale and the
> specification it authorises no longer agree.

**Disposition of N-1 through N-10.** Each finding was checked against the
revision-37 bytes, sealed preregistration, cited implementation, and relevant
history before correction:

1. **N-1 — corrected.** Section 6.2 and the preamble again enumerate only
   the seven status-model boundaries absent from the component-(f) table.
   Each copy now explains that `+0.025` is excluded because it is component
   (f)'s own sealed margin, appears in the table, and is not governed by
   section 8.2a.
2. **N-2 — corrected.** Section 6.3 now identifies both bye-domain directions
   as disclosed substantive choices: the section 6.3 exclusion is fail-safe
   for its gate, while section 5.2's inclusion remains open to approval.
3. **N-3 — corrected.** Section 6.2's exhaustive table now has an eighth row
   for `exactSignTest`'s shifted-zero tie-drop and sign-count comparisons at
   `arms.js:813`, `:815`, and `:817`, including their conformity and current
   computational inertness.
4. **N-4 — corrected.** Section 5.2 distinguishes pairwise-row construction
   at `controlCellEvaluator.js:122`, interval-row construction at
   `armWeekEvaluator.js:118`, and pairwise delegation at
   `armWeekEvaluator.js:227`.
5. **N-5 — corrected.** Section 8.7's revision-36 bracket now has a grammatical
   and unambiguous account of the repaired second and third ranges.
6. **N-6 — corrected.** Section 7 locates `status-class-reserve` and its
   published exclusion accounting in `cohort.js:56`, `:276`, and `:353-367`,
   after roster construction and injury-status mapping.
7. **N-7 — corrected.** Section 4.6 now records that revision 32 already
   labelled items 3 and 4, revision 33 removed only item 3's label, and
   revision 37 restored item 3 while removing item 4's label to match the
   delta-scoped ruling.
8. **N-8 — corrected.** The section 4.6 preregistration quotation restores
   `1 - 0.0071428571 = 0.9928571429` verbatim.
9. **N-9 — corrected.** Section 8.2a now quotes the sealed phrase `both the
   favorable and harmful margin` exactly.
10. **N-10 — corrected.** Section 6.5 identifies the projection loop at
    `projection.service.js:464` and the `projectFromBundle` call beginning
    at `:467`.

**Owner item: historical row 8.** Row 8 remains historical, lapsed, and
unedited. Its S3 rationale describes the pre-repair mechanism — reserve rows
excluded at roster construction before injury-status mapping — and therefore
does not describe current section 7. It supplies no current approval
authority. Any future S3 user attestation must bind the then-current approved
bytes and use the corrected mechanism: roster construction first,
injury-status mapping second, and cohort exclusion/counting afterward.

**Revision-38 anchor and verification.** The specification-only anchor is
commit `d65bc1086227c76f3a0991cd31c577f2b2c9e96d`
(`docs(backtest): anchor PHASE5_EXECUTION_SPEC revision 38`). Its
specification blob is `44fae65bce063e9eff2912e0827b868061bf7a15`;
SHA-256 is
`DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43`;
the document is 5,601 lines with 61 headings. The revision-37-to-38
changed-section set is exactly
`["10","4.6","5.2","6.2","6.3","6.5","7","8.2a","8.7","preamble"]`
with zero confinement violations. Packet coverage reports `missing: []`.
Identifier consistency reports `statusRevisions:[38]`,
`staleRevisions:[]`, and only the two declared worked-example tokens.

The locator instrument reports `total=89`, `bareFound=208`,
`bareAttributed=94`, `bareReported=92`, `bareDemoted=2`,
`bareUnchecked=116`, `rangeOnly=153`, `claimExpression=18`,
`identifierWindow=10`, and zero failures. All four instrument
self-validations pass. The focused backtest-instrument suite passes 18 of 18.
The full server suite passes 2,181, fails 0, and skips 3 of 2,184 tests
(`node --test server/test/*.test.js`; 568.2 seconds).

**Gate and forward state.** Gate 0 remains active. No candidate cell, frozen
snapshot, Docker sweep, report generation, or result inspection occurred.
No statistical approval, user attestation, or implementation-conformance
approval may be inferred from this corrective entry. The next statistical
packet must be freshly cut from a ref containing this entry and the
revision-38 anchor, with its manifest bound to that ledger HEAD. Recipient
selection and delivery remain the study owner's call.

### CORRECTIVE ENTRY 29 — appended 2026-08-09

**Scope.** This append-only entry corrects one factual ordering sentence in
corrective entry 28's owner item. Entries 1-28 remain byte-for-byte
untouched. No specification byte, ruling, classification, finding
disposition, test result, or approval state changes.

**Correction.** Entry 28 says that a future S3 attestation must use "roster
construction first, injury-status mapping second, and cohort
exclusion/counting afterward." That sequence is **false and is withdrawn**.
The current mechanism established by section 7 is:

1. reserve-class source rows receive injury-status mapping first
   (`asOfView.js:359-361`, `:433`);
2. the later cohort flag excludes them and cohort construction records the
   exclusion (`asOfView.js:442-444`; `cohort.js:56`, `:276`,
   `:353-367`); and
3. excluded rows never reach downstream roster construction or scoring.

The historical row-8 rationale remains lapsed and supplies no current
approval authority. Any future S3 user attestation must bind the
then-current approved bytes and describe the corrected
mapping-first, cohort-exclusion-and-counting-second, downstream-roster-last
mechanism.

**Unchanged state.** Revision 38 remains anchored at
`d65bc1086227c76f3a0991cd31c577f2b2c9e96d`, specification blob
`44fae65bce063e9eff2912e0827b868061bf7a15`, SHA-256
`DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43`.
Zero approvals are in force. Gate 0 remains active, and no candidate,
frozen-data, Docker-sweep, report, or result operation occurred.

**Forward packet.** Any revision-38 statistical packet must be cut against a
ledger HEAD containing this corrective entry. Entry 28 remains the verbatim
record of the revision-37 reviewer response and its N-1 through N-10
dispositions; this entry is the controlling correction for the owner-item
mechanism order.

### CORRECTIVE ENTRY 30 — appended 2026-08-09

**This entry records the independent statistical APPROVAL of revision 38**
and creates approval row 11. Entries 1-29 and rows 1-10 remain
byte-for-byte untouched. The specification is not edited.

**(1) The approval issued and the exact tuple was verified.** The reviewer
approved:

```
scope      revision 38, sections 3-8
SHA-256   DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43
git blob  44fae65bce063e9eff2912e0827b868061bf7a15
anchor    d65bc1086227c76f3a0991cd31c577f2b2c9e96d
```

The blob is identical at the anchor and at the delivery ledger HEAD
`3817d6871787b3292ddd03aa890bc374009351e3`. The approver did not draft
a row and closed with: "This decision is returned to the commissioning
party to record." That is the explicit direction under which row 11 is
written after approval issued.

**(2) Delivery and review response.** The reviewer reproduced commission
SHA-256
`8fb405baf11475c9a2d258662d59cc63cb46e2d980b400cccde6ce6d8f12c2b3`,
scope SHA-256
`12e0a8d259090fa2983ce0c60b159062a1afc700415391710df4d579131728dd`,
the exact three-file set, LF bytes, immutable specification tuple, chain,
counts, all four instrument results, and remote staleness gate. The
response is preserved verbatim:

> # Independent statistical review — PHASE5_EXECUTION_SPEC.md revision 38, sections 3–8
>
> **Decision: APPROVAL.** Zero BLOCKER, zero SUBSTANTIVE, four MINOR findings —
> each inert on every ruling, verdict, and evaluability decision.
>
> All three revision-37 SUBSTANTIVE findings are repaired. Six of the seven MINOR
> findings are closed; the seventh is substantially closed with a residual
> imprecision recorded below. The four MINOR findings I raise do not prevent
> approval under the severity scheme this commission sets and that I have applied
> in each prior round.
>
> ---
>
> ## 0. Threshold matters
>
> ### 0a. Addressee, independence, path
>
> I am the reviewer who issued the revision-36 and revision-37 findings, same
> session, both reports in context. Prior exposure is the premise of this round.
>
> **The limit disclosed at revisions 36 and 37 stands and is unresolved**: I
> cannot audit whether the drafting party, or the revisions 33–35 seat, was
> occupied by the same assistant model in other sessions. No ledger entry records a
> ruling on it. **It bears more weight now than it did in the prior two rounds,
> because an approval is issuing.** It remains the study owner's call, and it is
> the one thing about this review I cannot evidence myself.
>
> Work path, disclosed: **`/home/claude/review-clone-r36/ez`** — the same external
> clone used for revisions 36 and 37, outside any drafting project directory,
> fetched and checked out at `d65bc10`. No directory-keyed memory index loads here.
>
> ### 0b. Receipt and delivery — clean
>
> | check | result |
> | --- | --- |
> | `REVIEWER-COMMISSION-revision-38.md` | `8fb405baf11475c9a2d258662d59cc63cb46e2d980b400cccde6ce6d8f12c2b3` — **matches** |
> | `REVIEWER-SCOPE-revision-38.md` | `12e0a8d259090fa2983ce0c60b159062a1afc700415391710df4d579131728dd` — **matches** |
> | SET | **exactly three files, each name once — clean** |
> | line endings | LF; zero CR bytes |
> | superseded | neither matches the revision-37 pair |
> | staleness gate | `git ls-remote origin refs/heads/integration` → `3817d6871787b3292ddd03aa890bc374009351e3` — **exact** |
>
> One methodological note against myself: my first set-check globbed `*38*` and
> returned four files, because the revision-36 attestation's filename contains the
> timestamp `133848Z`. That was a probe that could not distinguish the right answer
> from the wrong one — caution 9's own failure mode, committed by the reviewer who
> raised it. Re-checked by arrival time: exactly three files arrived in this
> delivery at 20:15:25; the attestation is the turn-1 artefact, byte-identical and
> untouched since 13:41:42. **Delivery is clean.**
>
> ### 0c. Bytes, chain, counts — all verified
>
> ```
> $ git cat-file blob d65bc10:.../PHASE5_EXECUTION_SPEC.md | sha256sum
> dc1e1c413a6cdfcb9072393720020179c0ffd4e483137117b66dc0f25281ae43
> $ git rev-parse d65bc10:.../PHASE5_EXECUTION_SPEC.md   → 44fae65bce063e9eff2912e0827b868061bf7a15
> $ git rev-parse 3817d68:.../PHASE5_EXECUTION_SPEC.md   → 44fae65bce063e9eff2912e0827b868061bf7a15
> $ git check-attr text eol -- ...                        → text: set   eol: lf
> ```
>
> Chain `d65bc10` (specification only) → `3e4fe54` (ledger, entry 28) → `3817d68`
> (ledger, entry 29): touched paths match the commission exactly. Document 5,601
> lines, 61 headings; section 3 opens at 1233, section 9 at 4306, so scope =
> 1233–4305 = 3,073 lines. Ledger 3,721 at the anchor, 4,250 at HEAD, ten approval
> rows at both, entry 29 present. Diff 90 insertions / 41 deletions. **Every count
> in the packet's front matter is accurate.**
>
> ### 0d. Instruments — all four self-validate, all live results reproduce
>
> | check | reported | reproduced |
> | --- | --- | --- |
> | confinement | exact 10-region set, zero violations | ✓ identical, set-equal both directions |
> | locators | 89 / 208 / 94 / 92 / 2 / 116; basis 153 / 18 / 10; 0 failures | ✓ identical |
> | packet coverage | `missing: []` | ✓ |
> | identifier | `[38]`, no stale, two declared tokens, nonzero exit | ✓ |
>
> ---
>
> ## 1. Disposition of the revision-37 findings
>
> ### N-1 — §6.2 boundary enumeration — **REPAIRED**
>
> Both in-scope copies (`:2546–2552`, `:2592–2596`) and the preamble copy (`:217`)
> now read "**Seven** of section 8.1's eight passing boundaries … are status-model
> thresholds; none appears in the eight-row component-(f) table above, and section
> 8.2a governs them. The eighth, `+0.025`, is excluded from that sentence because
> it is component (f)'s own sealed noninferiority margin, appears in the table, and
> has no wide-straddle case; section 8.2a does not govern it."
>
> Recounted independently: §8.1's passing column carries exactly eight distinct
> values; seven trace to prereg 9.2–9.7 as status-model boundaries reduced under
> §8.2a rules 3 and 5; `+0.025` is `delta_F`, sealed at `PREREGISTRATION.md:841`,
> implemented at `arms.js:759`, exact-only with no wide-straddle case (`:2912`).
> The row count was also correctly bumped from "seven rows" to "eight rows" to
> absorb the N-3 addition — the rotting-count hazard was caught this time.
>
> **All three predicates now hold.** VERIFIED.
>
> ### N-2 — §6.3 / §5.2 bye cross-reference — **REPAIRED**
>
> §6.3 (`:2636–2640`) now reads: "byes are OUT here by the substantive A4/D4
> fail-safe choice and IN there by section 5.2's separately disclosed substantive
> choice; **neither direction is forced by an invariant that reaches both
> statistics**." That agrees with §5.2 (`:2085–2087`), and §6.3's
> self-characterisation matches its own block label (`:2613–2615`, "substantive
> prospective amendment") and body (`:2622–2624`, "in the fail-safe direction").
>
> Single-token sweep of `forced|forces|force|compel|invariant|requires|must` across
> 1233–4305, plus a bye-token sweep: **no remaining sentence withdraws either bye
> choice from approval.** VERIFIED.
>
> ### N-3 — §6.2 completeness declaration — **REPAIRED**
>
> An eighth row names the tie drop and sign count, and the conformity bullet at
> `:2523–2531` shows the margin is folded into the operand before both comparisons.
>
> I re-enumerated every comparison in component (f) from the implementation myself
> rather than from the table — `exactSignTest` (795–877), `componentFEndpoint`
> (890–1028), `assertVetoRealizationCoverage` (1029–1082), `evaluateCatastrophicVeto`
> (1084–1097), `componentF` (1120–1163). Every comparison against a frozen or
> sealed threshold maps to a row, and every row maps to code:
>
> | code | threshold | row |
> | --- | --- | --- |
> | `:1086` | `CATASTROPHIC_CAP` 0.20 | 1 |
> | `:985` | `DELTA_F` 0.025 | 2 |
> | `:935` | 3.80 | 3 |
> | `:926` | `FALSIFIABILITY_FLOOR` 0.30 | 4 |
> | `:834`, `:858` | `alpha/7` | 5 |
> | `:865` | `DELTA_F` as sign-test margin | 6 |
> | `:954` | `MIN_F_CLUSTERS` 8, `MIN_F_ROWS` 30 | 7 |
> | `:815`, `:817` | `0` after shift by signed `DELTA_F` | **8 (new)** |
>
> Everything else in those spans is a structural, cardinality, parity, sort or type
> guard — `:818` (`n === 0`, cardinality of the empty non-tied set), `:833`, `:848`,
> `:968`, `:983`, `:1066`, `:1092–1093`, `:1137–1138`. I considered `:818` and
> rejected it: `0` there is a set size, not a frozen threshold, and nothing in the
> sealed text supplies it. Recording that judgment so it is auditable.
>
> The tie set remains the sealed one — `PREREGISTRATION.md:865–868` shifts first
> (`S_w = D_w - 0.025`) then drops exact zeros on ten-decimal values, and
> `arms.js:813` rounds the difference, not the operands separately. No
> `roundToTie(D_w)` vs `roundToTie(delta_F)` form exists anywhere in the path.
>
> **The eight-row table is complete.** VERIFIED.
>
> ### N-4 … N-10
>
> | id | verdict | check |
> | --- | --- | --- |
> | **N-4** | CLOSED | `controlCellEvaluator.js:122` is inside `pairwiseRowsByPosition` (`:117–137`); `armWeekEvaluator.js:118` is inside `intervalRows` (`:114–140`); `:227` is the pairwise delegation. §5.2 now distinguishes all three. |
> | **N-5** | CLOSED | Grammar repaired to one subordinate + one main clause. Every historical claim in the bracket verified at the revision-32, -36 and -37 anchors: the ranges did read `:305-308`/`:352-354`; the shift is exactly +7; `:197` is in `buildPriorGames`; section 9 already carried `:296`. |
> | **N-6** | CLOSED | `cohort.js:56` is the closed exclusion reason, `:276` the tally, `:353–367` the returned `counts.excluded` map. `rosterGeneration.js` and `rosters.js` carry no exclusion accounting, consistent with the corrected location. |
> | **N-7** | CLOSED | Checked at the anchors, not from the narrative. Revision 32 (`9a03721`): both items 3 and 4 labelled, closing "Only items 3-4 are amended." Revision 36: item 3 relabelled, item 4's label intact. Revision 37: item 3 restored, item 4's removed, provenance recording only the first half. Revision 38's account matches all three and now records the removal. |
> | **N-8** | CLOSED | `1 - 0.0071428571 = 0.9928571429` restored; quotation byte-identical to `PREREGISTRATION.md:948–950` modulo the sealed file's line wrap. |
> | **N-9** | **SUBSTANTIALLY CLOSED** | The paraphrase is gone and the operative words are now verbatim. One residual imprecision — finding **F-1** below. |
> | **N-10** | CLOSED | `projection.service.js:464` is `for (const playerId of playerIds) {`; `:467` is `projectFromBundle({`. §6.5 now cites both correctly. |
>
> ---
>
> ## 2. MINOR findings
>
> None of these can change a verdict, a cell status, an evaluability decision, or a
> reader's understanding of any ruling. Each is a single-line edit.
>
> ### F-1 — §8.2a rule 2, line 2981: the prereg 10.6 quotation is closer but still not exact
>
> **Specification**: `…what keeps "the interval spans both the favorable and
> harmful margin" (prereg 10.6) commensurate with the test it qualifies.`
>
> **Sealed** (`PREREGISTRATION.md:994–995`): "If **a component's** interval spans
> both the favorable and harmful margin, the claim is INCONCLUSIVE."
>
> The operative words are now verbatim — the revision-37 paraphrase "spans both
> margins" is gone, which was N-9's substance. What remains is the subject:
> `a component's interval` is rendered as `the interval` inside quotation marks,
> with no bracket or ellipsis. Rule 3 twenty lines later quotes the same clause
> with its subject intact. The packet's claim that the quotation "now reads …
> exactly" is therefore slightly overstated. Inert. **VERIFIED.**
>
> ### F-2 — §8.7, line 4036: "Four sealed sections" heads five bullets
>
> **Specification**: "**The gap this fills.** Four sealed sections each state a
> piece of this and none states the whole:" — followed by bullets for **prereg 4.3**,
> **12.1**, **12.2**, **10.6**, and **16**. Five.
>
> All five are load-bearing: 4.3 supplies the inheritance default rules 1–3 and 5
> use; 16 supplies rule 4's grant. A reviewer auditing the resolution rules against
> the sealed text is told to find four contributors and must guess which listed
> section is not one. Stale since at least revision 32; the ten prior findings did
> not reach it. Same class as M-1. **VERIFIED** (`grep -c '^- \*\*Prereg'` over the
> block → 5).
>
> ### F-3 — §8.6.4, line 3905: the same loop cited at a different line than §6.5 now cites
>
> **Specification**: "scan each arm's own raw input `playerIds` array for repeated
> ids BEFORE `generateProjections`'s **per-player loop** (`projection.service.js:465`,
> `projections.set(playerId, ...)`) runs."
>
> The parenthetical's line and expression agree with each other — `:465` is
> `projections.set(`. But the construct named is the loop, whose header is `:464`,
> which is exactly the line §6.5 now cites after the N-10 repair. The document
> cites one loop at two lines in two sections. Cross-section consistency is this
> document's stated weakest axis, and this pair was created by two of my own
> findings pulling in opposite directions (M-9 asked for `:465` for the *call*;
> N-10 asked for `:464` for the *loop*). **VERIFIED.**
>
> ### F-4 — §8.6.5, line 3932: "eleven lines short of the loop" is ten
>
> **Specification**: "`:496` is the function signature, **eleven lines short of the
> loop**".
>
> `projection.service.js:496` is `async function loadCachedRows(…)`; the loop is
> `:506`; `byPlayer.set` is `:507`. 506 − 496 = **ten**. Eleven is the distance to
> `:507`. The same loop-versus-first-body-statement conflation as F-3, in the
> passage that narrates the repair of that very locator family. **VERIFIED.**
>
> ---
>
> ## 3. Recorded, deliberately NOT raised as findings
>
> Stated so the boundary of this review is visible rather than implied.
>
> - **§6.2's `0` and the eighth row.** The boundary sentence says the seven
>   status-model boundaries — which include `0` — "appear in none of the eight rows
>   above", and revision 38's new row 8 begins with `` `0` ``. I checked whether
>   this is the `+0.025` collision repeating. **It is not.** §8.1's `0` is the
>   zero-margin passing boundary for components (b), (c), (d), from prereg
>   9.3/9.4/9.5, consumed by §8.2a's interval reducer. Row 8's `0` is the tie-drop
>   origin for component (f)'s exact sign test, from prereg 9.8's tie/zero rule,
>   and its threshold cell is explicitly qualified as "`0` after shifting by the
>   signed `0.025` margin". Different components, different provenance, different
>   operands. The sentence is **true**, and believing it leads a reader to nothing
>   false. A token-level scan of the threshold column does return a hit, so one
>   qualifier would make the claim checkable mechanically as well as by reading —
>   worth doing at some later re-anchor, not a defect now.
> - **`the harmful margin` at §8.1 `:2872`.** Attributed to prereg 10.6; the exact
>   string "the harmful margin" does not occur, but the term "harmful margin" does
>   (`PREREGISTRATION.md:995`). This is term-quoting, which is legitimate, and the
>   substantive claim — that the sealed text never defines a harmful boundary — is
>   correct. Not a finding.
> - **`A4/D4` versus `D4`.** §6.3 names the 2026-08-08 ruling "A4/D4"; §5.2 and the
>   history table name it "D4". Both resolve to the same ruling. Cosmetic.
> - **Three sealed quotations lowercase a sentence-initial capital** where the
>   clause is grammatically integrated, and several truncate at a clause boundary
>   with a terminal period rather than an ellipsis. Standard practice; every
>   elision removing interior material *is* marked. Not findings.
>
> ---
>
> ## 4. Carry-forward boundary and its basis
>
> **Read anew at revision 38, contiguously through the next peer-or-higher
> heading**: the eight changed in-scope regions — `4.6`, `5.2`, `6.2`, `6.3`,
> `6.5`, `7`, `8.2a`, `8.7` — plus the out-of-scope `preamble` and `10`, plus the
> complete `72d43ac..d65bc10` diff line by line. Confinement confirms this set is
> exact in both directions, not a subset.
>
> **Carried forward** to the byte-identical remainder of sections 3–8: my
> revision-36 cold read of all 3,020 in-scope lines and my revision-37 re-read of
> all fifteen regions changed there. That is my own work, and byte-identity was
> confirmed from the diff rather than from the packet's account of it.
>
> **Dependency re-authentication, per the rule my own N-2 established.** Byte
> identity is not sufficient. The regions whose claims rest on changed text:
>
> - **§6.1 depends on §6.2's table.** §6.1 `:2227` cites "the third row of the
>   table immediately following it". Row 8 was appended at the end, so row 3 is
>   still `3.80` and §6.1's classification survives on exactly the leg-5 terms
>   §6.2 `:2488–2490` records. **Holds.**
> - **§6.3 ↔ §5.2** — the dependency that failed last round. Both changed and now
>   agree. **Holds.**
> - **§8.1 ↔ §6.2's boundary paragraph** — §8.1 unchanged; §6.2's reference to it
>   is now correct in all three copies. **Holds.**
> - **§4.6 items 1–4** — labels unchanged from revision 37, which I verified
>   correct against `PREREGISTRATION.md:948–952`; only the quotation and provenance
>   changed. **Holds.**
> - **§8.7 rule 5** — bracket grammar only; the profile-contingency ruling and the
>   `:296` citation are unchanged. **Holds.**
> - **§7** — mechanism unchanged from revision 37's repair; only the counts
>   location was corrected. Conclusion unchanged. **Holds.**
>
> **Stated plainly:** the unchanged regions rest on my revision-36 and revision-37
> reads plus this dependency check, not on a fresh line-by-line re-read at revision
> 38. Across the three rounds I have read every line of sections 3–8 at least once
> and every changed line at its own revision. That is the basis on which the
> all-or-none approval issues.
>
> **Gate 0 held.** No candidate execution, no `backtest-data/snapshot/` or result
> access, no sweep, report or Docker execution. Only the four read-only instruments
> and arithmetic written from scratch.
>
> ---
>
> ## 5. Clean — stated explicitly
>
> - All six revision-36 SUBSTANTIVE findings: repaired and re-confirmed.
> - All twelve revision-36 MINOR findings: closed and re-confirmed.
> - All three revision-37 SUBSTANTIVE findings: repaired, each verified against the
>   sealed text and the implementation rather than against its own description.
> - §6.2's completeness declaration: **genuinely complete**, verified by enumerating
>   component (f) from the implementation, not from the table.
> - The force-family sweep across sections 3–8: clean.
> - Rulings D1, D2, D4, D5, D6; §8.6.6's five mechanical-completion labels;
>   §§8.2, 8.2b, 8.3, 8.4, 8.5, 8.6.0, 8.6.1; salt derivation; §4.6.1's
>   exception-scope note; §6.3's asymmetry; §7's deviation and its conclusion; all
>   stated inertness computations and counts: clean, on byte-identity plus the
>   dependency check above.
> - The ledger's own correction at entry 29 restores the mechanism order §7 states
>   — injury-status mapping first, cohort exclusion and counting second, downstream
>   roster construction and scoring last — and §7 matches that order.
>
> ---
>
> ## 6. Decision
>
> **APPROVAL.**
>
> > **revision 38, sections 3-8; exact git blob
> > `44fae65bce063e9eff2912e0827b868061bf7a15` at commit
> > `d65bc1086227c76f3a0991cd31c577f2b2c9e96d`**
>
> SHA-256 `DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43`.
>
> Per commission section 5 I have **not** drafted or appended a ledger row. This
> decision is returned to the commissioning party to record.
>
> **Why approval and not another round.** The severity scheme has three tiers so
> that MINOR means what it says. I have applied it consistently: in each prior
> round I withheld approval naming only the SUBSTANTIVE findings, and the minors
> rode along. Four cosmetic imprecisions — one quoted article, one "four" that
> should be "five", two loop-line citations off by one — do not reach that bar, and
> withholding on them would make the standard unfalsifiable. Nothing I found at
> this revision can change a verdict, a cell status, an evaluability decision, or
> the meaning of any ruling.
>
> **Two things the study owner should weigh before recording it.**
>
> 1. **This approval lapses on any byte change, including a change that fixes F-1
>    through F-4.** Fixing them costs one re-anchor and a re-issued approval against
>    the new blob. The choice between recording this approval now and fixing first
>    is the owner's; I would not object to either, and I will re-authenticate a
>    fix-only revision cheaply, since the four edits are single lines and the
>    dependency surface is empty.
> 2. **The independence limit is unresolved and now matters more.** Whether a fresh
>    session of a possibly-recurring model satisfies entry 26 item (6)'s "fresh
>    reviewer" is a question no clone answers and no instrument in this repository
>    tests. Three rounds of findings do not settle it. If the owner reads the
>    rotation as requiring model-level novelty, this approval should be discounted
>    accordingly — and that is a decision available now, before it is recorded,
>    which is strictly cheaper than after.

**(3) Reach and independence limitation.** The approval's reach is exactly
the approver's stated carry-forward basis: revision 38's eight changed
in-scope regions were read anew; the byte-identical remainder carries from
that same reviewer's revision-36 and revision-37 reads; changed
dependencies were separately re-authenticated. The reviewer disclosed that
they cannot audit whether drafting or revisions 33-35 used the same
assistant model in other sessions. That model-level-novelty question
remains unresolved and is recorded as a limitation, not silently converted
into evidence of independence.

**(4) Four open MINOR findings are deliberately not repaired in the
approved bytes.** F-1 is an incomplete quotation subject in section 8.2a;
F-2 says four sealed sections before five bullets; F-3 cites the
`generateProjections` loop at its first body statement `:465` rather than
its header `:464`; F-4 says eleven lines from `:496` to the `:506` loop
rather than ten. Each was independently reproduced before recording this
row. The approver found all four inert on every ruling, verdict, cell
status, and evaluability decision. Fixing any one would change the approved
blob and immediately lapse row 11, so no fix is made here.

**(5) Approval and gate state.** **One of four approvals is now in force**
against revision 38: row 11, independent statistical review. Still
required against the same approved bytes are the S3 user attestation using
entry 29's corrected mapping-first mechanism, the user approval of the
remainder, and the independent implementation review performed strictly
last against the complete implementation.

**Gate 0 remains active.** This approval and row do not authorize candidate
execution, frozen snapshot access, Docker sweep execution, report
generation, or result inspection. None occurred while recording it.

### CORRECTIVE ENTRY 31 — appended 2026-08-09

**This entry records both user attestations against revision 38** and
creates approval rows 12 and 13. Entries 1-30 and rows 1-11 remain
byte-for-byte untouched. The specification is not edited.

**(1) The two exact attestations presented for decision were:**

> I approve treating S3 as structurally non-estimable under the frozen
> active-only cohort. Reserve-class rows receive injury-status mapping
> first, cohort exclusion and counting occur second, and excluded rows
> never reach downstream roster construction or scoring. No S3 estimate is
> published; this is an explicit prospective deviation from
> preregistration §4.2.

> I approve all remaining provisions of revision 38, sections 3–8, exact
> git blob `44fae65bce063e9eff2912e0827b868061bf7a15` at commit
> `d65bc1086227c76f3a0991cd31c577f2b2c9e96d`, SHA-256
> `DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43`.
> This authorizes implementation work only and does not authorize
> candidate-cell execution.

**(2) The user issued both approvals explicitly.** Their complete response
was: **"I explicitly approve both attestations."** The word "both" binds
the two immediately preceding, separately stated attestations reproduced
above; neither row is inferred from silence or from a general instruction.

**(3) The identical approval tuple was verified before recording.**

```
SHA-256   DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43
git blob  44fae65bce063e9eff2912e0827b868061bf7a15
anchor    d65bc1086227c76f3a0991cd31c577f2b2c9e96d
```

Rows 11, 12, and 13 therefore authenticate the same revision-38 bytes.
Row 12 uses corrective entry 29's current mechanism order and does not
inherit historical row 8's lapsed rationale.

**(4) Scope disclosures remain visible.** Row 13 approves the remainder
with the independent statistical review and entry 30 already recorded,
including the four known inert MINOR findings F-1 through F-4 and the
reviewer's unresolved model-level-independence limitation. This user
approval records no finding that the limitation is resolved and does not
alter row 11's stated reach.

**(5) Approval and gate state.** **Three of four approvals are now in
force** against revision 38: independent statistical review (row 11),
the S3 user attestation (row 12), and the remainder user approval (row
13). The sole remaining approval is the independent implementation review,
performed strictly last against the complete implementation and the same
approved specification bytes.

**Gate 0 remains active.** Rows 12 and 13 authorize implementation work
only. They do not authorize candidate execution, frozen snapshot access,
Docker sweep execution, report generation, or result inspection. None
occurred while recording them.

### CORRECTIVE ENTRY 32 — appended 2026-08-10

**This entry records the independent implementation approval against
revision 38** and creates approval row 14. Entries 1-31 and rows 1-13
remain byte-for-byte untouched. The specification and approved
implementation tree are not edited.

**(1) The approval authenticates one exact specification and implementation
tuple.**

```
SHA-256              DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43
specification blob   44fae65bce063e9eff2912e0827b868061bf7a15
specification anchor d65bc1086227c76f3a0991cd31c577f2b2c9e96d
implementation       a85f6a67c99d27740018b77a5324c0841ce5a99a
```

The approver is the holder of historical row 10 and the author of the
2026-08-10 no-approval, re-review, reach-completion, and corrective
re-review records. The approver wrote no ledger row and directed that the
approval be recorded with the stated reach.

**(2) The exact verdict was:**

> **APPROVED**: the complete implementation at commit
> `a85f6a67c99d27740018b77a5324c0841ce5a99a` conforms to revision 38,
> sections 3-8, exact specification blob
> `44fae65bce063e9eff2912e0827b868061bf7a15` at anchor
> `d65bc1086227c76f3a0991cd31c577f2b2c9e96d`.

The approver expressly stated that the approval attaches to those bytes,
that any implementation change lapses it, and that it does not authorize
candidate-cell execution or lift Gate 0.

**(3) Corrective reach and reproduced evidence.** The approver
authenticated the parentless three-file review packet, the specification
blob and SHA-256, a silent specification diff, and the corrective
implementation diff from `a6aef0e1f0bbdfbb8b8edf28360463e323597b4e` to
`a85f6a67c99d27740018b77a5324c0841ce5a99a` as exactly 13 modified files,
383 insertions, 11 deletions, and one commit. N-2 is closed across the full
cohort-exclusion chain: roster capture, input production, checkpoint
round-trip, canonical assembly, reducer validation, JSON publication, and
Markdown publication. The reviewer personally ran ten fail-closed probes
and reproduced the 15-file synthetic suite as **379 passed, 0 failed**.

Semgrep run `31410073445` was independently authenticated as an executed
scan at the approved implementation commit with conclusion `failure`.
The public log body was unavailable, so its rule, file, and finding counts
remain packet-derived. The reviewer independently located and adjudicated
the four reported repo-root `path.join` statements in
`scripts/backtest/instruments/check-locators.js` as nonblocking false
positives and an omitted-suppression gap. The recommended pins are not
added here because any implementation-byte change would lapse this
approval.

**(4) Open limitation and residual observations.** **MINOR N-1 remains
open.** A direct handmade `sweepReport.buildReport` call can supply an
explicitly null veto or omit the evidence container and publish a visible
null. It cannot publish the false affirmative `catastrophicVeto: false`.
The production path always emits a veto evidence block and validates it
before report construction, so the condition is unreachable through that
path and changes no status on a validated document.

O-1 (DEF fumble pricing) and O-2 (an unpinned dataset fallback) are carried
as unverified observations for which the reviewer found no governing-text
conformance requirement. The reviewer also disclosed that their own prior
review work was carried forward and that model-level novelty cannot be
audited. Row 14 records that independence limitation; it does not represent
novelty as proven.

**(5) Approval and gate state.** **Four of four approvals are now in force**
against revision 38: independent statistical review (row 11), the S3 user
attestation (row 12), the remainder user approval (row 13), and independent
implementation review (row 14).

**Gate 0 remains active.** Completion of the four-approval chain does not
itself authorize candidate execution, frozen snapshot access, Docker sweep
execution, report generation, or result inspection. Gate 4's replacement
freeze sequence and Gate 3 verification under specification section 1
remain required. None of the prohibited operations occurred while
recording this approval.

### CORRECTIVE ENTRY 33 — appended 2026-08-10

**This entry corrects row 14's attribution and records the superseding-byte
independent implementation approval against revision 38** by creating approval
row 15. Entries 1-32 and rows 1-14 remain byte-for-byte untouched. The
specification and approved implementation tree are not edited.

**(1) Row 14 contains an attribution that its approving reviewer did not
supply.** Row 14 says:

> **Independence limitation**: model-level novelty remains unresolved.

In the corrective re-review of `2716934def4ba5eef155113d458f5b20a58cf97d`,
the holder of historical rows 10 and 14 expressly stated that they never
disclosed a model-level-novelty limitation. That sentence therefore must not be
attributed to that reviewer. If another reviewer disclosed such a limitation,
the defect here is attribution rather than invention; this entry neither
resolves nor adopts a limitation whose source and content this implementation
reviewer could not verify.

**(2) The limitations the row-14 reviewer actually stated are preserved.** At
the prior approved implementation commit
`a85f6a67c99d27740018b77a5324c0841ce5a99a`, the reviewer carried MINOR N-1
with its direct-handmade-call production-reach limitation, could not read the
Semgrep log body, left observations O-1 and O-2 unverified and unasserted, and
carried the reach established in the reach-completion review. Corrective entry
32 item (4)'s statement that this reviewer disclosed an inability to audit
model-level novelty is likewise incorrect and is superseded by this entry.

**(3) The new approval authenticates one exact specification and implementation
tuple.**

```
SHA-256              DC1E1C413A6CDFCB9072393720020179C0FFD4E483137117B66DC0F25281AE43
specification blob   44fae65bce063e9eff2912e0827b868061bf7a15
specification anchor d65bc1086227c76f3a0991cd31c577f2b2c9e96d
implementation       2716934def4ba5eef155113d458f5b20a58cf97d
```

The approver is the holder of historical rows 10 and 14 and the author of the
2026-08-10 implementation review sequence. The approver wrote no ledger row,
drafted none, and named no row number.

**(4) The exact verdict was:**

> **APPROVED**: the complete implementation at commit
> `2716934def4ba5eef155113d458f5b20a58cf97d` conforms to revision 38,
> sections 3-8, exact specification blob
> `44fae65bce063e9eff2912e0827b868061bf7a15` at anchor
> `d65bc1086227c76f3a0991cd31c577f2b2c9e96d`.

The approver expressly stated that this approval attaches to implementation
bytes and lapses on any change to them. It does not authorize candidate-cell
execution and does not lift Gate 0.

**(5) Corrective delta and evidence.** From the prior approved implementation
commit to this approval, three commits isolate the ledger record, four
rule-specific Semgrep annotations, and the full-history CI checkout:

```
0a2e7b148ee7b76f6fc9acfc4f9b1d74b437b1fd  APPROVAL_LEDGER.md only
63f9282121bf6cf6218cef739cc8abd491a4096d  check-locators.js only
2716934def4ba5eef155113d458f5b20a58cf97d  ci.yml only
```

The reviewer verified that no production or backtest runtime file changed,
that all four executable statements are byte-identical before their comment
delimiters, and that the checkout-depth change affects only the `test-build`
job. The reviewer authenticated successful Semgrep run `31417720395` and CI
run `31417719882` at the exact target, and locally reproduced both synthetic
locator validations, the live 89/92/181/0 locator result, and 19/19 passing
instrument tests. The Backtest reproduction run at parent `63f9282...` failed
discovery and skipped reproduction as expected before M-prime; no reproduction
container ran.

**(6) Open findings and bounded evidence remain visible.** MINOR N-1 remains
open with the exact reach stated in the approval. MINOR N-3 is new, open, and
inert: the line-100 suppression conclusion is sound, but its rationale calls
the module-private, never-mutated `SEARCH_ROOTS` array "frozen" when it is not
frozen. The recommended wording or `Object.freeze` repair is not made because
any implementation-byte change would lapse this approval. O-1 and O-2 remain
unverified, unasserted, and unresolved. The reviewer authenticated GitHub run
identities, target commits, conclusions, and job outcomes, but could not read
the log bodies; the internal rule, file, and test tallies remain packet-derived.

**(7) Approval and gate state.** Row 14 remains the historical approval of
implementation commit `a85f6a67c99d27740018b77a5324c0841ce5a99a`, but that
approval lapsed for the current implementation when its bytes changed. Row 15
records the independent implementation approval of the current exact commit
`2716934def4ba5eef155113d458f5b20a58cf97d`. Together with rows 11-13, all four
required approval roles are in force against revision 38 and the current
approved implementation bytes.

**Gate 0 remains active.** This approval does not authorize candidate
execution, frozen snapshot access, Docker sweep execution, report generation,
or result inspection. Gate 4's replacement freeze sequence and Gate 3
verification under specification section 1 remain required. No prohibited
operation occurred while recording this approval.
