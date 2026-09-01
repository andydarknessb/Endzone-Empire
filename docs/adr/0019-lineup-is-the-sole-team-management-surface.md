# Make Lineup the sole fantasy Team-management surface

Status: accepted (2026-09-01)

This ADR is retrospective: the decision below shipped with spec #575 (Make
Team the canonical lineup editor), which closed with all seven children
delivered, before this document existed. It is recorded now, after the
fact, so the boundary has a durable reference. Before #575, the fantasy
Team route rendered a Roster Management table and an embedded Lineup
editor as two presentations of the same roster: player actions lived in
the table, lineup assignment lived in the editor, and Lineup rows lost the
richer Roster Management presentation (profile image, position, Bye,
status, acquisition detail). The Team route read as two competing surfaces
rather than one.

We make Lineup the sole fantasy Team-management surface. It retains Team
identity and League context, and owns both roster actions and lineup
assignment: every occupied row, whether Starter, Bench, or IR, uses the
Roster Management presentation, including profile image, position, Bye,
status, acquisition detail, player quick view, Trade, Drop, and Undo.
Standard-league managers make legal lineup moves there; Best Ball keeps
lineup assignment read-only while retaining roster actions. No separate
roster table remains.

This rejects the design #575 replaced: a Roster Management table plus an
embedded Lineup editor, showing the same roster in two shapes and
splitting player actions from lineup assignment. This boundary also
excludes keeping any separate roster table alongside the editor, for
instance one scoped to Bench and IR while the editor kept only Starters.
Both shapes preserve the duplicate-presentation problem the consolidation
exists to remove, so neither survives alongside a single Lineup surface.

## Consequences

- A Team route change that reintroduces a second roster table, or an
  occupied row that does not use the Roster Management presentation, is a
  regression against this boundary, not a stylistic choice.
- Lineup owns the Team header, selected-League context, Team summary,
  roster lifecycle states, selected-week presentation, player quick view,
  Trade, Drop, and Undo, in addition to lineup assignment; a future feature
  that needs one of these does not get to fork a second implementation of
  it.
- The legacy League Lineup URL is a protected compatibility redirect to
  Team preserving the League selection, not a second Lineup screen.
- Best Ball disables manual lineup assignment (including quick-pick and
  slot movement) but not player detail or roster lifecycle actions, so the
  single surface still serves both League types without a second code
  path.
- No schema migration or new server contract was required: the
  consolidation is a client presentation and mutation-entry-point change
  over the existing lineup and roster API boundary.
