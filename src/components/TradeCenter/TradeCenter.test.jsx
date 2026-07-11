import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import TradeCenter from './TradeCenter';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const renderScreen = (leagueId = 1) =>
  renderWithProviders(<TradeCenter />, {
    path: '/league/:leagueId/trades',
    route: `/league/${leagueId}/trades`,
    state: { user: { id: 1, username: 'alice' } },
  });

const rosters = [
  {
    teamId: 10,
    teamName: 'Alice Squad',
    ownerId: 1,
    players: [
      { id: 100, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills' },
      { id: 101, name: 'Stefon Diggs', position: 'WR', nfl_team: 'Houston Texans' },
    ],
  },
  {
    teamId: 20,
    teamName: 'Bob Squad',
    ownerId: 2,
    players: [
      { id: 200, name: 'Tyreek Hill', position: 'WR', nfl_team: 'Miami Dolphins' },
      { id: 201, name: 'Travis Kelce', position: 'TE', nfl_team: 'Kansas City Chiefs' },
    ],
  },
  {
    teamId: 30,
    teamName: 'Carol Squad',
    ownerId: 3,
    players: [{ id: 300, name: 'Justin Jefferson', position: 'WR', nfl_team: 'Minnesota Vikings' }],
  },
];

const leagueResponse = (overrides = {}) => ({
  league: { id: 1, name: 'Test League', owner_id: 1, ...overrides },
  teams: [],
});

const pendingTrade = (overrides = {}) => ({
  id: 5,
  status: 'pending',
  proposing_team_id: 10,
  receiving_team_id: 20,
  proposing_team_name: 'Alice Squad',
  receiving_team_name: 'Bob Squad',
  review_ends_at: null,
  items: [
    { player_id: 101, from_team_id: 10, to_team_id: 20, name: 'Stefon Diggs', position: 'WR', nfl_team: 'Houston Texans' },
    { player_id: 200, from_team_id: 20, to_team_id: 10, name: 'Tyreek Hill', position: 'WR', nfl_team: 'Miami Dolphins' },
  ],
  ...overrides,
});

const mockGetSequence = ({ trades = [], myTeamId = 10, rostersData = rosters, league = leagueResponse() }) => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/trades')) {
      return Promise.resolve({ data: { myTeamId, trades } });
    }
    if (url.includes('/rosters')) {
      return Promise.resolve({ data: rostersData });
    }
    return Promise.resolve({ data: league });
  });
};

afterEach(() => {
  jest.clearAllMocks();
});

test('shows a loading spinner before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
});

test('renders trades with team names, status, and items', async () => {
  mockGetSequence({ trades: [pendingTrade()] });

  renderScreen();

  await screen.findByText('Alice Squad ⇄ Bob Squad');
  expect(screen.getByText('pending')).toBeInTheDocument();
  expect(screen.getByText('Stefon Diggs (WR)')).toBeInTheDocument();
  expect(screen.getByText('Tyreek Hill (WR)')).toBeInTheDocument();
});

test('shows empty state when there are no trades', async () => {
  mockGetSequence({ trades: [] });

  renderScreen();

  expect(await screen.findByText('No trades yet')).toBeInTheDocument();
});

test('propose trade dialog flow posts the correct body and refetches', async () => {
  mockGetSequence({ trades: [] });
  apiClient.post.mockResolvedValue({});

  renderScreen();
  await screen.findByText('No trades yet');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));

  await userEvent.click(screen.getByLabelText('Trade with'));
  await userEvent.click(await screen.findByRole('option', { name: 'Bob Squad' }));

  await userEvent.click(await screen.findByLabelText('Stefon Diggs (WR)'));
  await userEvent.click(await screen.findByLabelText('Tyreek Hill (WR)'));

  await userEvent.click(screen.getByRole('button', { name: 'Send Offer' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades', {
      leagueId: 1,
      receivingTeamId: 20,
      playerIds: [101, 200],
    })
  );

  expect(await screen.findByText('Trade offer sent')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledTimes(4); // 3 initial + 1 refetch of trades
});

test('Send Offer is disabled until at least one player is checked on each side', async () => {
  mockGetSequence({ trades: [] });

  renderScreen();
  await screen.findByText('No trades yet');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await userEvent.click(screen.getByLabelText('Trade with'));
  await userEvent.click(await screen.findByRole('option', { name: 'Bob Squad' }));

  expect(screen.getByRole('button', { name: 'Send Offer' })).toBeDisabled();

  await userEvent.click(await screen.findByLabelText('Stefon Diggs (WR)'));
  expect(screen.getByRole('button', { name: 'Send Offer' })).toBeDisabled();

  await userEvent.click(await screen.findByLabelText('Tyreek Hill (WR)'));
  expect(screen.getByRole('button', { name: 'Send Offer' })).not.toBeDisabled();
});

test('accept and reject buttons appear only for the receiving team owner on a pending trade', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 20 });
  apiClient.post.mockResolvedValue({});

  renderScreen();
  await screen.findByText('Alice Squad ⇄ Bob Squad');

  const acceptButton = screen.getByRole('button', { name: 'Accept' });
  expect(acceptButton).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

  await userEvent.click(acceptButton);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/respond', { action: 'accept' })
  );
  expect(await screen.findByText('Trade accepted')).toBeInTheDocument();
});

test('cancel button appears for the proposing team on a pending trade and calls cancel', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 10 });
  apiClient.post.mockResolvedValue({});

  renderScreen();
  await screen.findByText('Alice Squad ⇄ Bob Squad');

  expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  const cancelButton = screen.getByRole('button', { name: 'Cancel' });

  await userEvent.click(cancelButton);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/cancel', {})
  );
  expect(await screen.findByText('Trade cancelled')).toBeInTheDocument();
});

test('vote to veto button appears for an uninvolved team on an accepted trade', async () => {
  mockGetSequence({ trades: [pendingTrade({ status: 'accepted' })], myTeamId: 30, league: leagueResponse({ owner_id: 3 }) });
  apiClient.post.mockResolvedValue({});

  renderScreen();
  await screen.findByText('Alice Squad ⇄ Bob Squad');

  const vetoButton = screen.getByRole('button', { name: 'Vote to Veto' });
  await userEvent.click(vetoButton);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/veto', {})
  );
});

test('commissioner sees force approve and can force-approve a pending trade', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 30, league: leagueResponse({ owner_id: 1 }) });
  apiClient.post.mockResolvedValue({});

  renderScreen();
  await screen.findByText('Alice Squad ⇄ Bob Squad');

  const forceApprove = screen.getByRole('button', { name: 'Force Approve' });
  expect(screen.getByRole('button', { name: 'Commissioner Veto' })).toBeInTheDocument();

  await userEvent.click(forceApprove);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/decide', { approve: true })
  );
  expect(await screen.findByText('Trade approved')).toBeInTheDocument();
});

test('shows an error alert when the initial fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'trades unavailable' } } });

  renderScreen();

  expect(await screen.findByText('trades unavailable')).toBeInTheDocument();
});
