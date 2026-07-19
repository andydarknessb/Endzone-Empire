import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import TransactionLog from './TransactionLog';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// Wed 2026-07-15 12:00 local — fixed "now" so Today/Yesterday/short-date
// boundaries in the day grouping aren't at the mercy of when the suite runs.
const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime();

const renderScreen = (leagueId = 1) =>
  renderWithProviders(<TransactionLog />, {
    path: '/league/:leagueId/activity',
    route: `/league/${leagueId}/activity`,
  });

const mockTransactions = (data) => {
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/transactions')) return Promise.resolve({ data });
    return new Promise(() => {}); // player quick-view summary calls: never resolve
  });
};

const txn = (overrides = {}) => ({
  id: 1,
  type: 'waiver',
  team_name: "Alice's Team",
  player_name: 'Breece Hall',
  dropped_player_name: null,
  detail: { playerId: 7, bid: 12 },
  created_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
  ...overrides,
});

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test('shows skeleton placeholders before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('fetches transactions for the league on mount', async () => {
  mockTransactions([]);
  renderScreen(5);

  await screen.findByText(/The league is quiet/);
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/5/transactions');
});

test('shows an empty state when there is no activity', async () => {
  mockTransactions([]);
  renderScreen();

  expect(
    await screen.findByText(
      'The league is quiet. Recent transactions, trades, and commissioner actions will appear here.'
    )
  ).toBeInTheDocument();
});

test('shows an error alert when the fetch fails', async () => {
  apiClient.get.mockRejectedValue({
    response: { data: { error: 'transactions unavailable' } },
  });
  renderScreen();

  expect(await screen.findByText('transactions unavailable')).toBeInTheDocument();
});

test('groups rows under Today, Yesterday, and short-date headers', async () => {
  mockTransactions([
    txn({ id: 1, created_at: new Date(NOW - 60 * 60 * 1000).toISOString() }), // today
    txn({ id: 2, created_at: new Date(2026, 6, 14, 9, 0, 0).toISOString() }), // yesterday
    txn({ id: 3, created_at: new Date(2026, 6, 5, 9, 0, 0).toISOString() }), // same-year short date
    txn({ id: 4, created_at: new Date(2025, 6, 1, 9, 0, 0).toISOString() }), // prior-year short date
  ]);
  renderScreen();

  await screen.findByTestId('txn-1');
  const headers = screen.getAllByTestId('day-header').map((el) => el.textContent);
  expect(headers).toEqual(['Today', 'Yesterday', 'Jul 5', 'Jul 1, 2025']);
});

test('renders an add transaction row with the team name and player link', async () => {
  mockTransactions([
    txn({ id: 1, type: 'add', team_name: "Bob's Team", player_name: 'Justin Jefferson', detail: { playerId: 1 } }),
  ]);
  renderScreen();

  const row = await screen.findByTestId('txn-1');
  expect(within(row).getByTestId('txn-desc')).toHaveTextContent("Bob's Team added Justin Jefferson");
  expect(within(row).getByText('add')).toBeInTheDocument();
});

test('renders a drop transaction row', async () => {
  mockTransactions([
    txn({ id: 2, type: 'drop', team_name: "Bob's Team", player_name: 'Zach Wilson', detail: { playerId: 2 } }),
  ]);
  renderScreen();

  const row = await screen.findByTestId('txn-2');
  expect(within(row).getByTestId('txn-desc')).toHaveTextContent("Bob's Team dropped Zach Wilson");
});

test('renders a waiver claim with the bid and a dropped-player suffix', async () => {
  mockTransactions([
    txn({
      id: 3,
      type: 'waiver',
      team_name: "Alice's Team",
      player_name: 'Breece Hall',
      dropped_player_name: 'Zach Wilson',
      detail: { playerId: 7, droppedPlayerId: 9, bid: 12 },
    }),
  ]);
  renderScreen();

  const row = await screen.findByTestId('txn-3');
  expect(within(row).getByTestId('txn-desc')).toHaveTextContent(
    "Alice's Team claimed Breece Hall ($12), dropped Zach Wilson"
  );
});

test('renders a rich trade description with both team names and player links', async () => {
  mockTransactions([
    txn({
      id: 4,
      type: 'trade',
      team_name: "Alice's Team",
      player_name: null,
      detail: {
        tradeId: 1,
        proposingTeamId: 10,
        receivingTeamId: 20,
        proposingTeamName: "Alice's Team",
        receivingTeamName: "Bob's Team",
        items: [
          { playerId: 1, playerName: 'Player A', fromTeamId: 10, toTeamId: 20 },
          { playerId: 2, playerName: 'Player B', fromTeamId: 20, toTeamId: 10 },
        ],
      },
    }),
  ]);
  renderScreen();

  const row = await screen.findByTestId('txn-4');
  expect(within(row).getByTestId('txn-desc')).toHaveTextContent(
    "Alice's Team traded Player A to Bob's Team for Player B"
  );
});

