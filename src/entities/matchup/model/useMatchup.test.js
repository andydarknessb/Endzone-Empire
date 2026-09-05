import { renderHook, act, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useMatchup } from './useMatchup';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// Drive the live feed through the app's own socket factory hook
// (window.__ENDZONE_TEST_SOCKET_FACTORY__, src/api/socket.js): the entity's
// score feed builds its socket through createDraftSocket, so installing this
// factory hands the feed a controllable fake, exactly as GameCenter's test does.
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

// The detail body: { matchup, home, away }, score on the matchup, identity and
// figures on the per-side objects (the shape matchupFromDetailBody reads).
const detailBody = () => ({
  data: {
    viewerTeamId: 10,
    matchup: { id: 9, season: 2026, week: 3, final: false, status: 'live', home_score: 41.2, away_score: 55.9 },
    home: { teamId: 10, name: 'Home Town', expectedFinal: 104.6, playersRemaining: 5, starters: [], bench: [] },
    away: { teamId: 20, name: 'Away Days', expectedFinal: 131.3, playersRemaining: 4, starters: [], bench: [] },
  },
});

beforeEach(() => {
  window.__ENDZONE_TEST_SOCKET_FACTORY__ = () => {
    socket = makeFakeSocket();
    return socket;
  };
});

afterEach(() => {
  delete window.__ENDZONE_TEST_SOCKET_FACTORY__;
  jest.clearAllMocks();
});

test('fetches the single-matchup detail body and never the list', async () => {
  apiClient.get.mockResolvedValue(detailBody());

  const { result } = renderHook(() => useMatchup(1, 9));

  await waitFor(() => expect(result.current.matchup).not.toBeNull());
  // The one read is the detail body, mapped to the model's one shape.
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/matchups/9');
  expect(result.current.matchup.home.score).toBe(41.2);
  expect(result.current.matchup.status).toBe('live');
  // A single-Matchup surface never reads the league's whole list.
  const readList = apiClient.get.mock.calls.some(
    ([u]) => /\/matchups$/.test(u) || u.includes('/matchups?')
  );
  expect(readList).toBe(false);
});

test('a reconnect resync refetches the detail body', async () => {
  apiClient.get.mockResolvedValue(detailBody());

  const { result } = renderHook(() => useMatchup(1, 9));
  await waitFor(() => expect(result.current.matchup).not.toBeNull());
  const before = apiClient.get.mock.calls.length;

  act(() => { socket.reconnect(); });

  await waitFor(() => expect(apiClient.get.mock.calls.length).toBeGreaterThan(before));
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/league/1/matchups/9');
});

// A detail body carrying real starters, so the paired-row behaviour has
// something to pair.
const detailWithStarters = () => ({
  data: {
    viewerTeamId: 10,
    matchup: { id: 9, season: 2026, week: 3, final: false, status: 'live', home_score: 41.2, away_score: 55.9 },
    home: {
      teamId: 10, name: 'Home Town', expectedFinal: 104.6, playersRemaining: 5,
      starters: [
        { id: 1, name: 'Josh Allen', slot: 'QB', points: 20 },
        { id: 2, name: 'Myles Garrett', slot: 'DL', points: 8 },
      ],
      bench: [],
    },
    away: {
      teamId: 20, name: 'Away Days', expectedFinal: 131.3, playersRemaining: 4,
      starters: [
        { id: 3, name: 'Jalen Hurts', slot: 'QB', points: 18 },
      ],
      bench: [],
    },
  },
});

test('exposes paired starter rows in the league slot order once the order is known', async () => {
  apiClient.get.mockResolvedValue(detailWithStarters());

  const { result } = renderHook(() => useMatchup(1, 9, { slotOrder: ['QB', 'DL'] }));

  await waitFor(() => expect(result.current.matchup).not.toBeNull());
  expect(result.current.starterRows.map((r) => [r.slot, r.home?.name ?? null, r.away?.name ?? null])).toEqual([
    ['QB', 'Josh Allen', 'Jalen Hurts'],
    ['DL', 'Myles Garrett', null],
  ]);
});

test('refuses to pair without the league slot order, so no render pairs against a default', async () => {
  apiClient.get.mockResolvedValue(detailWithStarters());

  const { result } = renderHook(() => useMatchup(1, 9));

  await waitFor(() => expect(result.current.matchup).not.toBeNull());
  // The starters loaded, but with no slot order there are no rows - the lineup
  // view renders nothing until the league arrives.
  expect(result.current.starterRows).toEqual([]);
});

test('an optimistic per-starter bump reaches the paired rows without a refetch', async () => {
  apiClient.get.mockResolvedValue(detailWithStarters());

  const { result } = renderHook(() => useMatchup(1, 9, { slotOrder: ['QB', 'DL'] }));
  await waitFor(() => expect(result.current.matchup).not.toBeNull());
  const before = apiClient.get.mock.calls.length;

  act(() => {
    socket.fire('scores:updated', {
      scored: [{ matchupId: 9, homeScore: 47.2, awayScore: 55.9 }],
      plays: [{ playerId: 1, pointsDelta: 6 }],
    });
  });

  const qbRow = result.current.starterRows.find((r) => r.slot === 'QB');
  expect(qbRow.home.points).toBe(26);
  expect(apiClient.get.mock.calls.length).toBe(before);
});

test('a live score event for this matchup moves the model without a refetch', async () => {
  apiClient.get.mockResolvedValue(detailBody());

  const { result } = renderHook(() => useMatchup(1, 9));
  await waitFor(() => expect(result.current.matchup).not.toBeNull());
  const before = apiClient.get.mock.calls.length;

  act(() => {
    socket.fire('scores:updated', {
      scored: [{ matchupId: 9, homeScore: 60, awayScore: 58, status: 'played', homePlayersRemaining: 0 }],
    });
  });

  expect(result.current.matchup.home.score).toBe(60);
  expect(result.current.matchup.status).toBe('played');
  // The model moved from the event alone; no second fetch was needed.
  expect(apiClient.get.mock.calls.length).toBe(before);
});
