import { renderHook, act, waitFor } from '@testing-library/react';
import apiClient from '../../api/apiClient';
import { onReconnect } from '../../api/socket';
import useLeagueChat from './useLeagueChat';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

// The hook never creates a socket - it rides one it is handed - so only
// onReconnect is mocked here. `createDraftSocket` is deliberately not, and a
// test below proves the hook never reaches for it.
jest.mock('../../api/socket', () => ({
  onReconnect: jest.fn(),
}));

/**
 * A controllable fake socket the hook is handed. It records `.on` handlers so
 * a test can fire an incoming message, and a real `.off` so the hook's
 * listener cleanup can be asserted. It has no `.disconnect` on purpose: the
 * hook does not own this socket's lifecycle and must never end it.
 */
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

// A chat row as the REST history returns it: Team identity beside the account
// fields the server leaves in place (#112). Only the Team half may be read.
const chatMessage = (overrides = {}) => ({
  id: 1,
  user_id: 1,
  username: 'alice',
  teamId: 11,
  teamName: 'Anvils',
  message: 'hello there',
  created_at: '2026-01-01T12:00:00Z',
  ...overrides,
});

// The `chat:message` broadcast: Team identity, and by contract no
// viewer-relative field (one payload reaches the whole league room).
const broadcast = (overrides = {}) => ({
  id: 2,
  leagueId: 1,
  userId: 2,
  username: 'bob',
  teamId: 22,
  teamName: 'Bulldogs',
  message: 'yo',
  created_at: '2026-01-01T12:05:00Z',
  ...overrides,
});

const mockGets = ({ history = [], unread = 0 } = {}) => {
  apiClient.get.mockImplementation((url) =>
    url.endsWith('/chat/unread')
      ? Promise.resolve({ data: { unread } })
      : Promise.resolve({ data: history })
  );
};

let reconnectHandlers;

beforeEach(() => {
  reconnectHandlers = [];
  onReconnect.mockImplementation((socket, handler) => {
    reconnectHandlers.push(handler);
    return () => {
      reconnectHandlers = reconnectHandlers.filter((h) => h !== handler);
    };
  });
  apiClient.post.mockResolvedValue({ data: { ok: true } });
});

afterEach(() => {
  jest.clearAllMocks();
});

const render = (props) => {
  const socket = makeFakeSocket();
  const utils = renderHook(
    ({ socket: s, leagueId, open, viewerTeamId }) =>
      useLeagueChat({ socket: s, leagueId, open, viewerTeamId }),
    { initialProps: { socket, leagueId: 1, open: true, viewerTeamId: null, ...props } }
  );
  return { socket, ...utils };
};

test('fetches league-chat history on mount and exposes it as messages', async () => {
  mockGets({ history: [chatMessage({ id: 1, message: 'hi' })] });

  const { result } = render();

  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(result.current.messages[0].message).toBe('hi');
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat');
});

test('appends an incoming chat:message from the socket it was handed', async () => {
  mockGets();

  const { socket, result } = render();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  act(() => socket.trigger('chat:message', broadcast()));

  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(result.current.messages[0].message).toBe('yo');
});

test('sendMessage emits chat:send with trimmed text and resolves true on an ok ack', async () => {
  mockGets();
  const { socket, result } = render({ leagueId: 5 });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true });
  });

  let resolved;
  await act(async () => { resolved = await result.current.sendMessage('  hey team  ', 'caller-key'); });

  // A caller-supplied key rides on the wire verbatim, so a retry that reuses it
  // collapses onto one server row.
  expect(socket.emit).toHaveBeenCalledWith(
    'chat:send',
    { leagueId: 5, message: 'hey team', clientMsgId: 'caller-key' },
    expect.any(Function)
  );
  expect(resolved).toBe(true);
  expect(result.current.error).toBe(null);
});

test('sendMessage mints a key when the caller supplies none', async () => {
  mockGets();
  const { socket, result } = render({ leagueId: 5 });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true });
  });

  await act(async () => { await result.current.sendMessage('hey team'); });

  const [, payload] = socket.emit.mock.calls.find(([event]) => event === 'chat:send');
  expect(typeof payload.clientMsgId).toBe('string');
  expect(payload.clientMsgId.length).toBeGreaterThan(0);
});

