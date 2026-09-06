# Game Center and Matchup Detail join the island

Status: accepted (2026-09-05)

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
