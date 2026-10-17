import React from 'react';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import TradeCenter from './TradeCenter';
import { findToast } from '../../test-utils/toast';

// A card is queried through its own `within(...)` scope (one page holds several), and the cursor, the filled
// action and the live regions are classes and attributes with no role.
/* eslint-disable testing-library/prefer-screen-queries, testing-library/no-node-access, testing-library/no-container */

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
      return Promise.resolve({ data: { myTeamId, trades: typeof trades === 'function' ? trades() : trades } });
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

const findCard = async (id = 5) => within(await screen.findByTestId(`trade-${id}`));
const selectTeam = (name) => userEvent.selectOptions(screen.getByLabelText('Trade with'), name);
const FAIR = {
  verdict: 'fair', proposerGives: 20.04, proposerGets: 19.96, receiverGives: 19.96, receiverGets: 20.04, players: [],
};
// The page's one filled action lives in a modal: outside a dialog nothing is filled.
const filled = (root = document) => root.querySelectorAll('[data-variant="fill"]');

test('shows a loading skeleton before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('renders trades with team names, status word, items, and a relative created_at caption', async () => {
  mockGetSequence({ trades: [pendingTrade()] });

  renderScreen();

  const c = await findCard();
  expect(screen.getByRole('heading', { level: 2, name: /Alice Squad.*Bob Squad/ })).toBeInTheDocument();
  // The status chip prints the word, not the raw lowercase status.
  expect(c.getByText('Pending')).toBeInTheDocument();
  expect(c.queryByText('pending')).not.toBeInTheDocument();
  expect(c.getByRole('button', { name: 'Stefon Diggs' })).toBeInTheDocument();
  expect(c.getByRole('button', { name: 'Tyreek Hill' })).toBeInTheDocument();
  expect(c.getByText('just now')).toBeInTheDocument();
});

test('the head names the league, the trade deadline and the time zone', async () => {
  mockGetSequence({ trades: [], league: leagueResponse({ trade_deadline_week: 10 }) });
  renderScreen();

  expect(await screen.findByRole('heading', { level: 1, name: 'Trade Center' })).toBeInTheDocument();
  expect(screen.getByText(/^Trade deadline Week 10 · times in /)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Test League/ })).toBeInTheDocument();
});

test('with no trade deadline the sub-line keeps only the time zone', async () => {
  mockGetSequence({ trades: [], league: leagueResponse({ trade_deadline_week: null }) });
  renderScreen();

  await screen.findByRole('heading', { level: 1, name: 'Trade Center' });
  expect(screen.queryByText(/Trade deadline/)).not.toBeInTheDocument();
  expect(screen.getByText(/^Times in /)).toBeInTheDocument();
});

test('the sections are a tablist: Left/Right move and activate, Trade Block keeps its Coming soon copy', async () => {
  mockGetSequence({ trades: [pendingTrade()] });
  renderScreen();
  await screen.findByTestId('trade-5');

  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((t) => t.textContent)).toEqual(['Pending', 'Completed', 'Trade Block']);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  expect(tabs[0]).toHaveAttribute('tabindex', '0');
  expect(tabs[1]).toHaveAttribute('tabindex', '-1');
  expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[0].id);

  tabs[0].focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
  expect(screen.getAllByRole('tab')[1]).toHaveFocus();
  expect(screen.getByText('No Completed Trades')).toBeInTheDocument();

  await userEvent.keyboard('{End}');
  expect(screen.getByText(/Coming soon/)).toBeInTheDocument();
});

