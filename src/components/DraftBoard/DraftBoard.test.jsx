import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import DraftBoard from './DraftBoard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
}));

/** A controllable fake socket: captures .on() handlers so tests can fire them. */
function makeFakeSocket() {
  const handlers = {};
  const managerHandlers = {};
  return {
    on: jest.fn((event, cb) => {
      handlers[event] = cb;
    }),
    io: {
      on: jest.fn((event, cb) => {
        managerHandlers[event] = cb;
      }),
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
    trigger(event, payload) {
      if (handlers[event]) handlers[event](payload);
    },
    triggerManager(event, payload) {
      if (managerHandlers[event]) managerHandlers[event](payload);
    },
  };
}

const playersPage = (players = [{ id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'Kansas City Chiefs' }]) => ({
  data: { players, totalPages: 1 },
});

const renderBoard = (leagueId = 1, state) =>
  renderWithProviders(<DraftBoard />, {
    path: '/league/:leagueId/draft',
    route: `/league/${leagueId}/draft`,
    state,
  });

// Toast text (via notify) only renders when a SnackbarProvider is mounted.
const renderBoardWithToasts = (leagueId = 1, state) =>
  renderWithProviders(
    <SnackbarProvider>
      <DraftBoard />
    </SnackbarProvider>,
    {
      path: '/league/:leagueId/draft',
      route: `/league/${leagueId}/draft`,
      state,
    }
  );

let fakeSocket;

beforeEach(() => {
  fakeSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(fakeSocket);
  onReconnect.mockImplementation((socket, handler) => socket.io.on('reconnect', handler));
  apiClient.get.mockResolvedValue(playersPage());
  apiClient.put.mockResolvedValue({});
  apiClient.post.mockResolvedValue({});
});

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

test('creates a socket and joins the league draft room once connected', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  expect(createDraftSocket).toHaveBeenCalled();
  act(() => fakeSocket.trigger('connect'));

  expect(fakeSocket.emit).toHaveBeenCalledWith('draft:join', { leagueId: 1 }, expect.any(Function));
});

test('renders league state (name, on-the-clock, pick history) from a draft:state event', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active' },
      teams: [{ id: 5, name: "Bob's Team", owner: 'bob' }],
      picks: [{ pick_number: 1, player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills' }],
      onTheClock: { id: 5, name: "Bob's Team", owner: 'bob' },
    })
  );

  expect(screen.getByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText("On the clock: Bob's Team (bob)")).toBeInTheDocument();
  expect(screen.getByText('#1')).toBeInTheDocument();
  // The pick-history name is now a quick-view button (separate from any action).
  expect(screen.getByRole('button', { name: 'Josh Allen' })).toBeInTheDocument();
});

test('shows the prominent on-clock timer with "Your pick!" for the active user', async () => {
  renderBoard(1, { user: { id: 5 } });
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: {
        name: 'Sunday Ballers',
        draft_status: 'active',
        owner_id: 99,
        pick_time_seconds: 90,
        pick_deadline_at: new Date(Date.now() + 30000).toISOString(),
      },
      teams: [{ id: 5, name: "Bob's Team", owner: 'bob', owner_id: 5, draft_position: 1, autodraft: false }],
      picks: [],
      onTheClock: { id: 5, name: "Bob's Team", owner: 'bob', owner_id: 5 },
    })
  );

  expect(screen.getByText('Your pick!')).toBeInTheDocument();
  expect(screen.getByTestId('draft-clock')).toBeInTheDocument();
});

test('shows an AUTO badge and a checked autodraft switch for an autodrafting team', async () => {
  renderBoard(1, { user: { id: 5 } });
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active', owner_id: 99 },
      teams: [{ id: 5, name: "Bob's Team", owner: 'bob', owner_id: 5, draft_position: 1, autodraft: true }],
      picks: [],
      onTheClock: null,
    })
  );

  expect(screen.getByText('AUTO')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Autodraft for Bob's Team/ })).toBeChecked();
});

