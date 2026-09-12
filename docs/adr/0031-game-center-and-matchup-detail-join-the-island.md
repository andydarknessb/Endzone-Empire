# Game Center and Matchup Detail join the island

Status: accepted (2026-09-05); scope superseded by ADR 0034 (2026-09-09)

ADR 0017 opened a local Feature-Sliced Design island, ADR 0020 grew it to
cover the League Dashboard, and ADR 0029 gave it an `entities` layer whose
first slice is the Matchup read model. Game Center and Matchup Detail were the
two surfaces that read that entity from outside the island: legacy pages under
`src/components`, on the app tokens and MUI's Inter ramp, while the League
Dashboard one click away runs on the `dash-*` token group, Barlow Condensed
and Archivo, and the `shared/ui` kit. The 2026-09-05 UI audit (spec #890, the
design canvas committed under `docs/design/game-center-matchups/`) found the
two pages had drifted from the dashboard in every visible respect and from
each other in several: no avatars or record on the hero, scores set in body
type, a win probability bar without per-side percentages, a sticky scoreboard
that lost the two numbers a manager scrolls back for, slot rows that could not
say which starters were done, live or yet to play.

We decide that the island now covers Game Center and Matchup Detail. Each
becomes a page slice (`src/pages/game-center`, `src/pages/matchup`) composed
from widget and feature slices that read only `entities/matchup` and `shared`.
This ADR supersedes the scope line of ADR 0029 the way 0029 superseded 0020's;
0029's Status line is amended in place, which the immutability guard permits,
and nothing else in it changes. ADR 0020's import rules and ADR 0029's entity
rules bind unchanged, and remain unaudited in the sense of ADR 0010 until the
boundary lint rule 0020 names exists.

The slices, in the order the spec's tickets deliver them:

- `src/shared/ui` gains StatTile, SplitBar, PosChip and SegmentedControl.
- Widgets: `matchup-hero`, `matchup-grid`, `scoring-feed`, `scoreboard-strip`,
  `slot-comparison`, `nfl-game-strip`, `retro-scoreboard`.
- Features: `pick-week`, `bench-what-if`, `toggle-matchup-view`,
  `celebrate-touchdown`.
- Pages: `game-center`, `matchup`; the `src/components` pages they replace are
  deleted with their tests.

Rulings recorded on the spec that shape the slices:

- Team record does not join the wire. The page passes standings down to the
  widgets that show a record, the way 0020's page passes shared values down.
- The bench what-if action opens the Lineup page with the swap named; it never
  swaps in place (ADR 0019: Lineup is the sole team management surface).
- Every new ink-on-surface pairing a slice paints (the LED amber on the board
  token, the home and away colors on a tile, the position fills) is registered
  in `tokens.contrast.test.js` in both themes before the slice merges (ADR
  0010: the guard certifies exactly the pairings it lists).

## Considered options

- **Grow the island (chosen).** The entity these pages read already lives in
  the island; the kit they should paint with already exists; the dashboard
  proved the pattern on six widgets.
- **Restyle the legacy pages in place.** Rejected: it keeps two generations of
  page in one tree and re-spells the kit's pieces in MUI `sx` on each page,
  which is how the drift this ADR answers happened.
- **A repo-wide FSD migration first.** Rejected as before (0017, 0020, 0029):
  it is not a prerequisite, and these two surfaces are the ones with a design
  to build to.

## Consequences

- The four new `shared/ui` pieces and their contrast rows ship with the
  foundation ticket, so every widget composes them rather than re-deriving a
  stat tile or a split bar.
- Two more `src/components` pages leave the legacy tree; the remaining ones
  keep importing the entity through its index as 0029 sanctions.
- The `src/hooks` and `src/lib` helpers only these pages used (the win
  probability arithmetic, the play classifier, the default week rule) stay
  where they are; a slice imports them as the entity imports `src/api`, the
  sanctioned reach below the island, until a second island consumer earns them
  a `shared/lib` home.

## Amendment (2026-09-10, #1131): the below-island clause fired

Two of the Consequences bullet's helpers have reached their second island
consumer thresholds and been ruled. The win-probability arithmetic fired
the below-island clause with PR #1120 and now lives in `src/shared/lib` as a
public index export. The play classifier fired the clause too, reaching six
island consumers across four slices, and is ruled to live in `entities/matchup`
as `playLabel`, a Scoring play domain model (#1137: `classifyPlays` folds into
`features/celebrate-touchdown` and its one caller is that feature). The default
week rule is unmeasured and unruled; the next reader should treat that silence
as an open question, not a ruling.

