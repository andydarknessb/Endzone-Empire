import { colorTokens, scaleTokens } from './tokens';
import { contrastRatio } from './contrast';

// WCAG 2.1 AA thresholds: 4.5:1 for normal body text, 3:1 for large text and
// UI component text (e.g. button labels). Each pairing below is a
// foreground/background combination the token set puts on screen, except the
// two veil rows, whose premise is spelled out with BRIGHTEST_BACKDROP.
const AA_TEXT = 4.5;
const AA_LARGE = 3.0;

// Not a WCAG number: a project judgement about visible interactive feedback.
// A resting color and its hover color that sit too close together mean a
// button gives no visible signal on hover; #267 restored the delta after
// #237 collapsed it to 1.05:1 while fixing a text-contrast failure, and nothing
// caught that. This constant is the floor for that delta, not an accessibility
// requirement.
const HOVER_DELTA = 1.3;

// A translucent token has no ratio on its own: it takes the color of whatever
// it is laid over. `backdrop` is that solid color, and contrast.js composites
// the pairing over it before measuring. Two backdrops are in play:
//
//   * `surface` for `accent-soft`, which marks a row as yours or as next up
//     and is always painted on a card.
//   * BRIGHTEST_BACKDROP for `scrim` and `overlay`, dark veils laid over
//     content this file cannot know (a photo, or whatever a modal covers).
//     White is the worst case for the light text that sits on them; over any
//     darker backdrop the ratio only improves.
//
// READ THIS BEFORE PUTTING `on-overlay` ON SCREEN. `scrim` is asserted at the
// AA_TEXT (4.5:1) body-text threshold, so `on-overlay` on `scrim` is a
// measurement, not an assumption (#238). `overlay` still carries the
// large-text threshold, and that ONE is an assumption, not a measurement: at
// 3.21 (light) it is under 4.5, so it holds 3:1 only while `on-overlay` is
// heading and label text rather than body copy over `overlay`. Nothing
// enforces that today because nothing renders `on-overlay` on `overlay` at
// all - `--overlay` has no textual reference in the app. The closest thing,
// UserPage.css, pairs `on-overlay` with `scrim`, not `overlay`, and that file
// is dead besides (imported by no component - UserPage.jsx loads no
// stylesheet). Reviving it would not turn this suite's premise into a live
// failure: `.user-page:before` and `.container` both paint `--scrim`, so
// `on-overlay` text there sits on a doubly-composited scrim, around 12:1,
// comfortably clear of AA_TEXT. The `overlay` row is the one still resting on
// the large-text assumption; its first real consumer has to honour that
// assumption or raise this row to AA_TEXT too. Decision recorded in #238.
const BRIGHTEST_BACKDROP = '#ffffff';

// fg / bg are token keys; backdrop is a token key or a literal color, and is
// only needed when fg or bg carries alpha.
const pairing = (fg, bg, min, label, backdrop) => ({ fg, bg, min, label, backdrop });

// The landing hero (LandingPage.css) paints a translucent accent gradient over
// `bg-page`: opaque at the top of the hero, transparent at the bottom. That
// gradient is not a token (and #354 keeps it that way), so it cannot be looked
// up from `colorTokens` the way every other `bg` in PAIRINGS is. Instead each
// mode's `tokens` map below gets one extra literal entry, `landing-hero-tint`,
// sourced from this test-local map - the existing `tokens[bg]` lookup then
// resolves it exactly like any other token key, with no change to how real
// tokens resolve.
//
// The value is the gradient's opaque end (0%), the worst case for text over
// it; the transparent end can only be a smaller tint and therefore a higher
// ratio. Source: LandingPage.css `.landing-page .landing-hero` (light, line 5)
// and `html[data-theme='dark'] .landing-page .landing-hero` (dark, line 9).
// Since #350 the hero carries a normal-size `text.secondary` (`text-muted`)
// paragraph, so AA_TEXT applies. Measured: 4.98:1 light, 6.28:1 dark - light
// has under 0.5 of headroom.
const HERO_TINT_BY_THEME = {
  light: 'rgba(30, 91, 184, 0.08)',
  dark: 'rgba(79, 140, 255, 0.14)',
};

