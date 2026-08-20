import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import LineupScreen from './LineupScreen';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), request: jest.fn() },
}));

const setOnline = (value) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
};

const renderScreen = (leagueId = 1) =>
  renderWithProviders(<LineupScreen />, {
    path: '/league/:leagueId/lineup',
    route: `/league/${leagueId}/lineup`,
  });

// Toast text (via notify) only renders when a SnackbarProvider is mounted.
const renderScreenWithToasts = (leagueId = 1) =>
  renderWithProviders(
    <SnackbarProvider>
      <LineupScreen />
    </SnackbarProvider>,
    {
      path: '/league/:leagueId/lineup',
      route: `/league/${leagueId}/lineup`,
    }
  );

// Defaults: a QB starter, two RB starters (one locked), a WR on bench (on bye).
const lineupResponse = (overrides = {}) => ({
  leagueId: 1,
  teamId: 10,
  season: 2026,
  week: 3,
  currentWeek: 3,
  rosterSlots: [
    { key: 'QB', count: 1, eligiblePositions: ['QB'] },
    { key: 'RB', count: 2, eligiblePositions: ['RB'] },
    { key: 'WR', count: 2, eligiblePositions: ['WR'] },
    { key: 'TE', count: 1, eligiblePositions: ['TE'] },
    { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
    { key: 'K', count: 1, eligiblePositions: ['K'] },
    { key: 'DEF', count: 1, eligiblePositions: ['DEF'] },
  ],
  benchSlots: 5,
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

const recoveredStashEntry = (overrides = {}) => ({
  id: 5,
  name: 'Recovered Receiver',
  position: 'WR',
  nfl_team: 'Minnesota Vikings',
  injury_status: 'Q',
  slot: 'IR',
  locked: true,
  onBye: false,
  ...overrides,
});

// URL-keyed mock covering the GETs LineupScreen now issues per week: the
// lineup itself, start/sit advice, the season-long hindsight tally, and a
// one-time league fetch (used only for the best_ball flag — see the
// component for why). `advice`/`hindsight` may be omitted (defaults to an
// empty/undefined response, which the component must tolerate silently) or
// passed as `{ reject: <error> }` to simulate an endpoint failure. `league`
// defaults to a non-best-ball league.
const setupGet = ({ lineup, advice, hindsight, league } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/team/lineup/advice')) {
      return advice && advice.reject ? Promise.reject(advice.reject) : Promise.resolve({ data: advice });
    }
    if (url.startsWith('/api/team/lineup')) {
      return Promise.resolve({ data: lineup ?? lineupResponse() });
    }
    if (url.startsWith('/api/team/hindsight')) {
      return hindsight && hindsight.reject
        ? Promise.reject(hindsight.reject)
        : Promise.resolve({ data: hindsight });
    }
    if (url.startsWith('/api/league/')) {
      return Promise.resolve({ data: { league: league ?? { id: 1, best_ball: false } } });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
};

const adviceResponse = (overrides = {}) => ({
  week: 3,
  season: 2026,
  projectedTotal: 110.4,
  optimalTotal: 118.2,
  suggestions: [
    {
      slot: 'FLEX',
      current: {
        playerId: 10,
        name: 'Justin Jefferson',
        projection: 10.2,
        opponent: 'DAL',
        opponentPointsAllowed: 14.5,
      },
      suggested: {
        playerId: 11,
        name: 'Saquon Barkley',
        projection: 17.9,
        opponent: 'NYG',
        opponentPointsAllowed: 22.1,
      },
      gain: 7.7,
    },
  ],
  ...overrides,
});

// A fully-filled starting lineup (every STARTER_SLOT_ORDER slot occupied),
// used to isolate the "already optimal" empty state from the "fill your
// lineup" one — both only render when advice returns zero suggestions.
const fullyFilledEntries = [
  { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'Kansas City Chiefs', slot: 'QB', locked: false, onBye: false },
  { id: 2, name: 'Christian McCaffrey', position: 'RB', nfl_team: 'San Francisco 49ers', slot: 'RB', locked: false, onBye: false },
  { id: 3, name: 'Derrick Henry', position: 'RB', nfl_team: 'Baltimore Ravens', slot: 'RB', locked: false, onBye: false },
  { id: 4, name: 'Davante Adams', position: 'WR', nfl_team: 'Las Vegas Raiders', slot: 'WR', locked: false, onBye: false },
  { id: 5, name: 'Tyreek Hill', position: 'WR', nfl_team: 'Miami Dolphins', slot: 'WR', locked: false, onBye: false },
  { id: 6, name: 'Travis Kelce', position: 'TE', nfl_team: 'Kansas City Chiefs', slot: 'TE', locked: false, onBye: false },
  { id: 7, name: 'Saquon Barkley', position: 'RB', nfl_team: 'Philadelphia Eagles', slot: 'FLEX', locked: false, onBye: false },
  { id: 8, name: 'Justin Tucker', position: 'K', nfl_team: 'Baltimore Ravens', slot: 'K', locked: false, onBye: false },
  { id: 9, name: 'SF Defense', position: 'DEF', nfl_team: 'San Francisco 49ers', slot: 'DEF', locked: false, onBye: false },
];

const flexBenchEntries = [
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

const hindsightSeasonResponse = (overrides = {}) => ({
  teamId: 10,
  weeks: [],
  totalActual: 200,
  totalOptimal: 230,
  totalPointsLeftOnBench: 30,
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
  clearLeagueCache();
  localStorage.removeItem('pending_lineup_mutations');
  setOnline(true);
});

test('suggestions panel shows projected vs optimal totals and a suggestion with opponent context', async () => {
  setupGet({ lineup: lineupResponse({ entries: flexBenchEntries }), advice: adviceResponse() });

  renderScreen();

  await screen.findByText('Justin Jefferson');
  expect(screen.getByText(/Projected 110\.4 pts/)).toBeInTheDocument();
  expect(screen.getByText(/Optimal 118\.2 pts/)).toBeInTheDocument();
  expect(
    screen.getByText(/Start Saquon Barkley \(17\.9 proj\) over\s*Justin Jefferson \(10\.2 proj\)/)
  ).toBeInTheDocument();
  expect(screen.getByText(/vs NYG, 22\.1 pts\s*allowed to FLEX/)).toBeInTheDocument();
  expect(screen.getByText('+7.7')).toBeInTheDocument();
});

test('clicking Apply on a suggestion swaps the two players and saves via the normal lineup save path', async () => {
  setupGet({ lineup: lineupResponse({ entries: flexBenchEntries }), advice: adviceResponse() });
  apiClient.put.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('Justin Jefferson');

  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

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
  expect(await screen.findByText('Lineup saved')).toBeInTheDocument();
});

test('shows an "already optimal" empty state when the starting lineup is full and advice returns no suggestions', async () => {
  setupGet({
    lineup: lineupResponse({ entries: fullyFilledEntries }),
    advice: adviceResponse({ suggestions: [] }),
  });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  expect(await screen.findByText('Your lineup is already optimal')).toBeInTheDocument();
});

test('shows a "fill your lineup" message instead of "already optimal" when starting slots are empty', async () => {
  // Default lineupResponse() leaves WR/TE/FLEX/K/DEF starter slots empty.
  setupGet({ advice: adviceResponse({ suggestions: [] }) });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  expect(
    await screen.findByText('Fill your starting lineup to unlock live optimization insights.')
  ).toBeInTheDocument();
  expect(screen.queryByText('Your lineup is already optimal')).not.toBeInTheDocument();
});

test('silently hides the suggestions panel when the advice endpoint fails', async () => {
  setupGet({ advice: { reject: new Error('boom') } });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  expect(screen.queryByTestId('lineup-advice-panel')).not.toBeInTheDocument();
});

test('shows a season bench-points stat sourced from the no-week hindsight response', async () => {
  setupGet({ hindsight: hindsightSeasonResponse() });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  expect(await screen.findByText('Bench points this season: 30')).toBeInTheDocument();
});

test('shows skeleton placeholders before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
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

  // Empty starter rows: WR(2) + TE(1) + FLEX(1) + K(1) + DEF(1) = 6,
  // plus IR(1) and the four unoccupied configured bench spots.
  expect(screen.getAllByText('Empty')).toHaveLength(11);
  expect(within(screen.getByTestId('lineup-bench')).getAllByText('Empty')).toHaveLength(4);
});

test('renders BYE and LOCKED chips for flagged entries', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });

  renderScreen();
  await screen.findByText('Davante Adams');

  expect(within(screen.getByTestId('slot-row-BENCH-4')).getByText(/BYE/)).toBeInTheDocument();
  expect(within(screen.getByTestId('slot-row-RB-0')).getByText('LOCKED')).toBeInTheDocument();
});

