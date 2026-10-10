# Upgrade is the gain to this week's optimal lineup

Status: accepted (2026-10-01); superseded in part by ADR 0062 (the week the Upgrade reads, and holding the candidate)

ADR 0049 defined the Upgrade as a free agent's Weekly projection over the
weakest starter at a slot he can fill, and #1793 zeroed an Unavailable
starter inside that comparison. Both read the starters only. A healthy bench
player who would simply move into an Unavailable starter's slot was never
netted out: a candidate projecting 10 over an Unavailable starter read +10
while the manager's bench RB at 12 already covered the slot, so the Waiver
Wire's default Upgrade sort ranked claims that change nothing above claims
that do. The weakest-starter rule also cannot see a gain that arrives through
a FLEX chain (the candidate takes the RB slot, the RB he displaces moves to
FLEX, the WR he displaces leaves).

Spec #1800 asked for a bench-aware Upgrade; this is its first slice.

We decide:

1. The Upgrade is the optimal lineup total with the candidate added to the
   roster minus the optimal total without him, over the team's starters and
   bench (the IR slot excluded), never below 0. The baseline is the optimal
   lineup of the current roster, not the lineup the manager happens to have
   set. An Unavailable roster player is worth 0. A player whose game has
   kicked off is held the way the Start/sit advice holds him: a kicked-off
   starter keeps his slot, a kicked-off bench player is not a lineup
   candidate. The candidate is never held. The candidate's own refusals are
   unchanged (own roster, No NFL team, Unavailable, Position-baseline and
   best ball all stay `null`).
2. `overPlayer` is the roster player in the optimal lineup without the
   candidate who is not in the one with him, `{ id, name, points,
   unavailable }` as before; `null` when the candidate fills an empty slot or
   adds nothing. `slot` is the slot the candidate takes. A candidate who adds
   nothing carries `{ points: 0, overPlayer: null, slot }` on the wire so a
   sort can still read it, but no Upgrade pill or tile is shown for it, on
   the Waiver Wire row, the Decision strip or the Decision card. A negative
   Upgrade no longer exists.
3. Cost: two exact `optimalAssignment` solves per candidate, with no pruning.
   A shortcut that skips candidates below the weakest starter is wrong when
   the gain comes through a FLEX chain. The slice reports the measured time of
   the pure step for a 2,500-candidate pool in its PR; above 150 ms, pruning
   becomes its own ticket with an equality test against the unpruned
   function.

This supersedes ADR 0049's "replaced starter preselected" sentence and its
2026-09-29 amendment: the claim sheet stops reading `overPlayer` for its drop
preselect and reads a drop suggestion instead. That client change is slice C
(#1912); until it ships, the sheet still preselects `overPlayer` when he is
available this week. ADR 0040 is not contradicted: the Upgrade still reads
the Weekly projection under league scoring.

## Amendment (2026-10-02): the drop preselect (slice C, #1912)

The claim sheet no longer reads `overPlayer` for its drop preselect. After
this ADR `overPlayer` is the player who leaves this week's optimal lineup,
usually a starter-grade player moved to the bench, which is the wrong default
drop. The players read's `context` now carries `dropSuggestion: { id, name }
| null`: when the viewer's team is at capacity (`rosterCount >=
rosterCapacity`), the roster player with the lowest Rest of season total from
a read over the roster's own ids, ties by lower id; `null` when a spot is free
or when that read fails. A player in an IR slot this week is not considered,
because roster capacity is earned by the stash and dropping him frees no spot.
The sheet preselects the suggestion when he is in the roster list it shows,
otherwise no drop; an edited claim still opens on its own drop, and the swap
preview still reads `upgrade`.
