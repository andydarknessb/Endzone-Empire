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

// --------------------------------------------------------------------------
// #516: the Draft room composes a GIF, mirroring useLeagueChat.sendGif exactly
// (payload / idempotency key / acknowledgement / reconciliation). The send goes
// over the SAME chat:send the text path uses; only the payload differs (a `gif`
// object instead of `message`). The whole thing runs against the deterministic
// fake provider with no network surface (AC7: proven absence of any provider
// network request).
// --------------------------------------------------------------------------

const gifPayload = (over = {}) => ({
  provider: 'fake', assetId: 'abc123', description: 'a cat knocking a cup off a table', caption: null, ...over,
});
// The entry the server persists and rides back on the ack, and re-broadcasts to
// the whole room (the sender included). A GIF entry carries structured `media`;
// its shared `seq` is the identity feedEntryKey dedups on.
const gifEntry = (over = {}) => chatEntry({
  media: { provider: 'fake', assetId: 'abc123', description: 'a cat knocking a cup off a table' },
  message: null, ...over,
});

test('sends a GIF over the same chat:send session, with the gif payload and an idempotency key', async () => {
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true, entry: gifEntry({ id: 40, seq: 40 }) });
  });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 7, viewerTeamId: 11 }));

  let ok;
  await act(async () => { ok = await result.current.sendGif(gifPayload()); });
  expect(ok).toBe(true);
  // Same contract as useLeagueChat.sendGif: leagueId + a structured gif object
  // (never a URL or upload) + the #440 idempotency key, on chat:send.
  expect(socket.emit).toHaveBeenCalledWith(
    'chat:send',
    expect.objectContaining({ leagueId: 7, gif: gifPayload(), clientMsgId: expect.any(String) }),
    expect.any(Function)
  );
  // The send never carries a text `message`: the caption rides inside the gif.
  const [, sent] = socket.emit.mock.calls.find(([e]) => e === 'chat:send');
  expect(sent).not.toHaveProperty('message');
});

test('a rejected GIF (no provider or no assetId) never touches the socket', async () => {
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 7, viewerTeamId: 11 }));

  let a; let b;
  await act(async () => { a = await result.current.sendGif({ assetId: 'x', description: 'd' }); });
  await act(async () => { b = await result.current.sendGif(gifPayload({ assetId: '' })); });
  expect(a).toBe(false);
  expect(b).toBe(false);
  expect(socket.emit).not.toHaveBeenCalledWith('chat:send', expect.anything(), expect.anything());
});

test('a successful GIF ack reconciles the returned entry WITHOUT DUPLICATING its broadcast echo', async () => {
  // The specific risk (#516): the server echoes every send to the whole room,
  // the sender included. The ack reconciles the entry AND the echo arrives on
  // chat:message; both share the entry's seq, so feedEntryKey dedups them and
  // the sender sees exactly ONE GIF - never two. Prove the COUNT is one; a
  // presence check cannot tell one message from two.
  const entry = gifEntry({ id: 41, seq: 41 });
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true, entry });
  });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 7, viewerTeamId: 11 }));
  await waitFor(() => expect(socket.hasHandler('chat:message')).toBe(true));

  await act(async () => { await result.current.sendGif(gifPayload()); });
  // The ack reconciled the entry.
  expect(result.current.entries.filter((e) => e.media)).toHaveLength(1);

  // The server now broadcasts that same entry back to the whole room; the sender
  // receives its own echo with the same seq.
  act(() => socket.trigger('chat:message', entry));

  // Still exactly one: the echo was deduped, not appended a second time.
  expect(result.current.entries.filter((e) => e.media)).toHaveLength(1);
  expect(result.current.entries).toHaveLength(1);
});

