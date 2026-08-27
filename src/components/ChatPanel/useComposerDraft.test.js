import { renderHook, act } from '@testing-library/react';
import useComposerDraft from './useComposerDraft';

afterEach(() => {
  window.sessionStorage.clear();
  jest.restoreAllMocks();
});

test('persists text per league stamped with the account, and restores it', () => {
  const { result, unmount } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  act(() => result.current[1]('half a thought'));
  unmount();

  // A fresh mount for the same league and account restores the draft.
  const { result: restored } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  expect(restored.current[0]).toBe('half a thought');
});

test('clearDraft empties the text and removes the stored record', () => {
  const { result } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  act(() => result.current[1]('ship it'));
  expect(window.sessionStorage.getItem('endzone:composerDraft:5')).toBeTruthy();

  act(() => result.current[2]());
  expect(result.current[0]).toBe('');
  expect(window.sessionStorage.getItem('endzone:composerDraft:5')).toBe(null);
});

test('a different account neither reads nor keeps the previous account\'s draft', () => {
  const { result, rerender } = renderHook(({ userId }) => useComposerDraft({ leagueId: 5, userId }), {
    initialProps: { userId: 7 },
  });
  act(() => result.current[1]('account seven note'));

  // Account changes in place (a re-login in the same tab): the draft is dropped.
  rerender({ userId: 8 });
  expect(result.current[0]).toBe('');
  // And it is gone from storage, so account 8 cannot recover it on a remount.
  expect(window.sessionStorage.getItem('endzone:composerDraft:5')).toBe(null);
});

test('a logout (no account) clears the draft', () => {
  const { result, rerender } = renderHook(({ userId }) => useComposerDraft({ leagueId: 5, userId }), {
    initialProps: { userId: 7 },
  });
  act(() => result.current[1]('private thought'));

  rerender({ userId: null });
  expect(result.current[0]).toBe('');
  expect(window.sessionStorage.getItem('endzone:composerDraft:5')).toBe(null);
});

test('an empty edit removes the record rather than storing an empty draft', () => {
  const { result } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  act(() => result.current[1]('typing'));
  act(() => result.current[1](''));
  expect(window.sessionStorage.getItem('endzone:composerDraft:5')).toBe(null);
});

test('the composer still works when sessionStorage throws', () => {
  jest.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(() => {
    throw new Error('storage disabled');
  });
  jest.spyOn(window.sessionStorage.__proto__, 'getItem').mockImplementation(() => {
    throw new Error('storage disabled');
  });

  const { result } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  // Typing does not throw even though nothing can be persisted.
  act(() => result.current[1]('resilient'));
  expect(result.current[0]).toBe('resilient');
});

// --------------------------------------------------------------------------
// #524: the reserved `gif` slice beside `text`, on the same scope and account
// stamp, with clearing that keeps the two composers independent.
// The return is [text, setText, clearDraft, gif, setGif]; gif is an object
// { assetId, description, caption } that defaults to empty strings. A GIF send
// discards the slice by writing an empty composition through setGif (there is no
// separate clearGif: the composer owns its own send, so it clears through the
// one writer), which is exactly what discardGif does below.
// --------------------------------------------------------------------------

const EMPTY_GIF = { assetId: '', description: '', caption: '' };
const gifOf = (result) => result.current[3];
const setGif = (result, next) => act(() => result.current[4](next));
const discardGif = (result) => setGif(result, EMPTY_GIF);

test('a fresh mount with no stored record starts with an empty gif composition', () => {
  const { result } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  expect(gifOf(result)).toEqual({ assetId: '', description: '', caption: '' });
});

test('persists a gif composition per league stamped with the account, and restores it', () => {
  const { result, unmount } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  setGif(result, { assetId: 'abc123', description: 'a waving hand', caption: 'hi' });
  unmount();

  const { result: restored } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  expect(gifOf(restored)).toEqual({ assetId: 'abc123', description: 'a waving hand', caption: 'hi' });
});

