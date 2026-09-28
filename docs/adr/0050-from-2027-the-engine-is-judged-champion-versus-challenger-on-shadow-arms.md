# From 2027 the engine is judged champion versus challenger on shadow arms

Status: accepted (2026-09-28)

ADR 0044 gates the next engine version on one full season of the holdout
ledger: nothing ships before the week 18 capture, and the successor is
judged once, after the season, against the Model version that was served all
year. That gate costs a season per engine change, and it can only judge a
change that already existed when the season's captures began. Every engine
finding the 2026 audits have produced since week 1 (the #1438 spec items
among them) waits a full season behind it. Cory approved a replacement in
principle on 2026-09-27.

We decide that from the 2027 preregistration onward the engine is evaluated
champion versus challenger:

1. **The Champion is what production serves; a Challenger is captured
   beside it without being served.** A Challenger is written pre-kickoff as
   its own `capture_kind`, in the same transaction and from the same
   REPEATABLE READ snapshot as the scheduled arm, so it accrues sealed
   holdout evidence under the same capture window and the same
   all-or-nothing rule while no manager ever sees its numbers. That captured
   Challenger series is a Shadow arm.
2. **Promotion is preregistered and happens only at fixed checkpoints.** A
   Challenger becomes eligible after K surviving weeks ahead of the Champion
   on the primary metric by a stated margin. K, the margin, the primary
   metric and the checkpoint weeks are fixed in the season's
   preregistration before its first capture. Promotion never happens
   weekly: one week cannot resolve differences of the size this engine's
   candidates produce.
3. **The Control arm is pinned by kind, not by what production serves.** The
   study's Control is a named `capture_kind` whose constants stay fixed for
   the whole study. When a Challenger is promoted and starts being served,
   the Control keeps being captured under its own kind and constants hash,
   so a promotion does not split the Control series and drop weeks under the
   evaluator's constants-hash majority rule.

## The shadow-arm requirements

An adversarial review of the current `holdout.service` capture transaction
found that bolting a Shadow arm onto it as it stands would either void the
sealed 2026 study or let the Challenger break the scheduled capture. Before
any Shadow arm touches a live capture, the mechanism must meet all seven:

1. **A non-`candidate:*` kind.** PREREGISTRATION section 2 of
   holdout-confirm-2026 seals that "the capture aborts whole if any
   candidate row's `mean` diverges from the scheduled row's". A Challenger
   is meant to move the mean, so it cannot live in that namespace.
2. **The write-time mean-equality abort scoped to `CANDIDATE_ARMS` only.**
   Today the check iterates every non-scheduled arm. A Challenger whose mean
   differs must not roll back the scheduled arm.
3. **Per-arm `model_version`** in the header insert and in the skip-match
   query. Both use the one served Model version today; a Challenger is a
   different version by definition.
4. **The Challenger excluded from `/api/health` `REQUIRED_ARMS`.** A missing
   or failed Shadow arm is not a missing scheduled capture and must not page
   as one.
5. **An owner ruling on the `HOLDOUT_PROTOCOL_VERSION` bump.** A protocol
   change makes weeks under the old and new protocols permanently
   incomparable, so whether adding a Shadow arm bumps it is Cory's call, not
   the implementer's.
6. **Failure isolation.** A throw or deadline overrun inside the Challenger's
   projection run cannot roll back the scheduled arm. The scheduled capture
   is the ledger's reason to exist; a Shadow arm is optional evidence.
7. **Version-keyed constants.** `captureArms()` accepts a version-keyed
   constants set (`MODEL_CONSTANTS_BY_VERSION`, as ADR 0047 set up for
   v3.2), and a Challenger's engine changes are selectable through that set,
   never through code branches on `MODEL_VERSION`. A branch on the served
   version cannot run two versions in one transaction.

The mechanism is prototyped against a test database during the 2026 season.
Nothing attaches to a live 2026 capture without a separate ruling.

## Considered options

- **Champion/challenger on Shadow arms (chosen).** A change is judged on
  sealed pre-kickoff evidence it accrued in parallel with the served
  version, so the wait is K weeks and a checkpoint, not a season. Costs the
  seven requirements above, a second projection run per capture, and a
  preregistration per season that names K, the margin and the checkpoints.
- **Keep ADR 0044's single-season gate every year.** Simplest, and already
  built. Rejected because every engine change waits for a season boundary
  regardless of how early it was ready, and a change found in week 3 is
  judged on the following season's evidence at the earliest.
- **Weekly promotion on the running leader.** Fastest reaction, but one
  week cannot resolve differences of the size this engine's candidates
  produce, so it would promote on luck and demote on luck.
- **Add Challengers as more `candidate:*` arms.** Reuses the existing arm
  machinery, but the sealed mean-equality abort would roll back every
  capture the Challenger's mean differs on, which is every capture.

## Consequences

- ADR 0044's gate governs 2026 unchanged. This ADR replaces it only from the
  2027 preregistration, which must name the Champion, each Challenger, the
  Control kind, K, the margin, the primary metric and the checkpoints.
- The capture transaction does two kinds of work with different failure
  rules: the scheduled and `candidate:*` arms stay all-or-nothing together,
  and a Shadow arm succeeds or fails on its own.
- A Shadow arm's rows are holdout evidence under the same Survivor rules as
  the Champion's; a Challenger with too few Survivors at a checkpoint is
  unjudged, not promoted.
- Capture cost grows by one projection run per Challenger per (week,
  profile), inside the capture window. The window, not the engine, bounds
  how many Challengers a season can carry.