test('toggling a team\'s autodraft posts to the autodraft endpoint', async () => {
  renderBoard(1, { user: { id: 5 } });
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active', owner_id: 99 },
      teams: [{ id: 5, name: "Bob's Team", owner: 'bob', owner_id: 5, draft_position: 1, autodraft: false }],
      picks: [],
      onTheClock: null,
    })
  );

  await userEvent.click(screen.getByRole('checkbox', { name: /Autodraft for Bob's Team/ }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/teams/5/autodraft', { enabled: true })
  );
});

test('shows "No picks yet" when the pick history is empty', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'pending' },
      teams: [],
      picks: [],
      onTheClock: null,
    })
  );

  expect(screen.getByText('No picks yet')).toBeInTheDocument();
  expect(screen.getByText('pending')).toBeInTheDocument(); // falls back to draft_status chip
});

test('clicking Draft on a player emits draft:pick with the league and player id', async () => {
  renderBoard(3, { user: { id: 5 } });
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active', draft_paused: false },
      teams: [{ id: 1, name: 'Team A', owner: 'alice', owner_id: 5 }],
      picks: [],
      onTheClock: { id: 1, name: 'Team A', owner: 'alice', owner_id: 5 },
    })
  );

  await userEvent.click(screen.getByRole('button', { name: 'Draft' }));

  expect(fakeSocket.emit).toHaveBeenCalledWith(
    'draft:pick',
    { leagueId: 3, playerId: 1 },
    expect.any(Function)
  );
});

test('a draft:picked event prepends the new pick, updates who is on the clock, and refetches players', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active' },
      teams: [
        { id: 1, name: 'Team A', owner: 'alice' },
        { id: 2, name: 'Team B', owner: 'bob' },
      ],
      picks: [],
      onTheClock: { id: 1, name: 'Team A', owner: 'alice' },
    })
  );
  apiClient.get.mockClear();
  apiClient.get.mockResolvedValue(playersPage([]));

  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      player: { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'Kansas City Chiefs' },
      nextTeamId: 2,
      draftComplete: false,
      by: { username: 'alice' },
    })
  );

  expect(screen.getByText('#1')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Patrick Mahomes' }).length).toBeGreaterThan(0);
  expect(screen.getByText('On the clock: Team B (bob)')).toBeInTheDocument();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/players', expect.any(Object)));
});

test('a draft:picked event with draftComplete shows the completion banner and marks the league complete', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active' },
      teams: [{ id: 1, name: 'Team A', owner: 'alice' }],
      picks: [],
      onTheClock: { id: 1, name: 'Team A', owner: 'alice' },
    })
  );

  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 15,
      teamId: 1,
      player: { id: 9, name: 'Last Player', position: 'K', nfl_team: 'X' },
      nextTeamId: null,
      draftComplete: true,
      by: { username: 'alice' },
    })
  );

  expect(screen.getByText('Draft complete!')).toBeInTheDocument();
  expect(screen.getByText('complete')).toBeInTheDocument(); // draft_status chip fallback
});

test('a draft:complete event alone also shows the completion banner', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() => fakeSocket.trigger('draft:complete'));

  expect(screen.getByText('Draft complete!')).toBeInTheDocument();
});

test('an error acknowledgment from draft:join is surfaced as an alert', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() => fakeSocket.trigger('connect'));
  const [, , ack] = fakeSocket.emit.mock.calls.find(([event]) => event === 'draft:join');
  act(() => ack({ error: 'you are not in this league' }));

  expect(await screen.findByText('you are not in this league')).toBeInTheDocument();
});

test('an error acknowledgment from draft:pick is surfaced as an alert', async () => {
  renderBoard(1, { user: { id: 5 } });
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', {
      league: { name: 'Sunday Ballers', draft_status: 'active', draft_paused: false },
      teams: [{ id: 1, name: 'Team A', owner: 'alice', owner_id: 5 }],
      picks: [],
      onTheClock: { id: 1, name: 'Team A', owner: 'alice', owner_id: 5 },
    })
  );

  await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
  const [, , ack] = fakeSocket.emit.mock.calls.find(([event]) => event === 'draft:pick');
  act(() => ack({ error: 'it is not your turn to pick' }));

  expect(await screen.findByText('it is not your turn to pick')).toBeInTheDocument();
});

