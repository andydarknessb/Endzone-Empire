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
changes and writes it in the same transaction (ADR 0033). A save and the shot
it contradicts never disagree. The cost is the reverse of the old rule: if the
void cannot be written, the save is refused and the manager retries. The
void is one UPDATE on a row the save already reads, so it is not a new way
to fail in practice.

## Considered options

- **Keep the void after commit, best effort (the #1856 rule).** Rejected:
  it trades a rare refused save for a silent contradiction that Advance week
  judges.
- **Void after commit, retried by the scheduler.** Rejected: a second writer
  for one fact, and a window in which the shot reads open.