## Amendment (2026-09-10, #1146): the second-island-consumer clause covers presentational components too

The Consequences bullet's below-island clause is worded around helpers
("until a second island consumer earns them a `shared/lib` home"), and neither
of that bullet's own examples was ever a presentational component. #1146 asked
the question directly, raised from the lead review of PR #1142 (#1118): that PR
landed a widget importing `AbbreviationTooltip` out of `src/components/common`,
following the precedent of `TeamAvatar`, already imported the same way by seven
widgets. Neither import had ever been ruled on - the clause names helpers, not
components, and no ADR said whether UI is different.

It is not. The clause is stated once, for a presentational component exactly as
for a helper: an island widget importing below-island for either is sanctioned
only until a second island consumer earns it a shared home - `shared/lib` for a
helper, `shared/ui` for a presentational component, the two bottom-layer
directories ADR 0020 and its amendment already name as siblings.

Ruled under that clause:

- `TeamAvatar` had reached seven island widget consumers (`standings-table`,
  `around-the-league`, `my-team-summary`, `matchup-grid`, `matchup-preview`,
  `scoreboard-strip`, `matchup-hero`), well past the threshold. It moves to
  `shared/ui` as the one canonical implementation, exported through
  `shared/ui`'s index. The seven island widgets import it from that index,
  per ADR 0020's barrel rule for widgets and features. The legacy
  `src/components` consumers that had it (`TradeProposalCard`,
  `TeamAvatarUploader`, `PowerRankings`, `LeagueHistory`, `PickemStandings`)
  are outside the layer that rule governs and import the concrete
  `shared/ui/TeamAvatar` module instead, not the index: a legacy file
  importing the barrel pulls every `shared/ui` module - and, through
  `TeamAvatar`'s own `initialsFor` dependency, `shared/lib`'s index - into
  its bundle, which is what broke the Draft room's harness-coverage guard
  (ADR 0014) and the initial bundle's size budget on this amendment's first
  pass (caught in #1146's review). `TeamAvatar` itself imports `initialsFor`
  from the concrete `shared/lib/initials` module for the same reason, so the
  reach to `shared/lib`'s index (and the non-literal `useEndpoint` GET the
  harness guard refuses) does not exist regardless of how a caller reaches
  `TeamAvatar`. Both directions - island through the barrel, legacy through
  the concrete module - resolve to the same one implementation and duplicate
  nothing; only the import style differs, because ADR 0020's barrel rule
  ("import them ONLY from this index") was written for widgets and features,
  never for a legacy `src/components` file outside the island it governs.
- `initialsFor`, the helper TeamAvatar and two widgets (`retro-scoreboard`,
  `join-requests`) call directly, had already reached its own second island
  consumer. It moves to `shared/lib` alongside TeamAvatar's promotion, under
  the pre-existing helper clause. The two widgets import it from the
  `shared/lib` index, per ADR 0020's amendment; the legacy
  `PlayerQuickView/PlayerAvatar`, outside that layer, imports the concrete
  `shared/lib/initials` module instead, the same split as `TeamAvatar`'s.
  (2026-09-12, #1304: `PlayerAvatar` itself moved into `shared/ui` alongside
  `TeamAvatar` and imports the concrete `shared/lib/initials` module exactly as
  `TeamAvatar` does; the sentence above describes its state before that move
  and is kept as history, not as the current layout.)
- `AbbreviationTooltip` has one island consumer (Draft Grades) and stays below
  the island at `src/components/common/AbbreviationTooltip`: a documented
  temporary edge under this clause until a second island consumer earns it a
  `shared/ui` home. This is the sanctioned instance of the below-island
  component reach going forward, the way ADR 0029's amendment names the
  Matchup entity's below-island edges.
- The reduced-motion still-frame decision (`src/lib/reducedMotionMedia`,
  `shouldShowStillFrame`) stays below the island: it is generic plumbing with
  no presentational identity of its own (GifMessage, outside the island,
  depends on it too) and has not reached a second island consumer under either
  clause.

Like the rest of this ADR's import rules, this remains unaudited in the sense
of ADR 0010: no lint rule enforces the threshold, and the boundary lint rule
ADR 0020 names as a follow-up would need to reach below-island component
imports the way it would reach below-island helper imports. Until it exists,
both halves of the clause bind by review.

