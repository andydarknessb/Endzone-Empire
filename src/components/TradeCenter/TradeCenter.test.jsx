import React from 'react';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
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

// Toast text (via notify) only renders when a SnackbarProvider is mounted.
const renderScreenWithToasts = (leagueId = 1) =>
  renderWithProviders(
    <SnackbarProvider>
      <TradeCenter />
    </SnackbarProvider>,
    {
      path: '/league/:leagueId/trades',
      route: `/league/${leagueId}/trades`,
      state: { user: { id: 1, username: 'alice' } },
    }
  );

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

const weeklyProjectionByPlayer = new Map([
  [100, 22.4],
  [101, 15.1],
  [200, 18.7],
]);
const restOfSeasonProjectionByPlayer = new Map([
  [100, 180.2],
]);
const rostersWithProjections = rosters.map((team) => ({
  ...team,
  players: team.players.map((player) => ({
    ...player,
    projected_weekly_points: weeklyProjectionByPlayer.get(player.id) ?? null,
    rest_of_season_points: restOfSeasonProjectionByPlayer.get(player.id) ?? null,
  })),
}));

const leagueResponse = (overrides = {}) => ({
  viewerTeamId: 1,
  league: { id: 1, name: 'Test League', ownerTeamId: 1, ...overrides },
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
  created_at: new Date(Date.now() - 5000).toISOString(),
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
  jest.useRealTimers();
  clearLeagueCache();
});

// PlayerNameLink renders the player's name inside a nested <button>, so a
// "Name (POS)" query is now split across elements — a plain string no
// longer matches (RTL only reads an element's own direct text nodes).
// This content-matching function checks the full textContent instead.
const byText = (text) => (_, element) => element?.textContent === text;

test('shows a loading skeleton before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('renders trades with team names, status, items, and a relative created_at caption', async () => {
  mockGetSequence({ trades: [pendingTrade()] });

  renderScreen();

  await screen.findByText('Alice Squad ⇄ Bob Squad');
  expect(screen.getByText('pending')).toBeInTheDocument();
  expect(screen.getByText(byText('Stefon Diggs (WR)'))).toBeInTheDocument();
  expect(screen.getByText(byText('Tyreek Hill (WR)'))).toBeInTheDocument();
  expect(within(screen.getByTestId('trade-5')).getByText('just now')).toBeInTheDocument();
});

test('shows empty state when there are no trades', async () => {
  mockGetSequence({ trades: [] });

  renderScreen();

  expect(await screen.findByText('No Pending Trades')).toBeInTheDocument();
});

test('propose trade dialog flow posts the correct body, toasts, and refetches', async () => {
  mockGetSequence({ trades: [] });
  apiClient.post.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('No Pending Trades');

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
  await screen.findByText('No Pending Trades');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await userEvent.click(screen.getByLabelText('Trade with'));
  await userEvent.click(await screen.findByRole('option', { name: 'Bob Squad' }));

  expect(screen.getByRole('button', { name: 'Send Offer' })).toBeDisabled();

  await userEvent.click(await screen.findByLabelText('Stefon Diggs (WR)'));
  expect(screen.getByRole('button', { name: 'Send Offer' })).toBeDisabled();

  await userEvent.click(await screen.findByLabelText('Tyreek Hill (WR)'));
  expect(screen.getByRole('button', { name: 'Send Offer' })).not.toBeDisabled();
});

test('propose dialog roster columns stack full width on mobile (xs=12, sm=6) and group players by position', async () => {
  mockGetSequence({ trades: [] });

  renderScreen();
  await screen.findByText('No Pending Trades');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await userEvent.click(screen.getByLabelText('Trade with'));
  await userEvent.click(await screen.findByRole('option', { name: 'Bob Squad' }));

  const sendColumn = await screen.findByTestId('roster-column-send');
  const receiveColumn = screen.getByTestId('roster-column-receive');

  expect(sendColumn.className).toEqual(expect.stringContaining('MuiGrid2-grid-xs-12'));
  expect(sendColumn.className).toEqual(expect.stringContaining('MuiGrid2-grid-sm-6'));
  expect(receiveColumn.className).toEqual(expect.stringContaining('MuiGrid2-grid-xs-12'));
  expect(receiveColumn.className).toEqual(expect.stringContaining('MuiGrid2-grid-sm-6'));

  // Alice Squad's roster has a QB and a WR — grouped under position subheaders.
  expect(within(sendColumn).getByText('QB')).toBeInTheDocument();
  expect(within(sendColumn).getByText('WR')).toBeInTheDocument();
});