test('clicking bench player then empty eligible slot applies the move optimistically, PUTs one move, and does not refetch', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });
  apiClient.put.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('Davante Adams');

  await userEvent.click(screen.getByTestId('slot-row-BENCH-4'));
  await userEvent.click(screen.getByTestId('slot-row-WR-0'));

  // Optimistic: the WR slot shows Adams right away, not after a refetch.
  expect(
    within(screen.getByTestId('slot-row-WR-0')).getByText('Davante Adams')
  ).toBeInTheDocument();

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
      leagueId: 1,
      week: 3,
      moves: [{ playerId: 4, slot: 'WR' }],
    })
  );

  expect(await screen.findByText('Lineup saved')).toBeInTheDocument();
  // No refetch of the lineup itself on a successful save (advice/hindsight calls don't count)
  const lineupGets = apiClient.get.mock.calls.filter(([url]) =>
    url.startsWith('/api/team/lineup?')
  );
  expect(lineupGets).toHaveLength(1);
});

test('an offline move is cached without a request and replays once when connectivity returns', async () => {
  setOnline(false);
  apiClient.get.mockResolvedValue({ data: lineupResponse() });
  apiClient.request.mockResolvedValue({ status: 200 });

  renderScreenWithToasts();
  await screen.findByText('Davante Adams');
  await userEvent.click(screen.getByTestId('slot-row-BENCH-4'));
  await userEvent.click(screen.getByTestId('slot-row-WR-0'));

  expect(apiClient.put).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('pending_lineup_mutations'))).toEqual([
    expect.objectContaining({
      endpoint: '/api/team/lineup',
      method: 'PUT',
      payload: {
        leagueId: 1,
        week: 3,
        moves: [{ playerId: 4, slot: 'WR' }],
      },
    }),
  ]);
  expect(await screen.findByText(/saved offline/i)).toBeInTheDocument();

  setOnline(true);
  act(() => window.dispatchEvent(new Event('online')));

  await waitFor(() => expect(apiClient.request).toHaveBeenCalledTimes(1));
  expect(apiClient.request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: '/api/team/lineup',
      method: 'PUT',
      data: {
        leagueId: 1,
        week: 3,
        moves: [{ playerId: 4, slot: 'WR' }],
      },
    })
  );
  await waitFor(() => expect(localStorage.getItem('pending_lineup_mutations')).toBeNull());
  expect(await screen.findByText('Lineup saved')).toBeInTheDocument();
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

