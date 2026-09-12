import { act, renderHook } from '@testing-library/react';
import useSavePicks from './useSavePicks';

const myPicks = [
  { gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 10 },
];

test('draftFor reads the server pick until a local edit exists', () => {
  const { result } = renderHook(() => useSavePicks({ myPicks, savePicks: jest.fn() }));
  expect(result.current.draftFor('DAL|WAS')).toEqual({ pickedTeam: 'DAL', confidence: 10 });
  expect(result.current.draftFor('NO|DET')).toBeNull();
});

test('pickWinner overlays a local pick without touching the server copy', () => {
  const { result } = renderHook(() => useSavePicks({ myPicks, savePicks: jest.fn() }));
  act(() => result.current.pickWinner('NO|DET', 'DET'));
  expect(result.current.draftFor('NO|DET')).toEqual({ pickedTeam: 'DET', confidence: null });
  expect(result.current.isDirty).toBe(true);
  expect(result.current.dirtyGameKeys.has('NO|DET')).toBe(true);
});

test('setConfidence keeps the picked team already on the draft', () => {
  const { result } = renderHook(() => useSavePicks({ myPicks, savePicks: jest.fn() }));
  act(() => result.current.pickWinner('NO|DET', 'DET'));
  act(() => result.current.setConfidence('NO|DET', 5));
  expect(result.current.draftFor('NO|DET')).toEqual({ pickedTeam: 'DET', confidence: 5 });
});

test('editing back to the server value is no longer dirty', () => {
  const { result } = renderHook(() => useSavePicks({ myPicks, savePicks: jest.fn() }));
  act(() => result.current.setConfidence('DAL|WAS', 3));
  expect(result.current.isDirty).toBe(true);
  act(() => result.current.setConfidence('DAL|WAS', 10));
  expect(result.current.isDirty).toBe(false);
});

test('save sends only the local overrides, never the whole saved slate', async () => {
  const savePicks = jest.fn().mockResolvedValue({ ok: true });
  const { result } = renderHook(() => useSavePicks({ myPicks, savePicks }));
  act(() => result.current.pickWinner('NO|DET', 'DET'));
  await act(async () => {
    await result.current.save();
  });
  expect(savePicks).toHaveBeenCalledWith([{ gameKey: 'NO|DET', pickedTeam: 'DET', confidence: null }]);
});

test('a successful save clears the local draft (the reload now carries it)', async () => {
  const savePicks = jest.fn().mockResolvedValue({ ok: true });
  const { result } = renderHook(() => useSavePicks({ myPicks, savePicks }));
  act(() => result.current.pickWinner('NO|DET', 'DET'));
  await act(async () => {
    await result.current.save();
  });
  expect(result.current.isDirty).toBe(false);
});

test('a rejected save keeps the draft and reports the flagged gameKeys', async () => {
  const savePicks = jest
    .fn()
    .mockResolvedValue({ ok: false, code: 'PICKEM_LOCKED', gameKeys: ['NO|DET'], message: 'too late' });
  const { result, rerender } = renderHook(
    (props) => useSavePicks(props),
    { initialProps: { myPicks, savePicks, saveError: null } }
  );
  act(() => result.current.pickWinner('NO|DET', 'DET'));
  let outcome;
  await act(async () => {
    outcome = await result.current.save();
  });
  expect(outcome.ok).toBe(false);
  rerender({ myPicks, savePicks, saveError: { code: 'PICKEM_LOCKED', gameKeys: ['NO|DET'] } });
  expect(result.current.flaggedGameKeys.has('NO|DET')).toBe(true);
  expect(result.current.draftFor('NO|DET')).toEqual({ pickedTeam: 'DET', confidence: null });
});

test('resetKey changing discards the local draft', () => {
  const { result, rerender } = renderHook(
    ({ resetKey }) => useSavePicks({ myPicks, savePicks: jest.fn(), resetKey }),
    { initialProps: { resetKey: 3 } }
  );
  act(() => result.current.pickWinner('NO|DET', 'DET'));
  expect(result.current.isDirty).toBe(true);
  rerender({ resetKey: 4 });
  expect(result.current.isDirty).toBe(false);
  expect(result.current.draftFor('NO|DET')).toBeNull();
});

test('discard clears every local edit', () => {
  const { result } = renderHook(() => useSavePicks({ myPicks, savePicks: jest.fn() }));
  act(() => result.current.pickWinner('NO|DET', 'DET'));
  act(() => result.current.discard());
  expect(result.current.isDirty).toBe(false);
});
