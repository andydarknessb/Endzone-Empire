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
