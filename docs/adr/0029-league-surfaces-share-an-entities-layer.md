# League surfaces share an entities layer

Status: accepted (2026-09-04)

ADR 0017 opened a local Feature-Sliced Design island and ADR 0020 grew it to
cover the League Dashboard: `shared`, `features`, `widgets` and `pages`, with
`shared` at the bottom depending on nothing above it. The island has no
`entities` layer. The 2026-09-04 architecture review of Game Center and the
Matchup surfaces found one Matchup read in three spellings (the list row's
columns, the detail body's per-side objects, the live score event's flat
camelCase entry), each re-spelled inline by Game Center, Matchup Detail and the
matchup-preview widget, with a fourth re-spelling in a Team identity patcher.
The number is the same everywhere; only the spelling differs, and the spelling
has already drifted (Matchup Detail stores players remaining and never renders
it). A module that owns the one spelling is domain vocabulary, a Matchup as the
client knows it, and it must be importable by an island widget and by two
legacy pages under `src/components` at once.

We decide that the island gains an `entities` layer, `src/entities/<slice>`,
sitting between `shared` and `features`/`widgets`, and that its first slice is
`src/entities/matchup`: the pure Matchup read model (three wire shapes in, one
per-side shape out, a live score update applied, a Team identity patch applied,
starters paired under the league's slot order) and the thin hooks that compose
a plain fetch with the score feed over it. This ADR supersedes the scope line of
ADR 0020 the way 0020 superseded 0017's; 0020's Status line is amended in
place, which the immutability guard permits, and nothing else in it changes.

Import rules, added to 0020's:

- An entity imports `shared` only. It never imports a feature, a widget, a page
  or another entity.
- Features, widgets, pages and the legacy `src/components` pages import an
  entity through its index file only, never an internal path. A legacy page
  importing an entity is the sanctioned bridge from the old tree into the
  island: the island grows one entity at a time and a repo-wide migration is
  still not a prerequisite.
- These rules are unaudited in the sense of ADR 0010, exactly as 0020's are,
  and bind by review until the boundary lint rule 0020 names as a follow-up
  exists.

## Considered options

- **An entities layer (chosen).** The read model is domain vocabulary that
  both island and legacy surfaces need, and FSD already has the word for it.
- **`src/shared/lib`, beside the shared endpoint hook.** Rejected: `shared` is
  plumbing with no domain meaning (a GET bound to a URL, a socket factory). A
  Matchup that knows what Expected final and Players remaining are does not
  belong at the bottom of the island.
- **`src/lib`, outside the island.** Rejected: the island would then depend on
  non-island code for a domain concept, inverting the direction 0020 set.
- **Leave the three spellings and document them.** Rejected: the 70-line
  docblock in the matchup-preview widget that explains why two of the
  spellings are not interchangeable is that documentation, and it did not stop
  three consecutive fixes to the same merge.

## Consequences

- The three renders (Game Center, Matchup Detail, matchup-preview) read one
  shape and stop knowing database column names.
- The spelling reconciliation is a table test on the entity with no render and
  no socket double; the page tests keep one render each proving a model update
  reaches the DOM.
- A second entity (a League, a Team) joins the same layer under the same rules
  when a surface needs it; nothing here decides which comes next.

## Amendment (2026-09-05, #874): the entity import rule is directional, not an allowlist

The first import rule above reads as an allowlist ("An entity imports `shared`
only") and the landed Matchup entity does not obey it: its two hooks import
`src/api/apiClient` and `src/lib/teamProfileEvents`, and its model imports
`src/lib/teamProfileEvents` alone, none of which is `shared`. ADR 0020's
parallel rule for `shared/lib` is directional -
"it depends on nothing above it" - and the code follows that shape at every
layer, including this one. This amendment restates the rule to match, and the
original sentence is superseded in place; it is not edited.

The entity import rule now reads: an entity depends on nothing above it in the
island (no feature, widget, page or other entity) and imports `shared` through
its index. Below the island, an entity may import from the legacy tree only
for plumbing with no domain meaning (a fetch client, a generic subscription or
event helper). It never reaches below for a domain concept; a domain concept
an entity needs is the entity's own to model, which is what this ADR's
rejected "`src/lib`, outside the island" option was guarding against, and that
option remains rejected.

The Matchup entity's two below-island edges are the sanctioned instances of
this rule: `src/api/apiClient` (a plain fetch, the same module
`shared/lib/useEndpoint` reads, imported by the two hooks and not by the
model) and `src/lib/teamProfileEvents` (the existing generic Team profile
event helper, mandated by the entity's originating brief, imported by the
model and both hooks). Each is named, with its reason, in the entity's index
docblock (`src/entities/matchup/index.js`), and that docblock is the audit
surface for the entity's below-island edges until the boundary lint rule ADR
0020 names as a follow-up exists - unaudited in the sense of ADR 0010, exactly
as the rest of this ADR's import rules are.