// The League Dashboard's viewer row, now that it actually paints. Standings and
// Draft Grades both mark the viewer's own row with `dash-accent-soft`, and the
// "You" pill sitting in that row is ITSELF `dash-accent-soft`, so the pill's
// accent label lands on a DOUBLE composite: tint over tint over the card. No
// single `backdrop` token spells that - the same problem HERO_TINT_BY_THEME
// solves - so the inner layer is pre-composited here per mode and registered
// below as an ordinary backdrop.
//
// Derived, not eyeballed: `dash-accent-soft` (12% accent) over `dash-surface`.
// Light rgba(15, 106, 65, .12) over #ffffff is rgb(226.2, 237.1, 232.2); dark
// rgba(47, 217, 123, .12) over #141b23 is rgb(23.2, 49.8, 45.6). Recompute both
// if either token moves; the row below is what fails if you do not.
//
// The composite is new because the tint is new ON SCREEN, not new in the code:
// Draft Grades declared it from the start, but the MuiTableBody override
// outranked the widget's own rule (0,2,0) to (0,1,0), so the app's zebra
// painted instead and this pairing never appeared. Rebuilding that table off
// MUI is what made it real.
const VIEWER_ROW_TINT_BY_THEME = {
  light: '#e2ede8',
  dark: '#17322e',
};

