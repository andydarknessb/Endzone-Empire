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
