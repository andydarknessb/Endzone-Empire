import React from 'react';
import { render, screen, within } from '@testing-library/react';
import DraftBoardMatrix from './DraftBoardMatrix';

test('marks a pre-filled keeper pick on the draft matrix', () => {
  render(
    <DraftBoardMatrix
      teams={[{ teamId: 1, teamName: 'Team A', draft_position: 1 }]}
      picks={[{ pick_number: 1, player_id: 10, teamId: 1, teamName: 'Team A', name: 'Josh Allen', position: 'QB', is_keeper: true }]}
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
      teams={[{ teamId: 1, teamName: 'Team A', draft_position: 1 }]}
      picks={[{ pick_number: 1, player_id: 10, teamId: 1, teamName: 'Team A', name: 'Josh Allen', position: 'QB' }]}
      onTheClock={null}
      draftRounds={1}
      readOnly
    />
  );

  expect(screen.queryByRole('button', { name: 'Round 1 pick 1, Team A: Josh Allen' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Round 1 pick 1, Team A: Josh Allen')).toBeInTheDocument();
});

test('marks the on-the-clock team column from the one On-the-clock value', () => {
  // The value object ({ team, state, deadlineAt }) drives the marker via
  // isTeamOnTheClock (#754), replacing the old inline teamId compare and the
  // decorative ⏱ glyph. The pending cell keeps its announced "on the clock".
  render(
    <DraftBoardMatrix
      teams={[
        { teamId: 1, teamName: 'Team A', draft_position: 1 },
        { teamId: 2, teamName: 'Team B', draft_position: 2 },
      ]}
      picks={[]}
      onTheClock={{ team: { teamId: 2, teamName: 'Team B' }, state: 'running', deadlineAt: 5_000 }}
      draftRounds={1}
      onOpenQuickView={jest.fn()}
    />
  );

  // Exactly one column head carries the marker, and it is Team B's.
  const marker = screen.getByTestId('matrix-on-clock-marker');
  expect(within(screen.getByRole('columnheader', { name: /Team B/ })).getByTestId('matrix-on-clock-marker'))
    .toBe(marker);
  expect(within(screen.getByRole('columnheader', { name: /Team A/ })).queryByTestId('matrix-on-clock-marker'))
    .toBeNull();
  // Team B's first-round cell is announced as on the clock.
  expect(screen.getByLabelText('Round 1, Team B: on the clock')).toBeInTheDocument();
});

test('renders no on-the-clock marker for an idle value', () => {
  render(
    <DraftBoardMatrix
      teams={[{ teamId: 1, teamName: 'Team A', draft_position: 1 }]}
      picks={[]}
      onTheClock={{ team: null, state: 'idle', deadlineAt: null }}
      draftRounds={1}
      onOpenQuickView={jest.fn()}
    />
  );
  expect(screen.queryByTestId('matrix-on-clock-marker')).toBeNull();
});

test('exposes itself as a named "Draft Board" H2 region, with and without a set draft order', () => {
  const { unmount } = render(
    <DraftBoardMatrix teams={[]} picks={[]} onTheClock={null} draftRounds={0} onOpenQuickView={jest.fn()} />
  );
  expect(screen.getByRole('region', { name: 'Draft Board' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Draft Board' })).toBeInTheDocument();
  unmount();

  render(
    <DraftBoardMatrix
      teams={[{ teamId: 1, teamName: 'Team A', draft_position: 1 }]}
      picks={[]}
      onTheClock={null}
      draftRounds={1}
      onOpenQuickView={jest.fn()}
    />
  );
  expect(screen.getByRole('region', { name: 'Draft Board' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Draft Board' })).toBeInTheDocument();
});