test('changing the position filter refetches available players filtered by position', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  apiClient.get.mockClear();
  apiClient.get.mockResolvedValue(playersPage([]));

  await userEvent.click(screen.getByLabelText('Position'));
  await userEvent.click(await screen.findByRole('option', { name: 'RB' }));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: { page: 1, leagueId: 1, available: true, sort: 'adp', position: 'RB' },
    })
  );
});

test('the position filter offers individual defender positions and filters the draft pool by them', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');
  apiClient.get.mockClear();
  apiClient.get.mockResolvedValue(playersPage([]));

  await userEvent.click(screen.getByLabelText('Position'));
  for (const pos of ['DE', 'DT', 'LB', 'CB', 'S', 'DB']) {
    expect(await screen.findByRole('option', { name: pos })).toBeInTheDocument();
  }
  await userEvent.click(screen.getByRole('option', { name: 'LB' }));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: { page: 1, leagueId: 1, available: true, sort: 'adp', position: 'LB' },
    })
  );
});

test('disconnects the socket on unmount', async () => {
  const { unmount } = renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  unmount();

  expect(fakeSocket.disconnect).toHaveBeenCalled();
});

test('shows a reconnecting indicator on disconnect and hides it once reconnected', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() => fakeSocket.trigger('disconnect'));
  expect(screen.getByText('Reconnecting…')).toBeInTheDocument();

  act(() => fakeSocket.trigger('connect'));
  expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
});

test('re-joins the draft room (and gets a fresh draft:state) when the manager reconnects', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() => fakeSocket.trigger('disconnect'));
  fakeSocket.emit.mockClear();

  act(() => fakeSocket.triggerManager('reconnect'));

  expect(fakeSocket.emit).toHaveBeenCalledWith(
    'draft:join',
    { leagueId: 1 },
    expect.any(Function)
  );
});

// --- Phase 4: pick timer, queue, commissioner controls ---

const activeLeague = (overrides = {}) => ({
  name: 'Sunday Ballers',
  draft_status: 'active',
  pick_time_seconds: 90,
  draft_paused: false,
  pick_deadline_at: null,
  owner_id: 99,
  ...overrides,
});

const stateEvent = (league, extra = {}) => ({
  league,
  teams: [{ id: 1, name: 'Team A', owner: 'alice' }],
  picks: [],
  onTheClock: { id: 1, name: 'Team A', owner: 'alice' },
  ...extra,
});

/** URL-keyed GET mock so the queue and player fetches can differ. */
const mockGets = ({ players = playersPage(), queue = [] } = {}) => {
  apiClient.get.mockImplementation((url) =>
    url === '/api/draft/queue'
      ? Promise.resolve({ data: queue })
      : Promise.resolve(players)
  );
};

test('countdown chip renders from pick_deadline_at and ticks down', async () => {
  jest.useFakeTimers();
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      pick_deadline_at: new Date(Date.now() + 30000).toISOString(),
    })))
  );
  expect(screen.getByText('⏱ 30s')).toBeInTheDocument();

  act(() => {
    jest.advanceTimersByTime(3000);
  });
  expect(screen.getByText('⏱ 27s')).toBeInTheDocument();
});

test('the countdown resets to pick_time_seconds on each draft:picked', async () => {
  jest.useFakeTimers();
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      pick_deadline_at: new Date(Date.now() + 5000).toISOString(),
    }), {
      teams: [
        { id: 1, name: 'Team A', owner: 'alice' },
        { id: 2, name: 'Team B', owner: 'bob' },
      ],
    }))
  );
  expect(screen.getByText('⏱ 5s')).toBeInTheDocument();

  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      player: { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' },
      nextTeamId: 2,
      draftComplete: false,
      by: { username: 'alice' },
    })
  );
  expect(screen.getByText('⏱ 90s')).toBeInTheDocument();
});

test('a paused draft shows the paused chip and disables drafting', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({ draft_paused: true })))
  );

  expect(screen.getByText('Draft Paused')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Draft' })).toBeDisabled();
});

