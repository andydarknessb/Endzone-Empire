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

const teamA = { id: 1, name: 'Team A', owner_id: 5 };
const teamB = { id: 2, name: 'Team B', owner_id: 9 };

test('joins the draft room on connect and emits pick over the socket', () => {
  const { result } = renderHook(() => useDraftSocket(1, 5));

  act(() => fakeSocket.trigger('connect'));
  expect(fakeSocket.emit).toHaveBeenCalledWith('draft:join', { leagueId: 1 }, expect.any(Function));

  act(() => result.current.emitPick(42, jest.fn()));
  expect(fakeSocket.emit).toHaveBeenCalledWith('draft:pick', { leagueId: 1, playerId: 42 }, expect.any(Function));
});

test('surfaces a draft:join error acknowledgment', () => {
  const { result } = renderHook(() => useDraftSocket(1, 5));

  act(() => fakeSocket.trigger('connect'));
  const [, , ack] = fakeSocket.emit.mock.calls.find(([event]) => event === 'draft:join');
  act(() => ack({ error: 'you are not in this league' }));

  expect(result.current.error).toBe('you are not in this league');
});

test('calls onPickLanded (fresh callback, no stale closure) whenever a pick lands', () => {
  const onPickLanded = jest.fn();
  const { rerender } = renderHook(({ cb }) => useDraftSocket(1, 5, { onPickLanded: cb }), {
    initialProps: { cb: onPickLanded },
  });

  const laterCallback = jest.fn();
  rerender({ cb: laterCallback });

  act(() =>
    fakeSocket.trigger('draft:picked', {
      pickNumber: 1,
      teamId: 1,
      player: { id: 10, name: 'X', position: 'QB', nfl_team: 'KC' },
      nextTeamId: null,
      draftComplete: false,
      by: {},
    })
  );

  expect(onPickLanded).not.toHaveBeenCalled();
  expect(laterCallback).toHaveBeenCalledTimes(1);
});

test('fires the on-clock alert exactly once per turn, and again once the turn comes back around', () => {
  const { result } = renderHook(() => useDraftSocket(1, 5));

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
      player: { id: 11, name: 'Y', position: 'RB', nfl_team: 'SF' },
      nextTeamId: 1,
      draftComplete: false,
      by: {},
    });
  });
  expect(result.current.isMyTurn).toBe(true);
  expect(result.current.onClockAlertOpen).toBe(true);
});

test('disconnects the socket on unmount', () => {
  const { unmount } = renderHook(() => useDraftSocket(1, 5));
  unmount();
  expect(fakeSocket.disconnect).toHaveBeenCalled();
});
