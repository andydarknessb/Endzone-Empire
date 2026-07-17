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
  ['on-accent', 'accent', AA_LARGE, 'button label on accent'],
  ['text-inverse', 'danger', AA_LARGE, 'alert banner text'],
  ['danger', 'surface', AA_TEXT, 'error text on cards'],
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