// #1311, ADR 0040 ruling (d): TradeCenter opens the Decision card with
// context 'my_team' when the clicked player sits on the viewer's own roster,
// else 'rostered' - never PlayerQuickView.
test('clicking a player name opens the Decision card, with context keyed off the viewer\'s own roster', async () => {
  mockGetSequence({ trades: [pendingTrade()] });
  renderScreen();

  await screen.findByTestId('trade-5');

  // Stefon Diggs (101) is on Alice Squad (team 10 == myTeamId): my_team, with
  // no lineup wiring here, so the card renders the Open lineup link.
  await userEvent.click(screen.getByRole('button', { name: 'Stefon Diggs' }));
  expect(await screen.findByTestId('decision-card')).toBeInTheDocument();
  expect(screen.getByTestId('decision-card-open-lineup')).toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-propose-trade')).not.toBeInTheDocument();
  // #1513: myTeam({ managed: false }) carries no onSwap, so lineupManaged
  // stays false and neither Bench/Start action nor Drop renders.
  expect(screen.queryByTestId('decision-card-bench-action')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-drop')).not.toBeInTheDocument();

  await userEvent.click(screen.getByTestId('decision-card-close'));
  await waitFor(() => expect(screen.queryByTestId('decision-card')).not.toBeInTheDocument());

  // Tyreek Hill (200) is on Bob Squad (team 20, not the viewer's): rostered.
  await userEvent.click(screen.getByRole('button', { name: 'Tyreek Hill' }));
  expect(await screen.findByTestId('decision-card-propose-trade')).toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-open-lineup')).not.toBeInTheDocument();
  // #1513: rostered({ availability: { teamName } }) - TradeCenter already
  // has every roster loaded, so the card names the owning team.
  expect(screen.getByText('Rostered by Bob Squad')).toBeInTheDocument();
});

// #1310: the Players list row's Trade action deep-links here as
// `?receivingTeamId=&playerId=` (src/features/propose-trade). TradeCenter
// reads both off the URL to preselect the receiving team and check the
// player, once its own rosters have loaded.
test('a Trade deep-link (?receivingTeamId=&playerId=) preselects the receiving team and checks the player', async () => {
  mockGetSequence({ trades: [] });

  renderWithProviders(<TradeCenter />, {
    path: '/league/:leagueId/trades',
    route: '/league/1/trades?receivingTeamId=20&playerId=200',
    state: { user: { id: 1, username: 'alice' } },
  });

  const receiveColumn = await screen.findByTestId('roster-column-receive');
  expect(within(receiveColumn).getByLabelText('Tyreek Hill (WR)')).toBeChecked();
  expect(screen.getByLabelText('Trade with')).toHaveDisplayValue('Bob Squad');
  // The team is already chosen, so focus opens on the first "You send" checkbox, not the select.
  expect(within(screen.getByTestId('roster-column-send')).getByLabelText('Josh Allen (QB)')).toHaveFocus();
});

// Formal review formal-1310-f4: a stale/mistyped playerId (traded, dropped,
// or simply wrong) must not land in receiveIds uncheckably - RosterColumn
// never renders a checkbox for an id absent from the team's own roster, yet
// handleSendOffer would still send it.
test('a Trade deep-link whose playerId is not on the receiving team\'s roster preselects the team with nothing checked', async () => {
  mockGetSequence({ trades: [] });

  renderWithProviders(<TradeCenter />, {
    path: '/league/:leagueId/trades',
    route: '/league/1/trades?receivingTeamId=20&playerId=999999',
    state: { user: { id: 1, username: 'alice' } },
  });

  await screen.findByTestId('roster-column-receive');
  expect(screen.getByLabelText('Trade with')).toHaveDisplayValue('Bob Squad');
  expect(screen.getByRole('button', { name: 'Send Offer' })).toBeDisabled();
});

test('closing a deep-linked dialog, which has no opener, puts focus on the h1', async () => {
  mockGetSequence({ trades: [] });

  renderWithProviders(<TradeCenter />, {
    path: '/league/:leagueId/trades',
    route: '/league/1/trades?receivingTeamId=20&playerId=200',
    state: { user: { id: 1, username: 'alice' } },
  });

  await screen.findByTestId('roster-column-receive');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { level: 1, name: 'Trade Center' })).toHaveFocus();
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

  // Focus opens on "Trade with", and the dialog is named by its title.
  expect(screen.getByLabelText('Trade with')).toHaveFocus();
  expect(screen.getByRole('dialog', { name: 'Propose Trade' })).toBeInTheDocument();

  await selectTeam('Bob Squad');

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

  expect(await findToast('Trade offer sent')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledTimes(4); // 3 initial + 1 refetch of trades
});

test('closing the dialog hands focus back to the Propose Trade button', async () => {
  mockGetSequence({ trades: [] });
  renderScreen();
  await screen.findByText('No Pending Trades');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Propose Trade' })).toHaveFocus();
});

