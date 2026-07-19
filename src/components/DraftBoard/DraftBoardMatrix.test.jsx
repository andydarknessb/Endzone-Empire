import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftBoardMatrix from './DraftBoardMatrix';

const teams = [
  { id: 10, name: 'Team A', draft_position: 1 },
  { id: 20, name: 'Team B', draft_position: 2 },
  { id: 30, name: 'Team C', draft_position: 3 },
  { id: 40, name: 'Team D', draft_position: 4 },
];

// Snake order across two rounds of a 4-team draft: round 1 goes A,B,C,D;
// round 2 (even) reverses to D,C,B,A. team_id here mirrors what the server
// would actually assign (see teamIndexForPick in draft.service.js) so the
// test is checking the matrix's round/column placement, not re-deriving snake
// order itself. Supplied newest-first, matching useDraftSocket's pick order.
const twoRoundPicks = [
  { pick_number: 8, team_id: 10, player_id: 108, name: 'P8', position: 'K', nfl_team: 'X' },
  { pick_number: 7, team_id: 20, player_id: 107, name: 'P7', position: 'DEF', nfl_team: 'X' },
  { pick_number: 6, team_id: 30, player_id: 106, name: 'P6', position: 'TE', nfl_team: 'X' },
  { pick_number: 5, team_id: 40, player_id: 105, name: 'P5', position: 'WR', nfl_team: 'X' },
  { pick_number: 4, team_id: 40, player_id: 104, name: 'P4', position: 'WR', nfl_team: 'X' },
  { pick_number: 3, team_id: 30, player_id: 103, name: 'P3', position: 'RB', nfl_team: 'X' },
  { pick_number: 2, team_id: 20, player_id: 102, name: 'P2', position: 'RB', nfl_team: 'X' },
  { pick_number: 1, team_id: 10, player_id: 101, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' },
];

test('places round 1 picks in draft-position column order (not reversed)', () => {
  render(
    <DraftBoardMatrix teams={teams} picks={twoRoundPicks} onTheClock={null} rosterLimit={2} onOpenQuickView={jest.fn()} />
  );

  const rows = screen.getAllByRole('row');
  const round1Row = rows[1]; // rows[0] is the team-name header row
  const names = within(round1Row)
    .getAllByRole('button')
    .map((btn) => btn.getAttribute('aria-label'));

  expect(names).toEqual([
    'Round 1 pick 1, Team A: Patrick Mahomes',
    'Round 1 pick 2, Team B: P2',
    'Round 1 pick 3, Team C: P3',
    'Round 1 pick 4, Team D: P4',
  ]);
});

test('places round 2 picks in reversed (snake) column order', () => {
  render(
    <DraftBoardMatrix teams={teams} picks={twoRoundPicks} onTheClock={null} rosterLimit={2} onOpenQuickView={jest.fn()} />
  );

  const rows = screen.getAllByRole('row');
  const round2Row = rows[2];
  const names = within(round2Row)
    .getAllByRole('button')
    .map((btn) => btn.getAttribute('aria-label'));

  expect(names).toEqual([
    'Round 2 pick 8, Team A: P8',
    'Round 2 pick 7, Team B: P7',
    'Round 2 pick 6, Team C: P6',
    'Round 2 pick 5, Team D: P5',
  ]);
});

test('gives the next-on-the-clock cell an accessible on-the-clock label', () => {
  // Only pick 1 has landed; team B (id 20) is up next -> pick 2, round 1.
  render(
    <DraftBoardMatrix
      teams={teams}
      picks={[twoRoundPicks[twoRoundPicks.length - 1]]}
      onTheClock={{ id: 20, name: 'Team B' }}
      rosterLimit={2}
      onOpenQuickView={jest.fn()}
    />
  );

  expect(screen.getByRole('cell', { name: 'Round 1, Team B: on the clock' })).toBeInTheDocument();
});

test('highlights the on-the-clock team in the column header', () => {
  render(
    <DraftBoardMatrix
      teams={teams}
      picks={[]}
      onTheClock={{ id: 30, name: 'Team C' }}
      rosterLimit={1}
      onOpenQuickView={jest.fn()}
    />
  );

  const header = screen.getByRole('columnheader', { name: /Team C/ });
  expect(header).toHaveTextContent('⏱');
});

test('clicking a filled cell opens the shared quick view for that pick', async () => {
  const onOpenQuickView = jest.fn();
  render(
    <DraftBoardMatrix teams={teams} picks={twoRoundPicks} onTheClock={null} rosterLimit={2} onOpenQuickView={onOpenQuickView} />
  );

  await userEvent.click(
    screen.getByRole('button', { name: 'Round 1 pick 1, Team A: Patrick Mahomes' })
  );

  expect(onOpenQuickView).toHaveBeenCalledWith(101);
});

test('shows a muted, non-interactive placeholder for empty future cells', () => {
  render(
    <DraftBoardMatrix teams={teams} picks={[]} onTheClock={null} rosterLimit={1} onOpenQuickView={jest.fn()} />
  );

  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

test('renders a fallback message when draft order/teams are not set', () => {
  render(<DraftBoardMatrix teams={[]} picks={[]} onTheClock={null} rosterLimit={0} onOpenQuickView={jest.fn()} />);

  expect(screen.getByText(/draft order isn.t set yet/i)).toBeInTheDocument();
});
