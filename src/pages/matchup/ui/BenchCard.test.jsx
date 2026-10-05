import React from 'react';
import { render, screen } from '@testing-library/react';
import BenchCard from './BenchCard';

const bench = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i}`, position: 'RB', points: 0 }));
const renderCard = (home, away, names = {}) => render(
  <BenchCard
    homeName="Team A"
    awayName="Team B"
    {...names}
    homeBench={bench(home)}
    awayBench={bench(away)}
    open={false}
    onToggle={() => {}}
  />,
);

test('equal bench counts read "4 players each"', () => {
  renderCard(4, 4);
  expect(screen.getByText('4 players each')).toBeInTheDocument();
  expect(screen.queryByText(/·/)).not.toBeInTheDocument();
});

test('a single player each reads "1 player each"', () => {
  renderCard(1, 1);
  expect(screen.getByText('1 player each')).toBeInTheDocument();
});

test('two empty benches show no count at all', () => {
  renderCard(0, 0);
  expect(screen.getByTestId('bench-card')).toHaveTextContent(/^Bench\s*Show$/);
});

test('unequal counts show both, the visible text hidden from assistive tech and a visually hidden line naming each team', () => {
  renderCard(4, 5);
  expect(screen.getByText('4 · 5 players')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByText('Team A 4 players, Team B 5 players')).not.toHaveAttribute('aria-hidden');
});

test('the hidden line uses the singular for one player and falls back to Home and Away for a missing name', () => {
  renderCard(1, 5, { homeName: null, awayName: undefined });
  expect(screen.getByText('Home 1 player, Away 5 players')).toBeInTheDocument();
});
