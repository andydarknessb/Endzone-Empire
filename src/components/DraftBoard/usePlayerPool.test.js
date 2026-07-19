import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import apiClient from '../../api/apiClient';
import usePlayerPool from './usePlayerPool';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const playersPage = (players = [], totalPages = 1) => ({ data: { players, totalPages } });

/** Renders a probe alongside the hook so tests can read the mirrored URL. */
function makeWrapper(initialEntry = '/league/1/draft') {
  const searchRef = { current: '' };
  function SearchProbe() {
    const [params] = useSearchParams();
    searchRef.current = params.toString();
    return null;
  }
  function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        {children}
        <SearchProbe />
      </MemoryRouter>
    );
  }
  return { Wrapper, searchRef };
}

beforeEach(() => {
  apiClient.get.mockResolvedValue(playersPage());
});

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

test('fetches page 1 on mount and clears the initial loading flag', async () => {
  const { Wrapper } = makeWrapper();
  const { result } = renderHook(() => usePlayerPool(1), { wrapper: Wrapper });

  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
    params: { page: 1, leagueId: 1, sort: 'adp', available: true },
  });
});

test('debounces the search box 300ms before committing and refetching', async () => {
  jest.useFakeTimers();
  const { Wrapper } = makeWrapper();
  const { result } = renderHook(() => usePlayerPool(1), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  apiClient.get.mockClear();

  act(() => result.current.setSearchInput('mahomes'));
  expect(result.current.search).toBe(''); // not committed yet
  expect(apiClient.get).not.toHaveBeenCalled();

  act(() => {
    jest.advanceTimersByTime(299);
  });
  expect(apiClient.get).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(result.current.search).toBe('mahomes');

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: { page: 1, leagueId: 1, sort: 'adp', available: true, search: 'mahomes' },
    })
  );
});

test('mirrors position/search/sort/dir/hideDrafted into the URL (replace)', async () => {
  const { Wrapper, searchRef } = makeWrapper();
  const { result } = renderHook(() => usePlayerPool(1), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));

  act(() => result.current.handlePositionFilterChange('RB'));
  await waitFor(() => expect(searchRef.current).toBe('pos=RB'));

  act(() => result.current.handleSort('name'));
  await waitFor(() => expect(searchRef.current).toBe('pos=RB&sort=name'));

  act(() => result.current.setHideDrafted(false));
  await waitFor(() => expect(searchRef.current).toBe('pos=RB&sort=name&showDrafted=1'));
});

test('loadMore appends the next page onto the existing list', async () => {
  apiClient.get.mockResolvedValueOnce(playersPage([{ id: 1, name: 'Page 1 Player' }], 2));
  const { Wrapper } = makeWrapper();
  const { result } = renderHook(() => usePlayerPool(1), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.hasMore).toBe(true);
  apiClient.get.mockResolvedValueOnce(playersPage([{ id: 2, name: 'Page 2 Player' }], 2));

  await act(async () => {
    result.current.loadMore();
  });

  await waitFor(() => expect(result.current.availablePlayers).toHaveLength(2));
  expect(result.current.availablePlayers.map((p) => p.id)).toEqual([1, 2]);
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/players', {
    params: { page: 2, leagueId: 1, sort: 'adp', available: true },
  });
  expect(result.current.hasMore).toBe(false);
});

test('a pick landing (refetch) does not re-trigger the initial loading flag', async () => {
  const { Wrapper } = makeWrapper();
  const { result } = renderHook(() => usePlayerPool(1), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    result.current.refetch();
  });

  expect(result.current.loading).toBe(false);
});