test('the gif slice rides beside the text under one account-stamped record', () => {
  const { result, unmount } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  act(() => result.current[1]('half a thought'));
  setGif(result, { assetId: 'abc123', description: 'a waving hand', caption: '' });
  unmount();

  const { result: restored } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  expect(restored.current[0]).toBe('half a thought');
  expect(gifOf(restored)).toEqual({ assetId: 'abc123', description: 'a waving hand', caption: '' });
});

test('a different account finds no gif composition', () => {
  const { result, rerender } = renderHook(({ userId }) => useComposerDraft({ leagueId: 5, userId }), {
    initialProps: { userId: 7 },
  });
  setGif(result, { assetId: 'abc123', description: 'a waving hand', caption: '' });

  rerender({ userId: 8 });
  expect(gifOf(result)).toEqual({ assetId: '', description: '', caption: '' });
  expect(window.sessionStorage.getItem('endzone:composerDraft:5')).toBe(null);
});

test('a logout (no account) finds no gif composition', () => {
  const { result, rerender } = renderHook(({ userId }) => useComposerDraft({ leagueId: 5, userId }), {
    initialProps: { userId: 7 },
  });
  setGif(result, { assetId: 'abc123', description: 'a waving hand', caption: '' });

  rerender({ userId: null });
  expect(gifOf(result)).toEqual({ assetId: '', description: '', caption: '' });
});

test('discarding the gif slice empties it but leaves the text draft untouched (independence)', () => {
  const { result } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  act(() => result.current[1]('keep me'));
  setGif(result, { assetId: 'abc123', description: 'a waving hand', caption: 'hi' });

  discardGif(result);
  expect(gifOf(result)).toEqual({ assetId: '', description: '', caption: '' });
  // The text draft survives a gif clear.
  expect(result.current[0]).toBe('keep me');
  // And it is still stored for the next mount.
  const stored = JSON.parse(window.sessionStorage.getItem('endzone:composerDraft:5'));
  expect(stored.text).toBe('keep me');
  expect(stored.gif).toBeUndefined();
});

test('clearDraft empties the text but leaves the gif composition untouched (independence)', () => {
  const { result } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  act(() => result.current[1]('send me'));
  setGif(result, { assetId: 'abc123', description: 'a waving hand', caption: 'hi' });

  act(() => result.current[2]());
  expect(result.current[0]).toBe('');
  // The gif composition survives a text clear.
  expect(gifOf(result)).toEqual({ assetId: 'abc123', description: 'a waving hand', caption: 'hi' });
  const stored = JSON.parse(window.sessionStorage.getItem('endzone:composerDraft:5'));
  expect(stored.text).toBeUndefined();
  expect(stored.gif).toEqual({ assetId: 'abc123', description: 'a waving hand', caption: 'hi' });
});

test('clearing both text and gif removes the stored record entirely', () => {
  const { result } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  act(() => result.current[1]('send me'));
  setGif(result, { assetId: 'abc123', description: 'a waving hand', caption: '' });

  act(() => result.current[2]());
  discardGif(result);
  expect(window.sessionStorage.getItem('endzone:composerDraft:5')).toBe(null);
});

test('the gif composer still works when sessionStorage throws', () => {
  jest.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(() => {
    throw new Error('storage disabled');
  });
  jest.spyOn(window.sessionStorage.__proto__, 'getItem').mockImplementation(() => {
    throw new Error('storage disabled');
  });

  const { result } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  setGif(result, { assetId: 'abc123', description: 'a waving hand', caption: '' });
  // The composition is held in React state even though nothing can be persisted.
  expect(gifOf(result)).toEqual({ assetId: 'abc123', description: 'a waving hand', caption: '' });
});

test('a legacy text-only stored record still reads back its text and an empty gif', () => {
  // A draft written by the pre-#524 hook holds only { acct, text }; the new hook
  // must read its text and present an empty gif rather than choke on the shape.
  window.sessionStorage.setItem('endzone:composerDraft:5', JSON.stringify({ acct: 7, text: 'from before' }));
  const { result } = renderHook(() => useComposerDraft({ leagueId: 5, userId: 7 }));
  expect(result.current[0]).toBe('from before');
  expect(gifOf(result)).toEqual({ assetId: '', description: '', caption: '' });
});
