import React from 'react';
import { render, screen } from '@testing-library/react';
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

// The matrix reads the On-the-clock value object (#754): the team lives under
// `.team`, and the mock draft simulator derives that shape at its seam
// (DraftSimulator.jsx) from the engine's flat team. A flat shape here would
// silently drop the column highlight, so this pins the nested read.
test('marks the on-the-clock team column from the value object', () => {
  render(
    <DraftBoardMatrix
      teams={[
        { teamId: 1, teamName: 'Team A', draft_position: 1 },
        { teamId: 2, teamName: 'Team B', draft_position: 2 },
      ]}
      picks={[]}
      onTheClock={{ team: { teamId: 2, teamName: 'Team B' }, state: 'untimed', deadlineAt: null }}
      draftRounds={1}
      readOnly
    />
  );

  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
  expect(headers).toContain('Team B⏱');
  expect(headers).toContain('Team A');
  expect(headers).not.toContain('Team A⏱');
});
