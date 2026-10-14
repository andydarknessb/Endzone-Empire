---
name: Endzone Empire
description: Private fantasy football and NFL pick'em leagues with friends, free.
colors:
  endzone-green: "#2fd97b"
  endzone-green-light: "#0f6a41"
  fourth-quarter-amber: "#ffb547"
  scoreboard-black: "#07090c"
  signal-blue: "#7eaaff"
  signal-blue-light: "#1e5bb8"
  sideline-green: "#7ee2a8"
  sideline-green-light: "#1b7d4f"
  flag-red: "#ff6b6b"
  flag-red-light: "#c62828"
  caution-gold: "#f0b34e"
  caution-gold-light: "#8a5a00"
  night-field: "#0b1015"
  desk-surface: "#141b23"
  desk-tile: "#1b242f"
  desk-raised: "#222e3b"
  chalk-ink: "#e8eef4"
  dim-ink: "#93a4b5"
  faint-ink: "#8a9bad"
  field-edge: "#6b7c8c"
  morning-field: "#eef2f6"
  paper-surface: "#ffffff"
  paper-tile: "#f4f7fa"
  slate-ink: "#141b23"
  slate-dim: "#55636f"
typography:
  display:
    fontFamily: "\"Barlow Condensed\", Impact, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    fontFeature: "tnum"
  headline:
    fontFamily: "\"Barlow Condensed\", Impact, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.02em"
  body:
    fontFamily: "\"Archivo\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  label:
    fontFamily: "\"Archivo\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.07em"
  button:
    fontFamily: "\"Archivo\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
  label-lg:
    fontFamily: "\"Archivo\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  body-sm:
    fontFamily: "\"Archivo\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-lg:
    fontFamily: "\"Archivo\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "\"Barlow Condensed\", Impact, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  headline-sm:
    fontFamily: "\"Barlow Condensed\", Impact, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.1
    fontFeature: "tnum"
  headline-md:
    fontFamily: "\"Barlow Condensed\", Impact, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.02em"
  display-sm:
    fontFamily: "\"Barlow Condensed\", Impact, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.1
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontWeight: 600
    letterSpacing: "0.1em"
  app-headline:
    fontFamily: "\"Inter\", \"Roboto\", \"Helvetica\", \"Arial\", sans-serif"
    fontSize: "2.5rem"
    fontWeight: 800
    lineHeight: 1.15
rounded:
  sm: "6px"
  button: "9px"
  md: "10px"
  dash: "14px"
  lg: "16px"
  pill: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "24px"
  space-6: "32px"
  space-7: "48px"
  space-8: "64px"
components:
  button-primary:
    backgroundColor: "{colors.endzone-green}"
    textColor: "{colors.night-field}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "0 16px"
    height: "38px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.dim-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "0 16px"
    height: "38px"
  button-ghost-hover:
    textColor: "{colors.chalk-ink}"
  card:
    backgroundColor: "{colors.desk-surface}"
    textColor: "{colors.chalk-ink}"
    rounded: "{rounded.dash}"
  stat-tile:
    backgroundColor: "{colors.desk-tile}"
    textColor: "{colors.chalk-ink}"
    rounded: "{rounded.dash}"
  scoreboard:
    backgroundColor: "{colors.scoreboard-black}"
    textColor: "{colors.fourth-quarter-amber}"
    typography: "{typography.display}"
  app-button:
    backgroundColor: "{colors.signal-blue-light}"
    textColor: "{colors.paper-surface}"
    rounded: "{rounded.md}"
  app-card:
    backgroundColor: "{colors.paper-surface}"
    rounded: "{rounded.lg}"
---

# Design System: Endzone Empire

The values here are a readable mirror of `src/theme/tokens.js`, which stays the single source of truth. When the two disagree, tokens.js wins and this file is stale. The frontmatter lists the dark theme under the plain name and the light theme under a `-light` suffix or its own name.

## Overview

**Creative North Star: "The Commissioner's Desk"**

