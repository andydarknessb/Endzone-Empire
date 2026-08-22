# Fix Draft rounds at draft start

Status: accepted (2026-08-22)

Draft rounds, the number of player-claiming rounds in one draft, is currently
computed on every call: `draftRosterSize()` (`server/services/rosterShape.js`)
reads a league's live `roster_limit` and `ir_slots` columns and subtracts one
from the other, and `draftPlayer` (`server/services/draft.service.js`) calls
it fresh each time it checks whether the draft is complete. Nothing pins that
number once a draft starts. We introduce a `draft_rounds` value that is
computed once, at the moment a draft transitions from pending to active, and
never recomputed after that: a pending draft keeps deriving Draft roster size
live, but an active or completed draft reads the fixed value instead. Spec: #109.

## Why

- `roster_limit`'s own meaning has already moved once. The
  `configurable_roster_scoring` migration
  (`server/db/migrations/20260720000001_configurable_roster_scoring.js`)
  changed how bench size is implied for leagues that had customized
  `roster_limit`, and `leagueSettings.service.js` still documents it as a
  derived value the server recomputes from roster shape. A live-derived Draft
  rounds inherits every future reinterpretation of that column automatically,
  including ones aimed at a completely different problem.
- A draft in progress or already finished is exactly the wrong place for that
  drift to land. Pick numbering, keeper round assignments and the Draft board's
  team-by-round matrix are all indexed against however many rounds actually
  ran; silently changing that count after the fact renumbers picks that were
  already made and can strand a keeper outside a shrunk round range.
- Roster shape is already a draft-frozen setting, so a commissioner cannot edit
  it once a draft starts. That protects the input, not the derivation: the
  round count still needs to be fixed independently, because the derivation
  itself (the code, or the meaning of the columns it reads) is not similarly
  locked, and because legacy rows and future migrations are read by the same
  live path.
- A pending draft has no picks, keepers or board to protect, so fixing the
  value early would buy nothing; it keeps deriving Draft roster size live,
  exactly as League settings intends for a draft-frozen setting that has not
  frozen yet.
- Draft start, not settings-freeze time or league-phase transition, is the
  moment the value stops being hypothetical and starts being spent: rounds are
  what the first pick begins consuming.

## Consequences

- Starting a draft computes `draft_rounds` once, from Draft roster size at
  that instant, and persists it. `draftPlayer`'s completion check and every
  other active/completed read use the stored value; none of them call
  `draftRosterSize()` again for that league.
- Existing active and completed drafts, which predate the column, are
  backfilled once from their current `draftRosterSize()` derivation (their
  stored `roster_limit` and `ir_slots`) rather than left null, so historical
  boards and keeper rounds stay intact through the migration. That backfill
  runs once; it is not a standing recomputation path.
- Invalid pending keepers or order overrides are never silently clamped or
  deleted to make them fit a changed round count; they surface as an explicit
  error requiring commissioner repair, consistent with how League settings
  already treats invalid pending configuration.
- `CONTEXT.md`'s Draft rounds entry states the derive-then-fix split directly,
  and Draft roster size stays the term for the live, pending-only computation.
