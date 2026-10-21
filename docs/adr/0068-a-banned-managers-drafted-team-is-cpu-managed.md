# A banned manager's drafted team is CPU-managed, not deleted

Status: accepted (2026-10-16)

A commissioner needs to remove a manager for good: take them out of the
league and keep them from rejoining. Removing a team is refused once the
draft has started (Removable, #195), because deleting the team rewrites the
draft, rosters and schedule. So for a drafted league, "Remove & ban" has to
leave the team in place.

## Decision

- **Ban.** A `league_bans` row (league_id, user_id, email_hash) is checked by
  `leagueMembership.assertAdmissible`, which every join path runs (create,
  invite code, public join, filing and approving a join request). An account
  is refused with a 403 when it is the banned account, or when its email has
  the same ban key: lowercased, any `+tag` dropped, and for Gmail the dots
  dropped. That catches a re-signup after deletion (deletion is a soft
  delete that frees the address) and simple aliases. The row stores a
  SHA-256 of the key, never the address, so deletion's anonymization promise
  holds. A commissioner sees and lifts a ban by the Team name it
  was made against. The account is never served (Team identity).
- **Team fate.** While the league is Removable, the team is deleted exactly
  as `removeTeam` deletes it. After that, the team keeps its row and
  `owner_id` becomes NULL. A NULL owner is a **CPU-managed team**. This
  amends ADR 0002: a teams row is still how a manager holds membership, but
  a teams row may now exist with no member.
- **What the CPU does.** A scheduler job (`cpu-lineups`) starts the best
  legal lineup by the league's projections each tick, through the shared
  `heldLineup` and `optimalLineup`. It never moves kicked-off players, never
  starts an unavailable player, and never touches IR. It makes no trades and
  no claims: the ban cancels the team's open trades and pending claims, and
  a proposal to a CPU team is refused with a 409. In a later season's draft
  a CPU team drafts by autopick (`autodraft` is set), found by the clock and
  not by owner. Once a rollover makes the league Removable again, the
  commissioner can remove the CPU team like any other.

## Why not hand the team to a new manager?

That needs a claim flow: an invite to a specific team, plus a transfer of
the `owner_id`. It can be built on top of this later (a NULL-owner team is
exactly the "unclaimed" state). A CPU manager keeps the season fair now with
no new join path.

## Consequences

- `notify` is a no-op for a null recipient, and `notifyLeague` skips CPU
  teams. Without that, every league-wide notification would fail the NOT NULL
  on `notifications.user_id` and roll back the calling transaction.
- `processWaivers` no longer inner-joins users. A CPU team keeps its waiver
  priority and counts toward `teamCount`.
- League detail's `teams[]` carries `is_cpu`. It is a team attribute and names
  no account.
- A ban cannot catch a different inbox. Matching on anything else (device,
  IP address) is out of scope.

## Amendment (2026-10-21): account deletion

Deleting an account (#2417, #2477) gives each team the account holds the same
fate as a ban, through the same helper (`settleDepartedTeam` in
`commissioner.service.js`). A team in a Removable league is deleted; any other
becomes a CPU-managed team, and its open trades and pending claims are
cancelled. It runs inside the deletion's transaction, so a rollback undoes it.
Teams already held by deleted accounts are a one-off data step, not part of
this change.
