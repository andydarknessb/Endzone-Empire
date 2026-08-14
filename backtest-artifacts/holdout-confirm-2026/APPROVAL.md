# APPROVAL - holdout-confirm-2026

## The sealed document

| | |
|---|---|
| Study id | `holdout-confirm-2026` |
| Document | `backtest-artifacts/holdout-confirm-2026/PREREGISTRATION.md` |
| Sealed at commit | `165626c9354202692e8da9c0b0c0669e92c67277` |
| Blob SHA-256 | `7c31ebf80aab684b003bf5db20b12531c85132abe79fe289da527b3d13cd59c6` |
| Git blob id | `4ce85a6d3bfac42b7e8221bfc4a95e9f61c967cd` |
| Sealed | 2026-08-14 |

Verify:

```
git show 165626c9354202692e8da9c0b0c0669e92c67277:backtest-artifacts/holdout-confirm-2026/PREREGISTRATION.md | sha256sum
```

The hash is of the COMMITTED bytes, taken via `git show` against the seal
commit, never of a working file.

## The approval

**One approval - the product owner's - is required and sufficient**
(PREREGISTRATION.md section 12). It is recorded here, beside the hash it
covers, and never inside the approved document.

Approver: **Cory Anderson**, product owner.
Date: **2026-08-14.**
Given in the 2026-08-14 working session, in the owner's own words, directing
this seal together with the credential provisioning and the deploy:

> Mint, Seal and deploy

The seal executes the owner's standing rulings from the same session's
grilling record: Candidate B seals as drafted with its C2 gate expected to
fail honestly on the sign of the measured effect; the section 9 item 5
completeness void closes the control-arm eligibility channel; the
pooled-residual sensitivity stands on its provenance disclosure. Sealing
three weeks ahead of the Sep 4 target was the owner's call to make and the
owner made it.

## The pre-seal statistical review (recommended, occurred, recorded)

Section 12 recommends an independent statistical read of sections 8-10
before sealing and asks that it be recorded here with its own hash
reference. It occurred, adversarially, and its findings were closed in
commit:

| | |
|---|---|
| Review closure commit | `6151d6fb0464631c64c8c2975bcadee7e90bd6c7` |
| Subject | adversarial statistical review of the evaluator and sections 8-10 |
| Outcome | candidate-wide voids, restored conservatism divisors (component alpha 0.025/3, test alpha 0.025), isolated claims, honest sensitivity plumbing |

A further adversarial QA pass over the final pre-seal batch (2026-08-14,
twenty agents, five angles with per-finding refutation) confirmed and closed
seven defects before these bytes were committed, including the section 9
item 5 empty-series crash and the section 9/section 10 eligibility-wording
contradiction. Its confirmed findings are all repaired in the sealed bytes;
its consciously accepted minors are recorded in the session record, not
here, because none touches a sealed rule.

## What follows the seal

- Any edit to the sealed document voids the study id (successor:
  `holdout-confirm-2026-r2`).
- Deviations: append-only entries in `DEVIATIONS.md`, per section 12.
- Capture obligations begin with the week-1 window, Tue 2026-09-08 8:20 PM
  ET; the evaluability floor is 14 surviving weeks.
