# League Dashboard v2 layout and the commissioner console

Status: accepted (2026-09-09)

ADR 0017 opened a local Feature-Sliced Design island, ADR 0020 grew it to
cover the League Dashboard, ADR 0029 gave it an `entities` layer, and ADR 0031
grew it again to cover Game Center and Matchup Detail. The 2026-09-09 audit of
the League Dashboard (spec #1097, design canvas
https://claude.ai/code/artifact/c594a615-f671-40cb-b536-5269053ad09f) measured
the dashboard on production (league 137, commissioner view, the app's 1200px
`lg` container): a 155px gap under the hero, a 919px gap under the standings,
a commissioner administration tree that overflows its 377px rail card by
nearly 300px, and a Quick Actions grid where the Moves group fills two of six
tracks and Play fills four of six. The overflow is not a card that needs to be
wider; it is administration rendering on a surface it does not fit.

We decide that the dashboard's composition rule becomes: every desktop row is
two columns of comparable height, and administration never renders on the
dashboard. The island gains one page slice, `src/pages/commissioner-console`
at the route `/league/:leagueId/commissioner`, following the page-slice
pattern `src/pages/game-center` set (ADR 0031), and one new entity slice,
`src/entities/activity`. It joins `src/entities/draft`, `src/entities/matchup`,
`src/entities/roster` and `src/entities/standings`, already in the layer at
this ADR's merge-base, under the import rules ADR 0029 set: an entity depends
on nothing above it in the island and imports `shared` through its index; a
below-island reach is sanctioned only for plumbing with no domain meaning,
named with its reason in the entity's index docblock. `src/entities/roster`
(landed in #1099 and #1111) already supplies the `useTeamLineup` read the
hero's Starters list needs; this ADR opens no new slice for it. This ADR
supersedes the scope line of ADR 0031 the way 0031 superseded 0029's; 0031's
Status line is amended in place, which the immutability guard permits, and
nothing else in it changes.

Rulings recorded on the spec that shape the slices:

- CommissionerTools composes AS-IS in the console (cut ruling on #617); the
  console's first cut is a re-parenting, not a rebuild, and it keeps
  CommissionerTools' own tabs.
- `commissionerFacts(league, teams)` moves from the commissioner panel's
  model into `shared/lib` (a pure reshape of the league payload, no request),
  so both the dashboard's commissioner strip and the console read the one
  function. No League entity slice opens for it (ruling R4 on #942).
- The commissioner strip replaces `widgets/commissioner-panel` in the same
  pull request as the page composition, so no release carries both an
  in-rail administration tree and a strip.
- No new ink-on-surface pairing ships unregistered: every colour this canvas
  paints is already listed in `tokens.contrast.test.js` (ADR 0010, ADR 0020);
  a widget that invents one registers it there first.

## Considered options

- **Grow the island again (chosen).** The entity the new widgets read follows
  ADR 0029's shape, the kit and tokens already exist, and the dashboard and
  Game Center both proved the pattern.
- **Widen the commissioner panel's card instead of routing administration to
  its own page.** Rejected: the audit measured the administration tree
  overflowing its rail card by a wide margin, and a wider card leaves the
  standings row just as bare beside it; nothing short of moving
  administration off the dashboard closes either gap.
- **Fold `activity` into `entities/matchup` rather than open a new slice.**
  Rejected: a league's Activity feed (`GET /api/league/:id/transactions`) is
  its own domain vocabulary, the same reasoning ADR 0029 gave for opening the
  entities layer at all, not a Matchup re-spelling.

## Consequences

- `src/widgets/commissioner-panel` (ADR 0020) is retired in the same PR that
  ships the strip and the console route; the dashboard mounts no
  administration tree at any width.
- `src/entities/activity` is a new island consumer of `shared/lib`'s
  `useEndpoint`, following the four widgets ADR 0020's amendment already
  migrated onto it and the shape `src/entities/roster` already uses.
- ADR 0031's Status line now reads "scope superseded by ADR 0034", so a
  reader following Game Center and Matchup Detail into the island is routed
  here from 0031 itself, not only from this ADR.
- The design canvas working files (`docs/design/league-dashboard-v2/`) join
  the repo's committed design sources (`docs/agents/design.md`), alongside
  `docs/design/dashboard-concept.html`.