test('selecting a player highlights eligible slots and disables ineligible ones (no top-of-page error)', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  await userEvent.click(screen.getByTestId('slot-row-QB-0'));

  // The helper strip announces the move.
  expect(
    screen.getByText('Moving Patrick Mahomes: tap a highlighted slot')
  ).toBeInTheDocument();

  // Derrick Henry (RB, unlocked) can't take a QB — ineligible, so disabled.
  expect(screen.getByTestId('slot-row-RB-1')).toHaveAttribute('aria-disabled', 'true');
  // Christian McCaffrey is locked, so also disabled as a target.
  expect(screen.getByTestId('slot-row-RB-0')).toHaveAttribute('aria-disabled', 'true');
  // Mahomes is healthy, so the empty IR slot is not an eligible target.
  expect(screen.getByTestId('slot-row-IR-0')).toHaveAttribute('aria-disabled', 'true');

  expect(screen.queryByText("That player can't go in that slot")).not.toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();

  // Cancel via the helper strip clears the selection and its highlighting.
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByTestId('lineup-move-strip')).not.toBeInTheDocument();
  expect(screen.getByTestId('slot-row-RB-1')).not.toHaveAttribute('aria-disabled', 'true');
});

test("clicking a locked player shows a warning toast and does not call put", async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });

  renderScreenWithToasts();
  await screen.findByText('Christian McCaffrey');

  await userEvent.click(screen.getByTestId('slot-row-RB-0'));

  expect(await screen.findByText("Locked players can't be moved")).toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('a locked recovered stash cannot move into a starting slot after kickoff', async () => {
  apiClient.get.mockResolvedValue({
    data: lineupResponse({ entries: [...lineupResponse().entries, recoveredStashEntry()] }),
  });

  renderScreenWithToasts();
  await screen.findByText('Recovered Receiver');

  await userEvent.click(screen.getByTestId('slot-row-IR-0'));
  expect(screen.getByText('Moving Recovered Receiver: tap a highlighted slot')).toBeInTheDocument();
  expect(screen.getByTestId('slot-row-WR-0')).toHaveAttribute('aria-disabled', 'true');
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('a locked IR-eligible stash remains unavailable after kickoff', async () => {
  apiClient.get.mockResolvedValue({
    data: lineupResponse({
      benchSlots: 2,
      entries: [
        ...lineupResponse().entries,
        recoveredStashEntry({ name: 'Still Out Receiver', injury_status: 'O' }),
      ],
    }),
  });

  renderScreenWithToasts();
  await screen.findByText('Still Out Receiver');

  await userEvent.click(screen.getByTestId('slot-row-IR-0'));
  expect(await screen.findByText("Locked players can't be moved")).toBeInTheDocument();
  expect(screen.queryByTestId('lineup-move-strip')).not.toBeInTheDocument();

  await userEvent.click(screen.getByTestId('slot-row-BENCH-empty-1'));
  const menu = await screen.findByRole('menu');
  expect(within(menu).queryByText(/Still Out Receiver/)).not.toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('a failed PUT rolls the optimistic move back and shows an error toast', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });
  apiClient.put.mockRejectedValue({
    response: { data: { error: 'Player is on bye and cannot start' } },
  });

  renderScreenWithToasts();
  await screen.findByText('Davante Adams');

  await userEvent.click(screen.getByTestId('slot-row-BENCH-4'));
  await userEvent.click(screen.getByTestId('slot-row-WR-0'));

  expect(await screen.findByText('Player is on bye and cannot start')).toBeInTheDocument();

  // Rolled back: Adams is back on the bench, the WR slot is empty again.
  expect(
    within(screen.getByTestId('lineup-bench')).getByText('Davante Adams')
  ).toBeInTheDocument();
  expect(screen.getByTestId('slot-row-WR-0')).toHaveTextContent('Empty');

  // No lineup refetch, on either success or failure.
  const lineupGets = apiClient.get.mock.calls.filter(([url]) =>
    url.startsWith('/api/team/lineup?')
  );
  expect(lineupGets).toHaveLength(1);
});

test('clicking an empty slot with no selection opens a quick-pick menu; choosing a player fills that slot directly', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });
  apiClient.put.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('Davante Adams');

  // WR-0 is empty; only Davante Adams (WR, unlocked) is eligible — the two
  // RBs are wrong position for a straight WR slot.
  await userEvent.click(screen.getByTestId('slot-row-WR-0'));

  const menu = await screen.findByRole('menu');
  expect(within(menu).getAllByRole('menuitem')).toHaveLength(1);
  await userEvent.click(within(menu).getByText(/Davante Adams/));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
      leagueId: 1,
      week: 3,
      moves: [{ playerId: 4, slot: 'WR' }],
    })
  );
  expect(await screen.findByText('Lineup saved')).toBeInTheDocument();
});

