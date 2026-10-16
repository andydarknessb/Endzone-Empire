import { act, renderHook } from '@testing-library/react';
import useSavePicks from './useSavePicks';

const views = [
  { gameKey: 'DAL|DEN', teams: ['DAL', 'DEN'], lock: false },
  { gameKey: 'ARI|SF', teams: ['ARI', 'SF'], lock: false },
  { gameKey: 'PHI|MIN', teams: ['PHI', 'MIN'], lock: true },
];

const setup = ({ mode = 'straight', myPicks = [], savePicks = jest.fn().mockResolvedValue({ ok: true }), ...rest } = {}) => {
  const view = renderHook((props) => useSavePicks({ mode, views, savePicks, resetKey: 7, ...props }), {
    initialProps: { myPicks, ...rest },
  });
  return { ...view, savePicks };
};

test('choosing a team sends a one-element picks array and lands as saved with an Undo', async () => {
  const { result, savePicks } = setup();
  await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
  expect(savePicks).toHaveBeenCalledTimes(1);
  expect(savePicks).toHaveBeenCalledWith([{ gameKey: 'DAL|DEN', pickedTeam: 'DEN', confidence: null }]);
  expect(result.current.stateFor('DAL|DEN')).toMatchObject({ status: 'saved' });
});

test('the state is saving while the request is in flight, with the attempted pick', async () => {
  let release;
  const savePicks = jest.fn(() => new Promise((resolve) => { release = resolve; }));
  const { result } = setup({ savePicks });
  act(() => { result.current.pickWinner('DAL|DEN', 'DEN'); });
  expect(result.current.stateFor('DAL|DEN')).toMatchObject({ status: 'saving', attempted: { pickedTeam: 'DEN' } });
  await act(async () => { release({ ok: true }); });
  expect(result.current.stateFor('DAL|DEN').status).toBe('saved');
});

test('Undo of a first pick sends pickedTeam null; Undo of a change restores the previous pick', async () => {
  const first = setup();
  await act(async () => { first.result.current.pickWinner('DAL|DEN', 'DEN'); });
  await act(async () => { first.result.current.undo('DAL|DEN'); });
  expect(first.savePicks).toHaveBeenLastCalledWith([{ gameKey: 'DAL|DEN', pickedTeam: null, confidence: null }]);
  expect(first.result.current.stateFor('DAL|DEN').status).toBe('undone');

  const change = setup({ myPicks: [{ gameKey: 'DAL|DEN', pickedTeam: 'DAL', confidence: null }] });
  await act(async () => { change.result.current.pickWinner('DAL|DEN', 'DEN'); });
  await act(async () => { change.result.current.undo('DAL|DEN'); });
  expect(change.savePicks).toHaveBeenLastCalledWith([{ gameKey: 'DAL|DEN', pickedTeam: 'DAL', confidence: null }]);
});

test('tapping the saved team again, a locked game, or a card mid-save sends nothing', async () => {
  const { result, savePicks } = setup({ myPicks: [{ gameKey: 'DAL|DEN', pickedTeam: 'DAL', confidence: null }] });
  await act(async () => { result.current.pickWinner('DAL|DEN', 'DAL'); });
  await act(async () => { result.current.pickWinner('PHI|MIN', 'PHI'); });
  expect(savePicks).not.toHaveBeenCalled();
});

test('a failed save keeps the attempted pick and Retry sends it again', async () => {
  const savePicks = jest.fn()
    .mockResolvedValueOnce({ ok: false, code: null, gameKeys: [], message: 'boom' })
    .mockResolvedValueOnce({ ok: true });
  const { result } = setup({ savePicks });
  await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
  expect(result.current.stateFor('DAL|DEN')).toMatchObject({
    status: 'failed', attempted: { pickedTeam: 'DEN' }, message: "Couldn't save this pick.",
  });
  await act(async () => { result.current.retry('DAL|DEN'); });
  expect(savePicks).toHaveBeenCalledTimes(2);
  expect(savePicks).toHaveBeenLastCalledWith([{ gameKey: 'DAL|DEN', pickedTeam: 'DEN', confidence: null }]);
  expect(result.current.stateFor('DAL|DEN').status).toBe('saved');
});

