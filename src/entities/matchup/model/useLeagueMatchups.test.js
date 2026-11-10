import { renderHook, waitFor, act } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import supabase from '../../../api/supabaseClient';
import { useLeagueMatchups } from './useLeagueMatchups';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// No live game is on the list in these cases, so the live-state reader is
// inert; the mock keeps it off the real Supabase client.
jest.mock('../../../api/supabaseClient', () => ({
  __esModule: true,
  default: { from: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() },
}));

// The score feed has its own tests (useMatchup, Game Center); this one is the
// list load, so the feed is a no-op here.
jest.mock('../../../shared/lib', () => ({
  ...jest.requireActual('../../../shared/lib'),
  subscribeToScoreFeed: jest.fn(() => () => {}),
}));

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const listRow = (id, homeName) => ({ id, season: 2026, week: 3, home_team_name: homeName });

beforeEach(() => {
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: [], error: null }) }),
  });
});

afterEach(() => jest.clearAllMocks());

test('when an earlier load answers last, the later answer stays on screen', async () => {
  const earlier = deferred();
  const later = deferred();
  apiClient.get.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);

  const { result } = renderHook(() => useLeagueMatchups(1));
  await act(async () => { result.current.refetch(); });

  await act(async () => { later.resolve({ data: [listRow(1, 'Later')] }); });
  await waitFor(() => expect(result.current.matchups[0]?.home.name).toBe('Later'));

  await act(async () => { earlier.resolve({ data: [listRow(1, 'Earlier')] }); });
  expect(result.current.matchups[0].home.name).toBe('Later');
});
