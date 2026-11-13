import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useAdvice } from './useAdvice';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('fetches the advice endpoint for the given league/week and shapes the response', async () => {
  apiClient.get.mockResolvedValue({
    data: { suggestions: [{ slot: 'WR' }], movePlan: [{ playerId: 1, toSlot: 'WR' }], projectedTotal: 90, optimalTotal: 95 },
  });
  const { result } = renderHook(() => useAdvice({ leagueId: 1, week: 4, bestBall: false }));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(apiClient.get).toHaveBeenCalledWith('/api/team/lineup/advice?leagueId=1&week=4');
  expect(result.current.suggestions).toEqual([{ slot: 'WR' }]);
  expect(result.current.movePlan).toEqual([{ playerId: 1, toSlot: 'WR' }]);
  expect(result.current.optimalTotal).toBe(95);
});

// #2886: `pending` is the first read still out, `failed` the first read rejected; a reload is neither.
test('pending is true until the first answer, then false (#2886)', async () => {
  let answer;
  apiClient.get.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
  const { result } = renderHook(() => useAdvice({ leagueId: 1, week: 4, bestBall: false }));
  expect(result.current.pending).toBe(true);
  expect(result.current.failed).toBe(false);

  await act(async () => { answer({ data: { suggestions: [] } }); });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.pending).toBe(false);
});

test('a reload is neither pending nor failed while the previous advice is held (#2886)', async () => {
  apiClient.get.mockResolvedValueOnce({ data: { suggestions: [{ slot: 'WR' }] } });
  const { result } = renderHook(() => useAdvice({ leagueId: 1, week: 4, bestBall: false }));
  await waitFor(() => expect(result.current.status).toBe('ready'));

  let release;
  apiClient.get.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  act(() => result.current.reload());
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
  expect(result.current.pending).toBe(false);
  expect(result.current.failed).toBe(false);

  await act(async () => { release({ data: { suggestions: [] } }); });
  await waitFor(() => expect(result.current.suggestions).toEqual([]));
});

test('failed is true when the first read rejects (#2886)', async () => {
  apiClient.get.mockRejectedValueOnce(new Error('boom'));
  const { result } = renderHook(() => useAdvice({ leagueId: 1, week: 4, bestBall: false }));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.status).toBe('error');
  expect(result.current.pending).toBe(false);
});

test('a reload that fails keeps the previous advice and is neither pending nor failed (#2886)', async () => {
  apiClient.get.mockResolvedValueOnce({ data: { suggestions: [{ slot: 'WR' }] } });
  const { result } = renderHook(() => useAdvice({ leagueId: 1, week: 4, bestBall: false }));
  await waitFor(() => expect(result.current.status).toBe('ready'));

  apiClient.get.mockRejectedValueOnce(new Error('boom'));
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.suggestions).toEqual([{ slot: 'WR' }]);
  expect(result.current.pending).toBe(false);
  expect(result.current.failed).toBe(false);
});

test('a week change is pending at once and never shows the previous week\'s suggestions (#2886)', async () => {
  apiClient.get.mockResolvedValueOnce({ data: { suggestions: [{ slot: 'WR' }] } });
  const seen = [];
  const { rerender } = renderHook(({ week }) => {
    const advice = useAdvice({ leagueId: 1, week, bestBall: false });
    seen.push(advice);
    return advice;
  }, { initialProps: { week: 4 } });
  await waitFor(() => expect(seen[seen.length - 1].suggestions).toEqual([{ slot: 'WR' }]));

  apiClient.get.mockImplementationOnce(() => new Promise(() => {}));
  seen.length = 0;
  rerender({ week: 5 });
  expect(seen.length).toBeGreaterThan(0);
  seen.forEach((advice) => {
    expect(advice.pending).toBe(true);
    expect(advice.suggestions).toEqual([]);
  });
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/team/lineup/advice?leagueId=1&week=5');
});