test('a GIF echo that arrives BEFORE its ack is still not doubled by the ack reconcile', async () => {
  // Order independence: on a fast room the chat:message echo can land before the
  // ack callback runs. The ack reconcile must still not double it.
  const entry = gifEntry({ id: 42, seq: 42 });
  let ackFn;
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ackFn = ack; // hold the ack, fire it after the echo
  });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 7, viewerTeamId: 11 }));
  await waitFor(() => expect(socket.hasHandler('chat:message')).toBe(true));

  let pending;
  await act(async () => { pending = result.current.sendGif(gifPayload()); });
  // Echo first...
  act(() => socket.trigger('chat:message', entry));
  expect(result.current.entries.filter((e) => e.media)).toHaveLength(1);
  // ...then the ack lands.
  await act(async () => { ackFn({ ok: true, entry }); await pending; });

  expect(result.current.entries.filter((e) => e.media)).toHaveLength(1);
});

// Each named refusal surfaces through the ONE existing composer error channel
// (result.current.error) and, critically, preserves the unsent composition -
// sendGif never clears anything, so the composer keeps the description and
// caption the manager typed (the GifComposer only resets on a truthy return).
// Each case resolves FALSE, which is what keeps the composer open (#516).
const refusalCases = [
  ['MESSAGE_TOO_LONG', { code: 'MESSAGE_TOO_LONG', length: 320, limit: 300, error: 'too long' }, /320 characters/],
  ['MESSAGE_TOO_LONG without numbers falls back to the ack text', { code: 'MESSAGE_TOO_LONG', error: 'caption too long' }, /caption too long/],
  ['DESCRIPTION_REQUIRED', { code: 'DESCRIPTION_REQUIRED', error: 'needs a description' }, /accessible description/],
  ['MEDIA_NOT_ALLOWED', { code: 'MEDIA_NOT_ALLOWED', error: 'not allowed' }, /only a provider GIF is allowed/],
  ['GIF_PROVIDER_DISABLED', { code: 'GIF_PROVIDER_DISABLED', error: 'disabled' }, /not available right now/],
  ['RATE_LIMITED with a retry time', { code: 'RATE_LIMITED', error: 'slow down', retryAfterSeconds: 12 }, /slow down\. Try again in 12s\./],
  ['a bare refusal with no code surfaces its text', { error: 'nope' }, /nope/],
];

describe.each(refusalCases)('a %s refusal', (_name, ackBody, expectedError) => {
  test('resolves false, surfaces the error, and leaves the composition to the caller', async () => {
    socket.emit.mockImplementation((event, payload, ack) => {
      if (event === 'chat:send' && ack) ack(ackBody);
    });
    const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 7, viewerTeamId: 11 }));

    let ok;
    await act(async () => { ok = await result.current.sendGif(gifPayload()); });

    // False is what keeps the composer open with the description/caption intact.
    expect(ok).toBe(false);
    await waitFor(() => expect(result.current.error).toMatch(expectedError));
    // A refusal never appends anything to the feed.
    expect(result.current.entries).toHaveLength(0);
  });
});

test('a duplicate GIF ack (retry the server already stored) reconciles once, no double', async () => {
  // A retry under the same key acks with the original entry; merge it so a client
  // that missed the first broadcast still shows it, deduped like any entry.
  const entry = gifEntry({ id: 43, seq: 43 });
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true, entry });
  });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 7, viewerTeamId: 11 }));

  await act(async () => { await result.current.sendGif(gifPayload()); });
  await act(async () => { await result.current.sendGif(gifPayload()); });

  expect(result.current.entries.filter((e) => e.media)).toHaveLength(1);
});

test('sendGif issues no provider network request - the send is the only wire traffic (AC7)', async () => {
  // The whole path runs against the fake provider and a socket the test owns;
  // there is no fetch/provider client anywhere in it. Prove it by the absence of
  // any REST call on send: apiClient.get is history/reconnect only, apiClient.post
  // is read-marker only, and neither is a provider request.
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ ok: true, entry: gifEntry({ id: 44, seq: 44 }) });
  });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 7, viewerTeamId: 11 }));
  apiClient.get.mockClear();

  await act(async () => { await result.current.sendGif(gifPayload()); });

  // The send rode the socket alone; it made no outbound HTTP request at all.
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(apiClient.post).not.toHaveBeenCalledWith(expect.stringMatching(/gif|giphy|tenor|provider/i), expect.anything());
});