const PAIRINGS = [
  pairing('text-primary', 'bg-page', AA_TEXT, 'body text on the page'),
  pairing('text-primary', 'surface', AA_TEXT, 'body text on cards'),
  pairing('text-muted', 'surface', AA_TEXT, 'muted text on cards'),
  pairing('text-muted', 'bg-page', AA_TEXT, 'muted text on the page'),
  pairing(
    'text-muted',
    'landing-hero-tint',
    AA_TEXT,
    'muted text on the landing hero tint (opaque end, worst case)',
    'bg-page'
  ),
  pairing('accent', 'bg-page', AA_TEXT, 'links on the page'),
  pairing('accent', 'surface', AA_TEXT, 'links on cards'),
  // The app bar and other raised surfaces: the active nav link sits here, and
  // this pairing was the one the other two didn't cover.
  pairing('accent', 'surface-raised', AA_TEXT, 'active nav link on the app bar'),
  pairing('text-primary', 'surface-raised', AA_TEXT, 'body text on a raised surface'),
  pairing('text-muted', 'surface-raised', AA_TEXT, 'muted text on a raised surface'),
  // #446: the "GIF unavailable" tile (GifMessage) paints surface-sunken and puts
  // its label on it (text-primary) with the description/attribution as muted
  // text. surface-sunken had no text pairing before this tile, so the guard's
  // green said nothing about it; these two make it a measurement.
  pairing('text-primary', 'surface-sunken', AA_TEXT, 'GIF unavailable tile label'),
  pairing('text-muted', 'surface-sunken', AA_TEXT, 'GIF unavailable tile description/attribution'),
  pairing('on-accent', 'accent', AA_LARGE, 'button label on accent'),
  pairing('text-inverse', 'danger', AA_LARGE, 'alert banner text'),
  pairing('danger', 'surface', AA_TEXT, 'error text on cards'),
  // Position chips/avatars: white (light) or dark (dark) label on the fill.
  pairing('text-inverse', 'pos-qb', AA_TEXT, 'QB position chip label'),
  pairing('text-inverse', 'pos-rb', AA_TEXT, 'RB position chip label'),
  pairing('text-inverse', 'pos-wr', AA_TEXT, 'WR position chip label'),
  pairing('text-inverse', 'pos-te', AA_TEXT, 'TE position chip label'),
  pairing('text-inverse', 'pos-k', AA_TEXT, 'K position chip label'),
  pairing('text-inverse', 'pos-def', AA_TEXT, 'DEF position chip label'),
  pairing('text-inverse', 'pos-idp', AA_TEXT, 'IDP position chip label'),
  // Table cell text on striped / hovered rows.
  pairing('text-primary', 'row-stripe', AA_TEXT, 'cell text on a striped row'),
  pairing('text-primary', 'row-hover', AA_TEXT, 'cell text on a hovered row'),
  pairing('text-muted', 'row-stripe', AA_TEXT, 'muted cell text on a striped row'),
  // row-hover has less headroom than row-stripe, and text-muted is the most
  // common non-plain foreground on a hoverable row (#174 follow-up).
  pairing('text-muted', 'row-hover', AA_TEXT, 'muted cell text on a hovered row'),
  // The amber "Teams: N/M" chip (MUI warning): its label flips white/dark with
  // the theme, matching text-inverse.
  pairing('text-inverse', 'warning', AA_TEXT, 'label on the amber Teams chip'),
  // Amber as TEXT on a card, which the row above does not cover: the roster
  // needs strip's "every remaining pick has to fill a starting spot" line and
  // the roster panel's rounds-vs-capacity note.
  pairing('warning', 'surface', AA_TEXT, 'warning severity line on cards'),
  // The keyboard focus ring (base.css `:focus-visible` and the
  // Mui-focusVisible override) is opaque, so its ratio against every surface
  // it can land on is fixed without compositing (#155).
  pairing('focus-ring', 'surface', AA_LARGE, 'focus ring on cards'),
  pairing('focus-ring', 'surface-raised', AA_LARGE, 'focus ring on a raised surface'),
  pairing('focus-ring', 'row-stripe', AA_LARGE, 'focus ring on a striped row'),
  pairing('focus-ring', 'row-hover', AA_LARGE, 'focus ring on a hovered row'),
  pairing('focus-ring', 'bg-page', AA_LARGE, 'focus ring on the page'),
  // Alpha tokens, composited over the backdrop they are painted on (#203).
  // `accent-soft` marks a row as yours or as next up: the Draft rail's queue
  // and You marker, the Pick'em standings viewer row, Power Rankings, the
  // lineup eligibility highlight. All of those sit on a card, so `surface` is
  // the backdrop. (The table row hover itself is `row-hover`, an opaque token,
  // asserted above.)
  pairing('text-primary', 'accent-soft', AA_TEXT, 'cell text on an accent-tinted row', 'surface'),
  pairing('text-muted', 'accent-soft', AA_TEXT, 'muted cell text on an accent-tinted row', 'surface'),
  // #354 sweep: every other `accent-soft` consumer checked below sits on
  // `surface` (already covered by the two rows above) or has no text on it.
  // Five do not:
  //
  // The legacy Game Center's LiveActionTicker painted `accent-soft` directly
  // as its own Paper's background, and that Paper sat straight on the page -
  // its backdrop was `bg-page`, not `surface`. The ticker text was MUI body2
  // at 14px even when bold, under the 14pt/18.66px bold threshold for "large
  // text", so AA_TEXT applies. That page left with #897 (the island's
  // scoring-feed widget paints `dash-*` tokens instead, guarded below); the
  // row stays so a later banner on the page composes a certified pairing.
  pairing(
    'text-primary',
    'accent-soft',
    AA_TEXT,
    'live scoring ticker text on the accent-tinted banner',
    'bg-page'
  ),
  // The public strategy index's featured ArticleCard (ArticleCard.jsx,
  // rendered by StrategyIndexPage.jsx inside PublicLayout, whose root is
  // `background.default` == `bg-page`), DraftSim's selected-format Card
  // (SimConfigForm.jsx, rendered inside DraftSimScreen's plain Container on
  // `bg-page`), and the mobile Power Rankings viewer-team Card
  // (PowerRankings.jsx:293, direct child of the bare `Container` at :225 -
  // no Paper in between, unlike the desktop table row below) all paint
  // `accent-soft` as the card's own background with no intervening surface,
  // and each carries a `text.secondary` (`text-muted`) body/caption line
  // (PowerRankings.jsx:315). Same fg/bg/backdrop triple in all three, so one
  // row covers it; thin margin like the hero tint above (4.84:1 light,
  // 5.73:1 dark).
  pairing(
    'text-muted',
    'accent-soft',
    AA_TEXT,
    'muted text on an accent-tinted card on the page (ArticleCard, SimConfigForm, Power Rankings mobile viewer card)',
    'bg-page'
  ),
  // DraftBoardMatrix's `pickLandedFlash` keyframe (DraftBoardMatrix.jsx) briefly
  // paints `accent-soft` over a table cell whose own background is transparent,
  // so the flash composites over whatever the row currently is: `surface` (odd
  // rows, already covered above), `row-stripe` (even rows), or `row-hover`
  // (hovered). `row-hover` is the worst case of the three in both themes
  // (measured: 12.18:1 light, 8.20:1 dark, vs. row-stripe's 13.27:1 / 9.44:1),
  // so it is the one asserted; row-stripe only has more headroom.
  pairing(
    'text-primary',
    'accent-soft',
    AA_TEXT,
    'draft pick name during the landed-pick flash on a hovered row',
    'row-hover'
  ),
  // The legacy Matchup Detail's `scoreFlash` keyframe (its slot list sat in
  // a Paper, so its backdrop was `surface`) was the same flash-over-a-row
  // pattern, but its foreground was `accent`, not `text-primary`:
  // PlayerNameLink colors a player name `primary.main` (`accent`). That page
  // left the tree with #903 (ADR 0031); the row stays because PlayerNameLink
  // still paints accent names on legacy surfaces, and the guard certifies
  // exactly the pairings it lists (ADR 0010).
  pairing(
    'accent',
    'accent-soft',
    AA_TEXT,
    'player name during the score-change flash',
    'surface'
  ),
  // The remaining #354 sweep candidates need no PAIRINGS row:
  //   - LeagueHistory's champion banner (LeagueHistory.jsx) and SimPickFeed's
  //     active-team row (SimPickFeed.jsx) both paint `accent-soft` inside a
  //     MUI Paper/Accordion, whose background is `background.paper` ==
  //     `surface` (AppThemeProvider.jsx). Same backdrop as the two rows at the
  //     top of this block, so nothing new to measure.
  //   - LandingPage.css's own `accent-soft` consumer, the `landing-cta-pulse`
  //     keyframe, animates a `box-shadow` ring around a button; no text sits
  //     on it.
  //   - UserPage's banner (UserPage.css `.user-page:before`/`.container`,
  //     `--scrim` over the background photo) is exactly the `on-overlay` /
  //     `scrim` row below, already measured comfortably clear (#238) - and the
  //     file is unused today (see the #238 comment above BRIGHTEST_BACKDROP).
  //   - TecmoCutscene's `.tecmo-scanlines` and `.tecmo-vignette`
  //     (TecmoCutscene.css) are later DOM siblings of the boom frame inside
  //     `.tecmo-scene` (TecmoCutscene.jsx), both `position: absolute; inset: 0`
  //     with no z-index, so during beat 2 they do paint on top of the boom
  //     caption text, not just the day-sky background behind it. Still no
  //     PAIRINGS row: `contrastRatio()` composites a background under a
  //     foreground, and has no way to represent a translucent layer drawn
  //     *over* already-rendered text (a uniform darkening of both fg and bg,
  //     which is a different, currently-unsupported compositing shape - adding
  //     it would be the "second compositing path" #354 rules out). Both
  //     overlays are aria-hidden, decorative CRT effects, and every color in
  //     this file is a fixed literal by design (theme-independent cutscene),
  //     never a token.
  pairing('on-overlay', 'scrim', AA_TEXT, 'light text on a photo scrim', BRIGHTEST_BACKDROP),
  pairing('on-overlay', 'overlay', AA_LARGE, 'light text on a modal overlay', BRIGHTEST_BACKDROP),
  // The Nav link hover on the app bar (Nav.jsx): `accent` text on `accent-soft`
  // over `surface-raised`. #203's compositing was what made this measurable at
  // all; it came in under AA in dark theme (3.75:1) until #237 lightened
  // `accent`/`accent-soft` to clear it. Body text, so AA_TEXT, not AA_LARGE.
  pairing('accent', 'accent-soft', AA_TEXT, 'nav link hover on the app bar', 'surface-raised'),

  // ---- League Dashboard token group (ADR 0020, #637). The dashboard themes
  // shared/ui and its widgets from the `dash-*` tokens. This block registers
  // the token-on-surface pairings the dashboard PUTS ON SCREEN, in both modes.
  // It does NOT prove the token set safe in the abstract: the guard certifies
  // exactly the pairings listed (ADR 0010), so a widget that composes a NEW
  // token-on-surface combination (a token on a backdrop no row below covers)
  // registers it here rather than assuming the group is blanket-safe. Three
  // inks (`dash-ink`, `dash-dim`, `dash-faint`) sit on four surfaces (`dash-bg`
  // the page and the three card/tile surfaces `dash-surface`/`-surface2`/
  // `-surface3`):
  //   * ink and dim carry small essential text, so AA_TEXT (4.5).
  //   * faint is the lightest muted tier (uppercase stat/table labels, counts,
  //     captions, short prose). The mockup uses it from 11px to 16px (`.vs` is
  //     16px/600, `.rk` 13.5px), none of which is WCAG large text, so it is
  //     held to AA_TEXT (4.5). `dash-faint` was lightened from the mockup value
  //     so it clears 4.5 on every plain surface (tokens.js). On the accent tint
  //     it clears only over a card; see the tint rows below.
  // ---- Game Center / Matchup Detail island (ADR 0031, #891). The home and
  // away colors carry per-side percentages and small labels on a card and on
  // a stat tile (AA_TEXT); they are NOT registered on the raised tile, so a
  // widget paints them on `dash-surface`/`-surface2` only. The LED digits are
  // amber on the board token, which stays dark in both themes.
  pairing('dash-home', 'dash-surface', AA_TEXT, 'home side percentage on a card'),
  pairing('dash-home', 'dash-surface2', AA_TEXT, 'home side percentage on a stat tile'),
  pairing('dash-away', 'dash-surface', AA_TEXT, 'away side percentage on a card'),
  pairing('dash-away', 'dash-surface2', AA_TEXT, 'away side percentage on a stat tile'),
  // The retro field's end zones (#902) carry the Team name in `text-inverse`
  // on the side's own fill, the pairing the position chips already carry:
  // both fills are chip-strength colors (light `dash-home` is `pos-wr`, dark
  // `dash-away` is `pos-rb`) and the label is small text, so AA_TEXT.
  pairing('text-inverse', 'dash-home', AA_TEXT, 'home end-zone label on the home fill'),
  pairing('text-inverse', 'dash-away', AA_TEXT, 'away end-zone label on the away fill'),
  pairing('dash-led', 'dash-board', AA_TEXT, 'LED digits on the scoreboard face'),
  // The scoring strip's Live pill (widgets/scoring-feed, #895): the canvas's
  // `.chip.live` is danger text on the danger tint, and the strip it sits in
  // is a card, so the pairing is registered over `dash-surface` ONLY. That is
  // a real boundary, not an omission: measured 4.81 light / 5.16 dark over a
  // card, but 4.47 light over a stat tile, 4.29 light over the page and
  // 4.05 / 4.09 over the raised tile. A danger pill on any other surface is
  // not guarded here.
  pairing('dash-danger', 'dash-danger-soft', AA_TEXT, 'the Live pill on the danger tint over a card (the only guarded danger backdrop)', 'dash-surface'),
  // The Final status chip on the hero and the matchup cards (#897): the
  // canvas's `.chip.final` is success text on the success tint, and the
  // island's success pair is `dash-away` / `dash-away-soft` (tokens.js). The
  // chip is 11.5px/600, normal text, so AA_TEXT. The tint's light alpha was
  // dropped from the canvas's 12% to 8% for exactly this row (4.36 failed;
  // 4.63 over a card now, while 4.30 over a stat tile, 3.90 over the raised
  // tile and 4.13 over the page all still FAIL in light), so the tinted chip
  // is registered over `dash-surface` ONLY and a slice paints it nowhere else.
  pairing('dash-away', 'dash-away-soft', AA_TEXT, 'the Final chip on the success tint over a card (the only guarded success backdrop)', 'dash-surface'),
  // bench-what-if (#900): the card's warning border and bolt icon are non-text
  // UI on `dash-surface` (AA_LARGE), and the gain chip (the canvas's
  // `.chip.warn`) is warning TEXT on the warning tint, painted on the swap row
  // (`dash-surface2`), with its own warning border on that row. The chip is
  // 11px/700 uppercase, normal text by WCAG, so AA_TEXT. Thin in light (4.66
  // over surface2; 5.00 over a card); the tint over the raised tile (4.23) and
  // the page (4.48) FAILS in light, so the tinted chip is registered on a card
  // and a stat tile only and a slice paints it nowhere else (tokens.js). The
  // Awaiting final status chip on the hero and the matchup cards (#897) is
  // the same warning text on the same tint over a card: the card row below.
  pairing('dash-warning', 'dash-surface', AA_LARGE, 'bench what-if card border and bolt on a card'),
  pairing('dash-warning', 'dash-surface2', AA_LARGE, 'bench what-if gain chip border on the swap row'),
  pairing('dash-warning', 'dash-warning-soft', AA_TEXT, 'warning chip text on the warning tint over a card', 'dash-surface'),
  pairing('dash-warning', 'dash-warning-soft', AA_TEXT, 'bench what-if gain chip text on the warning tint over the swap row', 'dash-surface2'),
  pairing('dash-ink', 'dash-bg', AA_TEXT, 'dashboard body text on the page'),
  pairing('dash-ink', 'dash-surface', AA_TEXT, 'dashboard body text on a card'),
  pairing('dash-ink', 'dash-surface2', AA_TEXT, 'dashboard body text on a stat tile'),
  pairing('dash-ink', 'dash-surface3', AA_TEXT, 'dashboard body text on the raised tile'),
  pairing('dash-dim', 'dash-bg', AA_TEXT, 'dashboard muted text on the page'),
  pairing('dash-dim', 'dash-surface', AA_TEXT, 'dashboard muted text on a card'),
  pairing('dash-dim', 'dash-surface2', AA_TEXT, 'dashboard muted text on a stat tile'),
  pairing('dash-dim', 'dash-surface3', AA_TEXT, 'dashboard muted text on the raised tile'),
  pairing('dash-faint', 'dash-bg', AA_TEXT, 'dashboard faint label on the page'),
  pairing('dash-faint', 'dash-surface', AA_TEXT, 'dashboard faint label on a card'),
  pairing('dash-faint', 'dash-surface2', AA_TEXT, 'dashboard faint label on a stat tile'),
  pairing('dash-faint', 'dash-surface3', AA_TEXT, 'dashboard faint label on the raised tile'),
  // Text ON the accent-soft tint (#203 compositing pattern). The tint is used
  // two ways in the mockup: as a floating badge fill (`.chip.live`, the `.you`
  // pill) and as a standings ROW background (`tr.me`). A badge floats, so its
  // foregrounds are registered over all four surfaces; the `tr.me` row lives
  // inside a card, so its foregrounds sit over `dash-surface`.
  //
  //   * accent text (the live chip / You pill label): all four backdrops.
  //     `dash-accent` was darkened so every one clears AA_TEXT (a lighter
  //     accent failed over the page background).
  //   * ink text (the `tr.me` team name): all four backdrops, clears easily
  //     (9.17-14.46).
  //   * faint text (the `tr.me` rank cell, `.rk`): registered over `dash-surface`
  //     ONLY, and that is a real boundary, not an omission. Faint on the tint
  //     clears 4.5 over a card (4.62 light / 4.81 dark) but not elsewhere: over
  //     the page background it fails in light (4.15) though it passes in dark
  //     (5.48), and over surface2 (4.32/4.30) and surface3 (3.92/3.76) it fails
  //     in both modes. It cannot be retuned to clear the tint on those surfaces
  //     without overshooting past `dash-dim` and inverting the tier order (dim
  //     itself only reaches 4.20 on the dark tint over surface3). So the rule
  //     for widgets, stated here and in ADR 0020, is one uniform card-only rule,
  //     deliberately a touch stricter than dark-over-bg alone would need: faint
  //     text on the accent tint only inside a card (where `tr.me` lives); a
  //     tinted element on any other surface uses INK - registered on the tint
  //     over all four surfaces (9.17-14.46) - never faint or dim (dim also fails
  //     on the tint over the raised tile, 4.37 light / 4.20 dark).
  pairing('dash-accent', 'dash-accent-soft', AA_TEXT, 'accent text on the accent tint over the page', 'dash-bg'),
  pairing('dash-accent', 'dash-accent-soft', AA_TEXT, 'accent text on the accent tint over a card', 'dash-surface'),
  pairing('dash-accent', 'dash-accent-soft', AA_TEXT, 'accent text on the accent tint over a stat tile', 'dash-surface2'),
  pairing('dash-accent', 'dash-accent-soft', AA_TEXT, 'accent text on the accent tint over the raised tile', 'dash-surface3'),
  pairing('dash-ink', 'dash-accent-soft', AA_TEXT, 'the me-row team name on the accent tint over the page', 'dash-bg'),
  pairing('dash-ink', 'dash-accent-soft', AA_TEXT, 'the me-row team name on the accent tint over a card', 'dash-surface'),
  pairing('dash-ink', 'dash-accent-soft', AA_TEXT, 'the me-row team name on the accent tint over a stat tile', 'dash-surface2'),
  pairing('dash-ink', 'dash-accent-soft', AA_TEXT, 'the me-row team name on the accent tint over the raised tile', 'dash-surface3'),
  pairing('dash-faint', 'dash-accent-soft', AA_TEXT, 'the me-row rank cell on the accent tint over a card (the only guarded tinted-faint backdrop)', 'dash-surface'),
  // The "You" pill inside the viewer's own row (standings-table and
  // draft-grades): an accent-tinted pill on an accent-tinted row on a card, so
  // the pill's own tint composites over an already-tinted backdrop rather than
  // over the bare surface. 4.68 light, 5.74 dark - light clears AA_TEXT by 0.18,
  // the thinnest margin in this group, so retuning `dash-accent` or the tint's
  // alpha breaks this row before it breaks any other.
  pairing('dash-accent', 'dash-accent-soft', AA_TEXT, 'the You pill on the viewer row tint over a card', 'viewer-row-tint'),
  // draft-grades widget (#642): the roster-value number in the viewer's own
  // (tinted) row. First dim-on-tint consumer in this group; the guidance
  // above warns dim fails the tint on the raised tile (dash-surface3), but
  // this widget's tint is only ever painted on the card itself
  // (dash-surface), where it clears AA_TEXT (5.15 light / 5.36 dark).
  pairing('dash-dim', 'dash-accent-soft', AA_TEXT, 'the draft-grades roster value on the accent tint over a card', 'dash-surface'),
  // GradeChip: the fixed dark `dash-on-grade` letter on each of the five grade
  // fills. AA_TEXT since the letter is small (a 26px round chip, ~14px glyph).
  pairing('dash-on-grade', 'dash-grade-a', AA_TEXT, 'grade A chip letter'),
  pairing('dash-on-grade', 'dash-grade-b', AA_TEXT, 'grade B chip letter'),
  pairing('dash-on-grade', 'dash-grade-c', AA_TEXT, 'grade C chip letter'),
  pairing('dash-on-grade', 'dash-grade-d', AA_TEXT, 'grade D chip letter'),
  pairing('dash-on-grade', 'dash-grade-f', AA_TEXT, 'grade F chip letter'),
  // Grade as TEXT (not a chip fill): the mockup paints the my-team draft grade
  // as colored text on a tile (`.stat .v`, dashboard-concept.html), and the
  // vivid fills above are unreadable as text on a light surface (grade-a would
  // be 1.72 on surface2). `dash-grade-*-text` are the legible-as-text tokens,
  // guarded on the card (`dash-surface`) and stat-tile (`dash-surface2`)
  // surfaces a grade value sits on, both modes. They are NOT guarded on the
  // raised tile (`dash-surface3`): light grade-b-text is 4.40 there, so the
  // rule (here and in ADR 0020) is that grade text is not painted on the raised
  // tile - it belongs on a card or a stat tile, where the mockup puts it.
  pairing('dash-grade-a-text', 'dash-surface', AA_TEXT, 'grade A as text on a card'),
  pairing('dash-grade-a-text', 'dash-surface2', AA_TEXT, 'grade A as text on a stat tile'),
  pairing('dash-grade-b-text', 'dash-surface', AA_TEXT, 'grade B as text on a card'),
  pairing('dash-grade-b-text', 'dash-surface2', AA_TEXT, 'grade B as text on a stat tile'),
  pairing('dash-grade-c-text', 'dash-surface', AA_TEXT, 'grade C as text on a card'),
  pairing('dash-grade-c-text', 'dash-surface2', AA_TEXT, 'grade C as text on a stat tile'),
  pairing('dash-grade-d-text', 'dash-surface', AA_TEXT, 'grade D as text on a card'),
  pairing('dash-grade-d-text', 'dash-surface2', AA_TEXT, 'grade D as text on a stat tile'),
  pairing('dash-grade-f-text', 'dash-surface', AA_TEXT, 'grade F as text on a card'),
  pairing('dash-grade-f-text', 'dash-surface2', AA_TEXT, 'grade F as text on a stat tile'),
  // The primary button: `dash-on-accent` label on the accent fill. The mockup's
  // only primary button (`.btn`) is 13px/600, which is normal text by WCAG, not
  // large text, so this is AA_TEXT (4.5), not the large-text 3.0. It clears it
  // comfortably in both modes (6.65 light, 10.31 dark).
  pairing('dash-on-accent', 'dash-accent', AA_TEXT, 'dashboard primary button label on accent'),
  // The keyboard focus ring on the dashboard page background. The island does
  // not redefine `--focus-ring`, so the global `:focus-visible` ring (base.css)
  // paints the app `focus-ring` token, and the copy-invite button (#638) is the
  // first focusable control the island lands directly on `dash-bg`. That
  // backdrop is new for the ring, so per ADR 0010 / ADR 0020 it is registered
  // rather than assumed. AA_LARGE, like the other focus-ring rows above; the
  // opaque ring needs no compositing (#155).
  pairing('focus-ring', 'dash-bg', AA_LARGE, 'focus ring on the dashboard page'),
  // The same keyboard focus ring on a dashboard CARD. matchup-preview (#640) is
  // the first widget to land a focusable control (its two footer link buttons)
  // directly on `dash-surface`, so with the outline-offset ring sitting on the
  // card behind the control, `dash-surface` is a new backdrop for the ring and
  // is registered rather than assumed, same doctrine as the `dash-bg` row above.
  // AA_LARGE like the other focus-ring rows; the opaque ring needs no
  // compositing (#155).
  pairing('focus-ring', 'dash-surface', AA_LARGE, 'focus ring on a dashboard card'),
  // The Draft assistant's Misery Meter stage label (issue #786, ADR 0027):
  // SimAssistantPanel.jsx colors the band name (e.g. "1966 Form") with
  // `secondary.main` on its Paper, whose background is `background.paper` ==
  // `surface` (AppThemeProvider.jsx), the same backdrop SimPickFeed's own
  // `accent-soft` row already resolves to. `secondary`/`success` share one
  // token value and neither had a text-on-surface pairing guarded before this
  // - this is that measurement, not an assumption.
  pairing('secondary', 'surface', AA_TEXT, 'Misery Meter stage label on the Draft assistant panel'),
];

