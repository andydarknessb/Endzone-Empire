import { renderHook, act, waitFor } from '@testing-library/react';
import apiClient from '../../api/apiClient';
import { onReconnect } from '../../api/socket';
import useDraftRoomFeed from './useDraftRoomFeed';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  onReconnect: jest.fn(),
}));

function makeFakeSocket() {
  const handlers = {};
  return {
    on: jest.fn((event, cb) => { handlers[event] = cb; }),
    off: jest.fn((event) => { delete handlers[event]; }),
    emit: jest.fn(),
    io: { on: jest.fn(), off: jest.fn() },
    trigger(event, payload) { handlers[event]?.(payload); },
    hasHandler(event) { return Boolean(handlers[event]); },
  };
}

const chatEntry = (overrides = {}) => ({
  type: 'league_chat', id: 1, seq: 1, teamId: 11, teamName: 'Anvils',
  message: 'hello', created_at: '2026-01-01T12:00:00Z', ...overrides,
});
const pickEntry = (overrides = {}) => ({
  type: 'draft_activity', kind: 'pick', id: 1, seq: 2, teamId: 12, teamName: 'Bulldogs',
  player: { id: 500, name: 'Pat Mahomes', position: 'QB', nflTeam: 'KC' },
  round: 1, pickNumber: 1, isAutopick: false, created_at: '2026-01-01T12:01:00Z', ...overrides,
});

let socket;
let reconnectHandlers;

beforeEach(() => {
  socket = makeFakeSocket();
  reconnectHandlers = [];
  onReconnect.mockImplementation((s, handler) => {
    reconnectHandlers.push(handler);
    return () => { reconnectHandlers = reconnectHandlers.filter((h) => h !== handler); };
  });
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { ok: true } });
});

afterEach(() => jest.clearAllMocks());

test('loads the combined feed from the draft-feed endpoint', async () => {
  apiClient.get.mockResolvedValue({ data: [chatEntry(), pickEntry()] });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));

  await waitFor(() => expect(result.current.entries).toHaveLength(2));
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/3/draft-feed');
});

test('interleaves live chat and Pick activity in one deterministic seq order (#435 AC4)', async () => {
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toEqual([]));

  // Arrive out of seq order: the Pick (seq 3) before the chat (seq 2).
  act(() => socket.trigger('draft:picked', { auto: false, activity: pickEntry({ seq: 3 }) }));
  act(() => socket.trigger('chat:message', chatEntry({ seq: 2, message: 'nice' })));

  // The feed is ordered by the shared sequence regardless of arrival order.
  expect(result.current.entries.map((e) => e.seq)).toEqual([2, 3]);
  expect(result.current.entries.map((e) => e.type)).toEqual(['league_chat', 'draft_activity']);
});

test('a Pick echo delivered twice is not doubled (dedup by seq)', async () => {
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toEqual([]));

  const activity = pickEntry({ seq: 5 });
  act(() => socket.trigger('draft:picked', { auto: false, activity }));
  act(() => socket.trigger('draft:picked', { auto: false, activity }));

  expect(result.current.entries.filter((e) => e.type === 'draft_activity')).toHaveLength(1);
});

test('a draft:picked without an activity entry appends nothing', async () => {
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toEqual([]));

  act(() => socket.trigger('draft:picked', { auto: false, activity: null }));
  expect(result.current.entries).toEqual([]);
});

test('marks chat read when a human message arrives, so the badge stays honest', async () => {
  renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(socket.hasHandler('chat:message')).toBe(true));

  act(() => socket.trigger('chat:message', chatEntry({ seq: 2 })));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/league/3/chat/read'));
});

test('pages older entries by the oldest held seq and prepends them', async () => {
  apiClient.get.mockResolvedValueOnce({ data: [chatEntry({ id: 10, seq: 5 })] });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toHaveLength(1));

  apiClient.get.mockResolvedValueOnce({ data: [chatEntry({ id: 8, seq: 4, message: 'older' })] });
  await act(async () => { await result.current.loadOlder(); });

  expect(apiClient.get).toHaveBeenLastCalledWith('/api/league/3/draft-feed?before=5');
  expect(result.current.entries.map((e) => e.seq)).toEqual([4, 5]);
});

test('re-syncs the whole feed on reconnect when nothing is held yet', async () => {
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toEqual([]));

  apiClient.get.mockResolvedValue({ data: [pickEntry({ seq: 9 })] });
  act(() => reconnectHandlers.forEach((cb) => cb()));

  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/league/3/draft-feed');
});

test('reconnect resumes AFTER the last held seq and keeps one order (#442)', async () => {
  // A feed already loaded: the acknowledged cursor is the max seq held.
  apiClient.get.mockResolvedValueOnce({ data: [chatEntry({ id: 1, seq: 6 }), pickEntry({ id: 2, seq: 7 })] });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toHaveLength(2));
  apiClient.get.mockClear();

  // On reconnect it asks only for entries newer than seq 7, not the whole feed.
  apiClient.get.mockResolvedValue({ data: [chatEntry({ id: 3, seq: 8, message: 'missed' })] });
  act(() => reconnectHandlers.forEach((cb) => cb()));

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/3/draft-feed?after=7'));
  await waitFor(() => expect(result.current.entries.map((e) => e.seq)).toEqual([6, 7, 8]));
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/league/3/draft-feed');
});

test('reconnect falls back to a full read when more than a page accrued offline (#442)', async () => {
  apiClient.get.mockResolvedValueOnce({ data: [chatEntry({ id: 1, seq: 6 }), pickEntry({ id: 2, seq: 7 })] });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toHaveLength(2));
  apiClient.get.mockClear();

  // A full resume page means the gap exceeded one page: snap to the latest
  // window rather than leaving the newest entries unfetched.
  const fullPage = Array.from({ length: 100 }, (_, i) => chatEntry({ id: 100 + i, seq: 100 + i }));
  apiClient.get.mockImplementation((url) =>
    url.includes('after=')
      ? Promise.resolve({ data: fullPage })
      : Promise.resolve({ data: [pickEntry({ id: 900, seq: 900 })] })
  );
  act(() => reconnectHandlers.forEach((cb) => cb()));

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/3/draft-feed?after=7'));
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/3/draft-feed'));
  await waitFor(() => expect(result.current.entries.some((e) => e.seq === 900)).toBe(true));
});

test('takes back both listeners on unmount and never ends the shared session', async () => {
  const { unmount } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(socket.hasHandler('chat:message')).toBe(true));

  unmount();
  expect(socket.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
  expect(socket.off).toHaveBeenCalledWith('draft:picked', expect.any(Function));
  expect(socket).not.toHaveProperty('disconnect');
});

test('sends chat over the handed-in session', async () => {
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true });
  });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 7, viewerTeamId: 11 }));

  let ok;
  await act(async () => { ok = await result.current.sendMessage('from the room'); });
  expect(ok).toBe(true);
  // The send carries the #440 idempotency key alongside the message, same
  // contract as the Dashboard chat (useLeagueChat).
  expect(socket.emit).toHaveBeenCalledWith(
    'chat:send',
    expect.objectContaining({ leagueId: 7, message: 'from the room', clientMsgId: expect.any(String) }),
    expect.any(Function)
  );
});
