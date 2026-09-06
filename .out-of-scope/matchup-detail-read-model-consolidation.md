# Matchup detail read-model consolidation

The Matchup detail route keeps its own lineup reads and its own pricing pass.
They will not be folded into the expected-final producer.

## Why this is out of scope

The route looks like a read model wearing an Express handler. It opens its own
transaction, reads both sides' lineup rows, and prices every row with the same
expression the producer already evaluated and kept. Removing that duplication is
an obvious-looking cleanup, and four framings of it have now been refuted. Three
of the four collapse onto the same fact, which is why the fourth keeps coming
back in a new costume.

**The fact: the producer is not run for a settled matchup.** The decoration step
filters out any matchup marked final before it reads anything, and advancing the
week marks every matchup final. So for a completed week there are no producer
rows for the route to read, whatever the producer emits.

**"Have the producer emit the extra columns."** In its weak form this means
emitting the stored lineup slot, which in best ball is Bench for every starter,
because best ball's managed paths assign no starting slot. The strong form is
better and still fails: the producer holds the optimizer's chosen slot and drops
it in one expression, so keeping it is a small change that would serve a live
best-ball matchup. It serves no settled one, because the producer does not run.

**"Call the producer directly instead of through the decoration step."** The same
fact, met head on. A settled matchup has no producer rows to call for.

**"Read the producer's price instead of pricing again."** The same fact, worse
consequence. With no producer rows for a settled matchup, the priced figure is
absent for every player, and the route would ship a completed week's box score
with no per-player points beside a full stat line. The route's own pricing is not
redundant; it is the fallback that makes a settled week and a producer outage
render at all. The handler already says so in its shape: every producer-derived
field is guarded against a missing price, and points deliberately is not.

**"Widen the producer's rows and build the page from them."** Free for the
producer's other callers, and still not enough, for the same reason. Even a fully
widened producer emits nothing for a completed week, so the route's own reads
survive the widening on every settled page, and the duplication survives with
them. The widening is also larger than it looks: the producer emits no name,
headshot, injury designation or stat line, though its select list already reads
the last two.

The shape underneath all four is that the producer is a **live-week instrument**.
It prices actual points with the identical pricer, the identical rules object and
the identical expression the route uses, so this is not a difference in what it
prices. It is that its price exists only for a week that is still open. The
detail route has to answer both weeks, and a single read model that serves both
is a larger design than the duplication costs.

What was real inside the finding has been extracted and filed on its own terms:
the settled week reading the wrong population, the best-ball starter list, the
transaction that writes nothing, and the fourth population in the same response
body. Those are defects with observable symptoms. The consolidation is not.

A future change should come with the settled-matchup read path mapped end to end,
and should say where the detail page's rows come from for a settled week before
proposing where they stop coming from today.

## Prior requests

- #955 - "Matchup detail duplicates the expected-final lineup read and prices it twice"
