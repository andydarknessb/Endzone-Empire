import React from 'react';
import { render, screen } from '@testing-library/react';
import BenchCard from './BenchCard';

const bench = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i}`, position: 'RB', points: 0 }));
const renderCard = (home, away) => render(
  <BenchCard homeName="Team A" awayName="Team B" homeBench={bench(home)} awayBench={bench(away)} open={false} onToggle={() => {}} />,
);

test('equal bench counts read "4 players each"', () => {
  renderCard(4, 4);
  expect(screen.getByText('4 players each')).toBeInTheDocument();
  expect(screen.queryByText(/·/)).not.toBeInTheDocument();
});

test('unequal bench counts show both, with an accessible label naming each team', () => {
  renderCard(4, 5);
  expect(screen.getByLabelText('Team A 4, Team B 5')).toHaveTextContent('4 · 5 players');
});