test('Send Offer is disabled until at least one player is checked on each side', async () => {
  mockGetSequence({ trades: [] });

  renderScreen();
  await screen.findByText('No Pending Trades');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await selectTeam('Bob Squad');

  expect(screen.getByRole('button', { name: 'Send Offer' })).toBeDisabled();

  await userEvent.click(await screen.findByLabelText('Stefon Diggs (WR)'));
  expect(screen.getByRole('button', { name: 'Send Offer' })).toBeDisabled();

  await userEvent.click(await screen.findByLabelText('Tyreek Hill (WR)'));
  expect(screen.getByRole('button', { name: 'Send Offer' })).not.toBeDisabled();
});

test('a refused Send Offer says why inside the dialog, which stays open', async () => {
  mockGetSequence({ trades: [] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'transactions are locked by the commissioner' } } });

  renderScreenWithToasts();
  await screen.findByText('No Pending Trades');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await selectTeam('Bob Squad');
  await userEvent.click(await screen.findByLabelText('Stefon Diggs (WR)'));
  await userEvent.click(await screen.findByLabelText('Tyreek Hill (WR)'));
  await userEvent.click(screen.getByRole('button', { name: 'Send Offer' }));

  const alert = await within(screen.getByRole('dialog')).findByRole('alert');
  expect(alert).toHaveTextContent('transactions are locked by the commissioner');
  // The live region holds text only, and the dialog is still open with Send Offer ready to retry.
  expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send Offer' })).toBeEnabled();
  // It is not also on the page behind the modal.
  expect(screen.getAllByText('transactions are locked by the commissioner')).toHaveLength(1);
});

test('the dialog is the page\'s one filled button; the page behind it has none', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 20 });
  renderScreen();
  await screen.findByTestId('trade-5');

  expect(filled()).toHaveLength(0);

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  const dialog = screen.getByRole('dialog');
  expect(filled(dialog)).toHaveLength(1);
  expect(within(dialog).getByRole('button', { name: 'Send Offer' })).toHaveAttribute('data-variant', 'fill');
  expect(filled()).toHaveLength(1);
});

test('roster rows carry position tags and Weekly proj and ROS column heads, grouped in position order', async () => {
  mockGetSequence({ trades: [], rostersData: rostersWithProjections });

  renderScreen();
  await screen.findByText('No Pending Trades');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await selectTeam('Bob Squad');

  const sendColumn = await screen.findByTestId('roster-column-send');
  expect(within(sendColumn).getAllByText('Weekly proj')).toHaveLength(1);
  expect(within(sendColumn).getByText('ROS')).toBeInTheDocument();
  // Josh Allen (QB) comes before Stefon Diggs (WR); each row has its position tag.
  const labels = within(sendColumn).getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'));
  expect(labels[0]).toMatch(/^Josh Allen \(QB\)/);
  expect(labels[1]).toMatch(/^Stefon Diggs \(WR\)/);
  expect(sendColumn.querySelectorAll('[data-position]').length).toBe(2);
});

test('propose dialog composes weekly and rest-of-season projection labels', async () => {
  mockGetSequence({ trades: [], rostersData: rostersWithProjections });

  renderScreen();
  await screen.findByText('No Pending Trades');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await selectTeam('Bob Squad');

  expect(await screen.findByLabelText('Josh Allen (QB) · weekly proj 22.4 · ROS 180.2')).toBeInTheDocument();
  expect(screen.getByLabelText('Tyreek Hill (WR) · weekly proj 18.7')).toBeInTheDocument();
  expect(screen.getByLabelText('Travis Kelce (TE)')).toBeInTheDocument();
});

test('live summary chip rows reflect the current selection on each side', async () => {
  mockGetSequence({ trades: [] });

  renderScreen();
  await screen.findByText('No Pending Trades');

  await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await selectTeam('Bob Squad');

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
    if (url === '/api/trades/analyze') return Promise.resolve({ data: FAIR });
    return Promise.resolve({});
  });

  renderScreen();
  await screen.findByText('No Pending Trades');

  await user.click(screen.getByRole('button', { name: 'Propose Trade' }));
  await user.selectOptions(screen.getByLabelText('Trade with'), 'Bob Squad');
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
  await user.selectOptions(screen.getByLabelText('Trade with'), 'Bob Squad');
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
  const c = await findCard();

  const acceptButton = c.getByRole('button', { name: 'Accept Trade' });
  expect(acceptButton).toBeInTheDocument();
  expect(c.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  expect(c.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

  await userEvent.click(acceptButton);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/respond', { action: 'accept' })
  );
  expect(await findToast('Trade accepted')).toBeInTheDocument();
});

