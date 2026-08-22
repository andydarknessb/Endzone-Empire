import { colorTokens } from './tokens';
import { contrastRatio } from './contrast';

// WCAG 2.1 AA thresholds: 4.5:1 for normal body text, 3:1 for large text and
// UI component text (e.g. button labels). Each pairing below is an actual
// foreground/background combination used somewhere in the app.
const AA_TEXT = 4.5;
const AA_LARGE = 3.0;

const PAIRINGS = [
  // token key foreground, token key background, minimum ratio, label
  ['text-primary', 'bg-page', AA_TEXT, 'body text on the page'],
  ['text-primary', 'surface', AA_TEXT, 'body text on cards'],
  ['text-muted', 'surface', AA_TEXT, 'muted text on cards'],
  ['text-muted', 'bg-page', AA_TEXT, 'muted text on the page'],
  ['accent', 'bg-page', AA_TEXT, 'links on the page'],
  ['accent', 'surface', AA_TEXT, 'links on cards'],
  // The app bar and other raised surfaces: the active nav link sits here, and
  // this pairing was the one the other two didn't cover.
  ['accent', 'surface-raised', AA_TEXT, 'active nav link on the app bar'],
  ['text-primary', 'surface-raised', AA_TEXT, 'body text on a raised surface'],
  ['text-muted', 'surface-raised', AA_TEXT, 'muted text on a raised surface'],
  ['on-accent', 'accent', AA_LARGE, 'button label on accent'],
  ['text-inverse', 'danger', AA_LARGE, 'alert banner text'],
  ['danger', 'surface', AA_TEXT, 'error text on cards'],
  // Position chips/avatars: white (light) or dark (dark) label on the fill.
  ['text-inverse', 'pos-qb', AA_TEXT, 'QB position chip label'],
  ['text-inverse', 'pos-rb', AA_TEXT, 'RB position chip label'],
  ['text-inverse', 'pos-wr', AA_TEXT, 'WR position chip label'],
  ['text-inverse', 'pos-te', AA_TEXT, 'TE position chip label'],
  ['text-inverse', 'pos-k', AA_TEXT, 'K position chip label'],
  ['text-inverse', 'pos-def', AA_TEXT, 'DEF position chip label'],
  ['text-inverse', 'pos-idp', AA_TEXT, 'IDP position chip label'],
  // Table cell text on striped / hovered rows.
  ['text-primary', 'row-stripe', AA_TEXT, 'cell text on a striped row'],
  ['text-primary', 'row-hover', AA_TEXT, 'cell text on a hovered row'],
  ['text-muted', 'row-stripe', AA_TEXT, 'muted cell text on a striped row'],
  // The amber "Teams: N/M" chip (MUI warning): its label flips white/dark with
  // the theme, matching text-inverse.
  ['text-inverse', 'warning', AA_TEXT, 'label on the amber Teams chip'],
  // Amber as TEXT on a card, which the row above does not cover: the roster
  // needs strip's "every remaining pick has to fill a starting spot" line and
  // the roster panel's rounds-vs-capacity note.
  ['warning', 'surface', AA_TEXT, 'warning severity line on cards'],
];

describe.each(['light', 'dark'])('%s theme contrast', (mode) => {
  const tokens = colorTokens[mode];

  test.each(PAIRINGS)(
    '%s / %s meets AA (%s:1) — %s',
    (fgKey, bgKey, min, _label) => {
      const ratio = contrastRatio(tokens[fgKey], tokens[bgKey]);
      expect(ratio).toBeGreaterThanOrEqual(min);
    }
  );
});
