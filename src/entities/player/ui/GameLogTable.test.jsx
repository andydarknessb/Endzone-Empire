import React from 'react';
import { render, screen, within } from '@testing-library/react';
import GameLogTable from './GameLogTable';

test('renders nothing when the current season has no played weeks', () => {
  const { container: nullCase } = render(<GameLogTable log={null} />);
  expect(nullCase).toBeEmptyDOMElement();
  const { container: emptyCase } = render(<GameLogTable log={{ current: [] }} />);
  expect(emptyCase).toBeEmptyDOMElement();
});

test('renders one row per played week with a formatted stat line and points', () => {
  render(
    <GameLogTable
      log={{
        current: [
          { week: 1, opponent: 'KC', statLine: { rushingYards: 92, rushingTDs: 1 }, points: 18.4 },
          { week: 2, opponent: 'BUF', statLine: null, points: null },
        ],
      }}
    />
  );
  const table = screen.getByTestId('decision-card-game-log');
  const rows = within(table).getAllByRole('row');
  expect(within(rows[1]).getByText('Wk 1')).toBeInTheDocument();
  expect(within(rows[1]).getByText(/92 Rush Yds/)).toBeInTheDocument();
  expect(within(rows[1]).getByText('18.4')).toBeInTheDocument();
  expect(within(rows[2]).getByText('Wk 2')).toBeInTheDocument();
  expect(within(rows[2]).getAllByText('-')).toHaveLength(2);
});
