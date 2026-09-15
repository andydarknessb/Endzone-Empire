# A merged ADR number collision is resolved by a byte-identical renumber

Status: accepted (2026-09-15)

Two pull requests can each merge an ADR at the same number: #1415 and
#1438 both landed an ADR 0044 on integration within a day of each other,
because each was numbered against the integration of its own branch point.
The uniqueness guard (`check-adr-uniqueness`) then reds every later pull
request, and the immutability guard (`check-adr-immutability`) forbids the
only repair, since a merged ADR may not be deleted or renamed. With both
guards as written, a collision that has merged cannot be fixed at all.

We decide that a collision is resolved by a collision renumber: the ADR that
merged second moves to the next free number with its text unchanged, and
the immutability guard admits exactly that move. A base ADR may be absent
on head only when both hold: its number is shared by another ADR on base,
and an ADR on head at a different number carries the same text after the
guard's own line normalisation. Every other rename or deletion stays a
violation. The move carries nothing else: a typo in the moved ADR is fixed
afterwards by an appended amendment, never in the renumber itself, so the
guard can tell a move from a rewrite by text identity alone.

## Considered options

- Supersede in place: leave the file at the colliding number with its Status
  line set to superseded by the new number, copy the text to the new number,
  and teach the uniqueness guard to tolerate a duplicate whose Status is
  Superseded. Rejected: it calls a live decision superseded, which the Status
  line is reserved for, and the colliding number then names two files for
  the rest of the log's life.
- Admin-merge past the red check and repair later. Rejected: every later
  pull request stays red until the repair lands, and a red that is expected
  is a red nobody reads.

## Consequences

- The later-merged ADR is the one that moves, so citations of the earlier
  one stay valid. Code comments that cite the moved number follow in the
  same pull request; no guard checks this, it is the author's job.
- The guard still has no environment escape hatch. The exception is a
  property of the two trees, not a flag.
- Numbering against a stale branch point is still the cause. Authors number
  a new ADR against origin/integration at the moment they open the pull
  request, and re-check before merge when another ADR pull request is open.
