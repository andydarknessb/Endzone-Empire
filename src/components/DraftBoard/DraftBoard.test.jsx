import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket } from '../../api/socket';
import DraftBoard from './DraftBoard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
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

const renderBoard = (leagueId = 1) =>
  renderWithProviders(<DraftBoard />, {
    path: '/league/:leagueId/draft',
    route: `/league/${leagueId}/draft`,
  });

let fakeSocket;

beforeEach(() => {
  fakeSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(fakeSocket);
  apiClient.get.mockResolvedValue(playersPage());
});

afterEach(() => {
  jest.clearAllMocks();
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