// --------------------------------------------------------------------------
// #482: the Draft room live-tombstones a hidden message and can hide from here
// --------------------------------------------------------------------------

test('a chat:hidden broadcast tombstones the held chat entry in place, leaving Picks untouched', async () => {
  apiClient.get.mockResolvedValue({ data: [chatEntry({ id: 7, seq: 9, message: 'you are worthless' }), pickEntry({ id: 3, seq: 10 })] });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toHaveLength(2));
  expect(socket.hasHandler('chat:hidden')).toBe(true);

  act(() => socket.trigger('chat:hidden', { id: 7, type: 'league_chat', seq: 9, hidden: true, message: null, teamId: 11, teamName: 'Anvils' }));

  // Same count, same seq order: the chat entry is tombstoned in place.
  expect(result.current.entries).toHaveLength(2);
  expect(result.current.entries.map((e) => e.seq)).toEqual([9, 10]);
  const chat = result.current.entries.find((e) => e.type === 'league_chat');
  expect(chat.hidden).toBe(true);
  expect(chat.message).toBeNull();
  // The Pick is never a chat message and is left as it was.
  const pick = result.current.entries.find((e) => e.type === 'draft_activity');
  expect(pick.hidden).toBeUndefined();
});

test('a chat:hidden for an id the feed never held changes nothing', async () => {
  apiClient.get.mockResolvedValue({ data: [chatEntry({ id: 7, seq: 9 })] });
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(result.current.entries).toHaveLength(1));

  act(() => socket.trigger('chat:hidden', { id: 999, hidden: true, message: null }));

  expect(result.current.entries).toHaveLength(1);
  expect(result.current.entries[0].hidden).toBeUndefined();
});

test('takes back its chat:hidden listener on unmount', async () => {
  const { unmount } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  await waitFor(() => expect(socket.hasHandler('chat:hidden')).toBe(true));
  unmount();
  expect(socket.off).toHaveBeenCalledWith('chat:hidden', expect.any(Function));
});

test('hideMessage posts the hide to the moderation surface and resolves true', async () => {
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));
  let outcome;
  await act(async () => { outcome = await result.current.hideMessage(55, '  targeted harassment  '); });

  expect(outcome).toBe(true);
  expect(apiClient.post).toHaveBeenCalledWith('/api/safety/hide', {
    leagueId: 3, messageId: 55, reason: 'targeted harassment',
  });
});

test('hideMessage surfaces a rejection and resolves false', async () => {
  apiClient.post.mockImplementation((url) =>
    url === '/api/safety/hide'
      ? Promise.reject({ response: { data: { error: 'moderator access required' } } })
      : Promise.resolve({ data: { ok: true } })
  );
  const { result } = renderHook(() => useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11 }));

  let outcome;
  await act(async () => { outcome = await result.current.hideMessage(55, 'targeted harassment'); });
  expect(outcome).toBe(false);
  await waitFor(() => expect(result.current.error).toBe('moderator access required'));
});

// --------------------------------------------------------------------------
// #534: the two channels that revoke a confirmed member mid-draft (AC4), and
// the transient failures that must NOT (AC5). The member-only feed answers 403
// to a non-member; chat:send answers NOT_A_MEMBER when the author's Team is
// gone. Both are authoritative and matched on their status/code, never text.
// Everything else preserves membership and only surfaces an error.
// --------------------------------------------------------------------------

