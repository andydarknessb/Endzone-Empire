# Upgrade is read in the candidate's first playable week

Status: accepted (2026-10-09). Supersedes in part ADR 0055 point 1 ("this
week" and "The candidate is never held").

ADR 0055 made the Upgrade the gain to this week's optimal lineup and never
held the candidate. A candidate whose game had kicked off still read his full
gain, though kickoff puts him on waivers until the week's last kickoff plus
the waiver period, so he could never score for the claimant that week. On
Monday and Tuesday, when most claims are made, nearly every player on the
Waivers page is in that state, and the Upgrade sort ranked claims by points
nobody could collect.

We decide:

1. The Upgrade is what acquiring the candidate can actually deliver. It is
   read in his first playable week: the week of the first game he can still
   play after he could join the roster. That is now for a Free agent, his
   Clear time for a player on waivers, and for another team's player the
   moment a trade could first complete (now, or once the league's review
   window ends, assuming an immediate accept). The baseline is the optimal
   lineup the current roster could field that same week.
2. A pill or tile for any week but the current one names its week. One sorted
   list may mix weeks; each number is honest for its own week.
3. A bye week has no game, so it is skipped, not refused: a free agent on bye
   reads next week's Upgrade. Out, IR and No NFL team stay undefined. So does
   a candidate whose first playable week falls after the league's last playoff
   week; zero would claim he adds nothing, when there is no week to add
   him to.
4. The drop a claim makes and the players a trade sends away are not part of
   the Upgrade. They belong to the claim or trade; the claim sheet's swap
   preview nets out the drop the manager picks. The drop suggestion is a
   default the manager may override, so folding it in would make a Players
   page number depend on it.

Considered: reading this week only, with an unreachable candidate at zero
(useless on Monday and Tuesday); one page-wide week, the Waiver week (still
zeros until Monday night's game is final); a separate reachability flag beside
the hypothetical number (two numbers for one question).

## Consequences

Next week's Weekly projections already exist mid-week (the nightly fill
projects every week through the playoffs). Next week's lineup does not, and
`materializeLineup` copies one forward whenever a read asks for it, which
would fix next week's lineup before the manager finishes this week's moves.
The Upgrade read must derive next week's roster without materializing it.
