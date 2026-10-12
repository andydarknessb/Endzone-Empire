# The Availability input is stored with the number; the Start verdict is derived on read

Status: accepted (2026-10-09)

The engine computes a player's availability (bye, No NFL team, Practice
squad, Out, IR) before it prices him, feeds it into the Appearance
probability inside the number, and stores it beside the number as
`factors.availability`. The holdout ledger captures the whole `factors` JSON
with every snapshot (ADR 0044). Two reconcilers rewrite the stored field when
ESPN facts change, Rest of season skips weeks from it, and the decision card
context selects it in SQL. Separately, the Start verdict (CONTEXT.md) is
derived on read by the Weekly projection read's `startVerdictFor`, from live
facts plus the engine's Position-baseline and Backup flags, and is never
stored.

The 2026-10-09 architecture review found twelve call sites hand-assembling
facts for the one verdict function and proposed a single Start verdict
module. The obvious first move was to delete the stored copy as a stale
cache of that verdict. We decide not to: the two are different concepts and
both stay.

1. **Availability input** names the stored field. It is the engine's own
   input, part of the number, captured by the holdout ledger, and maintained
   by the reconcilers. It never carries Doubtful, no practice,
   Position-baseline or Backup, and no surface reads it as an answer to
   whether a player may be started. The interval reading's eligibility check
   reads it as engine input and stays.
2. **Start verdict** is derived on read and never stored. The Weekly
   projection read is its one producer (ADR 0057); every reader, including
   the public Waiver Targets, the Home status card, the Expected final and
   the matchup detail route, gets a verdict from that read by player id and
   passes no availability facts of its own. `unavailableFor` becomes an
   internal seam of the projection read.
3. **Lineup lock is not part of the verdict.** Whether an entry is locked is
   a Lineup fact composed beside the verdict by the callers that need both.

## Considered options

- **Delete the stored field and read the verdict live everywhere.**
  Rejected: it changes the holdout snapshot shape ADR 0044 freezes until the
  2026 week 18 capture, and the engine needs the input for the number
  regardless of what surfaces show.
- **A standalone Start verdict module that loads bye, injury, roster status,
  depth chart and practice itself.** Rejected: ADR 0057 already made the
  Weekly projection read the verdict's owner, and the depth chart and
  practice loads live there; a second loader would be a second producer.

## Consequences

- A cheap reader such as the Home status card pays a projection read for its
  verdict. Projections are stored per week, so this is a lookup, not a model
  run.
- The matchup detail route's fallback verdict for a row with no priced row
  (which admitted "a bye is unknown then") is deleted: the read answers from
  facts whether or not pricing succeeded.
- A future verdict rule (the shape of ADRs 0053, 0056 and 0057) is one
  edit inside the projection read.