test('a 403 from the member-only feed reports membership revoked and shows no load error (AC4)', async () => {
  const onMembershipRevoked = jest.fn();
  apiClient.get.mockRejectedValue({ response: { status: 403 } });
  const { result } = renderHook(() =>
    useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11, onMembershipRevoked })
  );

  await waitFor(() => expect(onMembershipRevoked).toHaveBeenCalledTimes(1));
  // A revocation replaces the whole surface; it is not a transient load error.
  expect(result.current.error).toBeNull();
  expect(result.current.entries).toEqual([]);
});

test.each([
  ['a 500', { response: { status: 500 } }],
  ['a network error with no response', { message: 'Network Error' }],
])('a transient feed failure (%s) preserves membership and surfaces an error (AC5)', async (_label, err) => {
  const onMembershipRevoked = jest.fn();
  apiClient.get.mockRejectedValue(err);
  const { result } = renderHook(() =>
    useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11, onMembershipRevoked })
  );

  await waitFor(() => expect(result.current.error).toMatch(/could not be loaded/i));
  // The direction a careless implementation breaks: a blip must not revoke.
  expect(onMembershipRevoked).not.toHaveBeenCalled();
});

test('a 403 while paging older entries also reports membership revoked (AC4)', async () => {
  const onMembershipRevoked = jest.fn();
  apiClient.get.mockImplementation((url) =>
    url.includes('before=')
      ? Promise.reject({ response: { status: 403 } })
      : Promise.resolve({ data: [chatEntry({ id: 7, seq: 9 })] })
  );
  const { result } = renderHook(() =>
    useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11, onMembershipRevoked })
  );
  await waitFor(() => expect(result.current.entries).toHaveLength(1));

  await act(async () => { await result.current.loadOlder(); });

  expect(onMembershipRevoked).toHaveBeenCalledTimes(1);
});

test('a NOT_A_MEMBER chat:send ack revokes membership, appends nothing, and shows no composer error (AC4)', async () => {
  const onMembershipRevoked = jest.fn();
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ error: 'you are not in this league', code: 'NOT_A_MEMBER' });
  });
  const { result } = renderHook(() =>
    useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11, onMembershipRevoked })
  );
  await waitFor(() => expect(result.current.entries).toEqual([]));

  let ok;
  await act(async () => { ok = await result.current.sendMessage('hi'); });

  expect(ok).toBe(false);
  expect(onMembershipRevoked).toHaveBeenCalledTimes(1);
  // The non-member surface is the message; no composer error, and nothing posts.
  expect(result.current.error).toBeNull();
  expect(result.current.entries).toEqual([]);
});

test('a NON-membership chat:send refusal (rate limited) does NOT revoke membership (AC5)', async () => {
  const onMembershipRevoked = jest.fn();
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ error: 'you are sending too quickly', code: 'RATE_LIMITED', retryAfterSeconds: 5 });
  });
  const { result } = renderHook(() =>
    useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11, onMembershipRevoked })
  );
  await waitFor(() => expect(result.current.entries).toEqual([]));

  let ok;
  await act(async () => { ok = await result.current.sendMessage('hi'); });

  expect(ok).toBe(false);
  expect(onMembershipRevoked).not.toHaveBeenCalled();
  // The ordinary refusal still surfaces through the composer error channel.
  await waitFor(() => expect(result.current.error).toMatch(/too quickly/i));
});

test('a NOT_A_MEMBER refusal on a GIF send revokes membership too (AC4)', async () => {
  const onMembershipRevoked = jest.fn();
  socket.emit.mockImplementation((event, payload, ack) => {
    if (event === 'chat:send' && ack) ack({ error: 'you are not in this league', code: 'NOT_A_MEMBER' });
  });
  const { result } = renderHook(() =>
    useDraftRoomFeed({ socket, leagueId: 3, viewerTeamId: 11, onMembershipRevoked })
  );
  await waitFor(() => expect(result.current.entries).toEqual([]));

  let ok;
  await act(async () => { ok = await result.current.sendGif(gifPayload()); });

  expect(ok).toBe(false);
  expect(onMembershipRevoked).toHaveBeenCalledTimes(1);
});
