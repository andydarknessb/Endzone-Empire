# Grow the FSD island to cover the League Dashboard

Status: accepted (2026-09-01)

ADR 0017 established a local Feature-Sliced Design island for the Draft order
controls (`src/widgets/draft-order`, `src/features/autodraft-toggle`) rather
than migrating the whole frontend into FSD. The League Dashboard redesign
(spec #617) rebuilds a second surface in the same style, so the island grows to
cover it. This ADR supersedes the scope line of ADR 0017: the island is no
longer only the Draft order controls, it now also covers the League Dashboard
surface. Everything else ADR 0017 decided still stands. ADR 0017 is left
unedited (merged ADRs are append-only apart from their Status line, and its
decision is extended here, not retired), so this supersession is recorded in
this ADR alone.

The League Dashboard island is:

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
  (`src/theme/tokens.js`) and is contrast-guarded in both themes, so the new
  surface cannot regress accessibility in either mode.
- ADR 0004 (the resource cache and its more-than-one-mount admission rule) and
  ADR 0007 (interaction-test style) continue to govern the data seam and the
  tests; this ADR does not change them.
- ADR 0017 keeps its own Status line; a reader following the Draft order island
  to the Dashboard island arrives here through this ADR's supersession note.
