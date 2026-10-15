import React from 'react';

// Authored SVG on the 8px grid with square caps, ported from the canvas kit
// (docs/design/home/kit.js). Colour is `currentColor`, set by the caller.

export function PixelArrow({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M3 1h2v2h2v2h2v2H7v2H5v2H3z" fill="currentColor" />
    </svg>
  );
}

export function PixelClock({ color = 'currentColor' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: 'none', color }}>
      <path d="M5 1h6v2H5zM3 3h2v2H3zM11 3h2v2h-2zM1 5h2v6H1zM13 5h2v6h-2zM3 11h2v2H3zM11 11h2v2h-2zM5 13h6v2H5zM7 4h2v5H7zM9 8h2v2H9z" fill="currentColor" />
    </svg>
  );
}

export function PixelWarn({ color = 'currentColor' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: 'none', color }}>
      <path d="M7 1h2v2h2v4h2v4h2v4H1v-4h2V7h2V3h2zM7 5v5h2V5zM7 11v2h2v-2z" fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

// Pixel sprites on a 2px grid (viewBox 96x48): Os, Xs, routes and arrowheads
// are stepped rects, like the clock and warn icons.
const cells = (x0, y0, rows) => rows
  .map((r, j) => [...r].map((c, i) => (c === '#' ? `M${x0 + i * 2} ${y0 + j * 2}h2v2h-2z` : '')).join(''))
  .join('');
const O = (x, y) => cells(x - 6, y - 6, ['.####.', '#....#', '#....#', '#....#', '#....#', '.####.']);
const X = (x, y) => cells(x - 5, y - 5, ['#...#', '.#.#.', '..#..', '.#.#.', '#...#']);
const H = (x1, x2, y) => `M${x1} ${y}h${x2 - x1}v2h${x1 - x2}z`;
const V = (x, y1, y2) => `M${x} ${y1}h2v${y2 - y1}h-2z`;
const dashH = (x1, x2, y) => {
  let d = '';
  for (let x = x1; x < x2; x += 8) d += H(x, Math.min(x + 4, x2), y);
  return d;
};
const dashV = (x, y1, y2) => {
  let d = '';
  for (let y = y1; y < y2; y += 8) d += V(x, y, Math.min(y + 4, y2));
  return d;
};
const headR = (x, y) => cells(x, y - 6, ['#...', '##..', '###.', '####', '###.', '##..', '#...']);
const headL = (x, y) => cells(x - 8, y - 6, ['...#', '..##', '.###', '####', '.###', '..##', '...#']);
const bracket = (x1, y1, x2, y2) => H(x1, x1 + 6, y1) + V(x1, y1, y1 + 6) + H(x2 - 6, x2, y1) + V(x2 - 2, y1, y1 + 6)
  + H(x1, x1 + 6, y2 - 2) + V(x1, y2 - 6, y2) + H(x2 - 6, x2, y2 - 2) + V(x2 - 2, y2 - 6, y2);

export const PICTO = {
  // the pick: your side bracketed, the line of scrimmage between, the other side in Xs
  picks: bracket(8, 10, 36, 38) + O(22, 24) + dashV(48, 4, 44) + X(66, 14) + X(76, 34) + X(86, 14),
  // a formation: five linemen on the line, the QB behind
  lineup: dashH(4, 92, 8) + [16, 32, 48, 64, 80].map((x) => O(x, 22)).join('') + O(48, 38),
  // the snake: back and forth across the board
  draft: H(8, 84, 8) + V(82, 8, 24) + H(12, 84, 22) + V(12, 22, 38) + H(12, 78, 36) + headR(78, 37),
  // a claim: a route across the waiver line
  waivers: O(12, 24) + H(20, 78, 23) + dashV(52, 4, 44) + headR(78, 24),
  // a trade: two routes passing each other
  trade: O(12, 14) + H(20, 78, 13) + headR(78, 14) + O(84, 34) + H(18, 76, 33) + headL(18, 34),
  // a win: the trophy
  trophy: H(30, 66, 6) + V(30, 6, 22) + V(64, 6, 22) + H(30, 66, 20) + H(22, 30, 8) + V(22, 8, 16) + H(22, 30, 14)
    + H(66, 74, 8) + V(72, 8, 16) + H(66, 74, 14) + V(46, 22, 32) + H(38, 58, 32) + H(34, 62, 38) + V(34, 38, 42)
    + V(60, 38, 42) + H(34, 62, 40),
  // creating: a new huddle
  create: [[48, 8], [30, 14], [66, 14], [24, 30], [72, 30], [36, 40], [60, 40]].map(([x, y]) => O(x, y)).join('') + X(48, 26),
  // joining: a route into the huddle box
  join: O(12, 24) + H(20, 54, 23) + headR(54, 24) + H(66, 92, 8) + H(66, 92, 38) + V(66, 8, 40) + V(90, 8, 40),
};

/** One pictogram per play kind, white (`ps-play-ink`) on whatever band it sits in. `width` is px or a CSS length. */
export function Pictogram({ kind, width = 96 }) {
  const d = PICTO[kind];
  if (!d) return null;
  return (
    <svg
      width={width}
      height={typeof width === 'number' ? width / 2 : undefined}
      viewBox="0 0 96 48"
      aria-hidden="true"
      shapeRendering="crispEdges"
      style={{ display: 'block', color: 'var(--ps-play-ink)' }}
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}
