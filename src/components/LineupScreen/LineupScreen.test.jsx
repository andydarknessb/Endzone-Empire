import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import configureMockStore from 'redux-mock-store';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import LineupScreen, { LineupEditor } from './LineupScreen';

const mockStore = configureMockStore([]);

function NavigateButton({ to }) {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="nav-to-league" onClick={() => navigate(to)}>
      switch league
    </button>
  );
}

// Mounts LineupScreen bare (no FantasyOnly wrapper) with a button that
// navigates the route from one leagueId to another, so a leagueId switch can
// be driven while the component instance stays mounted throughout — the
// scenario the ref-latching bug needed and FantasyOnly's own unmount-on-load
// behavior happens to mask in production.
const renderScreenWithNavigation = (initialLeagueId, nextLeagueId) => {
  const store = mockStore({ user: {}, errors: { loginMessage: '', registrationMessage: '' } });
  return render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[`/league/${initialLeagueId}/lineup`]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route
            path="/league/:leagueId/lineup"
            element={(
              <>
                <NavigateButton to={`/league/${nextLeagueId}/lineup`} />
                <LineupScreen />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
};

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

test('LineupEditor accepts the League identity from its caller', async () => {
  setupGet({ lineup: lineupResponse({ leagueId: 42 }) });

  renderWithProviders(<LineupEditor leagueId={42} showLeagueBreadcrumb={false} />, {
    path: '/team',
    route: '/team',
  });

  await screen.findByText('Patrick Mahomes');
  expect(apiClient.get).toHaveBeenCalledWith('/api/team/lineup?leagueId=42');
});

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
  valid_stash: false,
  locked: true,
  onBye: false,
  ...overrides,
});

// A single-response stand-in for `apiClient.get.mockResolvedValue(response)`
// that still answers the league endpoint separately, with a resolved,
// known-standard league (#217). The tests using this only care about the
// lineup response, not best_ball, and must not have their league request
// look permanently unsettled just because they never mocked it: with the
// tri-state fix, an unmocked (never-resolving) league request means every
// league-gated consumer — advice, quick-pick, warnings, row interactivity —
// treats the league as still unknown, which would break tests that have
// nothing to do with best-ball.
const mockGetAll = (response) => {
  apiClient.get.mockImplementation((url) =>
    url.startsWith('/api/league/')
      ? Promise.resolve({ data: { league: { id: 1, best_ball: false } } })
      : Promise.resolve(response)
  );
};

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
  // Each suggestions-panel assertion awaits its own element: the panel
  // renders from a separate, later-resolving advice fetch, so it must not be
  // assumed present just because a lineup-fetch element (Justin Jefferson,
  // above) has already rendered.
  expect(await screen.findByText(/Projected 110\.4 pts/)).toBeInTheDocument();
  expect(await screen.findByText(/Optimal 118\.2 pts/)).toBeInTheDocument();
  expect(
    await screen.findByText(/Start Saquon Barkley \(17\.9 proj\) over\s*Justin Jefferson \(10\.2 proj\)/)
  ).toBeInTheDocument();
  expect(await screen.findByText(/vs NYG, 22\.1 pts\s*allowed to FLEX/)).toBeInTheDocument();
  expect(await screen.findByText('+7.7')).toBeInTheDocument();
});

