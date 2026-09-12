import { contrastRatio } from '../../../theme/contrast';

// WCAG 1.4.3's normal-text threshold. The monogram glyph is 14px/700, below
// the 18.66px bold cutoff for "large text", so 4.5:1 applies (issue #1301).
const AA_TEXT = 4.5;

const WHITE = '#ffffff';
const BLACK = '#000000';

/**
 * The monogram's ink color for a given kit.jersey fill: white when it clears
 * 4.5:1 against that jersey, black otherwise (issue #1301).
 *
 * Both inks are fixed literals, never theme tokens: the jersey itself is a
 * real external NFL brand color (`src/lib/nflTeamColors.js`), not a themed
 * one, so the ink drawn on it has to stay fixed alongside it regardless of
 * light/dark mode - the same reasoning `TeamPickButton` already applies to
 * `kit.jersey` itself.
 *
 * The dark ink is literal black, not a near-black: the four jerseys that
 * fail white (CIN, MIA, CAR, LAC) sit at mid luminance, where a near-black
 * such as `#101820` only clears CAR (4.44) and LAC (4.18) - both too close
 * to the 4.5:1 floor to trust. Literal `#000000` clears all four (CIN 6.23,
 * MIA 5.32, CAR 5.21, LAC 4.90) and the neutral fallback kit (14.85).
 *
 * Reuses `contrastRatio` from `src/theme/contrast.js` rather than a second
 * compositing path (#354); brand hex values in `nflTeamColors.js` stay at
 * their brand values (a brand-fidelity call, not a contrast fix).
 */
export function monogramInk(jersey) {
  return contrastRatio(WHITE, jersey) >= AA_TEXT ? WHITE : BLACK;
}
