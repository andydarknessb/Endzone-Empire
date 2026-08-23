import { colorTokens, scaleTokens } from './tokens';
import { contrastRatio } from './contrast';

// WCAG 2.1 AA thresholds: 4.5:1 for normal body text, 3:1 for large text and
// UI component text (e.g. button labels). Each pairing below is a
// foreground/background combination the token set puts on screen, or (for the
// veil tokens, which have no call site today) the one the token exists for.
const AA_TEXT = 4.5;
const AA_LARGE = 3.0;

// A translucent token has no ratio on its own: it takes the color of whatever
// it is laid over. `backdrop` is that solid color, and contrast.js composites
// the pairing over it before measuring. Two backdrops are in play:
//
//   * `surface` for `accent-soft`, the row-hover / quick-draft tint, which is
//     always painted on a card.
//   * BRIGHTEST_BACKDROP for `scrim` and `overlay`, dark veils laid over
//     content this file cannot know (a photo, or whatever a modal covers).
//     White is the worst case for the light text that sits on them; over any
//     darker backdrop the ratio only improves. Measured there both land under
//     4.5, so they carry the large-text threshold: `on-overlay` is heading and
//     label text on a veil, not body copy.
const BRIGHTEST_BACKDROP = '#ffffff';

// fg / bg are token keys; backdrop is a token key or a literal color, and is
// only needed when fg or bg carries alpha.
const pairing = (fg, bg, min, label, backdrop) => ({ fg, bg, min, label, backdrop });

const PAIRINGS = [
  pairing('text-primary', 'bg-page', AA_TEXT, 'body text on the page'),
  pairing('text-primary', 'surface', AA_TEXT, 'body text on cards'),
  pairing('text-muted', 'surface', AA_TEXT, 'muted text on cards'),
  pairing('text-muted', 'bg-page', AA_TEXT, 'muted text on the page'),
  pairing('accent', 'bg-page', AA_TEXT, 'links on the page'),
  pairing('accent', 'surface', AA_TEXT, 'links on cards'),
  // The app bar and other raised surfaces: the active nav link sits here, and
  // this pairing was the one the other two didn't cover.
  pairing('accent', 'surface-raised', AA_TEXT, 'active nav link on the app bar'),
  pairing('text-primary', 'surface-raised', AA_TEXT, 'body text on a raised surface'),
  pairing('text-muted', 'surface-raised', AA_TEXT, 'muted text on a raised surface'),
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
  // `accent-soft` is the theme-level MuiTableRow hover (AppThemeProvider) and
  // the Draft rail's quick-draft highlight; both sit on a card.
  pairing('text-primary', 'accent-soft', AA_TEXT, 'cell text on an accent-tinted row', 'surface'),
  pairing('text-muted', 'accent-soft', AA_TEXT, 'muted cell text on an accent-tinted row', 'surface'),
  pairing('on-overlay', 'scrim', AA_LARGE, 'light text on a photo scrim', BRIGHTEST_BACKDROP),
  pairing('on-overlay', 'overlay', AA_LARGE, 'light text on a modal overlay', BRIGHTEST_BACKDROP),
];

describe.each(['light', 'dark'])('%s theme contrast', (mode) => {
  // `on-overlay` and `scrim` are theme-independent (they always sit on a dark
  // veil), so they live in scaleTokens rather than the per-theme color map.
  const tokens = { ...scaleTokens, ...colorTokens[mode] };

  test.each(PAIRINGS)(
    '$fg / $bg meets AA ($min:1) — $label',
    ({ fg, bg, min, backdrop }) => {
      const over = backdrop === undefined ? undefined : tokens[backdrop] ?? backdrop;
      const ratio = contrastRatio(tokens[fg], tokens[bg], over);
      expect(ratio).toBeGreaterThanOrEqual(min);
    }
  );
});