test('an empty bench row lets a locked recovered stash activate after a drop', async () => {
  apiClient.get.mockResolvedValue({
    data: lineupResponse({
      benchSlots: 2,
      entries: [...lineupResponse().entries, recoveredStashEntry()],
    }),
  });
  apiClient.put.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('Recovered Receiver');

  await userEvent.click(screen.getByTestId('slot-row-BENCH-empty-1'));
  const menu = await screen.findByRole('menu');
  await userEvent.click(within(menu).getByText(/Recovered Receiver/));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
      leagueId: 1,
      week: 3,
      moves: [{ playerId: 5, slot: 'BENCH' }],
    })
  );
});

test('clicking an empty slot with no eligible players shows a disabled "no eligible players" item', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  // DEF-0 is empty and no entry in the fixture plays DEF.
  await userEvent.click(screen.getByTestId('slot-row-DEF-0'));

  const menu = await screen.findByRole('menu');
  expect(within(menu).getByText('No eligible players available')).toBeInTheDocument();
});

test('shows a "Needs attention" warning chip in the summary header when starting slots are empty', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  expect(
    within(screen.getByTestId('lineup-summary-header')).getByTestId('lineup-warning-chip')
  ).toBeInTheDocument();
});

test('shows an error alert when the initial fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'lineup unavailable' } } });

  renderScreen();

  expect(await screen.findByText('lineup unavailable')).toBeInTheDocument();
});

