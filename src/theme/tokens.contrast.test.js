import { colorTokens, scaleTokens } from './tokens';
import { contrastRatio } from './contrast';
import { NFL_TEAM_COLORS, FALLBACK_KIT } from '../shared/lib/nflTeamColors';
import { monogramInk } from '../shared/lib/monogramInk';

// WCAG 2.1 AA thresholds: 4.5:1 for normal body text, 3:1 for large text and
// UI component text (e.g. button labels). Each pairing below is a
// foreground/background combination the token set puts on screen, except the
// two veil rows, whose premise is spelled out with BRIGHTEST_BACKDROP.
const AA_TEXT = 4.5;
const AA_LARGE = 3.0;

// Not a WCAG number: the floor for a container edge that no meaning rests on (a tertiary
// frame's 2px border; its own Pixel 16 heading names the region). Dark Rule is 2:1 on Field.
const DECORATIVE_EDGE = 1.5;

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
// the retired UserPage stylesheet, pairs `on-overlay` with `scrim`, not `overlay`, and that file
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
  // The Decision card (#1307, ADR 0040): the WeeklyPointsBars current-week
  // marker (a 9px/700 pill) and the DecisionStrip Upgrade pill (15px/700 -
  // not WCAG "large text" either, which needs >=18.66px bold) both paint
  // `success` text in an outline on the card's own opaque `surface`, one
  // pairing since neither carries a fill (a risk-review finding: the
  // original design tinted BOTH with `accent-soft`, which measured 4.44 in
  // light mode, under AA_TEXT's 4.5 - the outline-on-surface pairing here
  // clears it comfortably: 5.13 light, 10.31 dark). New per the issue's
  // premise-check ruling item 4 - the other two Decision-card pairings it
  // names (`on-accent`/`accent`, `text-inverse`/`warning`) were already
  // registered above.
  pairing('success', 'surface', AA_TEXT, 'the Decision card current-week marker and Upgrade pill'),
  // #354 sweep: every other `accent-soft` consumer checked below sits on
  // `surface` (already covered by the two rows above) or has no text on it.
  // Five do not:
  //
  // The legacy Game Center's LiveActionTicker painted `accent-soft` directly
  // as its own Paper's background, and that Paper sat straight on the page -
  // its backdrop was `bg-page`, not `surface`. The ticker text was MUI body2
  // at 14px even when bold, under the 14pt/18.66px bold threshold for "large
  // text", so AA_TEXT applies. That page left with #897 (the island's
  // scoring-feed widget no longer uses this pairing); the
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
  // `background.default` == `bg-page`) and DraftSim's selected-format Card
  // (SimConfigForm.jsx, rendered inside DraftSimScreen's plain Container on
  // `bg-page`) paint `accent-soft` as the card's own background with no
  // intervening surface, and each carries a `text.secondary` (`text-muted`)
  // body/caption line. Same fg/bg/backdrop triple in both, so one row covers
  // it; thin margin like the hero tint above (4.84:1 light, 5.73:1 dark).
  pairing(
    'text-muted',
    'accent-soft',
    AA_TEXT,
    'muted text on an accent-tinted card on the page (ArticleCard, SimConfigForm)',
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
  //   - SimPickFeed's active-team row (SimPickFeed.jsx) paints `accent-soft`
  //     inside a MUI Paper/Accordion, whose background is `background.paper`
  //     == `surface` (AppThemeProvider.jsx). Same backdrop as the two rows at
  //     the top of this block, so nothing new to measure.
  //   - LeagueHistory's champion banner moved off this MUI pairing at #1213:
  //     it now lives at `src/pages/league-history/LeagueHistoryPage.jsx`, on
  //     the dashboard kit, since retired (ADR 0067), and no longer uses this
  //     pairing. The note stays so the sweep reads complete.
  //   - LandingPage.css's own `accent-soft` consumer, the `landing-cta-pulse`
  //     keyframe, scales and fades an `::after` ring behind a button (transform and
  //     opacity only); no text sits on it.
  //   - UserPage's banner (the retired UserPage stylesheet `.user-page:before`/`.container`,
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

  // The Draft assistant's Misery Meter stage label (issue #786, ADR 0027):
  // SimAssistantPanel.jsx colors the band name (e.g. "1966 Form") with
  // `secondary.main` on its Paper, whose background is `background.paper` ==
  // `surface` (AppThemeProvider.jsx), the same backdrop SimPickFeed's own
  // `accent-soft` row already resolves to. `secondary`/`success` share one
  // token value and neither had a text-on-surface pairing guarded before this
  // - this is that measurement, not an assumption.
  pairing('secondary', 'surface', AA_TEXT, 'Misery Meter stage label on the Draft assistant panel'),

  // ---- Home Play-select (DESIGN.md "Play-select: Home and league pages"). Home paints
  // only from the `ps-*` group; the pairings below are the ones it puts on
  // screen, in both modes. Text tiers sit on the page (`ps-field`) and in
  // frames (`ps-panel`); play-card text sits on the fixed Play blue and its
  // darker field band; the board is black in both themes.
  pairing('ps-ink', 'ps-field', AA_TEXT, 'Home body text on the page'),
  pairing('ps-ink', 'ps-panel', AA_TEXT, 'Home body text in a frame'),
  ...['ps-cell', 'ps-cell-above', 'ps-cell-below'].map((cell) => pairing('ps-ink', cell, AA_TEXT, `game log cell text on ${cell}`)),
  pairing('ps-dim', 'ps-field', AA_TEXT, 'Home muted text on the page'),
  pairing('ps-dim', 'ps-panel', AA_TEXT, 'Home muted text in a frame'),
  pairing('ps-play-ink', 'ps-play', AA_TEXT, 'play card name and foot label on the Play blue'),
  pairing('ps-play-ink', 'ps-play-field', AA_TEXT, 'play card pictogram on its field band'),
  pairing('ps-play-dim', 'ps-play', AA_TEXT, 'play card league line and lock note on the Play blue'),
  pairing('ps-play-dim', 'ps-play-field', AA_TEXT, 'play card hash marks on its field band'),
  pairing('ps-on-accent', 'ps-accent', AA_TEXT, 'Home filled button label on accent'),
  pairing('ps-on-danger', 'ps-danger', AA_TEXT, 'urgent strip text on danger'),
  pairing('ps-on-play-accent', 'ps-play-accent', AA_TEXT, 'the lead foot label on the fixed play-card green'),
  pairing('ps-play-accent', 'ps-play', AA_TEXT, 'the lead foot fill and the Live lock line on the Play blue'),
  pairing('ps-board-ink', 'ps-board', AA_TEXT, 'scoreboard and pick-em tile text on Board'),
  pairing('ps-board-dim', 'ps-board', AA_TEXT, 'scoreboard and pick-em tile muted text on Board'),
  pairing('ps-board-live', 'ps-board', AA_LARGE, 'live odds fill on Board'),
  // The Matchup Scoreboard view stays amber LED on black (ADR 0067 item 4): ps-led reads on ps-board.
  pairing('ps-led', 'ps-board', AA_TEXT, 'LED digits on the retro scoreboard face'),
  // Non-text edges on the page: the cursor frame, the double rule, the urgent
  // cursor and error panel, and the live odds fill and chip outline.
  pairing('ps-cursor', 'ps-field', AA_LARGE, 'cursor frame on the page'),
  // Badge warning (the injury tag's may-not-play tone): 11px text and edge on the panel fill.
  pairing('ps-medal-gold', 'ps-panel', AA_TEXT, 'Badge warning text and edge on a frame'),
  pairing('ps-frame', 'ps-field', AA_LARGE, 'frame double rule on the page'),
  pairing('ps-danger', 'ps-field', AA_LARGE, 'urgent cursor and error frame on the page'),
  // Pickem (ADR 0067 wave 2): "Locks in n min" and a failed save's words are Danger text on a frame.
  pairing('ps-danger', 'ps-panel', AA_TEXT, 'Pickem lock words and failed-save text in a frame'),
  pairing('ps-accent', 'ps-field', AA_TEXT, 'live chip text and outline, live odds fill on the page (16px pixel text is not WCAG large)'),
  pairing('ps-accent', 'ps-panel', AA_TEXT, 'live chip text and outline in a frame'),
  pairing('ps-focus', 'ps-halo', AA_LARGE, 'focus ring on its dark halo'),
  pairing('ps-halo', 'ps-selection', AA_TEXT, 'selected text on the cursor-yellow selection'),
  // League pages: the 2px edge of a tertiary frame, on the page and against its own panel fill.
  pairing('ps-frame-2', 'ps-field', DECORATIVE_EDGE, 'tertiary frame edge on the page'),
  pairing('ps-frame-2', 'ps-panel', DECORATIVE_EDGE, 'tertiary frame edge against its own panel fill'),
  // Menu panel (#2652 Home, #2660 league dashboard): NES navy in dark, white in light.
  pairing('ps-ink', 'ps-menu-panel', AA_TEXT, 'body text in a frame on the menu panel'),
  pairing('ps-dim', 'ps-menu-panel', AA_TEXT, 'muted text in a frame on the menu panel'),
  pairing('ps-accent', 'ps-menu-panel', AA_TEXT, 'live chip text and outline in a frame on the menu panel'),
  pairing('ps-danger', 'ps-menu-panel', AA_TEXT, 'danger text in a frame on the menu panel'),
  pairing('ps-cursor', 'ps-menu-panel', AA_LARGE, 'cursor frame on the menu panel'),
  pairing('ps-frame', 'ps-menu-panel', AA_LARGE, 'frame double rule on the menu panel'),
  pairing('ps-frame-2', 'ps-menu-panel', DECORATIVE_EDGE, 'tertiary frame edge on the menu panel'),
  pairing('ps-rule', 'ps-menu-panel', DECORATIVE_EDGE, 'frame dividers on the menu panel'),
  // The league dashboard adds the gold badge, the rank medals and the position tags on the menu panel.
  pairing('ps-medal-gold', 'ps-menu-panel', AA_TEXT, 'gold rank medal and badge warning text on the league dashboard menu panel'),
  ...['gold', 'silver', 'bronze'].map((m) => pairing(`ps-medal-${m}`, 'ps-menu-panel', AA_LARGE, `the ${m} rank medal on the league dashboard menu panel`)),
  ...['qb', 'rb', 'wr', 'te', 'k', 'def', 'idp'].map((pos) => pairing(`pos-${pos}`, 'ps-menu-panel', AA_TEXT, `position tag text and edge on the league dashboard menu panel (${pos})`)),
  // League History podium medals: non-text marks on a Play-select frame, held to the 3:1 non-text floor.
  ...['gold', 'silver', 'bronze'].map((m) => pairing(`ps-medal-${m}`, 'ps-panel', AA_LARGE, `the ${m} rank medal on a Play-select frame`)),
  // Position tags on a frame: a data encoding (RULINGS.md), still held to AA text on Panel.
  ...['qb', 'rb', 'wr', 'te', 'k', 'def', 'idp'].map((pos) => pairing(`pos-${pos}`, 'ps-panel', AA_TEXT, `position tag text and edge on a Play-select frame (${pos})`)),
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

// External-data lane (issue #1301, ADR 0010): every PAIRINGS row above
// resolves its background through this file's own `tokens` map, so a
// pairing whose background comes from an external table - a brand color this
// app does not control - has no lane at all. `NFL_TEAM_COLORS` (plus its
// `FALLBACK_KIT`) is exactly that: the Pick'em team monogram
// (`TeamPickButton.jsx`) paints `monogramInk(jersey)` on `kit.jersey`, and
// this describe certifies exactly that pairing - `monogramInk` clearing
// AA_TEXT against every jersey it can be asked to ink - theme-independent
// since both colors are fixed literals rather than tokens.
// `TeamPickButton.test.jsx` is what pins the component to actually calling
// `monogramInk` rather than a fixed literal; this lane only certifies the
// function.
//
// Per ADR 0010 ("A green check certifies exactly what that check reads, and
// nothing adjacent"), this is not a blanket certification of every
// `kit.jersey` consumer - only of `monogramInk` itself. `LedgerRow.jsx`'s
// `PlayerAvatar` and the Decision card's old header avatar both called
// `monogramInk(kit.jersey)` too (#1317, the second and third consumers that
// triggered this function's promotion to `shared/lib`), but each component's
// own test file (`LedgerRow.test.jsx`, `PlayerDecisionCard.test.jsx`) is what
// pins IT to actually calling `monogramInk`, the same division of labour
// `TeamPickButton.test.jsx` already has with this lane. The next external
// palette (a sponsor table, an opponent kit) gets its own lane by adding to
// this map.
// ADR 0067 item 4: the retro scoreboard's amber, pinned so a retune is deliberate.
describe.each(['light', 'dark'])('%s theme ps-led values', (mode) => {
  test.each([['ps-led', '#ffb547'], ['ps-led-dim', 'rgba(255, 181, 71, 0.28)']])('%s is %s', (key, value) => {
    expect(colorTokens[mode][key]).toBe(value);
  });
});

describe('external color data: monogram ink on kit.jersey', () => {
  const jerseysByLabel = {
    ...NFL_TEAM_COLORS,
    FALLBACK_KIT: FALLBACK_KIT,
  };

  test.each(Object.entries(jerseysByLabel))(
    "monogramInk clears AA (4.5:1) on %s's jersey",
    (_label, kit) => {
      const ink = monogramInk(kit.jersey);
      expect(contrastRatio(ink, kit.jersey)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  );
});
