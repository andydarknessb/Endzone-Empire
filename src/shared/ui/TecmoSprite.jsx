import React from 'react';
import PropTypes from 'prop-types';

// 16x16 pixel-art runner, shared by the full-screen touchdown cutscene
// (features/celebrate-touchdown) and the persistent retro field
// (widgets/retro-scoreboard). It lives in `shared/ui` (ADR 0020: the bottom
// of the island) because a feature and a widget both compose it and neither
// may import the other (ADR 0031, #903). The palette is a fixed pixel-art data
// encoding, not a themed pairing, and is allowlisted in
// scripts/check-color-literals.js. Body rows are shared; only the legs differ
// between the two animation frames, giving a 2-frame run cycle. Role letters
// map to team-kit colors (H/J/P/A) or fixed sprite colors (S skin, F facemask,
// B boot).
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

export const FIXED = {
  S: '#e8b58b', // skin
  F: '#c8ccd0', // facemask
  B: '#1b1d22', // boot black (also referee cap/stripes/socks)
  W: '#f2f4f8', // referee white (stripes, knickers)
  Y: '#ffd23f', // goal-post yellow (matches the cutscene title yellow)
  '.': null,
};

// 16x16 referee signaling touchdown — striped shirt, white knickers, both arms
// up. Two full frames (the arms are what animate, so no body/legs split): B is
// arms fully extended and A drops them 1px lower/wider for a bounce cycle.
export const REF_UP_A = [
  '...S........S...',
  '...W........W...',
  '...W..BBBB..W...',
  '...B.BBBBBB.B...',
  '...W..SSSS..W...',
  '...W..SSSS..W...',
  '....WW.SS.WW....',
  '....WBWBWBWB....',
  '....WBWBWBWB....',
  '....WBWBWBWB....',
  '.....BBBBBB.....',
  '.....WWWWWW.....',
  '....WWW..WWW....',
  '....BB....BB....',
  '....BB....BB....',
  '...BBB....BBB...',
];
export const REF_UP_B = [
  '................',
  '..S..........S..',
  '..W...BBBB...W..',
  '..B..BBBBBB..B..',
  '..W...SSSS...W..',
  '...W..SSSS..W...',
  '....WW.SS.WW....',
  ...REF_UP_A.slice(7),
];

// 16x16 chunky goal post — uprights, crossbar, center pole, base.
export const GOAL_POST = [
  'YY............YY',
  'YY............YY',
  'YY............YY',
  'YY............YY',
  'YY............YY',
  'YYYYYYYYYYYYYYYY',
  '.......YY.......',
  '.......YY.......',
  '.......YY.......',
  '.......YY.......',
  '.......YY.......',
  '.......YY.......',
  '.......YY.......',
  '.......YY.......',
  '......YYYY......',
  '.....YYYYYY.....',
];

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

// The referee and goal post use only FIXED colors — no team kit letters — so
// rowsToRects gets an empty kit and the H/J/P/A branches never match.
const EMPTY_KIT = {};

/**
 * Touchdown referee, arms up; `frame` (0|1) picks the bounce pose.
 * `testId` is an optional test-only seam: the sprite stays `aria-hidden`, so a
 * test that needs to see it has no role or accessible name to query it by.
 */
export function RefereeSprite({ frame, className, testId }) {
  return (
    <svg
      className={className}
      data-testid={testId}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {rowsToRects(frame === 0 ? REF_UP_A : REF_UP_B, EMPTY_KIT)}
    </svg>
  );
}

RefereeSprite.propTypes = {
  frame: PropTypes.number.isRequired,
  className: PropTypes.string,
  testId: PropTypes.string,
};

/** Static pixel goal post. `testId` is the same test-only seam as RefereeSprite. */
export function GoalPostSprite({ className, testId }) {
  return (
    <svg
      className={className}
      data-testid={testId}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {rowsToRects(GOAL_POST, EMPTY_KIT)}
    </svg>
  );
}

GoalPostSprite.propTypes = {
  className: PropTypes.string,
  testId: PropTypes.string,
};
