import React from 'react';
import { render } from '@testing-library/react';
import {
  BODY, LEGS_A, LEGS_B, REF_UP_A, REF_UP_B, GOAL_POST,
  RefereeSprite, GoalPostSprite, Sprite, rowsToRects,
} from './TecmoSprite';

const LEGAL_ROW = /^[.HJPASFBWY]{16}$/;

// Plain string matching over container.innerHTML — not DOM node access/traversal
// (no querySelector, no .closest, no .children) — so this stays lint-clean while
// still reading what actually landed on screen.
const fillsFromHtml = (html) =>
  Array.from(html.matchAll(/<rect\b[^>]*\bfill="([^"]*)"/g)).map(([, fill]) => fill);

// Referee and goal post sprites use only FIXED colors, so rowsToRects gets an
// empty kit here too, mirroring TecmoSprite.jsx's own EMPTY_KIT.
const EMPTY_KIT_FOR_TEST = {};

describe('sprite pixel grids', () => {
  const grids = {
    BODY,
    LEGS_A,
    LEGS_B,
    REF_UP_A,
    REF_UP_B,
    GOAL_POST,
  };

  Object.entries(grids).forEach(([name, rows]) => {
    test(`${name} rows are 16 chars of legal letters`, () => {
      rows.forEach((row) => {
        expect(row).toMatch(LEGAL_ROW);
      });
    });
  });

  test('referee and goal post frames are full 16x16 grids', () => {
    expect(REF_UP_A).toHaveLength(16);
    expect(REF_UP_B).toHaveLength(16);
    expect(GOAL_POST).toHaveLength(16);
  });

  test('runner body + legs compose a full 16x16 grid', () => {
    expect([...BODY, ...LEGS_A]).toHaveLength(16);
    expect([...BODY, ...LEGS_B]).toHaveLength(16);
  });
});

describe('kit-free sprites', () => {
  // Each of these tests keeps two things true, matching #326's hard constraint:
  // the builder (rowsToRects) is asserted on directly via its own React-element
  // props (`.props` access is exempt from no-node-access — it's plain object
  // access, not DOM traversal), AND a render assertion survives proving the
  // component actually puts that builder output on screen, not just that the
  // builder itself is correct.
  test('RefereeSprite renders rects with a fill on every pixel', () => {
    const rects = rowsToRects(REF_UP_A, EMPTY_KIT_FOR_TEST);
    expect(rects.length).toBeGreaterThan(0);
    rects.forEach((rect) => {
      expect(rect.props.fill).toBeTruthy();
      expect(rect.props.fill).not.toBe('undefined');
    });

    const { container } = render(<RefereeSprite frame={0} />);
    expect(fillsFromHtml(container.innerHTML)).toEqual(rects.map((rect) => rect.props.fill));
  });

  test('RefereeSprite bounce frame differs from the extended frame', () => {
    const a = render(<RefereeSprite frame={0} />).container.innerHTML;
    const b = render(<RefereeSprite frame={1} />).container.innerHTML;
    expect(a).not.toEqual(b);
  });

  test('GoalPostSprite renders yellow rects only', () => {
    const rects = rowsToRects(GOAL_POST, EMPTY_KIT_FOR_TEST);
    expect(rects.length).toBeGreaterThan(0);
    rects.forEach((rect) => {
      expect(rect.props.fill).toBe('#ffd23f');
    });

    const { container } = render(<GoalPostSprite />);
    const screenFills = fillsFromHtml(container.innerHTML);
    expect(screenFills).toEqual(rects.map((rect) => rect.props.fill));
  });

  test('runner Sprite still renders with a team kit', () => {
    const kit = { helmet: '#e31837', jersey: '#e31837', pants: '#ffffff', accent: '#ffb81c' };
    const rects = rowsToRects([...BODY, ...LEGS_A], kit);
    expect(rects.length).toBeGreaterThan(0);

    const { container } = render(<Sprite kit={kit} frame={0} />);
    expect(fillsFromHtml(container.innerHTML)).toEqual(rects.map((rect) => rect.props.fill));
  });
});
