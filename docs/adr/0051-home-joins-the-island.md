# Home joins the island

Status: proposed (2026-09-28)

ADR 0020 scoped the `dash-*` token group, Barlow Condensed and Archivo to the
League Dashboard island, and ADR 0031, ADR 0037, ADR 0038 and ADR 0049 brought
Game Center and Matchup Detail, Lineup, Pick'em and Waivers in after it. Home
(`/user`, `src/components/UserPage`), the page a manager lands on after
signing in, is still on the app tokens and MUI's Inter ramp, and every
league card on it leads into one of those surfaces. The 2026-09-28 UI/UX audit of `/user` (the User
Profile Redesign canvas: the Audit, Main, Mobile and Handoff boards) found
this on type and tokens:

- The theme names Inter, but nothing loads it: there is no Inter
  `@font-face`, no `@fontsource` package and no Fonts link (finding m4). Every
  heading and number on the page renders in whichever fallback the browser
  finds (Roboto, Helvetica or Arial), while `src/theme/base.css` already
  self-hosts Barlow Condensed and Archivo and `tokens.js` already carries
  `dash-font-display` and `dash-font-body` for them.
- Text contrast is not the problem: every app-token text pairing on the page
  clears AA in both themes. The one low number is the card edge,
  `border-subtle` on `surface` at 1.30:1, the only visible edge of a league
  card that is one big link (m8, advisory under WCAG 1.4.11).
- `UserPage.css` is imported by nothing and carries a global `button {}`
  rule, and the Teams label hard-codes its font sizes inline (m5).
- The audit's fifth priority is to join the island, and it notes that
  `tokens.js` scopes `dash-*` to the League Dashboard island, so Home cannot
  use the group without a decision.

The redesign boards are drawn on the `dash-*` values, with the display face
for headings, card headers and scores and the body face for everything else.
Home v2 is being built in seven slices (the Handoff board); slice 6 is the
restyle, and this ADR is the decision it needs.

We decide that the island's visual generation now covers Home. The Home page
and the pieces Home v2 builds for it (the greeting header and `ActionQueue`,
`NextDraftCard`, `LeagueStatusCard`, `CreateLeagueStepper`,
`JoinLeagueDialog`, and the Activity, News and Around the League feeds as the
restyle reaches them) paint from `dash-*` tokens and set type in
`--dash-font-display` and `--dash-font-body`, the faces `base.css` already
serves. No Google Fonts request is added. The page root paints the island's
token context (`dash-bg`, `dash-ink`, the body face) the way the League
Dashboard and Game Center page roots do.

