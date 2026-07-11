import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket } from '../../api/socket';
import DraftBoard from './DraftBoard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
}));

/** A controllable fake socket: captures .on() handlers so tests can fire them. */
function makeFakeSocket() {
  const handlers = {};
  return {
    on: jest.fn((event, cb) => {
      handlers[event] = cb;
    }),
    emit: jest.fn(),
    disconnect: jest.fn(),
    trigger(event, payload) {
      if (handlers[event]) handlers[event](payload);
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

let fakeSocket;

beforeEach(() => {
  fakeSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(fakeSocket);
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
  expect(screen.getByText('Josh Allen (QB)')).toBeInTheDocument();
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
  renderBoard(3);
  await screen.findByText('Patrick Mahomes');

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
  expect(screen.getByText('Patrick Mahomes (QB)')).toBeInTheDocument();
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
  renderBoard(1);
  await screen.findByText('Patrick Mahomes');

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
      params: { page: 1, leagueId: 1, available: true, position: 'RB' },
    })
  );
});

test('disconnects the socket on unmount', async () => {
  const { unmount } = renderBoard(1);
  await screen.findByText('Patrick Mahomes');

  unmount();

  expect(fakeSocket.disconnect).toHaveBeenCalled();
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

test('the queue loads on mount and renders players in rank order', async () => {
  mockGets({
    queue: [
      { id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', rank: 1 },
      { id: 3, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', rank: 2 },
    ],
  });
  renderBoard(1);

  expect(await screen.findByText('1. Bijan Robinson (RB)')).toBeInTheDocument();
  expect(screen.getByText('2. Justin Jefferson (WR)')).toBeInTheDocument();
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
  expect(screen.getByText('1. Patrick Mahomes (QB)')).toBeInTheDocument();
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
  await screen.findByText('1. Bijan Robinson (RB)');

  await userEvent.click(screen.getAllByLabelText('Move up')[1]);
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/draft/queue', {
      leagueId: 1,
      playerIds: [3, 2],
    })
  );
  expect(screen.getByText('1. Justin Jefferson (WR)')).toBeInTheDocument();

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
  const { unmount } = renderBoard(1, { user: { id: 7, username: 'commish' } });
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
