import { renderHook } from '@testing-library/react';
import { useApplyAdvice } from './useApplyAdvice';

// The patch, rollback, Undo, toasts and replay live in useLineupWrite (see
// useLineupWrite.test.js); this hook only turns an advice move plan into moves.
const setup = () => {
  const submit = jest.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useApplyAdvice({ submit }));
  return { result, submit };
};

test('submits exactly the named moves as one write, converting fromSlot/toSlot to the moves payload', async () => {
  const { result, submit } = setup();

  await result.current.apply([
    { playerId: 1, fromSlot: 'BENCH', toSlot: 'WR' },
    { playerId: 2, fromSlot: 'WR', toSlot: 'BENCH' },
  ]);

  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith([
    { playerId: 1, slot: 'WR' },
    { playerId: 2, slot: 'BENCH' },
  ]);
});

test('drops plan rows with no player or no target slot', async () => {
  const { result, submit } = setup();

  await result.current.apply([null, { playerId: null, toSlot: 'WR' }, { playerId: 3, fromSlot: 'WR' }, { playerId: 1, toSlot: 'BENCH' }]);

  expect(submit).toHaveBeenCalledWith([{ playerId: 1, slot: 'BENCH' }]);
});

test('an empty move plan writes nothing', async () => {
  const { result, submit } = setup();

  await result.current.apply([]);
  await result.current.apply(undefined);

  expect(submit).not.toHaveBeenCalled();
});
