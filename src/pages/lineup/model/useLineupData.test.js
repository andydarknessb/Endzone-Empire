import { useEffect } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useLineupData } from './useLineupData';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// A GET the test answers by hand, so the order the answers land in is chosen.
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const lineupBody = (week) => ({
  week, season: 2026, teamId: 10, currentWeek: week, rosterSlots: [], benchSlots: null, irSlots: null, entries: [],
});

afterEach(() => jest.clearAllMocks());

test('when an earlier week answers last, the later week stays on screen', async () => {
  const week2 = deferred();
  const week3 = deferred();
  apiClient.get.mockImplementation((url) => (url.includes('week=2') ? week2.promise : week3.promise));

  const { result, rerender } = renderHook(
    ({ week }) => useLineupData({ leagueId: 1, week }),
    { initialProps: { week: 2 } }
  );
  rerender({ week: 3 });
  await act(async () => { week3.resolve({ data: lineupBody(3) }); });
  await waitFor(() => expect(result.current.raw?.week).toBe(3));

  await act(async () => { week2.resolve({ data: lineupBody(2) }); });
  expect(result.current.raw.week).toBe(3);
  expect(result.current.loading).toBe(false);
});

// The league goes null while its load is still on the wire: that load must write nothing.
test('a load still in flight when the league goes null writes nothing', async () => {
  const answer = deferred();
  apiClient.get.mockImplementation(() => answer.promise);

  const { result, rerender } = renderHook(
    ({ leagueId }) => useLineupData({ leagueId, week: 2 }),
    { initialProps: { leagueId: 1 } }
  );
  rerender({ leagueId: null });
  await act(async () => { answer.resolve({ data: lineupBody(2) }); });

  expect(result.current.raw).toBeNull();
});

// The page starts this read on a league the inventory may correct: the corrected league never shows the first one's failure.
test('an error from a league the page has left is never shown for the next one', async () => {
  const next = deferred();
  apiClient.get.mockImplementation((url) => (url.includes('leagueId=1') ? Promise.reject(new Error('not your league')) : next.promise));
  const seen = [];

  const { result, rerender } = renderHook(
    ({ leagueId }) => {
      const state = useLineupData({ leagueId, week: 2 });
      seen.push([leagueId, state.error]);
      return state;
    },
    { initialProps: { leagueId: 1 } }
  );
  await waitFor(() => expect(result.current.error).toBe('not your league'));
  rerender({ leagueId: 2 });

  expect(seen.filter(([leagueId, error]) => leagueId === 2 && error)).toEqual([]);
});

// The committed renders under the new league show no roster and a loading flag until its own answer lands
// (recorded in an effect, so the render the reset discards is not counted as one the page showed).
test('a league change shows no roster and a loading flag until the new league answers', async () => {
  const first = deferred();
  const second = deferred();
  apiClient.get.mockImplementation((url) => (url.includes('leagueId=1') ? first.promise : second.promise));
  const seen = [];

  const { result, rerender } = renderHook(
    ({ leagueId }) => {
      const state = useLineupData({ leagueId, week: 2 });
      useEffect(() => { seen.push({ leagueId, raw: state.raw, loading: state.loading }); });
      return state;
    },
    { initialProps: { leagueId: 1 } }
  );
  await act(async () => { first.resolve({ data: lineupBody(2) }); });
  expect(result.current.raw.week).toBe(2);

  rerender({ leagueId: 2 });
  const underTwo = seen.filter((r) => r.leagueId === 2);
  expect(underTwo.length).toBeGreaterThan(0);
  expect(underTwo.every((r) => r.raw === null && r.loading === true)).toBe(true);

  await act(async () => { second.resolve({ data: lineupBody(2) }); });
  expect(result.current.raw.week).toBe(2);
  expect(result.current.loading).toBe(false);
});

// The page moved on from the read that failed: a week change (the same league) never shows its error.
test('an error from week 2 is not shown on the first render after the week changes to 3', async () => {
  const week3 = deferred();
  apiClient.get.mockImplementation((url) => (url.includes('week=2') ? Promise.reject(new Error('week two failed')) : week3.promise));
  const seen = [];

  const { result, rerender } = renderHook(
    ({ week }) => {
      const state = useLineupData({ leagueId: 1, week });
      seen.push([week, state.error]);
      return state;
    },
    { initialProps: { week: 2 } }
  );
  await waitFor(() => expect(result.current.error).toBe('week two failed'));
  rerender({ week: 3 });

  expect(seen.filter(([week, error]) => week === 3 && error)).toEqual([]);
});