test('a rate-limited ack surfaces the error with its explicit retry time', async () => {
  mockGets();
  const { socket, result } = render();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) {
      ack({ error: 'you are sending too quickly', code: 'RATE_LIMITED', retryAfterMs: 4200, retryAfterSeconds: 5 });
    }
  });

  let resolved;
  await act(async () => { resolved = await result.current.sendMessage('spammy'); });

  expect(resolved).toBe(false);
  await waitFor(() => expect(result.current.error).toBe('you are sending too quickly. Try again in 5s.'));
});

test('a duplicate ack carrying the original entry shows it once, never twice', async () => {
  mockGets();
  const { socket, result } = render();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  const original = { type: 'league_chat', id: 55, seq: 9, teamId: 11, teamName: 'Anvils', message: 'gg', created_at: '2026-01-01T12:00:00Z' };
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true, duplicate: true, entry: original });
  });

  await act(async () => { await result.current.sendMessage('gg'); });
  await waitFor(() => expect(result.current.messages.some((m) => m.id === 55)).toBe(true));

  // A second retry acked the same way must not append a second copy.
  await act(async () => { await result.current.sendMessage('gg'); });
  expect(result.current.messages.filter((m) => m.id === 55)).toHaveLength(1);
});

test('a re-broadcast of an entry already held is not appended twice', async () => {
  mockGets();
  const { socket, result } = render();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  act(() => socket.trigger('chat:message', broadcast({ id: 77, message: 'once' })));
  await waitFor(() => expect(result.current.messages.some((m) => m.id === 77)).toBe(true));

  // Same id again (e.g. a reconnect history refetch overlapping the live one).
  act(() => socket.trigger('chat:message', broadcast({ id: 77, message: 'once' })));

  expect(result.current.messages.filter((m) => m.id === 77)).toHaveLength(1);
});

test('sendMessage surfaces the ack error and resolves false', async () => {
  mockGets();
  const { socket, result } = render();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ error: 'message rejected' });
  });

  let resolved;
  await act(async () => { resolved = await result.current.sendMessage('bad'); });

  expect(resolved).toBe(false);
  await waitFor(() => expect(result.current.error).toBe('message rejected'));
});

test('an empty or whitespace-only message never emits and never touches the error', async () => {
  mockGets();
  const { socket, result } = render();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  let resolved;
  await act(async () => { resolved = await result.current.sendMessage('   '); });

  expect(resolved).toBe(false);
  expect(socket.emit).not.toHaveBeenCalledWith('chat:send', expect.anything(), expect.anything());
});