test('propose dialog composes weekly and rest-of-season projection labels', async () => {
  mockGetSequence({ trades: [], rostersData: rostersWithProjections });

  renderScreen();
  await screen.findByText('No Pending Trades');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await userEvent.click(screen.getByLabelText('Trade with'));
  await userEvent.click(await screen.findByRole('option', { name: 'Bob Squad' }));

  expect(await screen.findByLabelText('Josh Allen (QB) · weekly proj 22.4 · ROS 180.2')).toBeInTheDocument();
  expect(screen.getByLabelText('Tyreek Hill (WR) · weekly proj 18.7')).toBeInTheDocument();
  expect(screen.getByLabelText('Travis Kelce (TE)')).toBeInTheDocument();
});

test('live summary chip rows reflect the current selection on each side', async () => {
  mockGetSequence({ trades: [] });

  renderScreen();
  await screen.findByText('No Pending Trades');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await userEvent.click(screen.getByLabelText('Trade with'));
  await userEvent.click(await screen.findByRole('option', { name: 'Bob Squad' }));

  expect(screen.getByText('You send (0):')).toBeInTheDocument();
  expect(screen.getByText('You receive (0):')).toBeInTheDocument();

  await userEvent.click(await screen.findByLabelText('Stefon Diggs (WR)'));
  await userEvent.click(await screen.findByLabelText('Tyreek Hill (WR)'));

  expect(screen.getByText('You send (1):')).toBeInTheDocument();
  expect(screen.getByText('You receive (1):')).toBeInTheDocument();
  // Chips render the selected names, distinct from the checkbox labels above.
  expect(screen.getAllByText('Stefon Diggs').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Tyreek Hill').length).toBeGreaterThan(0);
});

test('auto-analyze in the compose dialog debounces ~600ms after the last checkbox change with no button', async () => {
  jest.useFakeTimers({ legacyFakeTimers: false });
  // Fake timers intercept userEvent's own internal delays too — disable them
  // so clicks resolve immediately and only the component's debounce timer
  // needs to be advanced explicitly below.
  const user = userEvent.setup({ delay: null });
  mockGetSequence({ trades: [] });
  apiClient.post.mockImplementation((url) => {
    if (url === '/api/trades/analyze') {
      return Promise.resolve({
        data: {
          verdict: 'fair',
          proposerGives: 20,
          proposerGets: 20,
          receiverGives: 20,
          receiverGets: 20,
          players: [],
        },
      });
    }
    return Promise.resolve({});
  });

  renderScreen();
  await screen.findByText('No Pending Trades');

  await user.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await user.click(screen.getByLabelText('Trade with'));
  await user.click(await screen.findByRole('option', { name: 'Bob Squad' }));
  await user.click(await screen.findByLabelText('Stefon Diggs (WR)'));

  // Only one side is non-empty — no auto-run should be scheduled yet.
  await user.click(await screen.findByLabelText('Tyreek Hill (WR)'));

  // No manual "Analyze Trade" button in the compose dialog anymore.
  expect(screen.queryByRole('button', { name: 'Analyze Trade' })).not.toBeInTheDocument();

  expect(apiClient.post).not.toHaveBeenCalledWith('/api/trades/analyze', expect.anything());

  await act(async () => {
    jest.advanceTimersByTime(599);
  });
  expect(apiClient.post).not.toHaveBeenCalledWith('/api/trades/analyze', expect.anything());

  await act(async () => {
    jest.advanceTimersByTime(1);
  });

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/analyze', {
      leagueId: 1,
      receivingTeamId: 20,
      offeredPlayerIds: [101],
      requestedPlayerIds: [200],
    })
  );

  expect(await screen.findByText('Fair')).toBeInTheDocument();
});

