import React from 'react';
import PropTypes from 'prop-types';

// 16x16 pixel-art runner, shared by the full-screen touchdown cutscene and the
// persistent retro field. Body rows are shared; only the legs differ between
// the two animation frames, giving a 2-frame run cycle. Role letters map to
// team-kit colors (H/J/P/A) or fixed sprite colors (S skin, F facemask, B boot).
export const BODY = [
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HFFFFFFH....',
  '.....SSSSSS.....',
  '...JJJJJJJJJJ...',
  '..JJJJJAAJJJJJ..',
  '.SJJJJJAAJJJJJS.',
  '.SJJJJJJJJJJJJS.',
  '..JJJJJJJJJJJJ..',
  '...PPPPPPPPPP...',
];
// Rows 11-15 are legs; two frames.
export const LEGS_A = [
  '...PPPP..PPPP...',
  '..PPP......PPP..',
  '..SSS......SSS..',
  '..SS........SS..',
  '.BBB........BBB.',
];
export const LEGS_B = [
  '....PPPPPPPP....',
  '....PPPPPPPP....',
  '.....SSSSSS.....',
  '....SS....SS....',
  '...BBB....BBB...',
];

export const FIXED = { S: '#e8b58b', F: '#c8ccd0', B: '#1b1d22', '.': null };

export function rowsToRects(rows, kit) {
  const color = (ch) => {
    if (ch === 'H') return kit.helmet;
    if (ch === 'J') return kit.jersey;
    if (ch === 'P') return kit.pants;
    if (ch === 'A') return kit.accent;
    return FIXED[ch] !== undefined ? FIXED[ch] : null;
  };
  const rects = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const c = color(row[x]);
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={c} />);
    }
  });
  return rects;
}

/** One 16x16 sprite as an SVG; `frame` (0|1) picks the leg cycle. */
export function Sprite({ kit, frame, className }) {
  const legs = frame === 0 ? LEGS_A : LEGS_B;
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {rowsToRects([...BODY, ...legs], kit)}
    </svg>
  );
}

Sprite.propTypes = {
  kit: PropTypes.object.isRequired,
  frame: PropTypes.number.isRequired,
  className: PropTypes.string,
};