test('Counter button appears for the receiving team and opens the propose dialog pre-filled with the trade inverted', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 20 });
  apiClient.post.mockResolvedValue({});

  renderScreenWithToasts();
  const c = await findCard();

  await userEvent.click(c.getByRole('button', { name: 'Counter' }));

  expect(screen.getByRole('dialog', { name: 'Counter Trade' })).toBeInTheDocument();

  // Fixed to the original proposer and disabled — a counter always goes back to them.
  const teamSelect = screen.getByLabelText('Trade with');
  expect(teamSelect).toHaveDisplayValue('Alice Squad');
  expect(teamSelect).toBeDisabled();

  // Sides inverted: what the proposer originally requested from me is now
  // pre-checked as what I send; what they offered is pre-checked as what I receive.
  expect(await screen.findByLabelText('Tyreek Hill (WR)')).toBeChecked();
  expect(screen.getByLabelText('Stefon Diggs (WR)')).toBeChecked();
  // The select is disabled, so focus opens on the first "You send" checkbox.
  expect(within(screen.getByTestId('roster-column-send')).getByLabelText('Tyreek Hill (WR)')).toHaveFocus();

  await userEvent.click(screen.getByRole('button', { name: 'Send Offer' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/counter', {
      playerIds: [200, 101],
    })
  );
  expect(await findToast('Counter offer sent')).toBeInTheDocument();
});

test('cancel button appears for the proposing team on a pending trade and calls cancel', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 10 });
  apiClient.post.mockResolvedValue({});

  renderScreenWithToasts();
  const c = await findCard();

  expect(c.queryByRole('button', { name: 'Accept Trade' })).not.toBeInTheDocument();
  await userEvent.click(c.getByRole('button', { name: 'Cancel' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/cancel', {})
  );
  expect(await findToast('Trade cancelled')).toBeInTheDocument();
});

test('a card action that moves its trade puts focus on the next card\'s heading', async () => {
  let list = [pendingTrade(), pendingTrade({ id: 4, receiving_team_name: 'Carol Squad', receiving_team_id: 30 })];
  mockGetSequence({ trades: () => list, myTeamId: 10 });
  apiClient.post.mockImplementation(async () => {
    list = list.filter((t) => t.id !== 5);
    return {};
  });

  renderScreen();
  await userEvent.click((await findCard()).getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByTestId('trade-5')).not.toBeInTheDocument());
  await waitFor(() => expect(within(screen.getByTestId('trade-4')).getByRole('heading', { level: 2 })).toHaveFocus());
});

test('the last card leaving Pending puts focus on the Pending tab', async () => {
  let list = [pendingTrade()];
  mockGetSequence({ trades: () => list, myTeamId: 10 });
  apiClient.post.mockImplementation(async () => {
    list = [];
    return {};
  });

  renderScreen();
  await userEvent.click((await findCard()).getByRole('button', { name: 'Cancel' }));

  await screen.findByText('No Pending Trades');
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Pending' })).toHaveFocus());
});

test('vote to veto button appears for an uninvolved team on an accepted trade', async () => {
  mockGetSequence({ trades: [pendingTrade({ status: 'accepted' })], myTeamId: 30, league: leagueResponse({ ownerTeamId: 3 }) });
  apiClient.post.mockResolvedValue({});

  renderScreen();
  const c = await findCard();

  await userEvent.click(c.getByRole('button', { name: 'Vote to Veto' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/veto', {})
  );
});

test('commissioner sees force approve and can force-approve a pending trade, on a labelled row of its own', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 30, league: leagueResponse({ ownerTeamId: 1 }) });
  apiClient.post.mockResolvedValue({});

  renderScreenWithToasts();
  const c = await findCard();

  const row = c.getByRole('group', { name: 'Commissioner' });
  const forceApprove = within(row).getByRole('button', { name: 'Force Approve' });
  expect(within(row).getByRole('button', { name: 'Commissioner Veto' })).toBeInTheDocument();

  await userEvent.click(forceApprove);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/5/decide', { approve: true })
  );
  expect(await findToast('Trade approved')).toBeInTheDocument();
});

