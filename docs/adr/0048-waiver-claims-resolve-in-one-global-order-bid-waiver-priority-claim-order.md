# Waiver claims resolve in one global order: bid, Waiver priority, Claim order

Status: accepted (2026-09-23)

A manager reported that changing the order of their pending claims meant
deleting them and re-requesting. It was worse than that: the Waiver wire
listed pending claims newest first, but processing grouped due claims by
player and walked the groups in `player_id` order, so a manager's own claims
had no order at all. Two of their claims naming the same drop player resolved
by whichever claimed player carried the lower id, and re-requesting changed
nothing. There was no vocabulary for the thing the manager was trying to set.

We decide that a manager's pending claims carry a Claim order (CONTEXT.md),
and that processing walks every due claim in the league in one global sort:
in a FAAB league the bid, highest first; then Waiver priority; then the
claiming team's Claim order; then submission time. Each claim is re-validated
at its own turn (player still unrostered, drop player still on the roster,
roster capacity, FAAB budget), a later claim on a player already won loses,
and a claim invalidated by an earlier claim of the same manager records which
of their claims did it.

Claim order is strictly intra-manager. It ranks a manager's claims against
each other and never against another team's; what a manager can win is still
decided by the bid and Waiver priority. In a FAAB league that means a
manager's larger bid on their second-ranked claim processes before their
first-ranked claim, and if both drop the same player the first-ranked one
is the one invalidated. That is the trade-off accepted here: bids are a
league-wide promise and the order is a private preference, and the promise
comes first.

## Considered options

- **Rounds: round k takes every team's k-th ranked claim in Waiver priority
  order.** Honours the manager's rank exactly, but a FAAB league needs all
  bids on one player in one place to pick the highest, and a round holds
  only one bid per team; the two rules cannot both be primary. Rejected.
- **Keep per-player grouping and use Claim order only to choose which of a
  manager's conflicting claims to void afterwards.** The lower-ranked claim
  may already have won and dropped the player before the higher-ranked one
  is reached; voiding it after the fact means reversing a completed roster
  move. Rejected.
- **Claim order beats the bid within one manager's claims.** Lets a manager
  win a player with a bid another team out-bid, because their own
  higher-ranked claim consumed the drop first and the out-bidding claim then
  processes against a changed roster. The bid must mean the same thing to
  every team. Rejected.

## Consequences

- `orderClaims` gains one sort key and the outer loop stops grouping by
  player; the `invalid` status and its note already exist and carry the
  sibling reason.
- The Waiver wire lists pending claims in Claim order and lets the manager
  move them; a claim submitted from any surface joins the order last.
- Editing a pending claim's bid or drop player is a separate change and does
  not touch the order.
