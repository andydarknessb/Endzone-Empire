import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import LineupScreen from './LineupScreen';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

const renderScreen = (leagueId = 1) =>
  renderWithProviders(<LineupScreen />, {
    path: '/league/:leagueId/lineup',
    route: `/league/${leagueId}/lineup`,
  });

// Defaults: a QB starter, two RB starters (one locked), a WR on bench (on bye).
const lineupResponse = (overrides = {}) => ({
  leagueId: 1,
  teamId: 10,
  season: 2026,
  week: 3,
  currentWeek: 3,
  lineupSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
  irSlots: 1,
  entries: [
    {
      id: 1,
      name: 'Patrick Mahomes',
      position: 'QB',
      nfl_team: 'Kansas City Chiefs',
      slot: 'QB',
      locked: false,
      onBye: false,
    },
    {
      id: 2,
      name: 'Christian McCaffrey',
      position: 'RB',
      nfl_team: 'San Francisco 49ers',
      slot: 'RB',
      locked: true,
      onBye: false,
    },
    {
      id: 3,
      name: 'Derrick Henry',
      position: 'RB',
      nfl_team: 'Baltimore Ravens',
      slot: 'RB',
      locked: false,
      onBye: false,
    },
    {
      id: 4,
      name: 'Davante Adams',
      position: 'WR',
      nfl_team: 'Las Vegas Raiders',
      slot: 'BENCH',
      locked: false,
      onBye: true,
    },
  ],
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows a loading spinner before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
});

test('renders starters grouped by slot, bench section, and empty slot rows', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });

  renderScreen();

  await screen.findByText('Patrick Mahomes');
  expect(screen.getByText('Christian McCaffrey')).toBeInTheDocument();
  expect(screen.getByText('Derrick Henry')).toBeInTheDocument();
  expect(
    within(screen.getByTestId('lineup-bench')).getByText('Davante Adams')
  ).toBeInTheDocument();

  // Empty starter rows: WR(2) + TE(1) + FLEX(1) + K(1) + DEF(1) = 6, plus IR(1) = 7.
  expect(screen.getAllByText('Empty')).toHaveLength(7);
});

test('renders BYE and LOCKED chips for flagged entries', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });

  renderScreen();
  await screen.findByText('Davante Adams');

  expect(within(screen.getByTestId('slot-row-BENCH-4')).getByText('BYE')).toBeInTheDocument();
  expect(within(screen.getByTestId('slot-row-RB-0')).getByText('LOCKED')).toBeInTheDocument();
});

test('clicking bench player then empty eligible slot PUTs one move and refetches', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });
  apiClient.put.mockResolvedValue({});

  renderScreen();
  await screen.findByText('Davante Adams');

  await userEvent.click(screen.getByTestId('slot-row-BENCH-4'));
  await userEvent.click(screen.getByTestId('slot-row-WR-0'));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
      leagueId: 1,
      week: 3,
      moves: [{ playerId: 4, slot: 'WR' }],
    })
  );

  expect(await screen.findByText('Lineup saved')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

test('swapping two players PUTs two moves', async () => {
  const customEntries = [
    {
      id: 10,
      name: 'Justin Jefferson',
      position: 'WR',
      nfl_team: 'Minnesota Vikings',
      slot: 'FLEX',
      locked: false,
      onBye: false,
    },
    {
      id: 11,
      name: 'Saquon Barkley',
      position: 'RB',
      nfl_team: 'Philadelphia Eagles',
      slot: 'BENCH',
      locked: false,
      onBye: false,
    },
  ];
  apiClient.get.mockResolvedValue({ data: lineupResponse({ entries: customEntries }) });
  apiClient.put.mockResolvedValue({});

  renderScreen();
  await screen.findByText('Justin Jefferson');

  await userEvent.click(screen.getByTestId('slot-row-FLEX-0'));
  await userEvent.click(screen.getByTestId('slot-row-BENCH-11'));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
      leagueId: 1,
      week: 3,
      moves: [
        { playerId: 10, slot: 'BENCH' },
        { playerId: 11, slot: 'FLEX' },
      ],
    })
  );
});

test("ineligible target shows an error and does not call put", async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  await userEvent.click(screen.getByTestId('slot-row-QB-0'));
  await userEvent.click(screen.getByTestId('slot-row-RB-1'));

  expect(await screen.findByText("That player can't go in that slot")).toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
});

test("clicking a locked player shows an error and does not call put", async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });

  renderScreen();
  await screen.findByText('Christian McCaffrey');

  await userEvent.click(screen.getByTestId('slot-row-RB-0'));

  expect(await screen.findByText("Locked players can't be moved")).toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('server error on PUT surfaces the error message', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });
  apiClient.put.mockRejectedValue({
    response: { data: { error: 'Player is on bye and cannot start' } },
  });

  renderScreen();
  await screen.findByText('Davante Adams');

  await userEvent.click(screen.getByTestId('slot-row-BENCH-4'));
  await userEvent.click(screen.getByTestId('slot-row-WR-0'));

  expect(await screen.findByText('Player is on bye and cannot start')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('shows an error alert when the initial fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'lineup unavailable' } } });

  renderScreen();

  expect(await screen.findByText('lineup unavailable')).toBeInTheDocument();
});
