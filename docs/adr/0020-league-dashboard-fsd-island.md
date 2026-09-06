# Grow the FSD island to cover the League Dashboard

Status: accepted (2026-09-01); scope superseded by ADR 0029 (2026-09-04)

ADR 0017 established a local Feature-Sliced Design island for the Draft order
controls (`src/widgets/draft-order`, `src/features/autodraft-toggle`) rather
than migrating the whole frontend into FSD. The League Dashboard redesign
(spec #617) rebuilds a second surface in the same style, so the island grows to
cover it. This ADR supersedes the scope line of ADR 0017: the island is no
longer only the Draft order controls, it now also covers the League Dashboard
surface. Everything else ADR 0017 decided still stands. ADR 0017's own Status
line is amended in place to point here ("scope superseded by ADR 0020"), which
the immutability guard explicitly permits for a Status line
(`scripts/ci/check-adr-immutability.js`); no other line of 0017 is touched. So
a reader who lands on ADR 0017 is routed here.

The League Dashboard island will comprise (this ADR is the foundation ticket;
`src/shared/ui` and the token group ship with it, and the slices below are
introduced by the eight tickets that build on it, so at this ADR's own commit
only `src/shared/ui`, `src/widgets/draft-order` and `src/features/autodraft-toggle`
exist):

- `src/pages/league-dashboard`, the page slice that composes the widgets.
- Six widget slices: `src/widgets/my-team-summary`, `matchup-preview`,
  `standings-table`, `draft-grades`, `quick-actions`, `commissioner-panel`.
- Two feature slices: `src/features/copy-invite`, `src/features/advance-week`.
- `src/shared/ui`, a shared presentation layer (Card, Badge, GradeChip,
  Skeleton) themed by the dashboard token group in `src/theme/tokens.js`.

The import rules for the island are:

- Each widget and feature exposes its public surface through an index file
  (`src/widgets/<slice>/index.js`), and consumers import only from that index,
  never from a slice's internal files.
- The page composes widgets and features. Widgets do not import each other; a
  value two widgets both need is passed down by the page, not shared sideways.
- `shared/ui` depends on nothing above it (no widget, feature, or page). It is
  the bottom of the island and is reusable by any future league surface.

These import rules are, today, an UNAUDITED convention in the sense of ADR
0010: nothing reads them. No lint rule or guard fails when a slice is imported
by its internal path or when two widgets import each other, and the older
`src/widgets/draft-order` slice (ADR 0017) predates the index rule and does not
follow it. So this ADR records the rules as unaudited on purpose, not as a
guaranteed-enforced boundary; a `shared/ui/index.js` public surface ships with
this foundation as the one worked example, and a boundary lint rule (an
eslint-plugin-boundaries or import/no-internal-modules config) is the follow-up
that would make the convention audited. Until that consumer exists, the rules
bind by review, not by a check.

This keeps the redesign local and testable at one seam (the composed page) while
leaving a clean, boring contract for the six widget slices and two feature
slices that build on this foundation. A future repo-wide FSD migration stays
possible but is still not a prerequisite.

## Consequences

- `src/shared/ui` is a reusable kit: Card, Badge, GradeChip and Skeleton are
  built once here and composed by every widget, so future league surfaces
  reuse them instead of re-importing raw MUI ad hoc.
- The widget-does-not-import-widget rule means one widget's change cannot reach
  through another's internals; the page is the only place cross-widget data is
  wired, so the composition stays visible in one file.
- The dashboard token group lives in the single source of truth
  (`src/theme/tokens.js`), and every ink-on-surface pairing a widget composes
  from it (text tiers on each surface, grade-as-chip and grade-as-text, the
  accent tint over each backdrop, the button label) is registered in
  `tokens.contrast.test.js` in both themes. The guard certifies exactly the
  pairings it lists (ADR 0010): a pairing a widget invents that is not on that
  list is not covered, so a widget adding a new token-on-surface combination
  registers it there rather than assuming the group is blanket-safe. Two such
  boundaries are load-bearing and cannot be widened by retuning without
  collapsing a tier, so they are rules for the widget tickets, not just guard
  rows:
    - Faint text on the accent tint (`dash-faint` on `dash-accent-soft`, the
      `tr.me` rank cell) is legible only over a card (`dash-surface`). This is
      one uniform rule, deliberately a touch stricter than dark mode alone
      requires: faint on the tint over the page background passes in dark (5.48)
      but fails in light (4.15), so the card-only rule errs safe across both
      modes. A tinted element on any other surface uses ink for its text (ink is
      registered on the tint over all four surfaces), never faint or dim - dim
      also fails on the tint over the raised tile (4.37 light / 4.20 dark).
    - Grade-as-text (`dash-grade-*-text`) is legible on a card (`dash-surface`)
      and a stat tile (`dash-surface2`), not on the raised tile
      (`dash-surface3`), where light grade-b text is 4.40. Grade text is not
      painted on the raised tile.
- ADR 0004 (the resource cache and its more-than-one-mount admission rule) and
  ADR 0007 (interaction-test style) continue to govern the data seam and the
  tests; this ADR does not change them.
- The committed design source `docs/design/dashboard-concept.html` contains
  em-dashes (in its copy and its empty standings cells). It is a reference, not
  shipped copy, and the em-dash guard (ADR 0016) scans only `.js`/`.jsx` under
  `src/` and `server/`, so it does not reach the mockup. A widget transcribing
  the mockup's strings rewrites those em-dashes to house style (middot
  separators, en-dash ranges), as spec #617 already directs.
- ADR 0017's Status line now reads "scope superseded by ADR 0020", so a reader
  following the Draft order island to the Dashboard island is routed here from
  0017 itself, not only from this ADR.

## Amendment (2026-09-02, #669): `shared/lib` is a second bottom-layer directory

The island gains a second shared bottom layer, `src/shared/lib`, a sibling of
`src/shared/ui`. It holds the island's shared non-presentational code, exposes
its public surface through `src/shared/lib/index.js` (consumers import from that
index, never from a module file directly), and is governed by the same rule
`shared/ui` is: it depends on nothing above it (no widget, feature, or page) and
is reusable by any future league surface. It is the bottom of the island for
logic the way `shared/ui` is for presentation.

Its first inhabitant is `useEndpoint`, the one-GET-bound-to-a-URL read hook
(#669). Four dashboard widget models (`my-team-summary`, `matchup-preview`,
`draft-grades`, `quick-actions`) had each grown a private copy of it, and the
copies had already diverged: only `draft-grades` still reported a failure's HTTP
status, so the other three had silently inherited the absence of a capability
the template once had. The shared hook adopts the superset shape (it reports the
failing response's HTTP status, nullable; callers that degrade every failure
identically ignore that field) and the four widgets now consume it.

Like the rest of this island's import rules, the `shared/lib` boundary is an
UNAUDITED convention in the sense of ADR 0010: no lint rule or guard fails when
a consumer imports a module by its internal path instead of the index, or when
something inside `shared/lib` reaches up into a widget, feature, or page. The
boundary lint rule named as this ADR's follow-up would cover `shared/lib` as
well as `shared/ui`. Until that consumer exists, the rule binds by review, not
by a check.