test('the pool Draft button is disabled off-turn and enabled on-turn', async () => {
  renderBoard(1, { user: { id: 5 } });
  await screen.findByText('Patrick Mahomes');

  act(() =>
    fakeSocket.trigger(
      'draft:state',
      stateEvent(activeLeague(), {
        teams: [{ id: 1, name: 'Team A', owner: 'alice', owner_id: 9 }],
        onTheClock: { id: 1, name: 'Team A', owner: 'alice', owner_id: 9 },
      })
    )
  );
  expect(screen.getByRole('button', { name: 'Draft' })).toBeDisabled();

  act(() =>
    fakeSocket.trigger(
      'draft:state',
      stateEvent(activeLeague(), {
        teams: [{ id: 1, name: 'Team A', owner: 'alice', owner_id: 5 }],
        onTheClock: { id: 1, name: 'Team A', owner: 'alice', owner_id: 5 },
      })
    )
  );
  expect(screen.getByRole('button', { name: 'Draft' })).toBeEnabled();
});

test("the queue's top-row Draft button appears only on your turn and drafts queue[0]", async () => {
  mockGets({
    queue: [
      { id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 },
      { id: 3, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', rank: 2 },
    ],
  });
  renderBoard(1, { user: { id: 5 } });
  await screen.findByRole('button', { name: 'Bijan Robinson' });

  const queuePanel = () => screen.getByText('My Queue').closest('.MuiPaper-root');

  // Not my turn: the queue's top row has no quick-draft button.
  act(() =>
    fakeSocket.trigger(
      'draft:state',
      stateEvent(activeLeague(), {
        teams: [{ id: 1, name: 'Team A', owner: 'alice', owner_id: 9 }],
        onTheClock: { id: 1, name: 'Team A', owner: 'alice', owner_id: 9 },
      })
    )
  );
  expect(within(queuePanel()).queryByRole('button', { name: 'Draft' })).not.toBeInTheDocument();

  // My turn: the quick-draft button appears and drafts queue[0] (Bijan Robinson, id 2).
  act(() =>
    fakeSocket.trigger(
      'draft:state',
      stateEvent(activeLeague(), {
        teams: [{ id: 1, name: 'Team A', owner: 'alice', owner_id: 5 }],
        onTheClock: { id: 1, name: 'Team A', owner: 'alice', owner_id: 5 },
      })
    )
  );
  const queueDraftButton = within(queuePanel()).getByRole('button', { name: 'Draft' });
  await userEvent.click(queueDraftButton);

  expect(fakeSocket.emit).toHaveBeenCalledWith(
    'draft:pick',
    { leagueId: 1, playerId: 2 },
    expect.any(Function)
  );
});

test('the queue loads on mount and renders players in rank order', async () => {
  mockGets({
    queue: [
      { id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 },
      { id: 3, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', rank: 2 },
    ],
  });
  renderBoard(1);

  await screen.findByRole('button', { name: 'Bijan Robinson' });
  // Queue names are quick-view buttons; assert both are present in rank order.
  const queued = screen
    .getAllByRole('button', { name: /Bijan Robinson|Justin Jefferson/ })
    .map((b) => b.textContent);
  expect(queued).toEqual(['Bijan Robinson', 'Justin Jefferson']);
  expect(apiClient.get).toHaveBeenCalledWith('/api/draft/queue', { params: { leagueId: 1 } });
});

test('clicking Queue on an available player persists the updated ordered list', async () => {
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  await userEvent.click(screen.getByRole('button', { name: 'Queue' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/draft/queue', {
      leagueId: 1,
      playerIds: [1],
    })
  );
  // Patrick Mahomes now appears both in the available table and the queue.
  expect(screen.getAllByRole('button', { name: 'Patrick Mahomes' })).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Queue' })).toBeDisabled();
});

test('move up and remove reorder the queue and persist it', async () => {
  mockGets({
    queue: [
      { id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 },
      { id: 3, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', rank: 2 },
    ],
  });
  renderBoard(1);
  await screen.findByRole('button', { name: 'Bijan Robinson' });

  await userEvent.click(screen.getAllByLabelText('Move up')[1]);
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/draft/queue', {
      leagueId: 1,
      playerIds: [3, 2],
    })
  );
  const reordered = screen
    .getAllByRole('button', { name: /Bijan Robinson|Justin Jefferson/ })
    .map((b) => b.textContent);
  expect(reordered).toEqual(['Justin Jefferson', 'Bijan Robinson']);

  apiClient.put.mockClear();
  await userEvent.click(screen.getAllByLabelText('Remove from queue')[0]);
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/draft/queue', {
      leagueId: 1,
      playerIds: [2],
    })
  );
});

