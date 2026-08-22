import React from 'react';
import { render } from '@testing-library/react';
import {
  BODY, LEGS_A, LEGS_B, REF_UP_A, REF_UP_B, GOAL_POST,
  RefereeSprite, GoalPostSprite, Sprite,
} from './TecmoSprite';

const LEGAL_ROW = /^[.HJPASFBWY]{16}$/;

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
  test('RefereeSprite renders rects with a fill on every pixel', () => {
    const { container } = render(<RefereeSprite frame={0} />);
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThan(0);
    rects.forEach((rect) => {
      expect(rect.getAttribute('fill')).toBeTruthy();
      expect(rect.getAttribute('fill')).not.toBe('undefined');
    });
  });

  test('RefereeSprite bounce frame differs from the extended frame', () => {
    const a = render(<RefereeSprite frame={0} />).container.innerHTML;
    const b = render(<RefereeSprite frame={1} />).container.innerHTML;
    expect(a).not.toEqual(b);
  });

  test('GoalPostSprite renders yellow rects only', () => {
    const { container } = render(<GoalPostSprite />);
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThan(0);
    rects.forEach((rect) => {
      expect(rect.getAttribute('fill')).toBe('#ffd23f');
    });
  });

  test('runner Sprite still renders with a team kit', () => {
    const kit = { helmet: '#e31837', jersey: '#e31837', pants: '#ffffff', accent: '#ffb81c' };
    const { container } = render(<Sprite kit={kit} frame={0} />);
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
  });
});