test('while closed, unread starts from the server count and grows only with others\' messages', async () => {
  mockGets({ unread: 2 });
  const { socket, result } = render({ open: false, viewerTeamId: 99 });

  await waitFor(() => expect(result.current.unread).toBe(2));
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat/unread');

  // Someone else's Team increments...
  act(() => socket.trigger('chat:message', broadcast()));
  await waitFor(() => expect(result.current.unread).toBe(3));

  // ...but the viewer's own broadcast echo, recognised by Team, does not.
  act(() => socket.trigger('chat:message', broadcast({ id: 3, teamId: 99, teamName: 'Mine', message: 'mine' })));
  await waitFor(() => expect(result.current.messages.some((m) => m.message === 'mine')).toBe(true));
  expect(result.current.unread).toBe(3);
  // A closed surface never moves the read marker.
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('counts a former manager\'s message as unread when the viewer\'s own Team is not known yet', async () => {
  // The two-nulls-match trap (#188): a departed author reads back teamId null,
  // and viewerTeamId is null until it is known, so a guard must not treat the
  // two nulls as "my own echo".
  mockGets({ unread: 0 });
  const { socket, result } = render({ open: false, viewerTeamId: null });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  act(() => socket.trigger('chat:message', broadcast({ id: 7, teamId: null, teamName: null, message: 'gone' })));

  await waitFor(() => expect(result.current.unread).toBe(1));
});

test('only unseen human messages move the unread count; Draft activity never does (#442)', async () => {
  // The unread badge counts unseen HUMAN chat only. Draft activity, cutover
  // boundaries and moderation tombstones are not correspondence, so an entry
  // that is not a league_chat message must be appended without touching unread
  // (spec #429: "Count unread human messages only").
  mockGets({ unread: 0 });
  const { socket, result } = render({ open: false, viewerTeamId: 99 });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  // A committed Pick arriving over the shared room is Draft activity, not chat.
  act(() =>
    socket.trigger('chat:message', {
      type: 'draft_activity',
      id: 501,
      seq: 12,
      teamId: 22,
      teamName: 'Bulldogs',
      player: { name: 'Pat Mahomes' },
      created_at: '2026-01-01T12:06:00Z',
    })
  );
  // It still shows in the feed...
  await waitFor(() => expect(result.current.messages.some((m) => m.id === 501)).toBe(true));
  // ...but never as unread.
  expect(result.current.unread).toBe(0);

  // A genuine human message still increments, proving the guard is on kind.
  act(() => socket.trigger('chat:message', broadcast({ id: 8, message: 'real chat' })));
  await waitFor(() => expect(result.current.unread).toBe(1));
});

test('an explicitly typed league_chat message still counts as unread (#442)', async () => {
  // The live broadcast carries type: 'league_chat' (leagueFeed.feedEntryOf);
  // the human-kind guard must accept it, not only the legacy untyped shape.
  mockGets({ unread: 0 });
  const { socket, result } = render({ open: false, viewerTeamId: 99 });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  act(() => socket.trigger('chat:message', broadcast({ id: 9, type: 'league_chat', message: 'typed' })));

  await waitFor(() => expect(result.current.unread).toBe(1));
});

test('opening resets unread and moves the server-side read marker', async () => {
  mockGets({ unread: 5 });
  const { socket, result, rerender } = render({ open: false });
  await waitFor(() => expect(result.current.unread).toBe(5));

  // Flip the drawer open, keeping the same handed-in socket.
  rerender({ socket, leagueId: 1, open: true, viewerTeamId: null });

  await waitFor(() => expect(result.current.unread).toBe(0));
  expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/chat/read');
});

test('messages arriving while open are marked read on the server immediately', async () => {
  mockGets();
  const { socket } = render({ open: true, leagueId: 4 });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  apiClient.post.mockClear();

  act(() => socket.trigger('chat:message', broadcast({ leagueId: 4, message: 'seen live' })));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/league/4/chat/read'));
});

test('re-fetches chat history and unread when the socket reconnects', async () => {
  mockGets({ history: [] });
  const { result } = render({ open: false });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat'));

  apiClient.get.mockClear();
  mockGets({ history: [chatMessage({ id: 9, message: 'missed while offline' })], unread: 4 });

  act(() => reconnectHandlers.forEach((cb) => cb()));

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat'));
  await waitFor(() => expect(result.current.messages.some((m) => m.message === 'missed while offline')).toBe(true));
});

test('reconnect resumes AFTER the last acknowledged seq and preserves order (#442)', async () => {
  // A page is already held, each entry carrying its seq; the acknowledged
  // cursor is the max seq. On reconnect the hook must resume from it, not
  // refetch the whole conversation, and the recovered order is still by seq.
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/chat/unread')) return Promise.resolve({ data: { unread: 0 } });
    if (url.includes('after=')) {
      return Promise.resolve({ data: [feedEntry({ id: 8, seq: 8, message: 'after-8' }), feedEntry({ id: 9, seq: 9, message: 'after-9' })] });
    }
    return Promise.resolve({ data: [feedEntry({ id: 6, seq: 6, message: 'have-6' }), feedEntry({ id: 7, seq: 7, message: 'have-7' })] });
  });

  const { result } = render({ open: false });
  await waitFor(() => expect(result.current.messages).toHaveLength(2));
  apiClient.get.mockClear();

  act(() => reconnectHandlers.forEach((cb) => cb()));

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat?after=7'));
  await waitFor(() => expect(result.current.messages.map((m) => m.seq)).toEqual([6, 7, 8, 9]));
  // A resume is not a full refetch of the conversation.
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/league/1/chat');
});