test('week chevrons step the selected week and are disabled at the boundaries', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse() }); // week 3

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  expect(screen.getByRole('combobox')).toHaveTextContent('Week 3');
  expect(screen.getByRole('button', { name: 'Previous week' })).not.toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next week' })).not.toBeDisabled();

  await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('week=4'))
  );
  expect(screen.getByRole('combobox')).toHaveTextContent('Week 4');

  await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('week=3'))
  );
  expect(screen.getByRole('combobox')).toHaveTextContent('Week 3');
});

test('the previous-week chevron is disabled at week 1', async () => {
  apiClient.get.mockResolvedValue({ data: lineupResponse({ week: 1, currentWeek: 1 }) });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next week' })).not.toBeDisabled();
});

test('the summary header shows projected/optimal totals and the (+gain) button expands the suggestions panel', async () => {
  setupGet({ lineup: lineupResponse({ entries: flexBenchEntries }), advice: adviceResponse() });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  expect(
    within(screen.getByTestId('lineup-summary-header')).getByText(/Projected 110\.4/)
  ).toBeInTheDocument();
  expect(
    within(screen.getByTestId('lineup-summary-header')).getByText(/Optimal 118\.2/)
  ).toBeInTheDocument();

  // Collapse the panel, then use the summary header's gain button to reopen it.
  await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
  expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '(+7.8)' }));
  expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
});

// --- Best ball ---

test('best ball: keeps starters automatic while allowing an eligible bench player to move to IR', async () => {
  const entries = lineupResponse().entries.map((entry) => (
    entry.id === 4 ? { ...entry, injury_status: 'O' } : entry
  ));
  setupGet({
    league: { id: 1, best_ball: true },
    lineup: lineupResponse({ entries }),
  });
  apiClient.put.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('Patrick Mahomes');

  expect(screen.getByTestId('best-ball-alert')).toHaveTextContent(
    'Best ball: your optimal lineup is computed automatically each week.'
  );
  expect(screen.queryByTestId('lineup-advice-panel')).not.toBeInTheDocument();
  expect(apiClient.get.mock.calls.some(([url]) => url.startsWith('/api/team/lineup/advice'))).toBe(
    false
  );

  expect(screen.getByTestId('slot-row-BENCH-4')).not.toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByTestId('slot-row-IR-0')).not.toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByTestId('slot-row-WR-0')).toHaveAttribute('aria-disabled', 'true');

  await userEvent.click(screen.getByTestId('slot-row-BENCH-4'));
  await userEvent.click(screen.getByTestId('slot-row-IR-0'));

  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
    leagueId: 1,
    week: 3,
    moves: [{ playerId: 4, slot: 'IR' }],
  }));
});

