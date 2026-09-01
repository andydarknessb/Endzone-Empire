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
  // GameCenter's LiveActionTicker (GameCenter.jsx) paints `accent-soft`
  // directly as its own Paper's background, and that Paper sits straight on
  // the page - its backdrop is `bg-page`, not `surface`. The ticker text is
  // MUI body2 at 14px even when bold, under the 14pt/18.66px bold threshold
  // for "large text", so AA_TEXT applies.
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
  // MatchupExtras' `scoreFlash` keyframe (MatchupDetail.jsx wraps
  // SlotComparisonList in a Paper, so its backdrop is `surface`) is the same
  // flash-over-a-row pattern, but its foreground is `accent`, not
  // `text-primary`: PlayerNameLink colors the player name `primary.main`
  // (`accent`). That fg/bg/backdrop triple is new too.
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
  // shared/ui and its widgets from the `dash-*` tokens; every ink-on-surface
  // pairing it puts on screen is registered here for both modes so a widget
  // ticket cannot ship an unguarded pairing. Three inks (`dash-ink`,
  // `dash-dim`, `dash-faint`) sit on four surfaces (`dash-bg` the page and the
  // three card/tile surfaces `dash-surface`/`-surface2`/`-surface3`):
  //   * ink and dim carry small essential text, so AA_TEXT (4.5).
  //   * faint is the lightest muted tier (uppercase stat/table labels, counts,
  //     captions, short prose). The mockup uses it only at small sizes
  //     (11-12.5px), which WCAG treats as normal text, so it is held to
  //     AA_TEXT (4.5) too, not the large-text 3.0. `dash-faint` was lightened
  //     from the mockup value so it clears 4.5 on every surface (tokens.js);
  //     it needs no "large text only" caveat.
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
  // The "You" pill and live chip: accent text on the accent-soft tint (#203
  // compositing pattern). A badge is a floating element, so the tint can sit
  // on any of the four surfaces: the mockup's `.chip.live` is on the page
  // background (`dash-bg`), the You pill on a card (`dash-surface`), and either
  // can land on a stat tile / hovered row (`dash-surface2`) or the raised tile
  // (`dash-surface3`). All four are registered so a widget cannot ship the
  // live chip on the page unguarded (it fails AA in light with a lighter
  // accent; `dash-accent` was darkened so every backdrop clears AA_TEXT).
  pairing('dash-accent', 'dash-accent-soft', AA_TEXT, 'dashboard accent text on the accent tint over the page', 'dash-bg'),
  pairing('dash-accent', 'dash-accent-soft', AA_TEXT, 'dashboard accent text on the accent tint over a card', 'dash-surface'),
  pairing('dash-accent', 'dash-accent-soft', AA_TEXT, 'dashboard accent text on the accent tint over a stat tile', 'dash-surface2'),
  pairing('dash-accent', 'dash-accent-soft', AA_TEXT, 'dashboard accent text on the accent tint over the raised tile', 'dash-surface3'),
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
  // guarded on the card and stat-tile surfaces a grade value sits on, both
  // modes, so a widget cannot ship grade text unguarded (finding #1, PR #650).
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
  // The primary button: `dash-on-accent` label on the accent fill. AA_LARGE,
  // matching how `on-accent`/`accent` is held above (button label = UI text).
  pairing('dash-on-accent', 'dash-accent', AA_LARGE, 'dashboard primary button label on accent'),
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