test('clicking Apply on a suggestion swaps the two players and saves via the normal lineup save path', async () => {
  setupGet({ lineup: lineupResponse({ entries: flexBenchEntries }), advice: adviceResponse() });
  apiClient.put.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('Justin Jefferson');

  // Apply lives in the suggestions panel, which renders from a separate,
  // later-resolving advice fetch — await it directly rather than assuming it
  // arrived alongside the lineup-fetch text above.
  await userEvent.click(await screen.findByRole('button', { name: 'Apply' }));

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
  mockGetAll({ data: lineupResponse() });

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

test('numbers repeated starter slots and keeps the Bench independently scrollable', async () => {
  mockGetAll({ data: lineupResponse() });

  renderScreen();

  await screen.findByText('Patrick Mahomes');
  expect(within(screen.getByTestId('slot-row-QB-0')).getByText('QB')).toBeInTheDocument();
  expect(within(screen.getByTestId('slot-row-RB-0')).getByText('RB 1')).toBeInTheDocument();
  expect(within(screen.getByTestId('slot-row-RB-1')).getByText('RB 2')).toBeInTheDocument();
  expect(screen.getByTestId('lineup-bench-scroll')).toHaveStyle({ overflowY: 'auto' });
});

test('renders BYE and LOCKED chips for flagged entries', async () => {
  mockGetAll({ data: lineupResponse() });

  renderScreen();
  await screen.findByText('Davante Adams');

  expect(within(screen.getByTestId('slot-row-BENCH-4')).getByText(/BYE/)).toBeInTheDocument();
  expect(within(screen.getByTestId('slot-row-RB-0')).getByText('LOCKED')).toBeInTheDocument();
});

test('an attested stash wears the ATTESTED chip on its IR row; an eligible stash does not', async () => {
  mockGetAll({
    data: lineupResponse({
      entries: [
        {
          id: 61,
          name: 'Attested Runner',
          position: 'RB',
          nfl_team: 'Minnesota Vikings',
          slot: 'IR',
          injury_status: null,
          ir_attested: true,
          valid_stash: true,
          locked: false,
          onBye: false,
        },
      ],
    }),
  });

  renderScreen();
  await screen.findByText('Attested Runner');

  expect(within(screen.getByTestId('slot-row-IR-0')).getByText('ATTESTED')).toBeInTheDocument();
});

test('a normally eligible stash renders without the ATTESTED chip', async () => {
  mockGetAll({
    data: lineupResponse({
      entries: [
        {
          id: 62,
          name: 'Eligible Runner',
          position: 'RB',
          nfl_team: 'Minnesota Vikings',
          slot: 'IR',
          injury_status: 'O',
          ir_attested: false,
          valid_stash: true,
          locked: false,
          onBye: false,
        },
      ],
    }),
  });

  renderScreen();
  await screen.findByText('Eligible Runner');

  expect(within(screen.getByTestId('slot-row-IR-0')).queryByText('ATTESTED')).not.toBeInTheDocument();
});

test('clicking bench player then empty eligible slot applies the move optimistically, PUTs one move, and does not refetch', async () => {
  mockGetAll({ data: lineupResponse() });
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
  mockGetAll({ data: lineupResponse() });
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
  mockGetAll({ data: lineupResponse({ entries: customEntries }) });
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
  mockGetAll({ data: lineupResponse() });

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
  mockGetAll({ data: lineupResponse() });

  renderScreenWithToasts();
  await screen.findByText('Christian McCaffrey');

  await userEvent.click(screen.getByTestId('slot-row-RB-0'));

  expect(await screen.findByText("Locked players can't be moved")).toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('a locked recovered stash cannot move into a starting slot after kickoff', async () => {
  mockGetAll({
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
  mockGetAll({
    data: lineupResponse({
      benchSlots: 2,
      entries: [
        ...lineupResponse().entries,
        recoveredStashEntry({ name: 'Still Out Receiver', injury_status: 'O', valid_stash: true }),
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

test('a locked attested stash remains unavailable after kickoff', async () => {
  mockGetAll({
    data: lineupResponse({
      benchSlots: 2,
      entries: [
        ...lineupResponse().entries,
        recoveredStashEntry({ name: 'Attested Receiver', ir_attested: true, valid_stash: true }),
      ],
    }),
  });

  renderScreenWithToasts();
  await screen.findByText('Attested Receiver');

  await userEvent.click(screen.getByTestId('slot-row-IR-0'));
  expect(await screen.findByText("Locked players can't be moved")).toBeInTheDocument();
  expect(screen.queryByTestId('lineup-move-strip')).not.toBeInTheDocument();

  await userEvent.click(screen.getByTestId('slot-row-BENCH-empty-1'));
  const menu = await screen.findByRole('menu');
  expect(within(menu).queryByText(/Attested Receiver/)).not.toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('a failed PUT rolls the optimistic move back and shows an error toast', async () => {
  mockGetAll({ data: lineupResponse() });
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
  mockGetAll({ data: lineupResponse() });
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
  mockGetAll({
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

test('a zero-bench league exposes a corrective target for a locked stale stash', async () => {
  mockGetAll({
    data: lineupResponse({
      benchSlots: 0,
      entries: [
        ...lineupResponse().entries.filter((entry) => entry.slot !== 'BENCH'),
        recoveredStashEntry(),
      ],
    }),
  });
  apiClient.put.mockResolvedValue({});

  renderScreenWithToasts();
  await screen.findByText('Recovered Receiver');

  await userEvent.click(screen.getByTestId('slot-row-BENCH-empty-0'));
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
  mockGetAll({ data: lineupResponse() });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  // DEF-0 is empty and no entry in the fixture plays DEF.
  await userEvent.click(screen.getByTestId('slot-row-DEF-0'));

  const menu = await screen.findByRole('menu');
  expect(within(menu).getByText('No eligible players available')).toBeInTheDocument();
});

test('shows a "Needs attention" warning chip in the summary header when starting slots are empty', async () => {
  mockGetAll({ data: lineupResponse() });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  expect(
    within(screen.getByTestId('lineup-summary-header')).getByTestId('lineup-warning-chip')
  ).toBeInTheDocument();
});

test('shows an error alert when the initial fetch fails', async () => {
  // The league endpoint resolves normally here (rather than a blanket
  // mockRejectedValue for every URL) so this stays a clean regression test
  // for the LINEUP fetch's own error surface: with the league also failing,
  // its separate #217 error alert would carry the same rejection text and
  // this assertion would ambiguously match two elements instead of one.
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/team/lineup')) {
      return Promise.reject({ response: { data: { error: 'lineup unavailable' } } });
    }
    if (url.startsWith('/api/league/')) {
      return Promise.resolve({ data: { league: { id: 1, best_ball: false } } });
    }
    return Promise.resolve({ data: undefined });
  });

  renderScreen();

  expect(await screen.findByText('lineup unavailable')).toBeInTheDocument();
});

test('week chevrons step the selected week and are disabled at the boundaries', async () => {
  mockGetAll({ data: lineupResponse() }); // week 3

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
  mockGetAll({ data: lineupResponse({ week: 1, currentWeek: 1 }) });

  renderScreen();
  await screen.findByText('Patrick Mahomes');

  expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next week' })).not.toBeDisabled();
});

test('the summary header shows projected/optimal totals and the (+gain) button expands the suggestions panel', async () => {
  setupGet({ lineup: lineupResponse({ entries: flexBenchEntries }), advice: adviceResponse() });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  // The header's totals come from the same later-resolving advice fetch as
  // the suggestions panel, so await them directly rather than a neighbour.
  expect(
    await within(screen.getByTestId('lineup-summary-header')).findByText(/Projected 110\.4/)
  ).toBeInTheDocument();
  expect(
    await within(screen.getByTestId('lineup-summary-header')).findByText(/Optimal 118\.2/)
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

  // best_ball comes from a separate league fetch, not the lineup fetch
  // awaited above, so await the alert directly. This also settles `bestBall`
  // before the row eligibility checks below, which are computed from it.
  expect(await screen.findByTestId('best-ball-alert')).toHaveTextContent(
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
  const irEntry = recoveredStashEntry({ injury_status: 'O', valid_stash: true, locked: false });
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

  // Bench row count factors in best_ball, from the separate league fetch —
  // await this row directly rather than assuming it settled alongside the
  // lineup-fetch text above.
  expect(await screen.findByTestId('slot-row-BENCH-4')).toBeInTheDocument();
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
  // The locked-in-best-ball click branch reads `bestBall` from the separate
  // league fetch; await its own element first so the click below runs after
  // that value has actually settled, not while it still defaults to false.
  await screen.findByTestId('best-ball-alert');

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
  // Quick-pick eligibility reads `bestBall` from the separate league fetch;
  // await its own element first so the click below runs after that value
  // has actually settled, not while it still defaults to false.
  await screen.findByTestId('best-ball-alert');

  await userEvent.click(screen.getByTestId('slot-row-BENCH-empty-1'));
  const menu = await screen.findByRole('menu');

  expect(within(menu).getByText('No eligible players available')).toBeInTheDocument();
  expect(within(menu).queryByText(/Recovered Receiver/)).not.toBeInTheDocument();
  expect(within(menu).queryByText(/Patrick Mahomes/)).not.toBeInTheDocument();
});

test('best ball: no advice request and no suggestions panel when the lineup resolves before the league (#167)', async () => {
  let resolveLeague;
  const leagueGate = new Promise((resolve) => {
    resolveLeague = resolve;
  });
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/team/lineup/advice')) {
      return Promise.resolve({ data: adviceResponse() });
    }
    if (url.startsWith('/api/team/lineup')) {
      // Resolves immediately, ahead of the league request below.
      return Promise.resolve({ data: lineupResponse() });
    }
    if (url.startsWith('/api/team/hindsight')) {
      return Promise.resolve({ data: hindsightSeasonResponse() });
    }
    if (url.startsWith('/api/league/')) {
      // Held open until the test explicitly resolves it, so the lineup
      // response lands first regardless of which request went out first.
      return leagueGate.then(() => ({ data: { league: { id: 1, best_ball: true } } }));
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderScreenWithToasts();

  // The lineup has landed and rendered; the league request is still
  // in flight. The advice decision must not have fired yet — it must wait
  // to learn the real best_ball value rather than treating "not loaded" as
  // "not best ball".
  await screen.findByText('Patrick Mahomes');
  expect(apiClient.get.mock.calls.some(([url]) => url.startsWith('/api/team/lineup/advice'))).toBe(
    false
  );
  expect(screen.queryByTestId('lineup-advice-panel')).not.toBeInTheDocument();
  expect(screen.queryByText(/Projected .* · Optimal/)).not.toBeInTheDocument();

  // Now let the league response land.
  resolveLeague();
  await screen.findByTestId('best-ball-alert');

  expect(apiClient.get.mock.calls.some(([url]) => url.startsWith('/api/team/lineup/advice'))).toBe(
    false
  );
  expect(screen.queryByTestId('lineup-advice-panel')).not.toBeInTheDocument();
  expect(screen.queryByText(/Projected .* · Optimal/)).not.toBeInTheDocument();
});

// This guards a specific rejected implementation, not the #167 bug directly:
// with `leagueKnown` computed as plain `!leagueLoading` (the first fix this
// issue tried), a background revalidation's true->false loading flip would
// re-run the advice-decision effect and refire the advice request even
// though nothing relevant had changed. It does NOT fail against the
// original, entirely-unfixed component (bestBall alone, no leagueLoading
// involved at all): there, `bestBall` never changes across a same-league
// revalidation, so the effect's dependency array never differs and nothing
// refires either, for an unrelated reason. This test exists to keep the
// rejected variant rejected, since it is the obvious next thing to reach
// for.
test('a background revalidation of the shared league resource does not refire the advice request', async () => {
  // The revalidation response is held open deliberately, and the trigger
  // below uses a plain (non-async) `act()` followed by a separate explicit
  // flush, rather than one `await act(async () => { clearLeagueCache(1) })`
  // call: a synchronous act() commits `setLoading(true)` as its own render
  // before any microtask runs, whereas wrapping the whole revalidation
  // (trigger + an instantly-resolved response) in a single async act() lets
  // React settle both the true and the (immediately following) false update
  // together, so the transient "loading" render never appears as its own
  // commit and this test would pass trivially without exercising the
  // hazard (verified directly: an instant response inside a single async
  // act() shows only one post-trigger render, already loading:false).
  // Holding the response open additionally keeps its resolution under this
  // test's own explicit act() rather than racing an uncontrolled microtask.
  let revalidating = false;
  let resolveRevalidatedLeague;
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/team/lineup/advice')) {
      return Promise.resolve({ data: adviceResponse() });
    }
    if (url.startsWith('/api/team/lineup')) {
      return Promise.resolve({ data: lineupResponse({ entries: flexBenchEntries }) });
    }
    if (url.startsWith('/api/team/hindsight')) {
      return Promise.resolve({ data: hindsightSeasonResponse() });
    }
    if (url.startsWith('/api/league/')) {
      if (!revalidating) {
        return Promise.resolve({ data: { league: { id: 1, best_ball: false } } });
      }
      return new Promise((resolve) => {
        resolveRevalidatedLeague = () => resolve({ data: { league: { id: 1, best_ball: false } } });
      });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  const adviceCallCount = () =>
    apiClient.get.mock.calls.filter(([url]) => url.startsWith('/api/team/lineup/advice')).length;
  expect(adviceCallCount()).toBe(1);

  // Simulate the shared league cache entry revalidating in the background
  // (a TTL lapse, or another mount on the same league invalidating it) with
  // the same best_ball value. This must not look like a fresh "league just
  // became known" transition to the advice-decision effect.
  revalidating = true;
  act(() => {
    clearLeagueCache(1);
  });

  // The revalidation's own loading state has now committed on its own
  // (leagueLoading flipped true again, ahead of the held-open response).
  expect(adviceCallCount()).toBe(1);

  await act(async () => {
    resolveRevalidatedLeague();
    await Promise.resolve();
  });

  expect(adviceCallCount()).toBe(1);
});

test('does not fire an advice request for a newly-selected league before its own league response settles', async () => {
  // League 1 resolves normally; league 2's own league response is held
  // open for the whole test, so its best_ball value is genuinely never
  // learned. If the "is the league known" check can latch onto league 1's
  // already-resolved state and carry it across the leagueId switch, it
  // would treat league 2 as known too and fire advice for it prematurely.
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/team/lineup/advice')) {
      return Promise.resolve({ data: adviceResponse() });
    }
    if (url.startsWith('/api/team/lineup?leagueId=2')) {
      return Promise.resolve({ data: lineupResponse({ leagueId: 2 }) });
    }
    if (url.startsWith('/api/team/lineup')) {
      return Promise.resolve({ data: lineupResponse() });
    }
    if (url.startsWith('/api/team/hindsight')) {
      return Promise.resolve({ data: hindsightSeasonResponse() });
    }
    if (url.startsWith('/api/league/2')) {
      return new Promise(() => {}); // never settles for the life of this test
    }
    if (url.startsWith('/api/league/1')) {
      return Promise.resolve({ data: { league: { id: 1, best_ball: false } } });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderScreenWithNavigation(1, 2);
  await screen.findByText('Patrick Mahomes');

  const adviceCallsFor = (leagueId) =>
    apiClient.get.mock.calls.filter(
      ([url]) => url.startsWith('/api/team/lineup/advice') && url.includes(`leagueId=${leagueId}`)
    ).length;
  expect(adviceCallsFor(1)).toBe(1);

  await userEvent.click(screen.getByTestId('nav-to-league'));

  // League 2's own lineup has landed (it resolves immediately in this
  // mock), but its league response never will — the advice decision must
  // still be blocked, not carried over from league 1's answer.
  await waitFor(() => {
    expect(
      apiClient.get.mock.calls.some(([url]) => url.startsWith('/api/team/lineup?leagueId=2'))
    ).toBe(true);
  });
  expect(adviceCallsFor(2)).toBe(0);
});

// --- League state: unresolved or failed (#217) ---
//
// `bestBall` used to default to false whenever `league` was anything other
// than a resolved best-ball league, so "still loading" and "request failed"
// both rendered exactly like a resolved standard league everywhere in this
// file — clickable rows, the quick-pick offer, the lineup warning, and (via
// the advice effect #167 fixed for the ordering race only) potentially the
// advice request itself, permanently for a failed request. Each test below
// drives every one of the roughly ten affected sites through one pass, since
// a partial migration (nine sites moved off the boolean, one left behind)
// would still pass a narrower test that only checks the one thing it looks
// at. Both tests were run against this file's own pre-#217 LineupScreen.jsx
// (bestBall collapsing straight off `!!league?.best_ball`, no tri-state) and
// failed — see the PR body for which assertion failed and its message.

test('league state - loading: no advice request, no quick-pick, no alert, no warning, rows inert, lineup still renders (#217)', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/team/lineup/advice')) {
      return Promise.resolve({ data: adviceResponse() });
    }
    if (url.startsWith('/api/team/lineup')) {
      return Promise.resolve({ data: lineupResponse() });
    }
    if (url.startsWith('/api/team/hindsight')) {
      return Promise.resolve({ data: hindsightSeasonResponse() });
    }
    if (url.startsWith('/api/league/')) {
      // Never settles for the life of this test: the league is permanently
      // "still loading" from this component's point of view.
      return new Promise(() => {});
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderScreenWithToasts();
  await screen.findByText('Patrick Mahomes');

  // Default lineupResponse() leaves WR/TE/FLEX/K/DEF starter slots empty,
  // which would trip the lineup warning the instant the league is known to
  // be standard. It must not trip while the league is still unknown.
  expect(screen.queryByTestId('lineup-summary-header')).not.toBeInTheDocument();
  expect(screen.queryByTestId('lineup-warning-chip')).not.toBeInTheDocument();
  expect(screen.queryByTestId('best-ball-alert')).not.toBeInTheDocument();
  expect(screen.queryByTestId('lineup-advice-panel')).not.toBeInTheDocument();
  expect(screen.queryByTestId('league-error-alert')).not.toBeInTheDocument();
  expect(apiClient.get.mock.calls.some(([url]) => url.startsWith('/api/team/lineup/advice'))).toBe(
    false
  );

  // Rows are not interactive: every rendered slot row carries the disabled
  // treatment, not just the ones a best-ball league would manage.
  expect(screen.getByTestId('slot-row-QB-0')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByTestId('slot-row-RB-1')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByTestId('slot-row-WR-0')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByTestId('slot-row-BENCH-4')).toHaveAttribute('aria-disabled', 'true');

  // Clicking an occupied, unlocked row must not enter select-mode. Plain
  // fireEvent rather than userEvent: MUI's `disabled` prop sets
  // `pointer-events: none`, which userEvent's own hover/pointer simulation
  // (correctly) refuses to click through — the click handler must never run
  // at all here, so bypassing that simulation is the point, not a workaround.
  fireEvent.click(screen.getByTestId('slot-row-RB-1'));
  expect(screen.queryByTestId('lineup-move-strip')).not.toBeInTheDocument();

  // Clicking an empty slot must not open the quick-pick menu.
  fireEvent.click(screen.getByTestId('slot-row-WR-0'));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();

  // Clicking the locked row must not surface the "locked" notice either —
  // that branch only makes sense once best_ball is actually known.
  fireEvent.click(screen.getByTestId('slot-row-RB-0'));
  expect(screen.queryByText("Locked players can't be moved")).not.toBeInTheDocument();

  expect(apiClient.put).not.toHaveBeenCalled();
});

test('league state - error: shows the league error surface, no advice request, no quick-pick, rows inert (#217)', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/team/lineup/advice')) {
      return Promise.resolve({ data: adviceResponse() });
    }
    if (url.startsWith('/api/team/lineup')) {
      return Promise.resolve({ data: lineupResponse() });
    }
    if (url.startsWith('/api/team/hindsight')) {
      return Promise.resolve({ data: hindsightSeasonResponse() });
    }
    if (url.startsWith('/api/league/')) {
      return Promise.reject(new Error('League fetch failed'));
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderScreenWithToasts();
  await screen.findByText('Patrick Mahomes');

  // The existing lineup-fetch-failure pattern (an error Alert, nothing
  // frozen silently underneath it) applies here too, for the league's own
  // failure, rather than a second, invented error convention.
  expect(await screen.findByTestId('league-error-alert')).toHaveTextContent('League fetch failed');
  expect(screen.queryByTestId('lineup-summary-header')).not.toBeInTheDocument();
  expect(screen.queryByTestId('lineup-warning-chip')).not.toBeInTheDocument();
  expect(screen.queryByTestId('best-ball-alert')).not.toBeInTheDocument();
  expect(screen.queryByTestId('lineup-advice-panel')).not.toBeInTheDocument();
  expect(apiClient.get.mock.calls.some(([url]) => url.startsWith('/api/team/lineup/advice'))).toBe(
    false
  );

  expect(screen.getByTestId('slot-row-QB-0')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByTestId('slot-row-WR-0')).toHaveAttribute('aria-disabled', 'true');

  // Plain fireEvent, not userEvent: see the loading-state test above for why.
  fireEvent.click(screen.getByTestId('slot-row-RB-1'));
  expect(screen.queryByTestId('lineup-move-strip')).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId('slot-row-WR-0'));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();

  expect(apiClient.put).not.toHaveBeenCalled();
});

test('a non-best-ball league still shows the suggestions panel and no info alert', async () => {
  setupGet({ lineup: lineupResponse({ entries: flexBenchEntries }), advice: adviceResponse() });

  renderScreen();
  await screen.findByText('Justin Jefferson');

  expect(screen.queryByTestId('best-ball-alert')).not.toBeInTheDocument();
  // The advice panel renders from a separate, later-resolving advice fetch —
  // await it directly rather than assuming it arrived alongside the
  // lineup-fetch text above.
  expect(await screen.findByTestId('lineup-advice-panel')).toBeInTheDocument();
});

test('shows injury badges and projected points on lineup rows', async () => {
  const response = lineupResponse();
  response.entries[0].injury_status = 'Q';
  response.entries[0].projected_points = 21.5;
  mockGetAll({ data: response });
  renderScreen();

  await screen.findByText('Patrick Mahomes');
  expect(screen.getByText('Q')).toBeInTheDocument();
  expect(screen.getByText(/proj 21\.5/)).toBeInTheDocument();
});

test('appends the opponent to the row caption when provided, and omits it when missing', async () => {
  const response = lineupResponse();
  response.entries[0].opponent = 'DAL';
  mockGetAll({ data: response });
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