test('PICKEM_LOCKED names the kicked-off game on that card and offers no retry', async () => {
  const savePicks = jest.fn().mockResolvedValue({ ok: false, code: 'PICKEM_LOCKED', gameKeys: ['DAL|DEN'], message: 'locked' });
  const { result } = setup({ savePicks });
  await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
  expect(result.current.stateFor('DAL|DEN')).toEqual({
    status: 'refused',
    message: "This pick wasn't saved: DAL @ DEN had already kicked off. Your other picks are saved.",
  });
  expect(result.current.stateFor('ARI|SF')).toBeNull();
});

describe('confidence mode', () => {
  const ranked = [
    { gameKey: 'DAL|DEN', pickedTeam: 'DAL', confidence: 4 },
    { gameKey: 'ARI|SF', pickedTeam: 'SF', confidence: 7 },
    { gameKey: 'PHI|MIN', pickedTeam: 'PHI', confidence: 9 },
  ];

  test('a team with no rank yet is a draft: nothing is sent until the rank is chosen', async () => {
    const { result, savePicks } = setup({ mode: 'confidence' });
    await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
    expect(savePicks).not.toHaveBeenCalled();
    expect(result.current.stateFor('DAL|DEN')).toMatchObject({ status: 'draft', attempted: { pickedTeam: 'DEN' } });

    await act(async () => { result.current.setConfidence('DAL|DEN', 3); });
    expect(savePicks).toHaveBeenCalledWith([{ gameKey: 'DAL|DEN', pickedTeam: 'DEN', confidence: 3 }]);
  });

  test('changing the team of a ranked pick keeps its rank', async () => {
    const { result, savePicks } = setup({ mode: 'confidence', myPicks: ranked });
    await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
    expect(savePicks).toHaveBeenCalledWith([{ gameKey: 'DAL|DEN', pickedTeam: 'DEN', confidence: 4 }]);
  });

  test('choosing a rank another open game holds swaps the two in ONE request', async () => {
    const { result, savePicks } = setup({ mode: 'confidence', myPicks: ranked });
    await act(async () => { result.current.setConfidence('ARI|SF', 4); });
    expect(savePicks).toHaveBeenCalledTimes(1);
    expect(savePicks).toHaveBeenCalledWith([
      { gameKey: 'ARI|SF', pickedTeam: 'SF', confidence: 4 },
      { gameKey: 'DAL|DEN', pickedTeam: 'DAL', confidence: 7 },
    ]);
    expect(result.current.stateFor('ARI|SF')).toMatchObject({ status: 'saved', swap: 'DAL @ DEN' });
    expect(result.current.stateFor('DAL|DEN')).toMatchObject({ status: 'saved', swap: 'ARI @ SF' });

    await act(async () => { result.current.undo('ARI|SF'); });
    expect(savePicks).toHaveBeenLastCalledWith([
      { gameKey: 'ARI|SF', pickedTeam: 'SF', confidence: 7 },
      { gameKey: 'DAL|DEN', pickedTeam: 'DAL', confidence: 4 },
    ]);
  });

  test('a rank held by a kicked-off game is refused on the card and never sent', async () => {
    const { result, savePicks } = setup({ mode: 'confidence', myPicks: ranked });
    await act(async () => { result.current.setConfidence('ARI|SF', 9); });
    expect(savePicks).not.toHaveBeenCalled();
    expect(result.current.stateFor('ARI|SF')).toMatchObject({
      status: 'refused', message: 'Rank 9 is locked to PHI @ MIN. Choose another rank.',
    });
  });

  test('"Confidence: none" is not a save', async () => {
    const { result, savePicks } = setup({ mode: 'confidence', myPicks: ranked });
    await act(async () => { result.current.setConfidence('DAL|DEN', null); });
    expect(savePicks).not.toHaveBeenCalled();
  });
});

test('changing the week clears every card state and drops a result that lands late', async () => {
  let release;
  const savePicks = jest.fn(() => new Promise((resolve) => { release = resolve; }));
  const { result, rerender } = setup({ savePicks });
  act(() => { result.current.pickWinner('DAL|DEN', 'DEN'); });
  rerender({ resetKey: 8, myPicks: [] });
  expect(result.current.stateFor('DAL|DEN')).toBeNull();
  await act(async () => { release({ ok: true }); });
  expect(result.current.stateFor('DAL|DEN')).toBeNull();
});