test('reconnect falls back to a full read when more than a page accrued offline (#442)', async () => {
  // A resume page that comes back FULL means the offline gap exceeded one page;
  // appending it would leave the newest entries unfetched. The hook must snap to
  // the latest window instead so the freshest entries are shown (the gap behind
  // is reachable through loadOlder), never silently drop the tail.
  const fullAfter = Array.from({ length: 100 }, (_, i) => feedEntry({ id: 100 + i, seq: 100 + i }));
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/chat/unread')) return Promise.resolve({ data: { unread: 0 } });
    if (url.includes('after=')) return Promise.resolve({ data: fullAfter });
    return Promise.resolve({ data: [feedEntry({ id: 6, seq: 6 }), feedEntry({ id: 7, seq: 7 })] });
  });
  const { result } = render({ open: false });
  await waitFor(() => expect(result.current.messages).toHaveLength(2));

  apiClient.get.mockClear();
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/chat/unread')) return Promise.resolve({ data: { unread: 0 } });
    if (url.includes('after=')) return Promise.resolve({ data: fullAfter });
    return Promise.resolve({ data: [feedEntry({ id: 500, seq: 500, message: 'latest window' })] });
  });

  act(() => reconnectHandlers.forEach((cb) => cb()));

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat?after=7'));
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat'));
  await waitFor(() => expect(result.current.messages.some((m) => m.message === 'latest window')).toBe(true));
});

test('reconnect falls back to a full history read when nothing is held (#442)', async () => {
  // No cursor to resume from yet (empty feed) means the reconnect must load the
  // latest page outright, the behaviour the first-load path already relies on.
  mockGets({ history: [] });
  const { result } = render({ open: false });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat'));
  apiClient.get.mockClear();
  mockGets({ history: [chatMessage({ id: 9, seq: 3, message: 'first ever' })] });

  act(() => reconnectHandlers.forEach((cb) => cb()));

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat'));
  await waitFor(() => expect(result.current.messages.some((m) => m.message === 'first ever')).toBe(true));
});

test('removes its chat:message listener on unmount, and never disconnects the shared socket', async () => {
  mockGets();
  const { socket, unmount } = render();
  await waitFor(() => expect(socket.hasHandler('chat:message')).toBe(true));

  unmount();

  expect(socket.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
  expect(socket.hasHandler('chat:message')).toBe(false);
  // It was handed the socket; ending it is the owner's job, never the hook's.
  expect(socket).not.toHaveProperty('disconnect');
});

test('does not blow up before a socket exists, and sendMessage is a no-op then', async () => {
  mockGets();
  const utils = renderHook(
    ({ socket }) => useLeagueChat({ socket, leagueId: 1, open: true, viewerTeamId: null }),
    { initialProps: { socket: null } }
  );

  let resolved;
  await act(async () => { resolved = await utils.result.current.sendMessage('hi'); });
  expect(resolved).toBe(false);
  // History still loads without a socket.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat'));
});

// A typed feed entry as the cursor-based history returns it (#434): Team
// identity plus its per-league `seq`, the cursor the client pages back from.
const feedEntry = (over = {}) => ({
  type: 'league_chat',
  id: 1,
  seq: 1,
  teamId: 11,
  teamName: 'Anvils',
  message: 'hello there',
  created_at: '2026-01-01T12:00:00Z',
  ...over,
});

test('loadOlder pages older entries by the oldest loaded seq and prepends them', async () => {
  // Newest page first: seq 5 and 6 are what the initial read returned.
  const older = [feedEntry({ id: 3, seq: 3, message: 'older-3' }), feedEntry({ id: 4, seq: 4, message: 'older-4' })];
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/chat/unread')) return Promise.resolve({ data: { unread: 0 } });
    if (url.includes('before=')) return Promise.resolve({ data: older });
    return Promise.resolve({ data: [feedEntry({ id: 5, seq: 5, message: 'recent-5' }), feedEntry({ id: 6, seq: 6, message: 'recent-6' })] });
  });

  const { result } = render();
  await waitFor(() => expect(result.current.messages).toHaveLength(2));

  await act(async () => { await result.current.loadOlder(); });

  // Paged from the lowest seq currently held (5), and the older page is
  // prepended ahead of it in ascending order.
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/chat?before=5');
  expect(result.current.messages.map((m) => m.seq)).toEqual([3, 4, 5, 6]);
});

