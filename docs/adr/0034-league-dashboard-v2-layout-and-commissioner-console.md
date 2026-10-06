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

## Amendment (2026-10-04, #1993): the dashboard no longer carries Draft Grades

The composition rule above (every desktop row is two columns of comparable
height) held on the 2026-09-09 audit's league and broke on a real 12-team league
in season (league 71, Week 4, 1440 wide), twice. #1979 L5 had swapped the rail
and second-row occupants for the live season: the main row paired the standings
(12 rows) with a Recent activity rail capped at `min(8, teams)` rows, which
ended about 170px above the standings, and the second row paired Quick Actions
(about 580px) with Draft Grades (12 rows plus its explainer, about 850px), which
left about 300px of bare page under Quick Actions. Reverting the swap alone does
not close this: Draft Grades and Quick Actions are never a comparable-height
pair at 12 teams, and no row cap can make them one.

The product owner ruled that Draft Grades leaves the dashboard in every phase,
because nothing is lost: League History already shows every Team's draft grades
per season, My Team keeps the viewer's own grade tile, and the Draft Room offers
"review the board". `GET /api/league/:id/draft-grades` stays (My Team reads it).
The composition is now:

- Main row: the standings beside a rail holding Recent activity, in every phase,
  sticky at `md`. At `md` and up the card shows `min(teams, 12)` rows (it
  fetches 12; the phone cap of 5 stays), one row per Team as the standings have,
  so the two columns end about together by construction (the layout spec bounds
  the difference at 120px).
- Quick Actions is alone in its row at the full content width, in every league
  kind, with one column per group from `md` (three for a fantasy league, two for
  a pick'em-only one). The second-row grid and the pick'em-only duplicate mount
  are gone.

The comparable-height rule reads, for a row with a single card, as that card
spanning the row: a lone full-width card has no neighbour to leave bare page
beside. `src/widgets/draft-grades` and `src/features/toggle-grade-details` (its
only consumer) are deleted. The earlier text of this ADR stands as written.

### Correction (2026-10-04, #1993, after QA)

The amendment above says Recent activity shows `min(teams, 12)` rows, "one row
per Team as the standings have", so the rail ends about with the standings.
Measured, a standings row is 49.0px and an activity row 58.8px (6:5), so one
row per Team overshoots. The card shows `ceil(teams * 5 / 6)` rows instead (5 at
6 teams, 10 at 12, 17 at 20, the largest league) and fetches 17. That measures
within about 40px of the standings for 4 to 20 teams once the feed has that
many rows, and falls shorter when the feed is short (a league early in its
life); the layout spec bounds the rail card at 60px of the standings and the
main row at 120px. Quick Actions' status line also wraps between `md` and `lg`
now, since each of its three columns has a third of the card there.

### Amendment (2026-10-06, #1998): a short feed stacks the rail card under the standings

"The standings beside a rail holding Recent activity, in every phase" holds
only while the feed fills the rail. At `md` and up the two sit side by side
when the card shows `ceil(teams * 5 / 6)` rows, which is when the feed has at
least that many. When the feed has resolved with fewer (zero rows and a failed
read included), the card cannot fill its column and the rail would be bare page
beside the standings (measured at 12 teams: 611px, 551px and 447px). The
standings then span the full row and Recent activity sits under them at full
width, showing every row it has: the lone full-width card rule above, applied to
the main row. While the feed is loading the row stays two columns (the skeleton
is already rail height), so a league with a short feed sees one reflow when the
feed resolves and a league past its first weeks sees none. Below `md` nothing
changes.

The card reports the verdict up (`onFeedShort`) rather than the page reading
the feed: `useEndpoint` has no cache, so a second caller of
`useLeagueTransactions` would be a second `GET /api/league/:id/transactions`,
and the dashboard keeps making one. A filler card and a Commissioner-only
join-request card in the rail were both rejected: the first is new content with
no design canvas, the second fills the rail for one role only.
