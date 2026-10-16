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
  const savePicks = jest.fn().mockResolvedValue({
    ok: false, status: 409, code: 'PICKEM_LOCKED', gameKeys: ['DAL|DEN'], message: 'locked',
  });
  const { result } = setup({ savePicks });
  await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
  expect(result.current.stateFor('DAL|DEN')).toMatchObject({
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

describe('which failures can be retried', () => {
  const fail = (extra) => jest.fn().mockResolvedValue({ ok: false, gameKeys: [], message: 'x', ...extra });

  test.each([
    ['a network error (no status)', { status: null, code: null }],
    ['a 500', { status: 500, code: null }],
    ['a 503', { status: 503, code: null }],
  ])('%s is failed, with Retry', async (_label, extra) => {
    const { result } = setup({ savePicks: fail(extra) });
    await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
    expect(result.current.stateFor('DAL|DEN')).toMatchObject({ status: 'failed', message: "Couldn't save this pick." });
    expect(result.current.stateFor('DAL|DEN').retry).toBeTruthy();
  });

  test('a 400 PICKEM_BAD_CONFIDENCE is refused with its own words and no Retry', async () => {
    const ranked = [{ gameKey: 'ARI|SF', pickedTeam: 'SF', confidence: 7 }];
    const { result } = setup({
      mode: 'confidence', myPicks: ranked, savePicks: fail({ status: 400, code: 'PICKEM_BAD_CONFIDENCE', gameKeys: ['ARI|SF'] }),
    });
    await act(async () => { result.current.setConfidence('ARI|SF', 3); });
    expect(result.current.stateFor('ARI|SF')).toMatchObject({ status: 'refused', message: 'That rank is already taken. Choose another rank.' });
    expect(result.current.stateFor('ARI|SF').retry).toBeUndefined();
  });

  test('any other 4xx is refused too, never retried', async () => {
    const { result } = setup({ savePicks: fail({ status: 403, code: 'PICKEM_DISABLED' }) });
    await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
    expect(result.current.stateFor('DAL|DEN')).toMatchObject({
      status: 'refused', message: "This pick wasn't saved. Reload the page and try again.",
    });
  });

  test("the unlocked half of a 409'd swap is refused with its own words and no Retry", async () => {
    const ranked = [
      { gameKey: 'DAL|DEN', pickedTeam: 'DAL', confidence: 4 },
      { gameKey: 'ARI|SF', pickedTeam: 'SF', confidence: 7 },
    ];
    const savePicks = fail({ status: 409, code: 'PICKEM_LOCKED', gameKeys: ['DAL|DEN'] });
    const { result } = setup({ mode: 'confidence', myPicks: ranked, savePicks });
    await act(async () => { result.current.setConfidence('ARI|SF', 4); });
    expect(result.current.stateFor('DAL|DEN')).toMatchObject({
      status: 'refused',
      message: "This pick wasn't saved: DAL @ DEN had already kicked off. Your other picks are saved.",
    });
    expect(result.current.stateFor('ARI|SF')).toMatchObject({
      status: 'refused', message: "This swap wasn't saved: DAL @ DEN had already kicked off.",
    });
    expect(result.current.stateFor('ARI|SF').retry).toBeUndefined();
  });
});

test('Undo refused after kickoff says the undo did not go through and that the pick stands', async () => {
  const savePicks = jest.fn()
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({
      ok: false, status: 409, code: 'PICKEM_LOCKED', gameKeys: ['DAL|DEN'], message: 'locked',
    });
  const { result, rerender } = setup({ savePicks });
  await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
  // The board now holds the saved pick (usePickemWeek patches myPicks).
  rerender({ myPicks: [{ gameKey: 'DAL|DEN', pickedTeam: 'DEN', confidence: null }] });
  await act(async () => { result.current.undo('DAL|DEN'); });
  expect(result.current.stateFor('DAL|DEN')).toMatchObject({
    status: 'refused', message: "Undo didn't go through: DAL @ DEN kicked off. Your pick DEN stands.",
  });
  expect(result.current.stateFor('DAL|DEN').retry).toBeUndefined();
});

test("a later save that touches a game another card's Undo would restore ends that card's Undo", async () => {
  const ranked = [
    { gameKey: 'DAL|DEN', pickedTeam: 'DAL', confidence: 4 },
    { gameKey: 'ARI|SF', pickedTeam: 'SF', confidence: 7 },
  ];
  const { result } = setup({ mode: 'confidence', myPicks: ranked });
  await act(async () => { result.current.setConfidence('ARI|SF', 4); }); // a swap: both cards saved with Undo
  expect(result.current.stateFor('ARI|SF').status).toBe('saved');
  expect(result.current.stateFor('DAL|DEN').status).toBe('saved');

  // A later save to the partner game: the other card's Undo (which would put the old rank back on this
  // game) is stale, so its saved state ends; the card just saved has its own new state.
  await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
  expect(result.current.stateFor('ARI|SF')).toBeNull();
  expect(result.current.stateFor('DAL|DEN').status).toBe('saved');
});

test("a save that touches an unrelated game leaves another card's Undo alone", async () => {
  const { result } = setup();
  await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
  await act(async () => { result.current.pickWinner('ARI|SF', 'SF'); });
  expect(result.current.stateFor('DAL|DEN').status).toBe('saved');
});

describe('one rank save at a time', () => {
  const ranked = [
    { gameKey: 'DAL|DEN', pickedTeam: 'DAL', confidence: 4 },
    { gameKey: 'ARI|SF', pickedTeam: 'SF', confidence: 7 },
  ];

  test('a rank change while another is in flight is told to wait, in a plain line, and sends nothing; it clears when the save settles', async () => {
    let release;
    const savePicks = jest.fn(() => new Promise((resolve) => { release = resolve; }));
    const { result } = setup({ mode: 'confidence', myPicks: ranked, savePicks });
    act(() => { result.current.setConfidence('DAL|DEN', 9); });
    act(() => { result.current.setConfidence('ARI|SF', 8); });
    expect(savePicks).toHaveBeenCalledTimes(1);
    expect(result.current.stateFor('ARI|SF')).toMatchObject({
      status: 'busy', message: 'Another rank is still saving. Choose this rank again in a moment.',
    });
    await act(async () => { release({ ok: true }); });
    expect(result.current.stateFor('ARI|SF')).toBeNull();
    // Once the first has settled the same change goes through.
    savePicks.mockResolvedValue({ ok: true });
    await act(async () => { result.current.setConfidence('ARI|SF', 8); });
    expect(savePicks).toHaveBeenCalledTimes(2);
  });

  test('a team change on a ranked pick keeps its rank and is not a rank change, so it is not held back', async () => {
    let release;
    const savePicks = jest.fn(() => new Promise((resolve) => { release = resolve; }));
    const { result } = setup({ mode: 'confidence', myPicks: ranked, savePicks });
    act(() => { result.current.setConfidence('DAL|DEN', 9); });
    act(() => { result.current.pickWinner('ARI|SF', 'ARI'); });
    expect(savePicks).toHaveBeenCalledTimes(2);
    await act(async () => { release({ ok: true }); });
  });

  test('straight up has no such wait', async () => {
    const savePicks = jest.fn(() => new Promise(() => {}));
    const { result } = setup({ savePicks });
    act(() => { result.current.pickWinner('DAL|DEN', 'DEN'); });
    act(() => { result.current.pickWinner('ARI|SF', 'SF'); });
    expect(savePicks).toHaveBeenCalledTimes(2);
  });

  test('a saved card keeps its Undo when a wait ends', async () => {
    let release;
    const savePicks = jest.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const { result } = setup({ mode: 'confidence', myPicks: ranked, savePicks });
    await act(async () => { result.current.setConfidence('ARI|SF', 8); });
    expect(result.current.stateFor('ARI|SF').status).toBe('saved');
    act(() => { result.current.setConfidence('DAL|DEN', 9); });
    act(() => { result.current.undo('ARI|SF'); });
    expect(result.current.stateFor('ARI|SF').status).toBe('busy');
    await act(async () => { release({ ok: true }); });
    expect(result.current.stateFor('ARI|SF').status).toBe('saved');
  });
});

test('a settled state names the team whose button should take focus: the restored pick after Undo, the undone team after a first pick', async () => {
  const savePicks = jest.fn().mockResolvedValue({ ok: true });
  const { result, rerender } = setup({ savePicks, myPicks: [{ gameKey: 'DAL|DEN', pickedTeam: 'DAL', confidence: null }] });
  await act(async () => { result.current.pickWinner('DAL|DEN', 'DEN'); });
  expect(result.current.stateFor('DAL|DEN').focusTeam).toBe('DEN');
  rerender({ myPicks: [{ gameKey: 'DAL|DEN', pickedTeam: 'DEN', confidence: null }] });
  await act(async () => { result.current.undo('DAL|DEN'); });
  expect(result.current.stateFor('DAL|DEN')).toMatchObject({ status: 'undone', focusTeam: 'DAL' });

  // Undo of a first pick: nothing holds the pick, so the team that was undone is where focus returns.
  const first = setup();
  await act(async () => { first.result.current.pickWinner('ARI|SF', 'SF'); });
  first.rerender({ myPicks: [{ gameKey: 'ARI|SF', pickedTeam: 'SF', confidence: null }] });
  await act(async () => { first.result.current.undo('ARI|SF'); });
  expect(first.result.current.stateFor('ARI|SF')).toMatchObject({ status: 'undone', focusTeam: 'SF' });
});
