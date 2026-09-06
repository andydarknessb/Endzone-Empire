import { renderHook, act, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import supabase from '../../../api/supabaseClient';
import { useMatchup } from './useMatchup';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// The anon Supabase client, the entity's one reader of live_game_states (#885):
// the same test double the per-game hook used to be driven through.
jest.mock('../../../api/supabaseClient', () => ({
  __esModule: true,
  default: {
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

// `rows` answer the initial read (filtered to the asked ids, as the query
// would); `push` delivers one realtime UPDATE payload to the channel handler.
function installLiveGames(rows) {
  const inFn = jest.fn().mockImplementation((column, ids) => Promise.resolve({
    data: rows.filter((r) => ids.includes(String(r.tank01_game_id))),
    error: null,
  }));
  supabase.from.mockReturnValue({ select: jest.fn().mockReturnValue({ in: inFn }) });
  let handler = null;
  const channelObj = {
    on: jest.fn((_event, _filter, cb) => { handler = cb; return channelObj; }),
    subscribe: jest.fn(() => channelObj),
  };
  supabase.channel.mockReturnValue(channelObj);
  return { inFn, channelObj, push: (payload) => act(() => { handler?.(payload); }) };
}

const game = (id, game_status, extra = {}) => ({ tank01_game_id: id, game_status, ...extra });

// Drive the live feed through the app's own socket factory hook
// (window.__ENDZONE_TEST_SOCKET_FACTORY__, src/api/socket.js): the entity's
// score feed builds its socket through createDraftSocket, so installing this
// factory hands the feed a controllable fake, exactly as the Game Center page
// test does (src/pages/game-center).
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
  installLiveGames([]);
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

// ---------------------------------------------------------------------------
// #885: one realtime subscription for the games a Matchup spans.
// ---------------------------------------------------------------------------

const detailWithGames = (nflGameIds) => {
  const body = detailBody();
  body.data.nflGameIds = nflGameIds;
  return body;
};

// Red-tell: opening one channel per id turns this case red and no other.
test('one channel is opened for two in-progress games, not two', async () => {
  apiClient.get.mockResolvedValue(detailWithGames(['g1', 'g2']));
  const { inFn, channelObj } = installLiveGames([game('g1', 'in_progress'), game('g2', 'in_progress')]);

  const { result } = renderHook(() => useMatchup(1, 9));
  await waitFor(() => expect(result.current.matchup?.games).toHaveLength(2));

  // One initial read of every listed game, one channel over both.
  expect(inFn).toHaveBeenCalledTimes(1);
  expect(inFn).toHaveBeenCalledWith('tank01_game_id', ['g1', 'g2']);
  expect(supabase.channel).toHaveBeenCalledTimes(1);
  expect(channelObj.on).toHaveBeenCalledTimes(1);
  expect(channelObj.on).toHaveBeenCalledWith(
    'postgres_changes',
    expect.objectContaining({ table: 'live_game_states', filter: 'tank01_game_id=in.(g1,g2)' }),
    expect.any(Function)
  );
  expect(result.current.matchup.games.map((g) => g.tank01_game_id)).toEqual(['g1', 'g2']);
});

test('a pushed update moves the game row, and the channel closes after the last listed game reports final', async () => {
  apiClient.get.mockResolvedValue(detailWithGames(['g1', 'g2']));
  const { push } = installLiveGames([game('g1', 'in_progress'), game('g2', 'in_progress')]);

  const { result } = renderHook(() => useMatchup(1, 9));
  await waitFor(() => expect(result.current.matchup?.games).toHaveLength(2));

  push({ new: game('g1', 'in_progress', { current_score_home: 7 }) });
  expect(result.current.matchup.games[0].current_score_home).toBe(7);
  expect(supabase.removeChannel).not.toHaveBeenCalled();

  push({ new: game('g1', 'final') });
  expect(supabase.removeChannel).not.toHaveBeenCalled();

  push({ new: game('g2', 'final') });
  expect(result.current.matchup.games.map((g) => g.game_status)).toEqual(['final', 'final']);
  expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
});

test('a game already final at the initial read is never subscribed to', async () => {
  apiClient.get.mockResolvedValue(detailWithGames(['done', 'live']));
  const { channelObj } = installLiveGames([game('done', 'final'), game('live', 'in_progress')]);

  const { result } = renderHook(() => useMatchup(1, 9));
  await waitFor(() => expect(result.current.matchup?.games).toHaveLength(2));

  expect(supabase.channel).toHaveBeenCalledTimes(1);
  expect(channelObj.on).toHaveBeenCalledWith(
    'postgres_changes',
    expect.objectContaining({ filter: 'tank01_game_id=in.(live)' }),
    expect.any(Function)
  );
});

test('no channel opens when every listed game is final', async () => {
  apiClient.get.mockResolvedValue(detailWithGames(['a', 'b']));
  installLiveGames([game('a', 'final'), game('b', 'final')]);
  const { result } = renderHook(() => useMatchup(1, 9));
  await waitFor(() => expect(result.current.matchup?.games).toHaveLength(2));
  expect(supabase.channel).not.toHaveBeenCalled();
});

// A page opened before kickoff: every listed game is still scheduled, and the
// one channel opens over them so the first in-progress update reaches the
// strip without a reload. Red-tell: gating the channel on an in-progress row
// turns this red and no other.
test('a scheduled-only set opens the one channel over every listed game, and an update moves it to in progress', async () => {
  apiClient.get.mockResolvedValue(detailWithGames(['c', 'd']));
  const { channelObj, push } = installLiveGames([game('c', 'scheduled'), game('d', 'scheduled')]);
  const { result } = renderHook(() => useMatchup(1, 9));
  await waitFor(() => expect(result.current.matchup?.games).toHaveLength(2));
  expect(supabase.channel).toHaveBeenCalledTimes(1);
  expect(channelObj.on).toHaveBeenCalledWith(
    'postgres_changes',
    expect.objectContaining({ filter: 'tank01_game_id=in.(c,d)' }),
    expect.any(Function)
  );
  push({ new: game('c', 'in_progress', { quarter: 'Q1', time_remaining: '14:52' }) });
  expect(result.current.matchup.games[0].game_status).toBe('in_progress');
});

test('a failed initial read leaves the games empty and logs a warning, never throws', async () => {
  apiClient.get.mockResolvedValue(detailWithGames(['x']));
  const inFn = jest.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } });
  supabase.from.mockReturnValue({ select: jest.fn().mockReturnValue({ in: inFn }) });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const { result } = renderHook(() => useMatchup(1, 9));
  await waitFor(() => expect(result.current.matchup).not.toBeNull());
  await waitFor(() => expect(warn).toHaveBeenCalled());
  expect(result.current.matchup.games).toEqual([]);
  expect(supabase.channel).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('the channel is closed on unmount', async () => {
  apiClient.get.mockResolvedValue(detailWithGames(['g1']));
  installLiveGames([game('g1', 'in_progress')]);

  const { result, unmount } = renderHook(() => useMatchup(1, 9));
  await waitFor(() => expect(result.current.matchup?.games).toHaveLength(1));
  expect(supabase.channel).toHaveBeenCalledTimes(1);

  unmount();
  expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
});