// Kept out of PAIRINGS, with their own test title below, so a pass here can
// never be misread as "meets AA": the first row (#267) is a project judgement
// about visible hover feedback, not a standard. The second row is a genuine
// legibility floor (WCAG's own large-text/UI-component threshold, AA_LARGE) -
// it is grouped here only because it is the other half of the same button
// hover state, not because it shares the first row's non-standard basis.
const HOVER_PAIRINGS = [
  pairing('accent', 'accent-hover', HOVER_DELTA, 'resting vs hover delta on the accent button'),
  pairing('on-accent', 'accent-hover', AA_LARGE, 'button label on the hover fill'),
];

describe.each(['light', 'dark'])('%s theme contrast', (mode) => {
  // `on-overlay` and `scrim` are theme-independent (they always sit on a dark
  // veil), so they live in scaleTokens rather than the per-theme color map.
  // Named individually rather than spread, to keep spacing and duration scales
  // out of a lookup that is only ever asked for colors. Their rows are
  // identical in both themes; the repeat costs nothing and keeps one table.
  const tokens = {
    'on-overlay': scaleTokens['on-overlay'],
    scrim: scaleTokens.scrim,
    ...colorTokens[mode],
    // Not a real token (see the comment above HERO_TINT_BY_THEME) - added here,
    // per mode, so the `tokens[bg]` lookup every PAIRINGS row already uses
    // resolves it exactly like any other key.
    'landing-hero-tint': HERO_TINT_BY_THEME[mode],
    // Likewise not a real token: `dash-accent-soft` already composited once
    // over `dash-surface`, so a pairing can name the viewer row as its backdrop.
    'viewer-row-tint': VIEWER_ROW_TINT_BY_THEME[mode],
  };

  test.each(PAIRINGS)(
    '$fg / $bg meets AA ($min:1) — $label',
    ({ fg, bg, min, backdrop }) => {
      const over = backdrop === undefined ? undefined : tokens[backdrop] ?? backdrop;
      const ratio = contrastRatio(tokens[fg], tokens[bg], over);
      expect(ratio).toBeGreaterThanOrEqual(min);
    }
  );

  test.each(HOVER_PAIRINGS)(
    '$fg / $bg clears ($min:1) — $label',
    ({ fg, bg, min, backdrop }) => {
      const over = backdrop === undefined ? undefined : tokens[backdrop] ?? backdrop;
      const ratio = contrastRatio(tokens[fg], tokens[bg], over);
      expect(ratio).toBeGreaterThanOrEqual(min);
    }
  );
});