test('Randomize Draft Order shows only for the commissioner pre-draft and POSTs', async () => {
  const { unmount } = renderBoardWithToasts(1, { user: { id: 7, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      draft_status: 'pending',
      owner_id: 7,
    }), { onTheClock: null }))
  );

  await userEvent.click(screen.getByRole('button', { name: 'Randomize Draft Order' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/order', { randomize: true })
  );
  expect(await screen.findByText('Draft order randomized')).toBeInTheDocument();
  unmount();

  // Non-owner never sees the button
  renderBoard(1, { user: { id: 8, username: 'notcommish' } });
  await screen.findByText('Patrick Mahomes');
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({
      draft_status: 'pending',
      owner_id: 7,
    }), { onTheClock: null }))
  );
  expect(screen.queryByRole('button', { name: 'Randomize Draft Order' })).not.toBeInTheDocument();
});

test('Pause Draft POSTs the toggled paused flag for the commissioner during an active draft', async () => {
  renderBoard(1, { user: { id: 7, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() =>
    fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 7 })))
  );

  await userEvent.click(screen.getByRole('button', { name: 'Pause Draft' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/pause', { paused: true })
  );
});

test('commissioner confirms undo before posting the last-pick rollback', async () => {
  renderBoardWithToasts(1, { user: { id: 99, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99, current_pick: 1 }), {
    picks: [{ pick_number: 1, player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', is_keeper: false }],
  })));

  await userEvent.click(screen.getByRole('button', { name: 'Undo last pick' }));
  expect(screen.getByText('Undo last pick?')).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalledWith('/api/draft/league/1/undo', { count: 1 });
  await userEvent.click(screen.getByRole('button', { name: 'Undo pick' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/undo', { count: 1 }));
  expect(await screen.findByText('Last pick undone')).toBeInTheDocument();
});

test('undo is disabled when the most recent reached pick is a keeper', async () => {
  renderBoard(1, { user: { id: 99, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99, current_pick: 1 }), {
    picks: [{ pick_number: 1, player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', is_keeper: true }],
  })));

  expect(screen.getByRole('button', { name: 'Undo last pick' })).toBeDisabled();
  expect(screen.getByText('Keeper picks cannot be undone.')).toBeInTheDocument();
});

test('reset draft requires the exact league name before calling the destructive endpoint', async () => {
  renderBoardWithToasts(1, { user: { id: 99, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99 }))));

  await userEvent.click(screen.getByRole('button', { name: 'Reset draft' }));
  const reset = screen.getByRole('button', { name: 'Reset draft' });
  expect(reset).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'League name' }), 'Sunday Ballers');
  expect(reset).toBeEnabled();
  await userEvent.click(reset);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/reset', {}));
});

test('commissioner copies a presenter link generated by the share-token endpoint', async () => {
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
  apiClient.post.mockResolvedValue({ data: { url: 'http://localhost:3000/#/present/example-token' } });
  renderBoardWithToasts(1, { user: { id: 99, username: 'commish' } });
  await screen.findByText('Patrick Mahomes');
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ owner_id: 99 }))));

  await userEvent.click(screen.getByRole('button', { name: 'Presenter link' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/share-token', {}));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/#/present/example-token');
  expect(screen.getByRole('textbox', { name: 'Presenter link' })).toHaveValue('http://localhost:3000/#/present/example-token');
});

test('a pending-draft member can toggle readiness and sees the league readiness chips', async () => {
  renderBoardWithToasts(1, { user: { id: 5, username: 'alice' } });
  await screen.findByText('Patrick Mahomes');
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ draft_status: 'pending', owner_id: 99 }), {
    teams: [
      { id: 1, name: 'Team A', owner: 'alice', owner_id: 5, draft_ready: false },
      { id: 2, name: 'Team B', owner: 'bob', owner_id: 6, draft_ready: true },
    ],
    onTheClock: null,
  })));

  expect(screen.getByRole('status')).toHaveTextContent('1 of 2 managers ready');
  expect(screen.getByText('Team B: Ready')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'I am ready for the draft' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/draft/league/1/ready', { ready: true }));
});

