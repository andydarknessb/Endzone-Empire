import React from 'react';
import { render, screen } from '@testing-library/react';
import { PosChip } from './index';
import { positionKey, positionLabel } from './PosChip';

test.each([
  ['QB', 'qb', 'QB'],
  ['RB', 'rb', 'RB'],
  ['WR', 'wr', 'WR'],
  ['TE', 'te', 'TE'],
  ['K', 'k', 'K'],
  ['DEF', 'def', 'D/ST'],
  ['FLEX', 'flex', 'FLEX'],
  ['LB', 'idp', 'LB'],
  ['IDP FLEX', 'idp', 'IDP FLEX'],
])('%s renders as %s on the %s fill', (position, key, label) => {
  render(<PosChip position={position} />);
  const chip = screen.getByTestId('pos-chip');
  expect(chip).toHaveTextContent(label);
  expect(chip).toHaveAttribute('data-position', key);
});

test('an unknown slot label reads as a flex place, never as a position hue', () => {
  expect(positionKey('BN')).toBe('flex');
  expect(positionKey(null)).toBe('flex');
  expect(positionLabel('DEF')).toBe('D/ST');
  expect(positionLabel('QB')).toBe('QB');
});
