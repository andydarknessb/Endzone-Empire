import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import TransactionLog from './TransactionLog';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const renderScreen = (leagueId = 1) =>
  renderWithProviders(<TransactionLog />, {
    path: '/league/:leagueId/activity',
    route: `/league/${leagueId}/activity`,
  });

const txn = (overrides = {}) => ({
  id: 1,
  type: 'waiver',
  team_name: "Alice's Team",
  player_name: 'Breece Hall',
  detail: { playerId: 7, bid: 12 },
  created_at: '2026-07-10T12:00:00.000Z',
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows skeleton placeholders before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('fetches transactions for the league on mount', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderScreen(5);

  await screen.findByText('No activity yet');
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/5/transactions');
});

test('renders an add transaction row with team, description, and type chip', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      txn({
        id: 1,
        type: 'add',
        team_name: "Bob's Team",
        player_name: 'Justin Jefferson',
        detail: {},
      }),
    ],
  });
  renderScreen();

  await screen.findByText("Bob's Team");
  expect(screen.getByText('added Justin Jefferson')).toBeInTheDocument();
  expect(screen.getByText('add')).toBeInTheDocument();
});

test('renders a drop transaction row', async () => {
  apiClient.get.mockResolvedValue({
    data: [txn({ id: 2, type: 'drop', player_name: 'Zach Wilson', detail: {} })],
  });
  renderScreen();

  expect(await screen.findByText('dropped Zach Wilson')).toBeInTheDocument();
  expect(screen.getByText('drop')).toBeInTheDocument();
});

test('renders a waiver transaction row with the bid amount appended', async () => {
  apiClient.get.mockResolvedValue({
    data: [txn({ id: 3, type: 'waiver', player_name: 'Breece Hall', detail: { bid: 12 } })],
  });
  renderScreen();

  expect(await screen.findByText('claimed Breece Hall ($12)')).toBeInTheDocument();
  expect(screen.getByText('waiver')).toBeInTheDocument();
});

test('renders trade and commissioner transaction descriptions', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      txn({ id: 4, type: 'trade', team_name: 'Team A', player_name: null, detail: {} }),
      txn({ id: 5, type: 'commissioner', team_name: 'Team B', player_name: null, detail: {} }),
    ],
  });
  renderScreen();

  expect(await screen.findByText('completed a trade')).toBeInTheDocument();
  expect(screen.getByText('commissioner action')).toBeInTheDocument();
  expect(screen.getByText('trade')).toBeInTheDocument();
  expect(screen.getByText('commissioner')).toBeInTheDocument();
});

test('renders a stat-correction row with the changed-matchup count and week', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      txn({
        id: 6,
        type: 'stat_correction',
        team_name: null,
        player_name: null,
        detail: { season: 2026, week: 4, changes: [{ matchupId: 9 }, { matchupId: 11 }] },
      }),
    ],
  });
  renderScreen();

  expect(
    await screen.findByText('NFL stat correction updated 2 matchup scores in week 4')
  ).toBeInTheDocument();
  expect(screen.getByText('stat_correction')).toBeInTheDocument();
});

test('shows an empty state when there is no activity', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderScreen();

  expect(await screen.findByText('No activity yet')).toBeInTheDocument();
});

test('shows an error alert when the fetch fails', async () => {
  apiClient.get.mockRejectedValue({
    response: { data: { error: 'transactions unavailable' } },
  });
  renderScreen();

  expect(await screen.findByText('transactions unavailable')).toBeInTheDocument();
});
