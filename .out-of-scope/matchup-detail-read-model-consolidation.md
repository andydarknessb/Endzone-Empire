# Matchup detail read-model consolidation

The Matchup detail route keeps its own lineup reads and its own pricing pass.
They will not be folded into the expected-final producer.

## Why this is out of scope

The route looks like a read model wearing an Express handler. It opens its own
transaction, reads both sides' lineup rows, and prices every row with the same
expression the producer already evaluated and kept. Removing that duplication is
an obvious-looking cleanup, and four separate framings of it have now been
refuted, each on different evidence.

**"Have the producer emit the extra columns."** The producer discards the
optimizer's slot on its way out, mapping the chosen lineup down to player ids.
Emitting "the slot it already reads" emits the stored slot, which in best ball
is Bench for every starter.

**"Call the producer directly instead of through the decoration step."** The
decoration step skips the producer entirely for a settled matchup, and week
advance marks every matchup settled. A settled matchup therefore has no producer
rows to read at all.

**"Read the producer's price instead of pricing again."** Same root cause, worse
consequence. With no producer rows for a settled matchup, the priced figure is
absent for every player, and the route would ship a completed week's box score
with no per-player points beside a full stat line. The route's own pricing is not
redundant; it is the fallback that makes a settled week and a producer outage
render at all. The handler already says so in its shape: every producer-derived
field is guarded against a missing price, and points deliberately is not.

**"Widen the producer's rows and build the page from them."** Free for the
producer's other callers, and still not enough. The producer's rows carry no
name, headshot, injury designation or stat line, so the route's reads cannot be
deleted; and the page's starters come from a slot the producer does not emit and
best ball never assigns.

The shape underneath all four is the same: the producer is a **live-week**
instrument. It is skipped for a settled matchup by design, and it prices for a
projection, not for a record. The detail route has to answer both weeks. A single
read model that serves both is a larger design than the duplication costs.

What was real inside the finding has been extracted and filed on its own terms:
the settled week reading the wrong population, the best-ball starter list, the
transaction that writes nothing, and the fourth population in the same response
body. Those are defects with observable symptoms. The consolidation is not.

A future change should come with the settled-matchup read path mapped end to end,
and should say where the detail page's rows come from for a settled week before
proposing where they stop coming from today.

## Prior requests

- #955 - "Matchup detail duplicates the expected-final lineup read and prices it twice"
