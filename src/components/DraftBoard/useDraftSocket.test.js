import { renderHook, act } from '@testing-library/react';
import { createDraftSocket, onReconnect } from '../../api/socket';
import useDraftSocket from './useDraftSocket';

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
}));

/** A controllable fake socket: captures .on() handlers so tests can fire them. */
function makeFakeSocket() {
  const handlers = {};
  return {
    on: jest.fn((event, cb) => {
      handlers[event] = cb;
    }),
    io: { on: jest.fn() },
    emit: jest.fn(),
    disconnect: jest.fn(),
    trigger(event, payload) {
      handlers[event]?.(payload);
    },
  };
}

let fakeSocket;

beforeEach(() => {
  fakeSocket = makeFakeSocket();
  createDraftSocket.mockReturnValue(fakeSocket);
  onReconnect.mockReturnValue(() => {});
});

afterEach(() => {
  jest.clearAllMocks();
});

// Team identity on the wire is `teamId` / `teamName` (#113, contract #112);
// `owner_id` is deliberately absent from these fixtures so a test can only
// pass by reading the Team fields.
const teamA = { id: 1, teamId: 1, teamName: 'Team A', name: 'Team A' };
const teamB = { id: 2, teamId: 2, teamName: 'Team B', name: 'Team B' };

/** Answers the `draft:join` acknowledgement the way the server does. */
function ackJoin(viewerTeamId) {
  const call = fakeSocket.emit.mock.calls.find(([event]) => event === 'draft:join');
  act(() => call[2]({ ok: true, viewerTeamId }));
}

test('joins the draft room on connect and emits pick over the socket', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  expect(fakeSocket.emit).toHaveBeenCalledWith('draft:join', { leagueId: 1 }, expect.any(Function));

  act(() => result.current.emitPick(42, jest.fn()));
  expect(fakeSocket.emit).toHaveBeenCalledWith('draft:pick', { leagueId: 1, playerId: 42 }, expect.any(Function));
});

test('surfaces a draft:join error acknowledgment', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  const [, , ack] = fakeSocket.emit.mock.calls.find(([event]) => event === 'draft:join');
  act(() => ack({ error: 'you are not in this league' }));

  expect(result.current.error).toBe('you are not in this league');
  expect(result.current.viewerTeamId).toBe(null);
});

test('takes viewerTeamId from the draft:join acknowledgement, the only per-viewer channel', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  expect(result.current.viewerTeamId).toBe(null);

  ackJoin(2);
  expect(result.current.viewerTeamId).toBe(2);
});

test('a viewer with no team in this league reads back a null viewerTeamId and is never on the clock', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(null);
  act(() => {
    fakeSocket.trigger('draft:state', {
      league: { draft_status: 'active' },
      teams: [teamA, teamB],
      picks: [],
      onTheClock: teamA,
    });
  });

  expect(result.current.viewerTeamId).toBe(null);
  expect(result.current.isMyTurn).toBe(false);
});

test('calls onPickLanded (fresh callback, no stale closure) whenever a pick lands', () => {
  const onPickLanded = jest.fn();
  const { rerender } = renderHook(({ cb }) => useDraftSocket(1, { onPickLanded: cb }), {
    initialProps: { cb: onPickLanded },
  });

  const laterCallback = jest.fn();
  rerender({ cb: laterCallback });

  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      teamName: 'Team A',
      player: { id: 10, name: 'X', position: 'QB', nfl_team: 'KC' },
      nextTeamId: null,
      draftComplete: false,
      by: {},
    })
  );

  expect(onPickLanded).not.toHaveBeenCalled();
  expect(laterCallback).toHaveBeenCalledTimes(1);
});

test('a landed pick enters history attributed by Team, carrying no account identity', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1);
  act(() => {
    fakeSocket.trigger('draft:state', {
      league: { draft_status: 'active' },
      teams: [teamA, teamB],
      picks: [],
      onTheClock: teamA,
    });
  });
  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      teamName: 'Team A',
      player: { id: 10, name: 'X', position: 'QB', nfl_team: 'KC' },
      nextTeamId: 2,
      draftComplete: false,
      by: { userId: 5, username: 'alice', auto: true },
    })
  );

  const [pick] = result.current.picks;
  expect(pick).toEqual({
    pick_number: 1,
    teamId: 1,
    teamName: 'Team A',
    player_id: 10,
    name: 'X',
    position: 'QB',
    nfl_team: 'KC',
    auto: true,
  });
  // `by` carried the picking manager's username and account id; only the
  // autopick flag survives into client state (#113 acceptance criterion 4).
  expect(pick).not.toHaveProperty('by');
});

test('fires the on-clock alert exactly once per turn, and again once the turn comes back around', () => {
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1);

  act(() => {
    fakeSocket.trigger('draft:state', {
      league: { draft_status: 'active' },
      teams: [teamA, teamB],
      picks: [],
      onTheClock: teamA,
    });
  });
  expect(result.current.isMyTurn).toBe(true);
  expect(result.current.onClockAlertOpen).toBe(true);

  act(() => result.current.dismissOnClockAlert());
  expect(result.current.onClockAlertOpen).toBe(false);

  // Another state push while it's still my turn must not reopen the alert.
  act(() => {
    fakeSocket.trigger('draft:state', {
      league: { draft_status: 'active' },
      teams: [teamA, teamB],
      picks: [],
      onTheClock: teamA,
    });
  });
  expect(result.current.onClockAlertOpen).toBe(false);

  // Turn passes to the other team.
  act(() => {
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      teamName: 'Team A',
      player: { id: 10, name: 'X', position: 'QB', nfl_team: 'KC' },
      nextTeamId: 2,
      draftComplete: false,
      by: {},
    });
  });
  expect(result.current.isMyTurn).toBe(false);
  expect(result.current.onClockAlertOpen).toBe(false);

  // ...and comes back to me: a new false -> true edge should re-fire the alert.
  act(() => {
    fakeSocket.trigger('draft:picked', {
      pickNumber: 2,
      teamId: 2,
      teamName: 'Team B',
      player: { id: 11, name: 'Y', position: 'RB', nfl_team: 'SF' },
      nextTeamId: 1,
      draftComplete: false,
      by: {},
    });
  });
  expect(result.current.isMyTurn).toBe(true);
  expect(result.current.onClockAlertOpen).toBe(true);
});

test('re-joining after a reconnect refreshes viewerTeamId from the new acknowledgement', () => {
  let reconnectHandler;
  onReconnect.mockImplementation((socket, handler) => {
    reconnectHandler = handler;
    return () => {};
  });
  const { result } = renderHook(() => useDraftSocket(1));

  act(() => fakeSocket.trigger('connect'));
  ackJoin(1);
  expect(result.current.viewerTeamId).toBe(1);

  act(() => reconnectHandler());
  const joins = fakeSocket.emit.mock.calls.filter(([event]) => event === 'draft:join');
  expect(joins).toHaveLength(2);
  act(() => joins[1][2]({ ok: true, viewerTeamId: 7 }));
  expect(result.current.viewerTeamId).toBe(7);
});

test('disconnects the socket on unmount', () => {
  const { unmount } = renderHook(() => useDraftSocket(1));
  unmount();
  expect(fakeSocket.disconnect).toHaveBeenCalled();
});
