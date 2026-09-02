# Best ball scores the roster held at the week's last kickoff

Status: accepted (2026-09-02)

The settle pass scores a week as played: the week's lineup entries, minus any
row no tenure of the team covered at its player's own kickoff (#190, #228, ADR
0006). In a standard league that is a bounded population, because a starter
dropped after his game keeps his row and that row still occupies his slot; a
replacement picked up for Sunday is benched on acquisition, and no save may
seat him beside the surviving row (#627).
Best ball has no slot occupancy. Every non-IR row is a candidate and
`optimalLineup` picks the best legal lineup from all of them. So a player
dropped after his Thursday game and the replacement acquired for Sunday were
both candidates, each tenure covered its own player's kickoff, and every
post-kickoff drop-and-replace cycle handed the optimiser one more scored body
than a roster seat can field, never one fewer (#635). The live path, which
joins the current roster, showed the manager one number all Sunday; the
score of record written at advance was a larger one.

We bound the pool with the same recorded fact: a best-ball candidate must have
been held at his own kickoff AND at the week's last kickoff. The instant is
the latest kickoff on the week's schedule over every game that week, not only
the candidates' own, so the answer does not move with the roster being asked
about. A player with no game that week is never excluded, as before. The rule
applies to the settle and final populations together, as the first exclusion
does, and to best ball alone.

## Considered options

- **Held at the week's last kickoff, in addition to his own (chosen).** One
  more question of `roster_tenures`, asked through the same predicate, in the
  best-ball branch only. It makes the score of record agree with what the live
  path already showed.
- **At most one candidate per roster seat, the seat keeping its first holder.**
  Rejected: best ball records no seat, so drops would have to be paired with
  pickups by timestamp, and the result would be a number nobody saw during the
  week.
- **Leave it, documented as legal churn.** Rejected: it is exactly the
  movement at advance that #190 exists to prevent, and it rewards a move no
  lineup could ever have made.

## Consequences

- A best-ball manager who cuts a player after that player's game, before the
  week's last kickoff, forfeits his points for the week. Live scoring already
  showed that; the settled number now matches it rather than moving.
- A standard league is untouched. Its dropped starter's surviving row still
  scores (#190), and its pool is bounded by slot occupancy, not by this rule.
- The predicate SQL lives once (`playersNotHeldAt` in `lineup.service`) behind
  two questions, so the two exclusions cannot drift. Test fakes seed
  `roster_tenures` explicitly (ADR 0006) and the shared tenure fake reads the
  operators out of the emitted statement, so both questions are answered by
  the same fake with no second implementation.
- The glossary's **Settle pass** entry names the second exclusion for best
  ball.
- A trade after a player's game settles his points for neither side: the
  giving team did not hold him at the week's last kickoff, and the receiving
  team did not hold him at his own (#228). Live scoring already showed the
  giving team that.
- The rule applies to final weeks too, so the first correction sweep after
  deploy re-scores any already-settled best-ball week that had post-kickoff
  churn and announces the drop as a stat correction. Deployed before the
  2026 season's first settle, that set is empty.
- Hindsight and the recap's blunder pick still score every row of a settled
  week with no tenure exclusion, so in best ball they disagree with the score
  of record. Pre-existing, tracked as #736.

## Amendment (2026-09-02, #736): hindsight reads this pool too

The last consequence above records hindsight and the recap's blunder pick as
scoring every row of a settled week, disagreeing with the score of record in
best ball, and tracked as #736. That gap is closed by ADR 0023: hindsight
reads the settle pass's population through the one helper that applies both
exclusions, so the bound this ADR records governs hindsight as well, and in
best ball a team's hindsight actual is its optimal over that same pool.
Pricing is a separate question (#739). Nothing above this line has changed.
