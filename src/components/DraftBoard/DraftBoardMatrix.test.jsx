import React from 'react';
import { render, screen } from '@testing-library/react';
import DraftBoardMatrix from './DraftBoardMatrix';

test('marks a pre-filled keeper pick on the draft matrix', () => {
  render(
    <DraftBoardMatrix
      teams={[{ id: 1, name: 'Team A', draft_position: 1 }]}
      picks={[{ pick_number: 1, player_id: 10, team_id: 1, name: 'Josh Allen', position: 'QB', is_keeper: true }]}
      onTheClock={null}
      draftRounds={2}
      onOpenQuickView={jest.fn()}
    />
  );

  expect(screen.getByText('Keeper')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Round 1 pick 1, Team A: Josh Allen' })).toBeInTheDocument();
});

test('renders picks without interactive player controls in read-only mode', () => {
  render(
    <DraftBoardMatrix
      teams={[{ id: 1, name: 'Team A', draft_position: 1 }]}
      picks={[{ pick_number: 1, player_id: 10, team_id: 1, name: 'Josh Allen', position: 'QB' }]}
      onTheClock={null}
      draftRounds={1}
      readOnly
    />
  );

  expect(screen.queryByRole('button', { name: 'Round 1 pick 1, Team A: Josh Allen' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Round 1 pick 1, Team A: Josh Allen')).toBeInTheDocument();
});
