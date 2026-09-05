import React from 'react';
import { render, screen } from '@testing-library/react';
import { StatTile } from './index';

test('renders its label above its value', () => {
  render(<StatTile label="Expected final" value="110.5" />);
  const tile = screen.getByTestId('stat-tile');
  expect(tile).toHaveTextContent('Expected final110.5');
  expect(screen.getByText('Expected final')).toBeInTheDocument();
  expect(screen.getByText('110.5')).toBeInTheDocument();
});

test('a custom test id and extra props reach the tile', () => {
  render(<StatTile label="PMR" value={4} data-testid="pmr-tile" title="Players remaining" />);
  expect(screen.getByTestId('pmr-tile')).toHaveAttribute('title', 'Players remaining');
  expect(screen.getByText('4')).toBeInTheDocument();
});
