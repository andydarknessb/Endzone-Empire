# A lineup save voids a contradicted Called shot in the same write

Status: accepted (2026-10-06)

Since #1856 a lineup save committed first and the route then voided any open
Called shot the new lineup contradicted, swallowing every failure so "the
shot path never blocks saving a lineup". A failed void therefore left a saved
lineup beside a still-open shot it contradicts: the card still showed it
pending, a later save moving the players back revived a shot that should
have been void for good, and the save's answer told the manager nothing.
(Advance week still voids a shot the lineup as played does not reflect, so
only the pre-lock window was exposed.) What the save changed was assembled
in three places: the lineup service, the route, and the client.

We decide that the lineup save plans the void with everything else it
changes and writes it in the same transaction (ADR 0033). The lock exception
stands: once either of the shot's players has locked, a save never voids it,
and Advance week settles it as played (ADR 0054). Before that, a save and the
shot it contradicts never disagree. The cost is the reverse of the old rule:
the save now reads the team's open Called shot, its two players' slots and
their lock state, and writes the void, inside its own transaction, so a
failure in any of those refuses the save and the manager retries.

## Considered options

- **Keep the void after commit, best effort (the #1856 rule).** Rejected:
  it trades a rare refused save for a silent contradiction that reads open,
  and can be revived, until a player locks.
- **Void after commit, retried by the scheduler.** Rejected: a second writer
  for one fact, and a window in which the shot reads open.
