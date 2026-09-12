import { renderHook, act } from '@testing-library/react';
import { useLiveScores } from './useLiveScores';

/**
 * #1241 AC2: live points via the existing scores socket. Drives the feed
 * through the app's own socket factory hook
 * (window.__ENDZONE_TEST_SOCKET_FACTORY__, src/api/socket.js), the same
 * seam useMatchup.test.js and the page tests use, rather than a real
 * socket.io-client connection.
 */
function makeFakeSocket() {
  const handlers = {};
  const ioHandlers = {};
  return {
    emit: jest.fn(),
    on: jest.fn((event, cb) => { handlers[event] = cb; }),
    io: {
      on: jest.fn((event, cb) => { ioHandlers[event] = cb; }),
      off: jest.fn(),
    },
    disconnect: jest.fn(),
    fire: (event, payload) => handlers[event]?.(payload),
    reconnect: () => ioHandlers.reconnect?.(),
  };
}

let socket;

beforeEach(() => {
  socket = undefined;
  window.__ENDZONE_TEST_SOCKET_FACTORY__ = () => {
    socket = makeFakeSocket();
    return socket;
  };
});

afterEach(() => {
  delete window.__ENDZONE_TEST_SOCKET_FACTORY__;
});

const rawLineup = (entries) => ({ week: 4, entries });

test('a plays delta patches the matching entry\'s actualPoints, summed per player', () => {
  const setRaw = jest.fn();
  renderHook(() => useLiveScores({ leagueId: 1, setRaw, refetch: jest.fn() }));

  act(() => {
    socket.fire('scores:updated', {
      scored: [{ matchupId: 55, homeScore: 20, awayScore: 10 }],
      plays: [
        { playerId: 2, pointsDelta: 6, isTouchdown: true },
        { playerId: 2, pointsDelta: 2, isTouchdown: false },
      ],
    });
  });

  expect(setRaw).toHaveBeenCalledTimes(1);
  const updater = setRaw.mock.calls[0][0];
  const next = updater(rawLineup([{ id: 2, actualPoints: 4 }, { id: 3, actualPoints: 1 }]));
  expect(next.entries).toEqual([{ id: 2, actualPoints: 12 }, { id: 3, actualPoints: 1 }]);
});

test('a play for a player not in the lineup is a no-op: the same raw object comes back', () => {
  const setRaw = jest.fn();
  renderHook(() => useLiveScores({ leagueId: 1, setRaw, refetch: jest.fn() }));

  act(() => {
    socket.fire('scores:updated', { scored: [], plays: [{ playerId: 999, pointsDelta: 6 }] });
  });

  const updater = setRaw.mock.calls[0][0];
  const prev = rawLineup([{ id: 2, actualPoints: 4 }]);
  expect(updater(prev)).toBe(prev);
});

test('an event with no plays never calls setRaw, but still records scoreEvent for the strip', () => {
  const setRaw = jest.fn();
  const { result } = renderHook(() => useLiveScores({ leagueId: 1, setRaw, refetch: jest.fn() }));

  act(() => {
    socket.fire('scores:updated', { scored: [{ matchupId: 55, homeScore: 7, awayScore: 0 }], plays: [] });
  });

  expect(setRaw).not.toHaveBeenCalled();
  expect(result.current.scoreEvent).toEqual({ scored: [{ matchupId: 55, homeScore: 7, awayScore: 0 }], plays: [] });
});

test('a reconnect resync clears scoreEvent and refetches the lineup', () => {
  const refetch = jest.fn();
  const { result } = renderHook(() => useLiveScores({ leagueId: 1, setRaw: jest.fn(), refetch }));

  act(() => {
    socket.fire('scores:updated', { scored: [{ matchupId: 55, homeScore: 7, awayScore: 0 }], plays: [] });
  });
  expect(result.current.scoreEvent).not.toBeNull();

  act(() => socket.reconnect());

  expect(refetch).toHaveBeenCalledTimes(1);
  expect(result.current.scoreEvent).toBeNull();
});

test('no leagueId subscribes to nothing', () => {
  renderHook(() => useLiveScores({ leagueId: null, setRaw: jest.fn(), refetch: jest.fn() }));
  expect(socket).toBeUndefined();
});
