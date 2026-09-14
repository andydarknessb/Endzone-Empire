# Kickoff places unrostered players on waivers by writing the same rows a drop writes

Status: accepted (2026-09-14)

Nothing moved an unrostered player to waivers when his NFL game kicked off.
Availability was decided from `waiver_players` (a row a drop writes, cleared
at drop time plus the league's waiver period) and the post-draft blanket
window, so a player whose team had already played this week stayed a Free
agent and could be added on the spot while his week was known. The glossary
now says a Free agent is unrostered, cleared, and not yet kicked off, and
that kickoff is the clock every time-sensitive rule keys off.

We decide that kickoff puts every unrostered player on the kicked-off team on
waivers by writing the same `waiver_players` row a drop writes: a scheduler
job, once per tick, upserts a row (no dropping team) for every such player in
every league whose draft is complete, with `available_at` set to the week
clear, the week's last kickoff plus the league's waiver period, taking the
later of that and any clear time already on the row. A drop after kickoff
keeps the later time the same way. The roster gate's acquire bundle also asks
the schedule directly, so the Add is refused from the kickoff instant even in
the minutes before the tick has written the row. Everything downstream
(Player Browser, Decision card, Waiver Wire, claims, processing, the digest,
the clear DELETE) reads the one table it already read.

## Considered options

- **Write rows at kickoff (chosen).** One fact, "on waivers", in one table,
  with every consumer unchanged. Costs a few thousand short-lived rows per
  league per week and a chip that can lag the tick by up to five minutes.
- **Derive at read time.** No rows, no lag. Rejected: the rule would live in
  six places (four availability reads, the Waiver Wire list, the claim
  due-query) and claim processing would need the week clear computed inside
  SQL, so the waiver fact would have two sources of truth.
- **Clear at kickoff plus the waiver period, per player.** Rejected: a Sunday
  early player would become addable before Monday night ended, and clears
  would scatter across the week. One weekly clear matches how managers
  already think about waivers.

## Consequences

- A kickoff row has no dropping team, so undo-drop and the interrupted stash
  never apply to it; the upsert must never overwrite those columns on a row a
  drop already wrote.
- The hold applies only once the draft is complete; a league drafting after
  the week's first kickoff sees no kickoff rows until then.
- Bye-week teams and players with no NFL team are never kicked off and stay
  Free agents.