The app shell stays on the app tokens. Nav (with its notification bell) and
Footer are shared by every route, and nothing in this ADR restyles them. The
boards draw the app bar in the island's palette; that part of the boards is
not adopted, and its one new ink (`--on-danger` on the bell's unread badge)
is not proposed as a token.

Unlike ADR 0031, ADR 0037, ADR 0038 and ADR 0049, this ADR moves no files
into a page slice. Home's files stay where the Home v2 slices put them, under
`src/components/UserPage` (and `LeagueStatusCard` under
`src/components/common`), the way `RecapCard` and `TrophyCase` already paint
`dash-*` from `src/components`. ADR 0020's import rules and ADR 0031's
slice-level rule govern island slices and do not reach these files. Where a
Home component composes a `shared/ui` piece, it imports the concrete module,
not the index, as ADR 0031's 2026-09-10 amendment directs for legacy files.
Moving Home to `src/pages/home` is left to its own decision.

Rulings that shape the restyle:

- Heading levels stay as slice 1 set them (an h1 greeting, an h2 per section,
  an h3 per league card), explicit through `component` (ADR 0021). The
  display face changes type scale only, never a level.
- The league card's edge becomes decoration. `LeagueStatusCard` makes the
  title the link (a 44px target), not the whole card, which is the audit's
  second remedy for m8, so the card keeps the island's `dash-line` hairline
  and needs no stronger border.
- Home does not redefine `--focus-ring`. The boards draw focus rings in the
  accent; the island uses the app's global ring (`base.css`), and so does
  Home.
- Where the boards' tints differ from `tokens.js`, Home uses `tokens.js`: the
  warning tint stays 12% in light (the boards draw 10%) and the home tint
  stays 16% in dark (the boards draw 14%). Both clear AA on every surface
  Home paints them on (the measurements below). The danger tint is the one
  exception, proposed in the next ruling.
- Proposed: the light `dash-danger-soft` drops from 10% to 6%, the value the
  boards were drawn with. Home paints danger text on the danger tint over the
  page in two places: the LIVE chip in the greeting header, and the Join
  sheet's "No league uses that code" alert, which sits on the page because
  the sheet is full screen. At 10% that text is 4.29:1 over `dash-bg` in
  light, under AA_TEXT; at 6% it is 4.57:1. The change also raises every
  danger row already registered (the Live pill over a card goes from 4.81 to
  5.12) and brings the stat tile inside AA (4.47 to 4.78). The raised tile
  still fails (4.31), so the danger pill stays off `dash-surface3`. Dark
  keeps its 14% (5.78 over the page). The same tuning already happened to
  `dash-away-soft` (12% to 8%) and `dash-accent` for the same reason: tune the
  light tint so the chip clears more surfaces, rather than add a surface rule
  per page. The cost falls on the existing light consumers, all of which get
  a fainter fill: the `shared/ui` Badge's danger variant, the bye-cluster
  warning tile, the Pick'em game card's error row, and the Game Center
  scoring strip, whose border is the tint itself and nearly disappears on a
  card at 6%. That border is decoration, not a WCAG boundary, but the restyle
  pass should look at it in light. The alternative is to keep 10% and move
  both Home placements onto a card, or paint the header chip without a fill
  (danger text and border straight on `dash-bg`, 5.00:1). The lead rules
  which.

## Considered options

- **Join the island's visual generation, files stay put (chosen).** The
  tokens, faces and contrast rows Home needs already exist but one (below).
  The Home v2 slices can restyle in place without touching the tree.
- **Move Home to a page slice now.** Deferred, not refused. Slices 2 to 5 of
  Home v2 are being built in parallel under `src/components/UserPage` by
  contract; a tree move now collides with every one of them. It can follow
  as its own decision.
- **Restyle on the app tokens.** Rejected. It keeps the Inter stack that never
  loads (m4), and it rebuilds on the app scale what the island already has,
  the drift ADR 0031 was written to stop.
- **Amend ADR 0020, as the audit and the Handoff board suggest.** Rejected.
  ADR 0031, ADR 0037, ADR 0038 and ADR 0049 each brought a surface in with an
  ADR of its own, and ADR 0020's scope line is already superseded by ADR
  0029. An amendment would bury Home's rulings inside ADR 0020.

## Consequences

- A sixth surface on the `dash-*` tokens, Barlow Condensed and Archivo, and
  the first outside a league. The island-scoping comment in `tokens.js` names
  Home with this ADR. The post-login landing now fetches the self-hosted
  woff2 files the island pages already use; `font-display: swap` keeps the
  fallback visible on first paint. Inter stays in `buildTheme` for the legacy
  pages; m4 is fixed for Home only.
- The tokens Home uses already exist: `dash-bg`, `dash-surface`,
  `dash-surface2`, `dash-surface3`, `dash-line`, `dash-line-strong`,
  `dash-ink`, `dash-dim`, `dash-accent`, `dash-accent-soft`,
  `dash-accent-line`, `dash-on-accent`, `dash-home`, `dash-home-soft`,
  `dash-warning`, `dash-warning-soft`, `dash-danger`, `dash-danger-soft`,
  `dash-radius`, `dash-radius-sm`, `dash-font-display` and `dash-font-body`.
  The boards use `dash-dim` for all muted text and never `dash-faint`, and
  they round cards at 16px where `dash-radius` is 14px; Home uses the token,
  not a new radius.
- One token the boards need does not exist: `dash-field`, the border of a
  text input or select (Create and Join), the Teams stepper and an unselected
  choice card (Create), at 3:1 or better against what it sits on (WCAG
  1.4.11): light `#7A8793`, dark `#6B7C8C`. It is
  added to both mode blocks by the restyle ticket, with its rows, not by this
  ADR. `dash-line-strong` (the boards' `--line2`) is decoration and cannot
  carry an input's edge.
- Pairings Home relies on that are already registered: `dash-ink` and
  `dash-dim` on all four surfaces; `dash-accent` on `dash-accent-soft` over
  all four; `dash-on-accent` on `dash-accent`; `dash-warning` on
  `dash-warning-soft` over a card; `dash-danger` on `dash-danger-soft` over a
  card (the league card's LIVE chip, the wrong pick cell, the Create failure
  alert title); `dash-home` on `dash-surface` and `dash-surface2`;
  `focus-ring` on `dash-bg` and `dash-surface`.
- New pairings that must be registered in `tokens.contrast.test.js`, in both
  themes, before the slice that paints them merges (ADR 0010: the guard
  certifies exactly the pairings it lists). Measured on today's `tokens.js`
  values, light then dark:
    - `dash-danger` on `dash-danger-soft` over `dash-bg`, AA_TEXT: the header
      LIVE chip and the Join not-found alert title. 4.29 (fails) / 5.78 at
      10%; 4.57 in light at 6%. This row cannot be registered until the tint
      ruling above is made.
    - `dash-ink` and `dash-dim` on `dash-danger-soft` over `dash-bg`, AA_TEXT:
      the failed-refresh alert's title and detail line, and the Join
      not-found alert's body. Ink 13.24 / 13.72; dim 4.72 / 6.28 (5.02 in
      light at 6%).
    - `dash-ink` on `dash-danger-soft` over `dash-surface`, AA_TEXT: the
      Create failure alert's body. 14.85 / 12.25.
    - `dash-home` on `dash-home-soft` over `dash-surface`, AA_TEXT: the blue
      chips (the Next draft format chip, a pre-draft card's draft date chip)
      and the picked cell's outline. 5.60 / 5.59.
    - `dash-ink` and `dash-danger` on `dash-warning-soft` over
      `dash-surface`, AA_TEXT: Create's draft-time acknowledgement and its
      error line. Ink 14.62 / 11.26; danger 4.74 / 4.74, the thinnest new
      row.
    - `dash-accent` on `dash-surface` and `dash-surface2`, AA_TEXT: plain text
      links (All notifications on a card, Show all in the to-do footer well).
      6.65 / 9.36 and 6.18 / 8.46. Add `dash-bg` (5.91 / 10.31) if the header
      keeps a text link.
    - `dash-danger` on `dash-surface` and `dash-bg`, AA_TEXT: an error under
      its field, in the Create dialog and on the Join sheet. 5.62 / 6.25 and
      5.00 / 6.88.
    - `dash-warning` on `dash-surface` at AA_TEXT: a to-do row's deadline
      under two hours, 13px text. 5.93 / 9.30. The existing row holds this
      pairing only at AA_LARGE, for a border.
    - `focus-ring` on `dash-surface2`, AA_LARGE: the to-do footer and the card
      footers are wells, so a focused link there rings over `dash-surface2`.
      6.02 / 6.78.
    - `dash-accent` on `dash-surface3`, AA_LARGE: the win probability bar's
      fill against its track, a graphical object. 5.59 / 7.45.
    - `dash-field` on `dash-bg`, `dash-surface` and `dash-surface2`,
      AA_LARGE. 3.27 / 4.45, 3.67 / 4.04 and 3.42 / 3.65. Not on
      `dash-surface3`, which no input sits on.
- If the light danger tint moves to 6%, the `tokens.js` comment and the
  contrast test's comment that confine the danger pill to a card are
  rewritten to confine it to the page, a card and a stat tile, and the Live
  pill row gains its `dash-bg` and `dash-surface2` backdrops.
- ADR 0020's import rules stay unaudited in the sense of ADR 0010, and this
  ADR adds nothing a lint rule reads. The one binding check it leans on is
  the contrast guard above.
