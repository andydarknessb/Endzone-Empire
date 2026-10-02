# A Questionable player with no practice all week is never auto-recommended

Status: proposed (2026-10-02)

Questionable is the only Game status the engine cannot price: Unavailable
players are zeroed and Doubtful players are never auto-recommended, but a
Questionable player is projected and recommended as if healthy, because the
coarse designation carries no calibrated probability. In week 4 of 2026
D'Andre Swift projected 15.4 and was recommendable after he did not
participate in Wednesday's or Thursday's practice. From #1922 we capture
Practice participation as it is reported, so the fact is now in hand.

ADR 0044 forbids a Model version change before the 2026 week 18 capture, so
the number cannot move in season. We decide, in the shape of ADR 0053, to
change the verdict and leave the number:

1. A Questionable player has had no practice this week when at least one
   Practice participation observation exists for him in that week, every
   observation reads did not participate, and none is rest-related. Any
   other case, including no observation at all, keeps today's verdict.
2. Like Doubtful, he is startable if a manager insists but never
   auto-recommended; a starter keeps his slot. The verdict is taken by the
   one verdict function, read only by Start/sit advice. The engine's own
   availability input before projection, the holdout capture and every other
   reader never see it.
3. Wherever the Questionable tag shows on the Start/sit card or the
   Decision card, "No practice this week" shows beside it.
4. Position-baseline wins over it, and it never applies to Doubtful, Out or
   injured reserve.

## Considered options

- **Haircut the projection for Questionable.** Rejected: it moves a projected
  number, which ADR 0044 forbids in season, and the Appearance probability
  it needs is planned for v3.2 (#1441).
- **Use the latest observation only.** Rejected: it would also fire on a
  late-week setback after a full practice, a stronger claim with no evidence
  behind it yet.
- **Treat no observation as no practice.** Rejected: a missed poll or a
  missing report is not evidence that the player did not practice.

## Consequences

- The holdout ledger is untouched: captures store what the engine produces,
  and nothing the engine produces changes, so there is no DEVIATIONS.md
  entry. A capture-identity test proves the bytes are unchanged.
- Practice days are approximate: we record when we observed a report, not
  the practice day it describes, so a report first seen a day late still
  reads did not participate.
- The Override capture (ADR 0054) records different Overrides from the first
  week the rule fires. That is a product consequence, not a study effect.
- The rule needs no switch: with no observations it is the status quo, and
  #1441 can replace it with a calibrated Appearance probability in a later
  Model version.
- Spec #1922.
