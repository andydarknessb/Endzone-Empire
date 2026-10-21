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

  const headers = screen.getAllByRole('columnheader');
  const onClock = headers.filter((h) => h.dataset.onClock === 'true');
  expect(onClock.map((h) => h.textContent)).toEqual(['Team B']);
  expect(headers.map((h) => h.textContent)).toContain('Team A');
});

test('with team 3 on the clock in round 4, only its head and its round 4 cell carry data-on-clock', () => {
  const teams = [1, 2, 3, 4].map((id) => ({ teamId: id, teamName: `Team ${id}`, draft_position: id }));
  const picks = Array.from({ length: 14 }, (_, i) => ({
    pick_number: 14 - i, player_id: 100 + i, teamId: ((13 - i) % 4) + 1, teamName: 'x', name: `P${i}`, position: 'RB',
  }));
  render(
    <DraftBoardMatrix
      teams={teams}
      picks={picks}
      onTheClock={{ team: { teamId: 3, teamName: 'Team 3' }, state: 'untimed', deadlineAt: null }}
      draftRounds={4}
      readOnly
    />
  );

  const marked = [...screen.getAllByRole('columnheader'), ...screen.getAllByRole('cell')].filter(
    (el) => el.getAttribute('data-on-clock') === 'true'
  );
  expect(marked).toHaveLength(2);
  expect(screen.getByRole('columnheader', { name: 'Team 3' })).toHaveAttribute('data-on-clock', 'true');
  expect(screen.getByRole('cell', { name: 'Round 4, Team 3: on the clock' })).toHaveAttribute('data-on-clock', 'true');
});