Endzone Empire is where a league gets run, week after week. The everyday surfaces are a working desk: dense, orderly, and quiet enough to make a lineup or waiver decision in seconds. Hairline cards, tabular numbers, and condensed display type keep a lot of data readable at once. Color on the desk is mostly a data encoding (positions, grades, home and away), not decoration.

The noise lives in the moments. Live games, a final score, a draft grade, a win, a trade landing: these are where the system gets loud and playful, with Endzone Green, Fourth-Quarter Amber on a scoreboard that stays black in both themes, big condensed figures, and the Tecmo-style sprite. A screen earns its loudness from what is happening in the league, never from ornament.

Two visual generations coexist. The **island** (League Dashboard, Game Center, Matchup Detail, Lineup, Pick'em, Waivers, and Home at `/user`) uses the `dash-*` tokens, Barlow Condensed and Archivo, and is where new league surfaces are drawn. **Legacy** pages under `src/components/` use the app tokens and MUI's Inter ramp. Each generation keeps its own tokens; never mix them on one surface.

The system rejects the sportsbook look (odds boards, neon promos, betting urgency) and the cluttered legacy-portal look (ad-shaped boxes, tiny type, every widget competing).

**Key Characteristics:**
- Dark-first and light-complete: every screen ships in both themes from the same token names.
- Condensed display type for names, scores, and stat values; tabular numerals on every figure.
- Flat island cards with a hairline edge; depth comes from tonal surface steps.
- Color encodes data first; the accent is reserved for primary action and live state.
- Contrast is asserted in tests, not eyeballed.

## Colors

A night-field palette of blue-black surfaces with one vivid green, plus a fixed amber-on-black scoreboard.

### Primary
- **Endzone Green**: the island's accent. Primary buttons, the live chip, the "You" pill, and active state. It flips to a deep green in light mode, because the bright dark-mode value cannot carry text on a near-white card. Its soft tint and line (12% and about 35% alpha) mark live and selected states.

### Secondary
- **Signal Blue**: the app accent on legacy pages, links, the focus ring, and the home side of a matchup. It is lightened in dark mode so its hover tint clears AA on the raised app bar.
- **Sideline Green**: the app secondary and success color, and the away side of a matchup. The brand wordmark gradient runs from Signal Blue to Sideline Green.

### Tertiary
- **Fourth-Quarter Amber**: LED digits on the Game Center scoreboard. It sits only on Scoreboard Black, which stays dark in both themes, because a scoreboard is black.
- **Caution Gold**: warnings, the Bench what-if gain chip, and the gold medal.
- **Flag Red**: danger, errors, and the Live pill on the scoring strip.

### Neutral
- **Night Field**: the island page background in dark mode, and the dark ink painted on grade chips and the primary button.
- **Desk Surface, Desk Tile, Desk Raised**: the three dark surface steps (card, stat tile, raised tile). Depth on the island is these steps, not shadows.
- **Chalk Ink, Dim Ink, Faint Ink**: dark-mode text tiers. Faint Ink is the lightest muted tier that still clears AA as body text.
- **Field Edge**: the edge of inputs, selects, steppers, and unselected choice cards, at the 3:1 that WCAG 1.4.11 asks of a boundary. Decorative hairlines cannot stand in for it.
- **Morning Field, Paper Surface, Paper Tile, Slate Ink, Slate Dim**: the light-mode counterparts.

### Data encodings
Position colors (`pos-qb` red, `pos-rb` green, `pos-wr` blue, `pos-te` orange, `pos-k` purple, `pos-def` gray, `pos-idp` teal) and grade colors (A green through F red) are data, not decoration. Each carries an AA label in both themes, and grade text has its own `-text` tokens, separate from the chip fills.

### Named Rules
**The One Truth Rule.** No component hard-codes a color literal. A missing color becomes a new semantic token in `tokens.js`, with its contrast pairing registered in `tokens.contrast.test.js`.

**The Island Boundary Rule.** Island surfaces use only `dash-*` tokens, and legacy pages and the app shell (Nav, Footer) use only app tokens.

**The Tint Placement Rule.** A tinted pill or chip sits only on the surfaces its pairing is registered for. The light danger pill never sits on Desk Raised's light counterpart, and the warning chip sits only on a card or a stat tile.

## Typography

**Display Font:** Barlow Condensed (with Impact, sans-serif)
**Body Font:** Archivo (with Helvetica Neue, Arial, sans-serif)
**Legacy Font:** Inter (with Roboto, Helvetica, Arial), on legacy pages only

**Character:** A condensed sports face set against a sturdy grotesque. Barlow carries the noise (names, scores, stats); Archivo keeps the desk readable. Both are self-hosted woff2 files and never fetched from Google Fonts at runtime.

### Hierarchy
- **Display** (Barlow Condensed 700, 30px, tabular numerals): projected and live scores on a matchup side.
- **Headline** (Barlow Condensed 700, 24px, line height 1.1, 0.02em tracking): team names and stat-tile values.
- **Body** (Archivo 400, 15px, line height 1.5): running text on island surfaces.
- **Button** (Archivo 600, 13px, line height 1.2): island button labels, never uppercased.
- **Label** (Archivo 600, 11px, 0.07em tracking, uppercase): stat-tile keys and small section labels, in Faint Ink.
- **Label large** (Archivo 600, 12px): chip text, card counts and tails, captions, and the deadline sub-line in the to-do list.
- **Body small** (Archivo 400, 14px): dim helper text, link and button labels inside cards, and filter chips. Grade chips are the one 14px use set in Barlow Condensed.
- **Body large** (Archivo 400, 16px): a to-do row's title (weight 600) and the greeting summary line on desktop.
- **Title** (Barlow Condensed 600, 18px, 0.08em tracking, uppercase): feed and highlight card titles, and the to-do deadline value on phones.
- **Headline small** (Barlow Condensed 700, 22px, tabular numerals): the league-code input. The invite code on the created-league screen is also 22px but uses Code.
- **Headline medium** (Barlow Condensed 700, 26px): section and dialog titles, the greeting heading on phones, and the stat-tile value.
- **Display small** (Barlow Condensed 700, 28px): the league name on the Next draft card and the create-league stepper title on phones.
- **Code** (ui-monospace, SFMono-Regular, Consolas, monospace, 600, 0.1em tracking): the invite-code input and the league-code display and input; the size follows the field.
- **Legacy ramp** (Inter): h1 2.5rem/800 down to h6 1rem/600; buttons 600 with no text transform; the `stat` variant (tabular numerals, 600) for any score or points figure.

### Named Rules
**The Tabular Figures Rule.** Every score, point total, projection, and stat is set in tabular numerals so columns line up.

**The Copy House Style Rule.** No em dashes in user-visible copy; use middot separators, hyphen scores, and en-dash ranges (ADR 0016, enforced by `npm run guards`).

## Layout

The spacing scale runs in 4px steps up to 16px, then 24, 32, 48, and 64px (`space-1` to `space-8`). Island card grids auto-fit columns at a 180px minimum with a 14px gap. Card headers pad 14px by 18px over a hairline divider and wrap their title, count, and tail at phone width instead of squeezing them.

Breakpoints are MUI's defaults (sm 600px, md 900px, lg 1200px, xl 1536px). Below md, interactive targets grow to 44px; island buttons are 38px from md up.

Density is high by design: a commissioner's desk shows a lot at once. Compact rows, striped tables, and opaque sticky columns keep scanning fast without crowding.

## Elevation & Depth

The island is flat. Depth comes from stepping between surface tones (page, card, stat tile, raised tile) with hairline edges, not from shadows. Legacy MUI cards carry a light shadow at rest, and Paper elevation maps onto three shadow tokens that differ by theme.

### Shadow Vocabulary
- **shadow-1** (light `0 1px 2px rgba(16, 24, 32, 0.08)`, dark `0 1px 2px rgba(0, 0, 0, 0.45)`): legacy cards at rest.
- **shadow-2** (light `0 4px 12px rgba(16, 24, 32, 0.10)`, dark `0 6px 16px rgba(0, 0, 0, 0.5)`): menus and raised Paper.
- **shadow-3** (light `0 12px 28px rgba(16, 24, 32, 0.16)`, dark `0 14px 32px rgba(0, 0, 0, 0.6)`): dialogs and the highest Paper.

### Named Rules
**The Flat Island Rule.** Island cards never take a shadow. To lift something, step it to the next surface tone.

## Shapes

Corners are gently rounded and consistent per generation: island cards at 14px, island buttons at 9px, legacy cards at 16px, legacy buttons and inputs at 10px, and small elements at 6px. Chips, badges, pills, and scrollbar thumbs are full pills (999px). Edges are 1px hairlines (`dash-line`, about 12% alpha) on cards; inputs take the stronger Field Edge.

## Components

### Buttons
Compact and confident: the island's DashButton is the one canonical implementation.
- **Shape:** gently rounded (9px), 38px tall from md up and 44px below it; the `sm` size is 32px.
- **Primary:** Night Field label on an Endzone Green fill with a matching border. Hover keeps the fill and brightens it slightly (`filter: brightness(1.08)`, eased over 150ms).
- **Ghost:** Dim Ink label, transparent fill, a strong hairline border. Hover moves the label to Chalk Ink and the border to the green accent line.
- **Disabled:** the primary drops its fill for Dim Ink on Desk Raised, so it never reads as live.
- **Legacy:** MUI buttons at 10px radius, weight 600, no elevation, transitions on background, border, and shadow over 150ms.

### Chips
- **Style:** full pills at weight 600. Live chips use accent text on the accent tint with the accent line; Final uses success text on the away tint.
- **Data chips:** position and grade chips are filled with their encoding color and carry the fixed AA label.

### Cards / Containers
- **Corner Style:** 14px on the island, 16px legacy.
- **Background:** Desk Surface on the island (Paper Surface in light); stat tiles step to Desk Tile.
- **Shadow Strategy:** none on the island; shadow-1 on legacy cards (see Elevation & Depth).
- **Border:** a 1px hairline.
- **Internal Padding:** a header row at 14px by 18px over a divider, then body content on the spacing scale.

### Inputs / Fields
- **Style:** a Field Edge boundary that meets 3:1 against the page, a card, or a stat tile.
- **Focus:** the global ring, a 2px solid outline in the focus-ring color offset by 2px, on every focusable control in both themes.

### Navigation
The app shell (Nav, Footer) stays in the app generation with app tokens, even when it frames an island surface.

### Scoreboard
The Game Center scoreboard view: Fourth-Quarter Amber LED digits in Barlow Condensed on Scoreboard Black, with a dimmed amber for unlit segments. It stays dark in both themes.

### Stat Tile
An uppercase Label key in Faint Ink above a Headline-size value in tabular Barlow Condensed, with an optional small Archivo unit in Dim Ink.

## Do's and Don'ts

### Do:
- **Do** take every value from `src/theme/tokens.js`, and add a semantic token (and its contrast pairing) when one is missing.
- **Do** ship both themes for every screen, using each theme's own values and never a mix.
- **Do** set every figure in tabular numerals, with Barlow Condensed for scores and stat values on island surfaces.
- **Do** save loudness for live state and big moments: live pills, finals, grades, wins, the scoreboard.
- **Do** keep a visible 2px focus ring and honor the global reduced-motion policy, which makes transitions instant.
- **Do** use inline stroke SVG icons on a 20 or 24px grid.

### Don't:
- **Don't** hard-code a color literal in CSS, `sx`, or inline styles.
- **Don't** mix `dash-*` and app tokens on one surface.
- **Don't** put a shadow on an island card.
- **Don't** borrow sportsbook visuals: odds boards, neon promos, countdown urgency.
- **Don't** add legacy-portal clutter: ad-shaped boxes, tiny type, widgets competing for attention.
- **Don't** use emoji in the product, or em dashes in its copy.
- **Don't** use a position or grade color as decoration.
