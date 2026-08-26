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

const lifecycleEntry = (overrides = {}) => ({
  type: 'draft_activity', kind: 'draft_start', id: 20, seq: 3, teamId: 30, teamName: 'Commish FC',
  created_at: '2026-01-01T12:02:00Z', ...overrides,
});

test('a draft:activity lifecycle entry is merged into its shared-seq position (#437)', async () => {
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toEqual([]));

  // A start (seq 1) then a chat (seq 2) then a completion (seq 4), out of order.
  act(() => socket.trigger('chat:message', chatEntry({ seq: 2, message: 'go' })));
  act(() => socket.trigger('draft:activity', lifecycleEntry({ kind: 'draft_start', seq: 1 })));
  act(() => socket.trigger('draft:activity', lifecycleEntry({ kind: 'complete', id: 21, seq: 4, teamId: null, teamName: null })));

  expect(result.current.entries.map((e) => e.seq)).toEqual([1, 2, 4]);
  expect(result.current.entries.map((e) => e.kind)).toEqual(['draft_start', undefined, 'complete']);
});

test('a lifecycle entry never marks chat read (only human messages do)', async () => {
  renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(socket.hasHandler('draft:activity')).toBe(true));

  act(() => socket.trigger('draft:activity', lifecycleEntry({ kind: 'pause', seq: 5 })));
  expect(apiClient.post).not.toHaveBeenCalledWith('/api/league/3/chat/read');
});

test('a lifecycle echo delivered twice is not doubled (dedup by seq)', async () => {
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toEqual([]));

  const entry = lifecycleEntry({ kind: 'reset', seq: 7 });
  act(() => socket.trigger('draft:activity', entry));
  act(() => socket.trigger('draft:activity', entry));

  expect(result.current.entries).toHaveLength(1);
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

test('re-syncs the whole feed on reconnect', async () => {
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toEqual([]));

  apiClient.get.mockResolvedValue({ data: [pickEntry({ seq: 9 })] });
  act(() => reconnectHandlers.forEach((cb) => cb()));

  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/league/3/draft-feed');
});

test('takes back both listeners on unmount and never ends the shared session', async () => {
  const { unmount } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(socket.hasHandler('chat:message')).toBe(true));

  unmount();
  expect(socket.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
  expect(socket.off).toHaveBeenCalledWith('draft:picked', expect.any(Function));
  expect(socket.off).toHaveBeenCalledWith('draft:activity', expect.any(Function));
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