test.each([
  ['no league', { leagueId: null, week: 4, bestBall: false }],
  ['no week', { leagueId: 1, week: null, bestBall: false }],
  ['best ball', { leagueId: 1, week: 4, bestBall: true }],
])('%s is neither pending nor failed (#2886)', (_, args) => {
  const { result } = renderHook(() => useAdvice(args));
  expect(result.current.pending).toBe(false);
  expect(result.current.failed).toBe(false);
});

test('best ball never calls the endpoint at all', () => {
  const { result } = renderHook(() => useAdvice({ leagueId: 1, week: 4, bestBall: true }));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.status).toBe('hidden');
  expect(result.current.suggestions).toEqual([]);
});

test('a missing league or week idles with no request', () => {
  const { result } = renderHook(() => useAdvice({ leagueId: null, week: null, bestBall: false }));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.suggestions).toEqual([]);
  expect(result.current.movePlan).toEqual([]);
});

test('carries the called shot from the payload, null when there is none (#1856)', async () => {
  apiClient.get.mockResolvedValue({ data: { suggestions: [], calledShot: { status: 'pending' } } });
  const { result } = renderHook(() => useAdvice({ leagueId: 1, week: 4, bestBall: false }));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.calledShot).toEqual({ status: 'pending' });

  apiClient.get.mockResolvedValue({ data: { suggestions: [] } });
  const { result: second } = renderHook(() => useAdvice({ leagueId: 2, week: 4, bestBall: false }));
  await waitFor(() => expect(second.current.status).toBe('ready'));
  expect(second.current.calledShot).toBeNull();
});

test('reload re-reads the advice and keeps the previous advice on screen meanwhile (#1856)', async () => {
  apiClient.get.mockResolvedValueOnce({ data: { suggestions: [{ slot: 'WR' }], calledShot: null } });
  const { result } = renderHook(() => useAdvice({ leagueId: 1, week: 4, bestBall: false }));
  await waitFor(() => expect(result.current.status).toBe('ready'));

  let release;
  apiClient.get.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  act(() => result.current.reload());
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
  expect(apiClient.get.mock.calls[1][0]).toBe('/api/team/lineup/advice?leagueId=1&week=4&reload=1');
  // In flight: the card is not emptied.
  expect(result.current.suggestions).toEqual([{ slot: 'WR' }]);

  await act(async () => { release({ data: { suggestions: [], calledShot: { status: 'pending' } } }); });
  await waitFor(() => expect(result.current.calledShot).toEqual({ status: 'pending' }));
  expect(result.current.suggestions).toEqual([]);
});

// The Forecast's three season lines read these off the advice payload (decision.service.js: pointsLeft,
// overrideRecord, calledShotRecord); dropping them here left "Left on the bench this season" nowhere on the page.
test('carries pointsLeft, overrideRecord and calledShotRecord from the payload, null when absent', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      suggestions: [],
      pointsLeft: { total: 38.6, rank: 4, teams: 12 },
      overrideRecord: { hits: 3, misses: 2 },
      calledShotRecord: { hits: 2, resolved: 3, streak: 1 },
    },
  });
  const { result } = renderHook(() => useAdvice({ leagueId: 1, week: 4, bestBall: false }));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.pointsLeft).toEqual({ total: 38.6, rank: 4, teams: 12 });
  expect(result.current.overrideRecord).toEqual({ hits: 3, misses: 2 });
  expect(result.current.calledShotRecord).toEqual({ hits: 2, resolved: 3, streak: 1 });

  apiClient.get.mockResolvedValue({ data: { suggestions: [] } });
  const { result: second } = renderHook(() => useAdvice({ leagueId: 2, week: 4, bestBall: false }));
  await waitFor(() => expect(second.current.status).toBe('ready'));
  expect(second.current.pointsLeft).toBeNull();
  expect(second.current.overrideRecord).toBeNull();
  expect(second.current.calledShotRecord).toBeNull();
});
