import React from 'react';
import { render, screen } from '@testing-library/react';
import { SplitBar } from './index';

test('is an image named with both sides and their percentages', () => {
  render(<SplitBar homeName="Dockworkers" awayName="Frostbite" homeShare={0.36} />);
  expect(screen.getByRole('img', { name: 'Win probability: Dockworkers 36%, Frostbite 64%' })).toBeInTheDocument();
});

// Red-tell: swapping the two segment widths turns this red and no other.
test('sizes the home segment to the home share and the away segment to the rest', () => {
  render(<SplitBar homeName="A" awayName="B" homeShare={0.36} />);
  expect(screen.getByTestId('split-bar-home').style.width).toBe('36%');
  expect(screen.getByTestId('split-bar-away').style.width).toBe('64%');
});

test('clamps the share to 0..1 and treats a missing share as zero', () => {
  const { rerender } = render(<SplitBar homeName="A" awayName="B" homeShare={1.7} />);
  expect(screen.getByTestId('split-bar-home').style.width).toBe('100%');
  expect(screen.getByTestId('split-bar-away').style.width).toBe('0%');
  rerender(<SplitBar homeName="A" awayName="B" homeShare={null} />);
  expect(screen.getByRole('img', { name: 'Win probability: A 0%, B 100%' })).toBeInTheDocument();
});
