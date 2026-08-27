import apiClient from '../api/apiClient';
import { applyHiddenEntry, hidePost } from './chatModeration';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

afterEach(() => jest.clearAllMocks());

// --------------------------------------------------------------------------
// applyHiddenEntry: the one live-tombstone rewrite both chat feeds call (#482).
// --------------------------------------------------------------------------

const chat = (over = {}) => ({
  type: 'league_chat',
  id: 7,
  seq: 9,
  teamId: 11,
  teamName: 'Anvils',
  message: 'gg',
  created_at: '2026-01-01T12:00:00Z',
  ...over,
});

const hiddenBroadcast = (over = {}) => ({
  type: 'league_chat',
  id: 7,
  seq: 9,
  hidden: true,
  message: null,
  teamId: 11,
  teamName: 'Anvils',
  ...over,
});

test('rewrites the held chat entry in place, dropping its content and flipping hidden', () => {
  const before = [chat({ id: 5, seq: 8, message: 'first' }), chat({ id: 7, seq: 9, message: 'gg' })];
  const after = applyHiddenEntry(before, hiddenBroadcast({ id: 7, seq: 9 }));

  expect(after).toHaveLength(2);
  // Same order, same seq position.
  expect(after.map((e) => e.seq)).toEqual([8, 9]);
  expect(after[1].id).toBe(7);
  expect(after[1].hidden).toBe(true);
  expect(after[1].message).toBeNull();
  // The untouched entry is left exactly as it was.
  expect(after[0]).toBe(before[0]);
});

test('ignores a broadcast for an id the feed never held', () => {
  const before = [chat({ id: 7 })];
  const after = applyHiddenEntry(before, hiddenBroadcast({ id: 999 }));
  expect(after).toEqual(before);
  expect(after[0].hidden).toBeUndefined();
});

test('never tombstones a Draft-activity entry that shares the id (combined feed)', () => {
  // Chat ids and draft-activity ids come from separate stores and can collide;
  // a chat:hidden for a chat id must not rewrite a Pick with the same id.
  const pick = { type: 'draft_activity', kind: 'pick', id: 7, seq: 6, player: { name: 'Pat Mahomes' } };
  const message = chat({ id: 7, seq: 9, message: 'gg' });
  const after = applyHiddenEntry([pick, message], hiddenBroadcast({ id: 7 }));

  expect(after[0]).toBe(pick); // the Pick is untouched
  expect(after[0].hidden).toBeUndefined();
  expect(after[1].hidden).toBe(true);
  expect(after[1].message).toBeNull();
});

test('treats a legacy entry with no type as chat (drawer holds only chat)', () => {
  const legacy = { id: 7, message: 'gg' }; // no type field
  const after = applyHiddenEntry([legacy], hiddenBroadcast({ id: 7 }));
  expect(after[0].hidden).toBe(true);
  expect(after[0].message).toBeNull();
});

test('a null or id-less broadcast changes nothing', () => {
  const before = [chat({ id: 7 })];
  expect(applyHiddenEntry(before, null)).toBe(before);
  expect(applyHiddenEntry(before, { hidden: true })).toBe(before);
});

// --------------------------------------------------------------------------
// hidePost: the one hide REST call both surfaces route through (#482), so the
// audit row and the broadcast are identical whichever surface acted.
// --------------------------------------------------------------------------

test('posts the trimmed hide to the moderation surface and resolves ok', async () => {
  apiClient.post.mockResolvedValue({ data: { ok: true } });
  const res = await hidePost({ leagueId: '3', messageId: 55, reason: '  targeted harassment  ' });

  expect(res).toEqual({ ok: true });
  expect(apiClient.post).toHaveBeenCalledWith('/api/safety/hide', {
    leagueId: 3,
    messageId: 55,
    reason: 'targeted harassment',
  });
});

test('surfaces the server error and resolves not ok on a rejected hide', async () => {
  apiClient.post.mockRejectedValue({ response: { data: { error: 'moderator access required' } } });
  const res = await hidePost({ leagueId: 3, messageId: 55, reason: 'targeted harassment' });
  expect(res).toEqual({ ok: false, error: 'moderator access required' });
});

test('falls back to a generic error when the server offers none', async () => {
  apiClient.post.mockRejectedValue(new Error('network'));
  const res = await hidePost({ leagueId: 3, messageId: 55, reason: 'targeted harassment' });
  expect(res).toEqual({ ok: false, error: 'failed to hide message' });
});