test('auto-analyze in the compose dialog surfaces an error message when the debounced request fails', async () => {
  jest.useFakeTimers({ legacyFakeTimers: false });
  const user = userEvent.setup({ delay: null });
  mockGetSequence({ trades: [] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'trade not eligible for analysis' } } });

  renderScreen();
  await screen.findByText('No Pending Trades');

  await user.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await user.click(screen.getByLabelText('Trade with'));
  await user.click(await screen.findByRole('option', { name: 'Bob Squad' }));
  await user.click(await screen.findByLabelText('Stefon Diggs (WR)'));
  await user.click(await screen.findByLabelText('Tyreek Hill (WR)'));

  await act(async () => {
    jest.advanceTimersByTime(600);
  });

  expect(await screen.findByText('trade not eligible for analysis')).toBeInTheDocument();
});

test('accept and reject buttons appear only for the receiving team owner on a pending trade', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 20 });
  apiClient.post.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('Alice Squad ⇄ Bob Squad');

  const acceptButton = screen.getByRole('button', { name: 'Accept Trade' });
  expect(acceptButton).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

  await userEvent.click(acceptButton);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/respond', { action: 'accept' })
  );
  expect(await screen.findByText('Trade accepted')).toBeInTheDocument();
});

test('Counter button appears for the receiving team and opens the propose dialog pre-filled with the trade inverted', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 20 });
  apiClient.post.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('Alice Squad ⇄ Bob Squad');

  await userEvent.click(
    within(screen.getByTestId('trade-5')).getByRole('button', { name: 'Counter' })
  );

  expect(screen.getByText('Counter Trade')).toBeInTheDocument();

  // Fixed to the original proposer and disabled — a counter always goes back to them.
  const teamSelect = screen.getByRole('combobox', { name: 'Trade with' });
  expect(teamSelect).toHaveTextContent('Alice Squad');
  expect(teamSelect).toHaveAttribute('aria-disabled', 'true');

  // Sides inverted: what the proposer originally requested from me is now
  // pre-checked as what I send; what they offered is pre-checked as what I receive.
  expect(await screen.findByLabelText('Tyreek Hill (WR)')).toBeChecked();
  expect(screen.getByLabelText('Stefon Diggs (WR)')).toBeChecked();

  await userEvent.click(screen.getByRole('button', { name: 'Send Offer' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/counter', {
      playerIds: [200, 101],
    })
  );
  expect(await screen.findByText('Counter offer sent')).toBeInTheDocument();
});

test('cancel button appears for the proposing team on a pending trade and calls cancel', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 10 });
  apiClient.post.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('Alice Squad ⇄ Bob Squad');

  expect(screen.queryByRole('button', { name: 'Accept Trade' })).not.toBeInTheDocument();
  const cancelButton = screen.getByRole('button', { name: 'Cancel' });

  await userEvent.click(cancelButton);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/cancel', {})
  );
  expect(await screen.findByText('Trade cancelled')).toBeInTheDocument();
});

test('vote to veto button appears for an uninvolved team on an accepted trade', async () => {
  mockGetSequence({ trades: [pendingTrade({ status: 'accepted' })], myTeamId: 30, league: leagueResponse({ ownerTeamId: 3 }) });
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
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 30, league: leagueResponse({ ownerTeamId: 1 }) });
  apiClient.post.mockResolvedValue({});

  renderScreenWithToasts();
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

test('Analyze Trade on an existing trade card posts the trade items and renders a fair verdict chip', async () => {
  mockGetSequence({ trades: [pendingTrade()] });
  apiClient.post.mockImplementation((url) => {
    if (url === '/api/trades/analyze') {
      return Promise.resolve({
        data: {
          verdict: 'fair',
          proposerGives: 20,
          proposerGets: 20,
          receiverGives: 20,
          receiverGets: 20,
          players: [],
        },
      });
    }
    return Promise.resolve({});
  });

  renderScreen();
  await screen.findByText('Alice Squad ⇄ Bob Squad');

  // Existing trade cards keep the manual button — no auto-run there.
  await userEvent.click(
    within(screen.getByTestId('trade-5')).getByRole('button', { name: 'Analyze Trade' })
  );

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/analyze', {
      leagueId: 1,
      receivingTeamId: 20,
      offeredPlayerIds: [101],
      requestedPlayerIds: [200],
    })
  );
  expect(await screen.findByText('Fair')).toBeInTheDocument();
});
