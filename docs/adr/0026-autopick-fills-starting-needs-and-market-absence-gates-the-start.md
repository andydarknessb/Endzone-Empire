# Autopick fills Starting needs first, and market absence gates the start

Status: accepted (2026-09-02)

The MinneApple draft (league 137, 2026-08-31) ran 128 autopicks through
an ordering that was queue first and then Best available, with no view of
the team's roster or the league's starting slots. The market was present:
team 249's autopicks tracked ADP almost pick for pick and it finished with
six quarterbacks and no tight end; three teams finished without a defense.
The 2026-09-01 review's candidate for this bug proposed deepening Best
available with a roster-shape filter and a loud refusal when ADP is absent
league-wide.

We decide two things.

First, the deepening target is Autopick, not Best available. Best available
is a comparator over a player's market number, last season's points and
name; it is shared by the Draft pool and by autopick precisely because it
knows nothing about any team. A rule about one team's roster belongs to
the act that drafts for that team. Autopick now walks three deterministic
phases: the queue, then Best available among players who fill a Starting
need, then Best available among everyone else, with kickers and defenses
held to the last three rounds unless they are all that remains. "Fills a
Starting need" is computed exactly (maximum matching against the league's
starting-slot instances), because commissioner roster_slots can overlap
without nesting and a greedy scan strands players.

Second, a thin market gates the start of a draft and never an expiry. Once
picks are landing, refusing to autopick is a stall, which is the failure
class the Pick clock module exists to prevent; a points-ordered autopick is
strictly better than a paused room. So manual start refuses with a 409 and
scheduled autostart flags the league and notifies its commissioners, both
before anyone is on the clock, and the expiry path degrades exactly as it
did before.

## Considered options

- **Widen Best available to take team context.** Rejected. It would make
  the Draft pool's ordering depend on a parameter it cannot supply and
  break the shared-usage guarantee for no gain.
- **A weighted need score, as the Draft Sim's CPU brain uses.** Rejected for
  the real draft. The Sim's score carries jitter by design; a real draft is
  a record people argue about and must be explainable in one sentence.
- **Refuse at expiry and pause the draft.** Rejected for the reason above.
  #602 pauses only when nothing at all is draftable, which is a roster
  fact, not a data fact.

## Consequences

- The Draft Sim keeps its own need logic on the client; the two sides share
  the comparator and one named constant (the kicker/defense window), pinned
  by a parity test.
- The queue stays sovereign: a queued sixth quarterback is still honored.
  Protecting a manager from their own queue is a different product decision.
- The start gate needs the market to be an observable fact, which is why the
  sync record and the scheduled sync ship with the gate (#747) rather than
  with this ADR's implementation (#746).