test('falls back to a generic sentence for trade rows logged before rich detail existed', async () => {
  mockTransactions([
    txn({ id: 5, type: 'trade', team_name: 'Team A', player_name: null, detail: {} }),
  ]);
  renderScreen();

  const row = await screen.findByTestId('txn-5');
  expect(within(row).getByTestId('txn-desc')).toHaveTextContent('Team A completed a trade');
});

test('renders commissioner and stat-correction descriptions', async () => {
  mockTransactions([
    txn({ id: 6, type: 'commissioner', team_name: 'Team B', player_name: null, detail: {} }),
    txn({
      id: 7,
      type: 'stat_correction',
      team_name: null,
      player_name: null,
      detail: { season: 2026, week: 4, changes: [{ matchupId: 9 }, { matchupId: 11 }] },
    }),
  ]);
  renderScreen();

  expect(await screen.findByText('commissioner action')).toBeInTheDocument();
  expect(
    screen.getByText('NFL stat correction updated 2 matchup scores in week 4')
  ).toBeInTheDocument();
});

test('filters rows by transaction type', async () => {
  mockTransactions([
    txn({ id: 1, type: 'add', team_name: "Alice's Team", detail: { playerId: 1 } }),
    txn({ id: 2, type: 'drop', team_name: "Alice's Team", detail: { playerId: 2 } }),
    txn({ id: 3, type: 'waiver', team_name: "Alice's Team", detail: { playerId: 3 } }),
  ]);
  renderScreen();

  await screen.findByTestId('txn-1');
  expect(screen.getByTestId('txn-2')).toBeInTheDocument();
  expect(screen.getByTestId('txn-3')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Adds' }));

  expect(screen.getByTestId('txn-1')).toBeInTheDocument();
  expect(screen.queryByTestId('txn-2')).not.toBeInTheDocument();
  expect(screen.queryByTestId('txn-3')).not.toBeInTheDocument();
});

test('filters rows by team', async () => {
  mockTransactions([
    txn({ id: 1, type: 'add', team_name: "Alice's Team", detail: { playerId: 1 } }),
    txn({ id: 2, type: 'add', team_name: "Bob's Team", detail: { playerId: 2 } }),
  ]);
  renderScreen();

  await screen.findByTestId('txn-1');
  const teamSelect = screen.getByRole('combobox', { name: 'Team' });
  await userEvent.click(teamSelect);
  await userEvent.click(screen.getByRole('option', { name: "Bob's Team" }));

  expect(screen.queryByTestId('txn-1')).not.toBeInTheDocument();
  expect(screen.getByTestId('txn-2')).toBeInTheDocument();
});

test('shows a filtered-empty message distinct from the true empty state', async () => {
  mockTransactions([txn({ id: 1, type: 'add', detail: { playerId: 1 } })]);
  renderScreen();

  await screen.findByTestId('txn-1');
  await userEvent.click(screen.getByRole('button', { name: 'Trades' }));

  expect(screen.getByText('No activity matches these filters')).toBeInTheDocument();
});

test('shows 30 rows initially and reveals more on demand', async () => {
  const many = Array.from({ length: 35 }, (_, i) =>
    txn({
      id: i + 1,
      type: 'add',
      detail: { playerId: i + 1 },
      created_at: new Date(NOW - i * 60 * 1000).toISOString(),
    })
  );
  mockTransactions(many);
  renderScreen();

  await screen.findByTestId('txn-1');
  expect(screen.getByTestId('txn-30')).toBeInTheDocument();
  expect(screen.queryByTestId('txn-31')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Show more' }));

  expect(screen.getByTestId('txn-35')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
});

test('clicking a player name opens the shared PlayerQuickView dialog', async () => {
  mockTransactions([
    txn({ id: 1, type: 'add', team_name: "Bob's Team", player_name: 'Justin Jefferson', detail: { playerId: 1 } }),
  ]);
  renderScreen();

  await screen.findByTestId('txn-1');
  await userEvent.click(screen.getByRole('button', { name: 'Justin Jefferson' }));

  expect(await screen.findByTestId('quickview-skeleton')).toBeInTheDocument();
});
