# Design canvases

How the `/design` skill (Claude Design canvas, published as an Artifact)
works inside this repo. Read before drafting any mockup, screen flow,
wireframe or marketing artboard for Endzone Empire.

## Match the app, from source

The design system has one source of truth: `src/theme/tokens.js`. Every
color, radius, spacing step, shadow and motion value lives there, and two
consumers derive from it: `buildTheme()` in `src/theme/AppThemeProvider.jsx`
(the MUI palette, shape, typography and component overrides) and the CSS
custom properties it writes onto `<html>` (`--bg-page`, `--accent`,
`--radius-md`, ...). `src/theme/base.css` holds the global resets, the
link and focus-ring rules, and the reduced-motion policy.

Lift exact values from those three files into each artboard as inline
styles. Do not round to a grid and do not invent a color: if a token is
missing, use the nearest semantic one and say so at handover. A concept
that departs from the tokens (a new palette, a new type pairing) is a
design proposal, not a mockup of the app; label it as such on the canvas.

Both themes are real. `data-theme="light"` and `data-theme="dark"` are
resolved from the same token names, so an artboard that shows one theme
must use that theme's literal values (`colorTokens.light` or
`colorTokens.dark`), never a mix. A dashboard or screen mockup ships as
two artboards, one per theme, unless the brief names one.

Two visual generations coexist. Legacy pages under `src/components/` use
the app tokens (`accent`, `surface`, `text-muted`) and MUI's ramp from
`buildTheme()`: Inter with Roboto/Helvetica/Arial fallbacks, `h1` 2.5rem/800 down to `h6` 1rem/600, buttons at weight 600
with no text transform, and the `stat` variant (tabular numerals, 600)
for any score or points figure. Standard components come from MUI with
the repo's overrides: cards are elevation 0 with a `border-subtle`
hairline, 16px radius and `shadow-1`; buttons are 10px radius with no
elevation; chips are pills at weight 600; table bodies stripe with
`row-stripe` and hover with `row-hover`.

The FSD island (ADR 0017, 0020, 0029: `src/pages`, `widgets`, `features`,
`entities`, `shared`) uses the `dash-*` token group in the same file:
Barlow Condensed for display type and scores, Archivo for body (both
self-hosted in `src/assets/fonts`), 14px card radius, `dash-surface`
cards with a `dash-line` hairline, and `shared/ui` Card, Badge and
Skeleton. New league surfaces are drawn in this generation; the committed
`docs/design/dashboard-concept.html` is its reference source (ADR 0020).

Position colors are a data encoding, not decoration: `pos-qb`, `pos-rb`,
`pos-wr`, `pos-te`, `pos-k`, `pos-def`, `pos-idp` carry `text-inverse`
labels at AA in both themes. Medal accents are `warning` (gold),
`medal-silver`, `medal-bronze`.

## Find the closest screen first

Screens live one directory each under `src/components/`. Before drawing,
open the component nearest the brief and its `.css` or `sx` styles, and
reproduce its anatomy (app bar height, panel padding, table density)
rather than a generic layout. Frequent targets: `Nav` (app bar),
`LeagueDashboard`, `LineupScreen`, `DraftBoard` and `DraftCentral`,
`GameCenter` and `MatchupDetail`, `WaiverWire`, `TradeCenter`,
`PlayerQuickView`, `LandingPage` and `public/` (the SEO layer). Say in one
line which screen and tokens you matched.

## House style carries into copy

Everything ADR 0016 says about user-facing copy applies to artboard
text: no em dashes, middot separators, hyphen scores, en-dash ranges. A
mockup with em dashes will be pasted into a component and trip
`npm run guards`. Icons are inline stroke SVG on a 20 or 24px grid; the
product uses no emoji.

## Where the files go

Working files for a canvas (`Main.dc.html`, siblings, `canvas.json`,
images) live under `docs/design/<slug>/`, one directory per canvas, so a
later session can re-seed from them. When the artboards are generated,
the generator (`build.mjs`) lives beside them and is the file to edit;
the `.dc.html` files are its output. Keep the seeded output `.html` out
of the tree; it is regenerated on every save. Files under `docs/` are
outside every guard's scan roots (`src/`, `server/`), so a stray em dash
there fails no build, which is exactly why the copy rule above is stated
here rather than enforced.

Name the canvas as the user would (`league-dashboard-redesign`, "League
Dashboard Redesign"), and when the canvas is for an issue, put the issue
number in the handover and link the artifact from the issue.

## Contrast is asserted, not eyeballed

`src/theme/tokens.contrast.test.js` checks the listed text/background
pairings at AA. A mockup that introduces a new pairing (new text color on
an existing surface, or a new surface) is proposing a pairing the guard
does not yet cover: name it at handover so the implementing ticket adds
it to the test, per the existing convention that a pairing is checked
only if listed.