test('loadOlder dedupes by id and does not page when nothing is loaded', async () => {
  const overlap = [feedEntry({ id: 4, seq: 4, message: 'older-4' }), feedEntry({ id: 5, seq: 5, message: 'recent-5' })];
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/chat/unread')) return Promise.resolve({ data: { unread: 0 } });
    if (url.includes('before=')) return Promise.resolve({ data: overlap });
    return Promise.resolve({ data: [feedEntry({ id: 5, seq: 5, message: 'recent-5' })] });
  });

  const { result } = render();
  await waitFor(() => expect(result.current.messages).toHaveLength(1));

  await act(async () => { await result.current.loadOlder(); });

  // id 5 already present is not duplicated; only the genuinely older 4 lands.
  expect(result.current.messages.map((m) => m.id)).toEqual([4, 5]);
});

test('hasMore is true only when a read fills a full page', async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => feedEntry({ id: i + 1, seq: i + 1 }));
  mockGets({ history: fullPage });
  const { result } = render();
  await waitFor(() => expect(result.current.messages).toHaveLength(100));
  expect(result.current.hasMore).toBe(true);
});

test('hasMore is false when the initial read is a partial page', async () => {
  mockGets({ history: [feedEntry({ id: 1, seq: 1 })] });
  const { result } = render();
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(result.current.hasMore).toBe(false);
});

// --------------------------------------------------------------------------
// #441: content moderation - live tombstone and the hide action
// --------------------------------------------------------------------------

test('a chat:hidden broadcast tombstones the held entry in place, dropping its content', async () => {
  mockGets({ history: [chatMessage({ id: 7, message: 'you are worthless', teamName: 'Anvils' })] });
  const { result, socket } = render();
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(socket.hasHandler('chat:hidden')).toBe(true);

  act(() => {
    socket.trigger('chat:hidden', { id: 7, type: 'league_chat', hidden: true, message: null, teamId: 11, teamName: 'Anvils' });
  });

  // Same entry, same place - content gone, hidden flipped true.
  expect(result.current.messages).toHaveLength(1);
  expect(result.current.messages[0].id).toBe(7);
  expect(result.current.messages[0].hidden).toBe(true);
  expect(result.current.messages[0].message).toBeNull();
});

test('a chat:hidden for an entry the client never held is ignored', async () => {
  mockGets({ history: [chatMessage({ id: 7 })] });
  const { result, socket } = render();
  await waitFor(() => expect(result.current.messages).toHaveLength(1));

  act(() => {
    socket.trigger('chat:hidden', { id: 999, hidden: true, message: null });
  });

  expect(result.current.messages).toHaveLength(1);
  expect(result.current.messages[0].id).toBe(7);
});

test('hideMessage posts the hide to the moderation surface and resolves true', async () => {
  mockGets();
  const { result } = render();

  let outcome;
  await act(async () => {
    outcome = await result.current.hideMessage(55, '  targeted harassment  ');
  });

  expect(outcome).toBe(true);
  expect(apiClient.post).toHaveBeenCalledWith('/api/safety/hide', {
    leagueId: 1,
    messageId: 55,
    reason: 'targeted harassment',
  });
});

test('hideMessage surfaces a rejection and resolves false', async () => {
  mockGets();
  // Reject only the hide; the mount's markRead post must still resolve, or it
  // would consume a one-shot rejection instead of the hide.
  apiClient.post.mockImplementation((url) =>
    url === '/api/safety/hide'
      ? Promise.reject({ response: { data: { error: 'moderator access required' } } })
      : Promise.resolve({ data: { ok: true } })
  );
  const { result } = render();

  let outcome;
  await act(async () => {
    outcome = await result.current.hideMessage(55, 'targeted harassment');
  });

  expect(outcome).toBe(false);
  await waitFor(() => expect(result.current.error).toBe('moderator access required'));
});
