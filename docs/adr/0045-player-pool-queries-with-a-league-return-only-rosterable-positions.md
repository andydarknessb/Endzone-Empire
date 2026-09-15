# Player pool queries carrying a league return only rosterable positions

Status: accepted (2026-09-15)

The Players page offered the same hardcoded position filter in every league:
QB through DEF plus six individual defender codes. A league whose roster
template has no IDP slot still listed DE, DT, LB, CB, S and DB chips and
still returned those players under "All", so managers browsed a pool their
league could never roster. There was no flex option at all, though the
roster template already knows which positions FLEX and SFLX accept. The
glossary now defines a Rosterable position as one some starting slot in the
league's template accepts, and makes "IDP league" a consequence of that
rather than a flag.

We decide that a player pool query carrying a league id returns only players
at that league's rosterable positions, computed on the server from the
league's roster template through the existing slot-eligibility expansion.
The query accepts a set of positions rather than one; the server intersects
the requested set (or "All") with the rosterable set. The client derives the
chips from the same template, one per starting slot key in canonical order,
and expands a flex-type chip to its slot's eligible positions before asking.
A missing league, or an empty template, means no gate: the canonical set.
Deep links to a player's profile are unaffected.

## Considered options

- **Gate on the server, keyed by league (chosen).** "All" is league-scoped
  in one place, and every surface that queries the pool with a league
  (Players page now, draft room pool later) gets the rule for free.
- **Gate only on the client.** Rejected: "All" would still return IDP
  players, and the draft room would need its own copy of the rule.
- **A league-level IDP flag.** Rejected: it would be a second source of
  truth beside the roster template and would not cover a league that
  drops K or DEF.
- **Server resolves slot keys.** Rejected: nothing else on the players
  endpoint understands slots; keeping the contract in positions keeps the
  server rule to one intersection.

## Consequences

- The players endpoint's response for the same position query differs by
  league. Callers that want the unscoped pool omit the league id.
- Slot-eligibility expansion stays hand-mirrored between client and server,
  as the draft-sim templates already record; neither side gains a third copy.
- A commissioner who edits the roster template changes the pool the Players
  page shows the next time it loads.