test('best ball: renders the full bench pool and lets an unlocked IR occupant return to BENCH', async () => {
  const benchEntries = lineupResponse().entries.map((entry) => ({
    ...entry,
    slot: 'BENCH',
    locked: false,
  }));
  const irEntry = recoveredStashEntry({ injury_status: 'O', locked: false });
  setupGet({
    league: { id: 1, best_ball: true },
    lineup: lineupResponse({
      benchSlots: 1,
      entries: [...benchEntries, irEntry],
    }),
  });
  apiClient.put.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('Recovered Receiver');

  expect(screen.getByTestId('slot-row-BENCH-4')).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('slot-row-IR-0'));
  await userEvent.click(screen.getByTestId('slot-row-BENCH-empty-4'));

  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
    leagueId: 1,
    week: 3,
    moves: [{ playerId: 5, slot: 'BENCH' }],
  }));
});

test('best ball: a recovered stash remains locked after kickoff', async () => {
  setupGet({
    league: { id: 1, best_ball: true },
    lineup: lineupResponse({
      entries: [...lineupResponse().entries, recoveredStashEntry()],
    }),
  });

  renderScreenWithToasts();
  await screen.findByText('Recovered Receiver');

  await userEvent.click(screen.getByTestId('slot-row-IR-0'));

  expect(await screen.findByText("Locked players can't be moved")).toBeInTheDocument();
  expect(screen.queryByTestId('lineup-move-strip')).not.toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('best ball: quick-pick offers only unlocked players from the opposite managed slot', async () => {
  setupGet({
    league: { id: 1, best_ball: true },
    lineup: lineupResponse({
      entries: [...lineupResponse().entries, recoveredStashEntry()],
    }),
  });

  renderScreen();
  await screen.findByText('Recovered Receiver');

  await userEvent.click(screen.getByTestId('slot-row-BENCH-empty-1'));
  const menu = await screen.findByRole('menu');

  expect(within(menu).getByText('No eligible players available')).toBeInTheDocument();
  expect(within(menu).queryByText(/Recovered Receiver/)).not.toBeInTheDocument();
  expect(within(menu).queryByText(/Patrick Mahomes/)).not.toBeInTheDocument();
});

test('a non-best-ball league still shows the suggestions panel and no info alert', async () => {
  setupGet({ lineup: lineupResponse({ entries: flexBenchEntries }), advice: adviceResponse() });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  expect(screen.queryByTestId('best-ball-alert')).not.toBeInTheDocument();
  expect(screen.getByTestId('lineup-advice-panel')).toBeInTheDocument();
});

test('shows injury badges and projected points on lineup rows', async () => {
  const response = lineupResponse();
  response.entries[0].injury_status = 'Q';
  response.entries[0].projected_points = 21.5;
  apiClient.get.mockResolvedValue({ data: response });
  renderScreen();

  await screen.findByText('Patrick Mahomes');
  expect(screen.getByText('Q')).toBeInTheDocument();
  expect(screen.getByText(/proj 21\.5/)).toBeInTheDocument();
});

test('appends the opponent to the row caption when provided, and omits it when missing', async () => {
  const response = lineupResponse();
  response.entries[0].opponent = 'DAL';
  apiClient.get.mockResolvedValue({ data: response });
  renderScreen();

  await screen.findByText('Patrick Mahomes');
  expect(
    within(screen.getByTestId('slot-row-QB-0')).getByText(/· vs DAL/)
  ).toBeInTheDocument();
  // Derrick Henry has no opponent field on this fixture, so no opponent
  // segment renders at all (no dangling "· vs").
  expect(
    within(screen.getByTestId('slot-row-RB-1')).queryByText(/vs/)
  ).not.toBeInTheDocument();
});