test('shows projected points and injury badges in the available players table', async () => {
  apiClient.get.mockResolvedValue(
    playersPage([
      {
        id: 1,
        name: 'Patrick Mahomes',
        position: 'QB',
        nfl_team: 'Kansas City Chiefs',
        projected_points: 21.5,
        injury_status: 'Q',
      },
      { id: 2, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills', projected_points: null, adp: 3.2 },
    ])
  );
  renderBoard(1);

  await screen.findByText('Patrick Mahomes');
  expect(screen.getByText('21.5')).toBeInTheDocument();
  expect(screen.getByText('Q')).toBeInTheDocument();
  expect(screen.getByText('3.2')).toBeInTheDocument(); // Josh Allen's ADP
  expect(screen.getByLabelText(/Season Proj: Projected fantasy points:/)).toBeInTheDocument();
  expect(screen.getAllByText('-').length).toBeGreaterThan(0); // missing proj/adp render as -
  // The name is a quick-view trigger (a button), not a navigation link.
  expect(screen.getByRole('button', { name: 'Patrick Mahomes' })).toBeInTheDocument();
});

test('shows a sortable Pos rank column so IDP players (no ADP) still order sensibly', async () => {
  apiClient.get.mockResolvedValue(
    playersPage([
      // An IDP player: no ADP by design, ranked from last season's points.
      { id: 3, name: 'Jordyn Brooks', position: 'LB', nfl_team: 'DET', adp: null, position_rank: 1, projected_points: 160.2 },
      { id: 4, name: 'Rookie Backer', position: 'LB', nfl_team: 'DAL', adp: null, position_rank: null, projected_points: null },
    ])
  );
  renderBoard(1);

  await screen.findByText('Jordyn Brooks');
  expect(screen.getByText('#1')).toBeInTheDocument();
  expect(screen.getByLabelText(/Pos rank: Position rank:/)).toBeInTheDocument();

  // Clicking the header re-fetches with the server's whitelisted sort key.
  apiClient.get.mockClear();
  await userEvent.click(screen.getByText('Pos rank'));
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: expect.objectContaining({ sort: 'position_rank' }),
    })
  );
});

