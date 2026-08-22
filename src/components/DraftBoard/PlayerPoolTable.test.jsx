import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerPoolTable from './PlayerPoolTable';

// PlayerPoolTable is provider-free (MUI only, same as DraftRail - see its own
// doc comment), so a bare render is enough here.
const players = [
  { id: 1, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', adp: 1.2, position_rank: 1, projected_points: 310.5, bye_week: 12 },
  { id: 2, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', adp: 3.4, position_rank: 2, projected_points: 400.2, bye_week: 7 },
];

const baseProps = {
  searchInput: '',
  onSearchInputChange: jest.fn(),
  positionFilter: 'All',
  onPositionFilterChange: jest.fn(),
  hideDrafted: false,
  onHideDraftedChange: jest.fn(),
  byeWeeksFilter: [],
  onByeWeeksFilterChange: jest.fn(),
  sort: 'adp',
  dir: 'asc',
  onSort: jest.fn(),
  search: '',
  displayPlayers: players,
  draftedIds: new Set(),
  draftStatus: 'active',
  draftType: 'snake',
  isMyTurn: true,
  draftPaused: false,
  queue: [],
  onDraft: jest.fn(),
  onQueue: jest.fn(),
  onOpenQuickView: jest.fn(),
  hasMore: false,
  loadingMore: false,
  onLoadMore: jest.fn(),
};

afterEach(() => {
  jest.clearAllMocks();
});

test('desktop renders the sortable table with a focusable, named scroll region', () => {
  render(<PlayerPoolTable {...baseProps} />);

  const region = screen.getByRole('region', { name: 'Available Players' });
  expect(region).toHaveAttribute('tabIndex', '0');
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument();
  // No player cards on desktop.
  expect(screen.queryByText('Bye: 12')).not.toBeInTheDocument();
});

test('mobile renders player cards (not a table) with the same approved columns', () => {
  render(<PlayerPoolTable {...baseProps} isMobile />);

  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  const card = screen.getByText('Bijan Robinson').closest('.MuiPaper-root');
  expect(within(card).getByText('ATL')).toBeInTheDocument();
  expect(within(card).getByText('Bye: 12')).toBeInTheDocument();
  expect(within(card).getByText('ADP: 1.2')).toBeInTheDocument();
  expect(within(card).getByText('Pos rank: #1')).toBeInTheDocument();
  expect(within(card).getByText('17-game pace: 310.5')).toBeInTheDocument();
});

test('mobile cards expose the same state-gated Draft/Queue actions as the table', async () => {
  const user = userEvent.setup();
  render(<PlayerPoolTable {...baseProps} isMobile />);

  const card = screen.getByText('Josh Allen').closest('.MuiPaper-root');
  await user.click(within(card).getByRole('button', { name: 'Draft', exact: true }));
  expect(baseProps.onDraft).toHaveBeenCalledWith(2);

  await user.click(within(card).getByRole('button', { name: 'Queue' }));
  expect(baseProps.onQueue).toHaveBeenCalledWith(players[1]);
});

test('a drafted player is shown without Draft/Queue actions on a mobile card, same as the table', () => {
  render(<PlayerPoolTable {...baseProps} isMobile draftedIds={new Set([1])} />);

  const card = screen.getByText('Bijan Robinson').closest('.MuiPaper-root');
  expect(within(card).getByText('Drafted')).toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Draft', exact: true })).not.toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Queue' })).not.toBeInTheDocument();
});

test('mobile: no manual Draft control renders anywhere when the draft has no manual Pick action', () => {
  render(<PlayerPoolTable {...baseProps} isMobile draftType="autopick" />);

  expect(screen.queryByRole('button', { name: 'Draft', exact: true })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Queue' })).toHaveLength(players.length);
});

test('mobile: off-turn Draft stays focusable but aria-disabled, matching the table', () => {
  render(<PlayerPoolTable {...baseProps} isMobile isMyTurn={false} />);

  const card = screen.getByText('Bijan Robinson').closest('.MuiPaper-root');
  const draftButton = within(card).getByRole('button', { name: 'Draft', exact: true });
  expect(draftButton).toHaveAttribute('aria-disabled', 'true');
  expect(draftButton).not.toHaveAttribute('disabled');
});