test('the commissioner\'s own trade, proposed or received, has no Force Approve or Commissioner Veto', async () => {
  // The viewer is the commissioner (is_commissioner) and Alice Squad (team 10) is the proposer.
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 10, league: leagueResponse({ is_commissioner: true }) });
  const { unmount } = renderScreen();
  const c = await findCard();
  expect(c.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  expect(c.queryByRole('button', { name: 'Force Approve' })).not.toBeInTheDocument();
  expect(c.queryByRole('button', { name: 'Commissioner Veto' })).not.toBeInTheDocument();
  expect(c.queryByRole('group', { name: 'Commissioner' })).not.toBeInTheDocument();
  unmount();
  clearLeagueCache();

  // As the receiving team too.
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 20, league: leagueResponse({ is_commissioner: true }) });
  renderScreen();
  const received = await findCard();
  expect(received.getByRole('button', { name: 'Accept Trade' })).toBeInTheDocument();
  expect(received.queryByRole('button', { name: 'Force Approve' })).not.toBeInTheDocument();
});

test('a failed read says "We could not load trades." with a Retry outside the alert, and Retry reads again', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'trades unavailable' } } });

  renderScreen();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('We could not load trades.');
  expect(within(alert).queryByRole('button')).not.toBeInTheDocument();

  mockGetSequence({ trades: [pendingTrade()] });
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByTestId('trade-5')).toBeInTheDocument();
  expect(screen.queryByText('We could not load trades.')).not.toBeInTheDocument();
});

