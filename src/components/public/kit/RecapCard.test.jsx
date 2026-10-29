import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RecapCard from './RecapCard';

const RECAP = {
  gameId: 9,
  week: 3,
  homeTeam: 'KC',
  awayTeam: 'BUF',
  homeScore: 24,
  awayScore: 17,
  hook: 'The Chiefs pulled away late.',
  topPerformer: { name: 'Josh Allen', photoUrl: 'https://example.com/allen.png', fantasyPoints: 24.6 },
};

const renderCard = () => render(
  <MemoryRouter>
    <RecapCard recap={RECAP} />
  </MemoryRouter>
);

test('names the top fantasy performer with their points', () => {
  renderCard();

  expect(screen.getByText('Josh Allen')).toBeInTheDocument();
  expect(screen.getByText('24.6')).toBeInTheDocument();
});

test('lazy-loads the top performer headshot (#2638)', () => {
  renderCard();

  expect(screen.getByRole('presentation', { hidden: true })).toHaveAttribute('loading', 'lazy');
});
