import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { useNavigate } from 'react-router-dom';
import TransactionLog from './TransactionLog';
import { clearLeagueCache } from '../../hooks/useLeague';

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

// The page waits for the league row (useLeague) before it shows the filter
// bar; the default fixture is a fantasy league.
const mockTransactions = (data, league = { id: 1, name: 'Sunday Ballers', pickem_only: false }) => {
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/transactions')) return Promise.resolve({ data });
    if (/\/api\/league\/\d+$/.test(url)) return Promise.resolve({ data: { league, teams: [] } });
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
  // useLeague's module cache would otherwise carry one test's league row
  // (permanently fresh under the pinned Date.now) into the next.
  clearLeagueCache();
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

// --- Pick'em-only leagues ---

const pickemLeague = { id: 1, name: 'Office Pool', pickem_only: true };

test("a pick'em-only league gets no Adds/Drops/Waivers/Trades toggles and an honest empty state", async () => {
  mockTransactions([], pickemLeague);
  renderScreen();

  expect(await screen.findByText('The league is quiet. Commissioner actions will appear here.')).toBeInTheDocument();
  expect(screen.queryByText(/Recent transactions, trades/)).not.toBeInTheDocument();
  const group = screen.getByRole('group', { name: 'Filter by transaction type' });
  expect(within(group).getByRole('button', { name: 'All' })).toBeInTheDocument();
  expect(within(group).getByRole('button', { name: 'Commissioner' })).toBeInTheDocument();
  for (const name of ['Adds', 'Drops', 'Waivers', 'Trades']) {
    expect(within(group).queryByRole('button', { name })).not.toBeInTheDocument();
  }
  // The Team filter still applies (commissioner actions name a team).
  expect(screen.getByLabelText('Team')).toBeInTheDocument();
});

test("a pick'em-only league still lists commissioner actions and the Team filter narrows them", async () => {
  mockTransactions([
    txn({ id: 1, type: 'commissioner', team_name: "Bob's Team", player_name: null, detail: { action: 'remove_team_avatar' } }),
    txn({ id: 2, type: 'commissioner', team_name: "Alice's Team", player_name: null, detail: { action: 'grant_co_commissioner' } }),
  ], pickemLeague);
  renderScreen();

  expect(await screen.findByTestId('txn-1')).toHaveTextContent("Bob's Team commissioner action");
  expect(screen.getByTestId('txn-2')).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Team'));
  await userEvent.click(await screen.findByRole('option', { name: "Bob's Team" }));
  expect(screen.getByTestId('txn-1')).toBeInTheDocument();
  expect(screen.queryByTestId('txn-2')).not.toBeInTheDocument();
});

test('a fantasy league keeps every type toggle and the fantasy empty state', async () => {
  mockTransactions([]);
  renderScreen();

  expect(
    await screen.findByText('The league is quiet. Recent transactions, trades, and commissioner actions will appear here.')
  ).toBeInTheDocument();
  const group = screen.getByRole('group', { name: 'Filter by transaction type' });
  for (const name of ['All', 'Adds', 'Drops', 'Waivers', 'Trades', 'Commissioner']) {
    expect(within(group).getByRole('button', { name })).toBeInTheDocument();
  }
});

test("the filter bar waits for the league row, so a pick'em league never flashes the roster-move toggles", async () => {
  let resolveLeague;
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/transactions')) return Promise.resolve({ data: [] });
    if (/\/api\/league\/\d+$/.test(url)) return new Promise((resolve) => { resolveLeague = resolve; });
    return new Promise(() => {});
  });
  renderScreen();

  // Transactions are back but the row is not: still the skeleton, no toggles.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/transactions'));
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Adds' })).not.toBeInTheDocument();

  await act(async () => { resolveLeague({ data: { league: pickemLeague, teams: [] } }); });

  expect(await screen.findByText('The league is quiet. Commissioner actions will appear here.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Adds' })).not.toBeInTheDocument();
});

// A hash edit from one league's Activity to another keeps this element
// mounted (same route, new param): filters, rows and the league row must all
// start over for the new league.
function SwitchLeagueButton() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/league/2/activity')}>go to league 2</button>;
}

test('switching leagues in place resets the filters and re-shapes the page for the new league', async () => {
  const leagues = {
    1: { id: 1, name: 'Sunday Ballers', pickem_only: false },
    2: { id: 2, name: 'Office Pool', pickem_only: true },
  };
  apiClient.get.mockImplementation((url) => {
    const m = url.match(/\/api\/league\/(\d+)(\/transactions)?$/);
    if (m && m[2]) return Promise.resolve({ data: m[1] === '1' ? [txn({ id: 1, type: 'add' })] : [] });
    if (m) return Promise.resolve({ data: { league: leagues[m[1]], teams: [] } });
    return new Promise(() => {});
  });
  renderWithProviders(
    <>
      <TransactionLog />
      <SwitchLeagueButton />
    </>,
    { path: '/league/:leagueId/activity', route: '/league/1/activity' }
  );
  await screen.findByTestId('txn-1');
  await userEvent.click(screen.getByRole('button', { name: 'Adds' }));
  expect(screen.getByRole('button', { name: 'Adds' })).toHaveAttribute('aria-pressed', 'true');

  await userEvent.click(screen.getByRole('button', { name: 'go to league 2' }));

  expect(await screen.findByText('The league is quiet. Commissioner actions will appear here.')).toBeInTheDocument();
  expect(screen.queryByTestId('txn-1')).not.toBeInTheDocument(); // league 1's rows are gone
  expect(screen.queryByRole('button', { name: 'Adds' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/2/transactions');
});