test('a refused card action shows the server\'s sentence in an alert with no Retry', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 20 });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'trade would put Bob Squad over its roster capacity of 15' } } });

  renderScreen();
  await userEvent.click((await findCard()).getByRole('button', { name: 'Accept Trade' }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('trade would put Bob Squad over its roster capacity of 15');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

test('Analyze Trade on an existing trade card posts the trade id and renders a fair verdict chip', async () => {
  mockGetSequence({ trades: [pendingTrade()] });
  apiClient.post.mockImplementation((url) => {
    if (url === '/api/trades/analyze') return Promise.resolve({ data: FAIR });
    return Promise.resolve({});
  });

  renderScreen();
  const c = await findCard();

  // Existing trade cards keep the manual button — no auto-run there.
  await userEvent.click(c.getByRole('button', { name: 'Analyze Trade' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/trades/analyze', { leagueId: 1, tradeId: 5 })
  );
  expect(await c.findByText('Fair')).toBeInTheDocument();
  // One decimal, whatever the wire sends.
  expect(c.getAllByText(/gives 20\.0 · gets 20\.0/, { selector: 'div' })).toHaveLength(2);
});

test('an analysis with verdict collusion_risk reads "Collusion risk", and the players show one-decimal values', async () => {
  mockGetSequence({ trades: [pendingTrade()] });
  apiClient.post.mockResolvedValue({
    data: {
      verdict: 'collusion_risk',
      proposerGives: 68,
      proposerGets: 166,
      receiverGives: 166,
      receiverGets: 68,
      players: [{
        playerId: 101, name: 'Stefon Diggs', position: 'WR', rosValue: 68, fitAdjustedValue: 57.8,
      }],
    },
  });

  renderScreen();
  const c = await findCard();
  await userEvent.click(c.getByRole('button', { name: 'Analyze Trade' }));

  expect(await c.findByText('Collusion risk')).toBeInTheDocument();
  expect(c.queryByText('collusion_risk')).not.toBeInTheDocument();
  expect(c.getByText(/gives 68\.0 · gets 166\.0/, { selector: 'div' })).toBeInTheDocument();
  expect(c.getByText('rest-of-season value 68.0, adjusted for roster fit 57.8')).toBeInTheDocument();
});

test('a failed analysis shows its sentence inside the card and the button comes back', async () => {
  mockGetSequence({ trades: [pendingTrade()] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'cannot analyze a trade right now' } } });

  renderScreen();
  const c = await findCard();
  await userEvent.click(c.getByRole('button', { name: 'Analyze Trade' }));

  expect(await c.findByRole('alert')).toHaveTextContent('cannot analyze a trade right now');
  expect(c.getByRole('button', { name: 'Analyze Trade' })).toBeEnabled();
});

// #970: the trade centre reads its load failure through readHttpFailure. This
// envelope is shape (c) - `code`, `message` and a requestId, with no `error`
// key at all - which the global express error handler and the rate limiter
// emit. The old hand-rolled `err.response?.data?.error` found nothing there
// and fell through to axios's own generic `err.message` ("Request failed with
// status code 429"), throwing away the sentence the server actually sent.
test('a load failure in the code/message/requestId envelope renders its message', async () => {
  const rateLimited = {
    message: 'Request failed with status code 429',
    response: {
      status: 429,
      data: { code: 'RATE_LIMITED', message: 'Too many trade requests. Try again in a minute.', requestId: 'r-1' },
    },
  };
  apiClient.get.mockImplementation((url) => (
    url.startsWith('/api/trades') ? Promise.reject(rateLimited) : Promise.resolve({ data: leagueResponse() })
  ));
  renderScreen();

  expect(await screen.findByText('Too many trade requests. Try again in a minute.')).toBeInTheDocument();
  expect(screen.queryByText('Request failed with status code 429')).not.toBeInTheDocument();
  expect(screen.queryByText('RATE_LIMITED')).not.toBeInTheDocument();
});

// #1585: the card's PlayerRow shows the week's NFL opponent - `vs BUF`, or a
// bare `Bye` when the item has an nfl_team but no opponent this week.
test('a trade item with an nfl_opponent renders "vs BUF"', async () => {
  const trade = pendingTrade();
  trade.items[0] = { ...trade.items[0], nfl_opponent: 'BUF' };
  mockGetSequence({ trades: [trade] });
  renderScreen();

  expect((await findCard()).getByText('vs BUF')).toBeInTheDocument();
});

test('a trade item with a null nfl_opponent renders "Bye" and no "vs"', async () => {
  const trade = pendingTrade();
  trade.items = [{ ...trade.items[0], nfl_opponent: null }];
  mockGetSequence({ trades: [trade] });
  renderScreen();

  const c = await findCard();
  expect(c.getByText('Bye')).toBeInTheDocument();
  expect(c.queryByText(/^vs /)).not.toBeInTheDocument();
});

test('an uninvolved viewer\'s "{proposing} Receives" column lists what the receiving team sends', async () => {
  mockGetSequence({ trades: [pendingTrade({ status: 'accepted' })], myTeamId: 30, league: leagueResponse({ ownerTeamId: 3 }) });
  renderScreen();
  const c = await findCard();

  // Alice Squad (proposing) receives Tyreek Hill, whom Bob Squad (receiving) sends; and the reverse.
  const aliceColumn = c.getByRole('list', { name: 'Alice Squad Receives' });
  expect(within(aliceColumn).getByRole('button', { name: 'Tyreek Hill' })).toBeInTheDocument();
  expect(within(aliceColumn).queryByRole('button', { name: 'Stefon Diggs' })).not.toBeInTheDocument();
  const bobColumn = c.getByRole('list', { name: 'Bob Squad Receives' });
  expect(within(bobColumn).getByRole('button', { name: 'Stefon Diggs' })).toBeInTheDocument();
});

test('an involved viewer reads "You Receive" first, then what the other team receives', async () => {
  mockGetSequence({ trades: [pendingTrade()], myTeamId: 20 });
  renderScreen();
  const c = await findCard();

  expect(within(c.getByRole('list', { name: 'You Receive' })).getByRole('button', { name: 'Stefon Diggs' })).toBeInTheDocument();
  expect(within(c.getByRole('list', { name: 'Alice Squad Receives' })).getByRole('button', { name: 'Tyreek Hill' })).toBeInTheDocument();
});

test('an accepted trade shows when league review ends, from review_ends_at', async () => {
  const reviewEnds = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  mockGetSequence({ trades: [pendingTrade({ status: 'accepted', review_ends_at: reviewEnds })], myTeamId: 30, league: leagueResponse({ ownerTeamId: 3 }) });
  renderScreen();

  const c = await findCard();
  expect(c.getByText(/^League review ends \S+ \d{1,2}:\d{2}/)).toBeInTheDocument();
});

test('a pending trade shows no review line', async () => {
  mockGetSequence({ trades: [pendingTrade({ review_ends_at: new Date(Date.now() + 3600 * 1000).toISOString() })], myTeamId: 20 });
  renderScreen();

  expect((await findCard()).queryByText(/League review ends/)).not.toBeInTheDocument();
});

test('the Completed tab prints each status word; an executed trade offers nothing, the rest only Analyze Trade', async () => {
  const done = ['executed', 'rejected', 'vetoed', 'cancelled', 'countered'].map((status, i) => pendingTrade({ id: 20 + i, status }));
  mockGetSequence({ trades: done, myTeamId: 10 });
  renderScreen();
  await screen.findByText('No Pending Trades');

  await userEvent.click(screen.getByRole('tab', { name: 'Completed' }));
  for (const word of ['Executed', 'Rejected', 'Vetoed', 'Cancelled', 'Countered']) {
    expect(screen.getByText(word, { selector: 'span' })).toBeInTheDocument();
  }
  // Analysis reads today's rosters, which an executed trade has already changed: its card has no button.
  expect(screen.getAllByRole('button', { name: 'Analyze Trade' })).toHaveLength(4);
  expect(within(screen.getByTestId('trade-20')).queryByRole('button', { name: 'Analyze Trade' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
});

describe('cursor and filled action', () => {
  const cursors = (container) => container.querySelectorAll('.cursor');

  test('the oldest incoming pending offer wears the one cursor', async () => {
    const newer = pendingTrade({ id: 7, created_at: new Date(Date.now() - 3600 * 1000).toISOString() });
    const older = pendingTrade({ id: 6, created_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString() });
    const outgoing = pendingTrade({
      id: 8,
      proposing_team_id: 20,
      receiving_team_id: 10,
      proposing_team_name: 'Bob Squad',
      receiving_team_name: 'Alice Squad',
      created_at: new Date(Date.now() - 9 * 3600 * 1000).toISOString(),
    });
    mockGetSequence({ trades: [newer, older, outgoing], myTeamId: 20 });
    const { container } = renderScreen();
    await screen.findByTestId('trade-6');

    // Trades 7 and 6 are incoming to team 20; trade 8 is its own outgoing offer.
    expect(cursors(container)).toHaveLength(1);
    expect(screen.getByTestId('trade-6').closest('.cursor')).not.toBeNull();
    expect(filled(container)).toHaveLength(0);
  });

  test('with no incoming pending offer the page has no cursor', async () => {
    // An outgoing offer, and an incoming one that is already accepted.
    mockGetSequence({
      trades: [pendingTrade({ id: 1 }), pendingTrade({ id: 2, status: 'accepted', proposing_team_id: 20, receiving_team_id: 10 })],
      myTeamId: 10,
    });
    const { container } = renderScreen();
    await screen.findByTestId('trade-1');

    expect(cursors(container)).toHaveLength(0);
    expect(filled(container)).toHaveLength(0);
  });

  test('the cursor stays on Pending only', async () => {
    mockGetSequence({ trades: [pendingTrade()], myTeamId: 20 });
    const { container } = renderScreen();
    await screen.findByTestId('trade-5');
    expect(cursors(container)).toHaveLength(1);

    await userEvent.click(screen.getByRole('tab', { name: 'Completed' }));
    expect(cursors(container)).toHaveLength(0);
  });

  test('the page has no contained button: every action on every card is a ghost', async () => {
    mockGetSequence({
      trades: [pendingTrade(), pendingTrade({ id: 6, status: 'accepted' })],
      myTeamId: 20,
      league: leagueResponse({ is_commissioner: true }),
    });
    const { container } = renderScreen();
    await screen.findByTestId('trade-5');

    expect(container.querySelectorAll('.MuiButton-contained')).toHaveLength(0);
    const variants = Array.from(container.querySelectorAll('button[data-variant]')).map((b) => b.getAttribute('data-variant'));
    expect(variants.length).toBeGreaterThan(4);
    expect(variants.every((v) => v === 'ghost')).toBe(true);
    // No action is red: nothing takes the MUI error colour.
    expect(container.querySelectorAll('.MuiButton-colorError, .MuiButton-colorSuccess')).toHaveLength(0);
  });

  test('no live region on the page holds a button', async () => {
    mockGetSequence({ trades: [pendingTrade()], myTeamId: 20 });
    apiClient.post.mockRejectedValue({ response: { data: { error: 'refused' } } });
    const { container } = renderScreen();
    await userEvent.click((await findCard()).getByRole('button', { name: 'Accept Trade' }));
    await screen.findByRole('alert');

    const regions = container.querySelectorAll('[role="status"], [role="alert"]');
    expect(regions.length).toBeGreaterThan(0);
    regions.forEach((region) => expect(region.querySelector('button, a')).toBeNull());
  });
});

describe('one request at a time', () => {
  const never = () => new Promise(() => {});

  test('Send Offer is disabled while the offer is in flight, and a second press posts nothing more', async () => {
    mockGetSequence({ trades: [] });
    apiClient.post.mockImplementation(never);
    renderScreen();
    await screen.findByText('No Pending Trades');

    await userEvent.click(screen.getByRole('button', { name: 'Propose Trade' }));
    await selectTeam('Bob Squad');
    await userEvent.click(await screen.findByLabelText('Stefon Diggs (WR)'));
    await userEvent.click(await screen.findByLabelText('Tyreek Hill (WR)'));
    const send = screen.getByRole('button', { name: 'Send Offer' });
    await userEvent.click(send);
    await userEvent.click(send);

    expect(send).toBeDisabled();
    expect(apiClient.post.mock.calls.filter(([url]) => url === '/api/trades')).toHaveLength(1);
  });

  test('the actions of a card are disabled while one of them is in flight, and a second press posts nothing more', async () => {
    mockGetSequence({ trades: [pendingTrade(), pendingTrade({ id: 4, proposing_team_id: 30, proposing_team_name: 'Carol Squad' })], myTeamId: 20 });
    apiClient.post.mockImplementation(never);
    renderScreen();
    const c = await findCard();

    const accept = c.getByRole('button', { name: 'Accept Trade' });
    await userEvent.click(accept);
    await userEvent.click(accept);

    expect(accept).toBeDisabled();
    expect(c.getByRole('button', { name: 'Decline' })).toBeDisabled();
    expect(c.getByRole('button', { name: 'Counter' })).toBeDisabled();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    // Another card is free to act.
    expect(within(screen.getByTestId('trade-4')).getByRole('button', { name: 'Accept Trade' })).toBeEnabled();
  });

  test('the dialog keeps one status region mounted, and a changed selection clears the old analysis at once', async () => {
    jest.useFakeTimers({ legacyFakeTimers: false });
    const user = userEvent.setup({ delay: null });
    mockGetSequence({ trades: [], rostersData: [{ ...rosters[0], players: [...rosters[0].players, { id: 102, name: 'Davante Adams', position: 'WR', nfl_team: 'LV' }] }, rosters[1], rosters[2]] });
    apiClient.post.mockResolvedValue({ data: FAIR });
    renderScreen();
    await screen.findByText('No Pending Trades');

    await user.click(screen.getByRole('button', { name: 'Propose Trade' }));
    await user.selectOptions(screen.getByLabelText('Trade with'), 'Bob Squad');
    const dialog = within(screen.getByRole('dialog'));
    const status = dialog.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    await user.click(dialog.getByLabelText('Stefon Diggs (WR)'));
    await user.click(dialog.getByLabelText('Tyreek Hill (WR)'));
    // The same element carries the text, rather than a new one mounting with it.
    expect(dialog.getByRole('status')).toBe(status);

    await act(async () => { jest.advanceTimersByTime(600); });
    expect(await dialog.findByText('Fair')).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();

    await user.click(dialog.getByLabelText('Davante Adams (WR)'));
    expect(dialog.queryByText('Fair')).not.toBeInTheDocument();
  });
});
