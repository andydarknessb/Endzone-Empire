import { SPRITE_FIXED } from '../../../shared/ui';

// Pixel frames the Postgame scenes add to the shared Tecmo runner. The runner's
// own high-step is `Sprite` from `shared/ui` (its LEGS_A / LEGS_B cycle); these
// are the poses it does not have. Role letters are the shared ones: H helmet,
// J jersey, P pants and A accent take the Team kit's colors; S skin, F facemask
// and B boot are the fixed sprite colors (`SPRITE_FIXED`). The ball's own two
// colors are fixed pixel-art data, allowlisted in scripts/check-color-literals.js.

/** Every player frame is 16 columns by 16 rows, feet on the last row (the helmet is 8 by 8). */
export const FRAME_SIZE = 16;

// Facing right, laid out flat: arms out front, legs trailing.
export const DIVE = [
  '................',
  '................',
  '................',
  '................',
  '........HHHH....',
  '.......HHHHHH...',
  '.......HFFFFHS..',
  '..PPJJJJJJJJSSSS',
  '.PPPJJJJAAJJJSSS',
  'PPPPJJJJAAJJJJ..',
  '.BPPPJJJJJJJ....',
  'BBB.PPPPPP......',
  '................',
  '................',
  '................',
  '................',
];

// Standing, the throwing arm down at the ball.
export const SPIKE = [
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HFFFFFFH....',
  '.....SSSSSS.....',
  '...JJJJJJJJJJ...',
  '..JJJJJAAJJJJJ..',
  '.SJJJJJAAJJJJJJ.',
  '..JJJJJJJJJJJJS.',
  '..JJJJJJJJJJJ.S.',
  '...PPPPPPPPPP.S.',
  '...PPPP..PPPP.SS',
  '..PPP......PPP..',
  '..SSS......SSS..',
  '..SS........SS..',
  '.BBB........BBB.',
];

// The dance: both arms up, arms out with feet together, one arm up and a kick.
export const DANCE_A = [
  '................',
  '................',
  '..S..HHHHHH..S..',
  '..S.HHHHHHHH.S..',
  '..JJHFFFFFFHJJ..',
  '...J.SSSSSS.J...',
  '...JJJJJJJJJJ...',
  '....JJJAAJJJ....',
  '....JJJAAJJJ....',
  '....JJJJJJJJ....',
  '....PPPPPPPP....',
  '...PPPP..PPPP...',
  '..PPP......PPP..',
  '..SS........SS..',
  '..SS........SS..',
  '.BBB........BBB.',
];
export const DANCE_B = [
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HFFFFFFH....',
  '.....SSSSSS.....',
  'SSJJJJJJJJJJJJSS',
  '..JJJJJAAJJJJJ..',
  '..JJJJJAAJJJJJ..',
  '...JJJJJJJJJJ...',
  '...PPPPPPPPPP...',
  '....PPPPPPPP....',
  '....PPPPPPPP....',
  '.....SSSSSS.....',
  '.....SS..SS.....',
  '.....SS..SS.....',
  '....BBB..BBB....',
];
export const DANCE_C = [
  '..............S.',
  '.....HHHHHH..S..',
  '....HHHHHHHH.J..',
  '....HFFFFFFHJ...',
  '.....SSSSSS.J...',
  '...JJJJJJJJJJ...',
  '..JJJJJAAJJJJJ..',
  '.SJJJJJAAJJJJJ..',
  '.S.JJJJJJJJJJ...',
  '...PPPPPPPPPP...',
  '....PPPPPPPP....',
  '....PPPP.PPPP...',
  '...PPP....SSS...',
  '..SSS.....SS....',
  '..SS......BBB...',
  '.BBB............',
];
/** The dance loops A, B, C. */
export const DANCE = [DANCE_A, DANCE_B, DANCE_C];

// The loss walk: head down, shoulders hunched, arms hanging, no helmet on (the
// helmet is dragged along as its own sprite). Facing right; the scene mirrors
// the pair to walk right to left. Two frames, the trailing leg swapping.
export const SLOUCH_A = [
  '................',
  '................',
  '................',
  '................',
  '.....SSSS.......',
  '....SSSSSS......',
  '....SSSSSS......',
  '...JJJSSJJJ.....',
  '..JJJJJJJJJJ....',
  '.SJJJJAAJJJJ....',
  '.SJJJJAAJJJJ....',
  '.S.JJJJJJJJ.....',
  '.S..PPPPPPP.....',
  '....PPP..PPP....',
  '....PP....PP....',
  '...BBB....BBB...',
];
export const SLOUCH_B = [
  '................',
  '................',
  '................',
  '................',
  '.....SSSS.......',
  '....SSSSSS......',
  '....SSSSSS......',
  '...JJJSSJJJ.....',
  '..JJJJJJJJJJ....',
  '..SJJJAAJJJJ....',
  '..SJJJAAJJJJ....',
  '..S.JJJJJJJ.....',
  '..S.PPPPPPP.....',
  '.....PPPPP......',
  '.....PP.PP......',
  '....BBB.BBB.....',
];
/** The walk loops A, B. */
export const SLOUCH = [SLOUCH_A, SLOUCH_B];

// The helmet dragged along the ground, 8 columns by 8 rows: H shell, F facemask.
export const HELMET = [
  '........',
  '........',
  '........',
  '..HHHH..',
  '.HHHHHH.',
  'HHHHHHFF',
  'HHHHHHF.',
  '.HHHHH..',
];

// The football, 6 columns by 4 rows: O leather, L lace.
export const BALL = [
  '.OOOO.',
  'OOLLOO',
  'OOOOOO',
  '.OOOO.',
];
export const BALL_COLORS = { O: '#8a4b1f', L: '#f2f4f8' };

function colorFor(ch, kit, palette) {
  if (ch === 'H') return kit.helmet;
  if (ch === 'J') return kit.jersey;
  if (ch === 'P') return kit.pants;
  if (ch === 'A') return kit.accent;
  if (palette && palette[ch]) return palette[ch];
  return SPRITE_FIXED[ch] || null;
}

/**
 * One frame as a list of one-pixel rectangles `{ x, y, fill }`, transparent
 * pixels left out. `kit` supplies H/J/P/A; `palette` adds letters of its own
 * (the ball's).
 */
export function frameRects(rows, kit = {}, palette = null) {
  const rects = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const fill = colorFor(row[x], kit, palette);
      if (fill) rects.push({ x, y, fill });
    }
  });
  return rects;
}