test('shows each pool player\'s bye week, with an em dash when the schedule is unknown', async () => {
  apiClient.get.mockResolvedValue(
    playersPage([
      { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC', adp: 12.1, position_rank: 1, projected_points: 380.5, bye_week: 10 },
      { id: 2, name: 'Rookie Backer', position: 'LB', nfl_team: 'DAL', adp: null, position_rank: null, projected_points: null, bye_week: null },
    ])
  );
  renderBoard(1);

  await screen.findByText('Patrick Mahomes');
  expect(screen.getByText('Bye')).toBeInTheDocument();
  expect(within(screen.getByText('Patrick Mahomes').closest('tr')).getByText('10')).toBeInTheDocument();
  const rookieCells = within(screen.getByText('Rookie Backer').closest('tr')).getAllByText('-');
  expect(rookieCells.length).toBeGreaterThan(0);
});

test('clicking a player name opens the quick-view dialog and never drafts the player', async () => {
  apiClient.get.mockImplementation((url) =>
    url.endsWith('/summary')
      ? Promise.resolve({
          data: {
            player: { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' },
            currentSeason: null,
            previousSeasons: [],
          },
        })
      : Promise.resolve(playersPage())
  );
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  await userEvent.click(screen.getByRole('button', { name: 'Patrick Mahomes' }));

  // Dialog opened (heading shows the player); no draft:pick was ever emitted.
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(
    fakeSocket.emit.mock.calls.some(([event]) => event === 'draft:pick')
  ).toBe(false);
});

// ---------------------------------------------------------------------------
// My Roster (src/components/RosterPanel/) - the league supplies its own shape.
// ---------------------------------------------------------------------------

/** 12 starters, 7 bench, 1 IR: the server derives roster_limit 20 from these. */
const ROSTER_SLOTS_12 = [
  { key: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', count: 1, eligiblePositions: ['DEF'] },
  { key: 'D LINE', count: 1, eligiblePositions: ['DL'] },
  { key: 'LB', count: 1, eligiblePositions: ['LB'] },
  { key: 'DB', count: 1, eligiblePositions: ['DB'] },
];

const rosterLeague = (overrides = {}) => activeLeague({
  roster_slots: ROSTER_SLOTS_12,
  bench_slots: 7,
  ir_slots: 1,
  roster_limit: 20,
  // leagues.current_pick is 0-based, so this is the third pick overall.
  current_pick: 2,
  draft_rotation: 'snake',
  ...overrides,
});

const rosterTeams = [
  { id: 1, name: 'Team A', owner: 'alice', owner_id: 5, draft_position: 1 },
  { id: 2, name: 'Team B', owner: 'bob', owner_id: 6, draft_position: 2 },
];

const firstPick = {
  pick_number: 1, team_id: 1, player_id: 10,
  name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL',
};

const showRoster = async (picks) => {
  renderBoard(1, { user: { id: 5, username: 'alice' } });
  await screen.findByText('Patrick Mahomes');
  act(() => fakeSocket.trigger('draft:state', stateEvent(rosterLeague(), {
    teams: rosterTeams,
    picks,
    onTheClock: { id: 1, name: 'Team A' },
  })));
};

test('renders the league’s own 12 starter / 7 bench / 1 IR shape in the rail', async () => {
  await showRoster([firstPick]);

  const panel = screen.getByLabelText('My Roster');
  expect(within(panel).getAllByRole('listitem')).toHaveLength(20);
  expect(within(panel).getByLabelText('RB 1 slot, Bijan Robinson, RB, ATL, pick 1.01')).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'Injured reserve' })).getAllByRole('listitem'))
    .toHaveLength(1);
  expect(screen.getByText('1 of 12 starters filled')).toBeInTheDocument();
  // roster_limit 20 equals 12 + 7 + 1, so there is nothing to warn about.
  expect(screen.queryByText(/This draft runs/)).not.toBeInTheDocument();
});

test('names the next pick from the league’s own rotation', async () => {
  await showRoster([firstPick]);
  // Two teams, snake: pick 0 was Team A, 1 and 2 are Team B and... the third
  // pick overall is on the clock, so Team A is next up at 2.02.
  expect(screen.getByText('Next pick 2.02')).toBeInTheDocument();
});

test('skips a keeper the team already holds when naming the next pick', async () => {
  await showRoster([
    firstPick,
    {
      pick_number: 4, team_id: 1, player_id: 11, is_keeper: true,
      name: 'Kept Guy', position: 'WR', nfl_team: 'BUF',
    },
  ]);

  // 2.02 is Team A's next turn by rotation, but a keeper is already sitting on
  // it, so the next pick they actually make is 3.01.
  expect(screen.getByText('Next pick 3.01')).toBeInTheDocument();
  expect(screen.getByText('Keeper')).toBeInTheDocument();
});

test('tags the manager’s own picks in the history with the slot they filled', async () => {
  await showRoster([firstPick]);
  expect(screen.getByText('→ RB 1')).toBeInTheDocument();
});

test('keeps the roster section out of the DOM until the league shape arrives', async () => {
  renderBoardWithToasts(1, { user: { id: 5, username: 'alice' } });
  await screen.findByText('Patrick Mahomes');
  act(() => fakeSocket.trigger('draft:state', stateEvent(activeLeague({ draft_status: 'pending', owner_id: 99 }), {
    teams: [
      { id: 1, name: 'Team A', owner: 'alice', owner_id: 5, draft_ready: false },
      { id: 2, name: 'Team B', owner: 'bob', owner_id: 6, draft_ready: true },
    ],
    onTheClock: null,
  })));

  expect(screen.queryByLabelText('My Roster')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Roster needs')).not.toBeInTheDocument();
  // And the managers-ready line stays the ONE status region: RosterNeedsStrip
  // uses a bare aria-live precisely so this singular query keeps working.
  expect(screen.getByRole('status')).toHaveTextContent('1 of 2 managers ready');
});
