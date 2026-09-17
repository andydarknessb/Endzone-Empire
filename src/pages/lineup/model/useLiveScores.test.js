import { useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useLiveScores } from './useLiveScores';

/**
 * #1241 AC2: live points via the existing scores socket. Drives the feed
 * through the app's own socket factory hook
 * (window.__ENDZONE_TEST_SOCKET_FACTORY__, src/api/socket.js), the same
 * seam useMatchup.test.js and the page tests use, rather than a real
 * socket.io-client connection.
 *
 * #1546 (Ruling item d): these tests drive the hook through a harness that
 * holds REAL state (`useState`, under `renderHook`) rather than a plucked
 * `setRaw` updater function - assertions read the resulting `raw` the same
 * way a real consumer (`useLineupData.js`) would, so the week guard living
 * inside the updater is exercised the same way it runs in the app.
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

const rawLineup = (entries, week = 4) => ({ week, entries });

function useHarness({ leagueId, initialRaw, refetch }) {
  const [raw, setRaw] = useState(initialRaw);
  const { scoreEvent } = useLiveScores({ leagueId, setRaw, refetch });
  return { raw, scoreEvent };
}

test('a plays delta patches the matching entry\'s actualPoints, summed per player', () => {
  const { result } = renderHook(() =>
    useHarness({
      leagueId: 1,
      initialRaw: rawLineup([{ id: 2, actualPoints: 4 }, { id: 3, actualPoints: 1 }]),
      refetch: jest.fn(),
    })
  );

  act(() => {
    socket.fire('scores:updated', {
      week: 4,
      scored: [{ matchupId: 55, homeScore: 20, awayScore: 10 }],
      plays: [
        { playerId: 2, pointsDelta: 6, isTouchdown: true },
        { playerId: 2, pointsDelta: 2, isTouchdown: false },
      ],
    });
  });

  expect(result.current.raw.entries).toEqual([{ id: 2, actualPoints: 12 }, { id: 3, actualPoints: 1 }]);
});

// Regression: one `scores:updated` event can carry plays from MORE THAN ONE
// live sync for the same player - liveBoxPoll's rescore gate (createRescoreGate)
// buckets a league's plays across 30s engine ticks and flushes on a 60s floor,
// so a kicker's FG at tick 1 and XP at tick 2 can both ride the same event.
// Each play's pointsDelta is that sync's own marginal share (server's
// attributePlayPoints), not the player's whole change repeated, so the client
// MUST keep summing per player - deduping to "first play wins" silently drops
// the later sync's points. Do not "fix" this back to a dedupe.
test('two plays for the same player with different deltas in one event still sum (rescore-gate plays are incremental, not repeated)', () => {
  const { result } = renderHook(() =>
    useHarness({
      leagueId: 1,
      initialRaw: rawLineup([{ id: 2, actualPoints: 4 }, { id: 3, actualPoints: 1 }]),
      refetch: jest.fn(),
    })
  );

  act(() => {
    socket.fire('scores:updated', {
      week: 4,
      scored: [{ matchupId: 55, homeScore: 20, awayScore: 10 }],
      plays: [
        { playerId: 2, pointsDelta: 3, isTouchdown: false },
        { playerId: 2, pointsDelta: 1, isTouchdown: false },
      ],
    });
  });

  expect(result.current.raw.entries).toEqual([{ id: 2, actualPoints: 8 }, { id: 3, actualPoints: 1 }]);
});

test('a play for a player not in the lineup is a no-op: raw keeps its identity', () => {
  const { result } = renderHook(() =>
    useHarness({ leagueId: 1, initialRaw: rawLineup([{ id: 2, actualPoints: 4 }]), refetch: jest.fn() })
  );
  const before = result.current.raw;

  act(() => {
    socket.fire('scores:updated', { week: 4, scored: [], plays: [{ playerId: 999, pointsDelta: 6 }] });
  });

  expect(result.current.raw).toBe(before);
});

test('an event with no plays leaves raw unchanged, but still records scoreEvent for the strip', () => {
  const { result } = renderHook(() =>
    useHarness({ leagueId: 1, initialRaw: rawLineup([{ id: 2, actualPoints: 4 }]), refetch: jest.fn() })
  );
  const before = result.current.raw;

  act(() => {
    socket.fire('scores:updated', { week: 4, scored: [{ matchupId: 55, homeScore: 7, awayScore: 0 }], plays: [] });
  });

  expect(result.current.raw).toBe(before);
  expect(result.current.scoreEvent).toEqual({ week: 4, scored: [{ matchupId: 55, homeScore: 7, awayScore: 0 }], plays: [] });
});

// #1546 Red-tell: a score event stamped for a week other than the one on
// screen changes nothing - the week guard lives inside the `setRaw`
// updater, keyed on the event's own `week` against `prev.week`.
test('a play whose event week does not match the lineup on screen is a no-op', () => {
  const { result } = renderHook(() =>
    useHarness({
      leagueId: 1,
      initialRaw: rawLineup([{ id: 2, actualPoints: 4 }], 4),
      refetch: jest.fn(),
    })
  );
  const before = result.current.raw;

  act(() => {
    socket.fire('scores:updated', {
      week: 3,
      scored: [],
      plays: [{ playerId: 2, pointsDelta: 6, isTouchdown: true }],
    });
  });

  expect(result.current.raw).toBe(before);
  expect(result.current.raw.entries).toEqual([{ id: 2, actualPoints: 4 }]);
});

// The server always stamps a week, but a defensive read never assumes it:
// an event with no `week` field at all reads as a mismatch, same as a wrong
// one, rather than patching whatever week happens to be on screen.
test('a play on an event with no week field at all is a no-op', () => {
  const { result } = renderHook(() =>
    useHarness({ leagueId: 1, initialRaw: rawLineup([{ id: 2, actualPoints: 4 }], 4), refetch: jest.fn() })
  );
  const before = result.current.raw;

  act(() => {
    socket.fire('scores:updated', { scored: [], plays: [{ playerId: 2, pointsDelta: 6, isTouchdown: true }] });
  });

  expect(result.current.raw).toBe(before);
  expect(result.current.raw.entries).toEqual([{ id: 2, actualPoints: 4 }]);
});

test('a reconnect resync clears scoreEvent and refetches the lineup silently', () => {
  const refetch = jest.fn();
  const { result } = renderHook(() => useHarness({ leagueId: 1, initialRaw: rawLineup([]), refetch }));

  act(() => {
    socket.fire('scores:updated', { week: 4, scored: [{ matchupId: 55, homeScore: 7, awayScore: 0 }], plays: [] });
  });
  expect(result.current.scoreEvent).not.toBeNull();

  act(() => socket.reconnect());

  expect(refetch).toHaveBeenCalledTimes(1);
  expect(refetch).toHaveBeenCalledWith({ silent: true });
  expect(result.current.scoreEvent).toBeNull();
});

test('no leagueId subscribes to nothing', () => {
  renderHook(() => useHarness({ leagueId: null, initialRaw: rawLineup([]), refetch: jest.fn() }));
  expect(socket).toBeUndefined();
});