## Amendment (2026-09-11, #1246): AbbreviationTooltip's temporary edge closes

`AbbreviationTooltip` reached its second island consumer: the League History
page composes it in the Final Standings PF header, alongside the Draft
Grades widget. Ruled under the #1146 amendment's clause, the same way as
`TeamAvatar` and `initialsFor` before it: it moves to `shared/ui` as the one
canonical implementation, exported through `shared/ui`'s index. The two
island consumers (Draft Grades, League History) import it from that index.
The legacy `src/components` consumers (PlayerDetail, PlayerManagement,
PlayerQuickView, public RankingTable and PlayerProfilePage, DraftBoard's
ColumnGuide and PlayerPoolTable) import the concrete `shared/ui/
AbbreviationTooltip` module instead, the same split as `TeamAvatar`'s. No
below-island reach for this component remains.

## Amendment (2026-09-11, #1269): the slice-level below-island rule, stated

This ADR's own sentence above (Game Center and Matchup Detail's widget and
feature slices "read only `entities/matchup` and `shared`") and its
counterparts on ADR 0037 (Lineup's slices "read only `entities` and `shared`")
and ADR 0038 (Pick'em's slices "read only `entities/pickem-game`,
`entities/pickem-standings` and `shared`") were each copied forward as a
criterion, and #1237 AC1 turned this ADR's wording into a criterion no island
PR meets: this ADR's own Consequences bullet and its 2026-09-10 amendments
above already sanction a widget or feature slice reaching below the island,
on a different test, and the reviewer on #1237 cited ADR 0029, which governs
the entity carve-out only (see that ADR's amendment of this date). None of
the three sentences is edited; each is read under the replacement below from
this date forward, the way this ADR's own Status line already supersedes ADR
0029's scope without touching ADR 0029's text. This amendment carries the
reading for all three; neither ADR 0037 nor ADR 0038 is touched.

Tickets stop writing "widgets read only entities and shared." The
replacement, stated once so a brief can quote it verbatim:

> Slices import `entities` and `shared` through their index files; every
> below-island edge is named with its reason in the slice's index docblock
> (ADR 0031).

The slice-level test, stated completely: a widget or feature slice depends on
nothing above it in the island (no page; widgets never import widgets) and
imports `entities` and `shared` through their index files. Below the island,
it may reach further in two ways:

- Plumbing with no domain meaning - a fetch client, an HTTP failure reader, a
  snackbar provider, a generic event helper - may be reached indefinitely and
  does not count toward the second-consumer threshold below.
- A helper with domain meaning may be reached until a second island slice
  consumes it. At that point it is promoted: a pure function to `shared/lib`,
  a hook or a read model to an entity. A promotion is a move, never a copy,
  the same way the win-probability arithmetic and the On-the-clock derivation
  moved under this ADR's and ADR 0029's earlier amendments. (The parallel rule
  for a presentational component, promoted to `shared/ui` at its second
  island consumer, is already stated for widgets and features by this ADR's
  2026-09-10 amendment above; this amendment restates only the helper test
  that amendment did not cover, not a third promotion home.)

A promotion that needs an entity slice that has not been approved stays a
named held-open edge instead of a promotion, the way the Draft entity's
`deriveOnTheClock` edge was held open until ADR 0029's #997 amendment closed
it. Today's instance: `useLeague`, read by eight widgets, would promote to a
League entity, and a League entity was refused (#942, ruling R4). `useLeague`
stays below the island as a named held-open edge until a League entity is
ruled.

The legacy `src/components` tree counts as the legacy tree for this rule,
exactly as it already does for the component reach this ADR's 2026-09-10
amendment sanctions (`AbbreviationTooltip`'s instance, above).

Every below-island edge, of either kind, is named with its reason in the
slice's index docblock. That docblock is the audit surface for this rule
until the boundary lint rule ADR 0020 names as a follow-up exists, unaudited
in the sense of ADR 0010, exactly as the rest of this ADR's import rules are.

The second-consumer threshold has already fired, unacted on, for several
below-island modules at `integration` as of 2026-09-11; #1272 lists them with
their promotion homes and carries out the moves this rule requires. This
amendment itself moves nothing (ruling R3 on #1269: this ticket changes no
source).
