import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import configureMockStore from 'redux-mock-store';
import apiClient from '../../../api/apiClient';
import { useLineupLeagues } from './useLineupLeagues';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const mockStore = configureMockStore([]);

// The inventory read, answered by hand so a test can look at the hook while it is still on the wire.
function deferredInventory() {
  let resolve;
  apiClient.get.mockImplementation(() => new Promise((r) => { resolve = r; }));
  return (leagues) => act(async () => { resolve({ data: leagues }); });
}

// The hook under a router on `route`, for the signed-in user `userId` (the store the page reads it from).
const at = (route, userId = 41) => {
  const store = mockStore({ user: { id: userId } });
  return {
    wrapper: ({ children }) => (
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
      </Provider>
    ),
  };
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

test('the league the URL names is read while the inventory loads, and the inventory confirms it', async () => {
  const answer = deferredInventory();
  const { result } = renderHook(() => useLineupLeagues(), at('/team?leagueId=2'));

  expect(result.current.readLeagueId).toBe(2);
  expect(result.current.selectedLeagueId).toBeNull();

  await answer([{ id: 1, name: 'One' }, { id: 2, name: 'Two' }]);
  await waitFor(() => expect(result.current.selectedLeagueId).toBe(2));
  expect(result.current.readLeagueId).toBe(2);
});

test('an inventory without the league the URL names moves the read to the first league', async () => {
  const answer = deferredInventory();
  const { result } = renderHook(() => useLineupLeagues(), at('/team?leagueId=9'));
  expect(result.current.readLeagueId).toBe(9);

  await answer([{ id: 1, name: 'One' }]);
  await waitFor(() => expect(result.current.selectedLeagueId).toBe(1));
  expect(result.current.readLeagueId).toBe(1);
});

test('a bare /team reads the league it resolved to last time, under this account', async () => {
  let answer = deferredInventory();
  const { result: first, unmount: leaveFirst } = renderHook(() => useLineupLeagues(), at('/team'));
  expect(first.current.readLeagueId).toBeNull();
  await answer([{ id: 4, name: 'Four' }, { id: 5, name: 'Five' }]);
  await waitFor(() => expect(first.current.selectedLeagueId).toBe(4));
  expect(window.localStorage.getItem('endzone_lineup_league:41')).toBe('4');
  leaveFirst();

  answer = deferredInventory();
  const { result: second, unmount: leaveSecond } = renderHook(() => useLineupLeagues(), at('/team'));
  expect(second.current.readLeagueId).toBe(4);
  expect(second.current.selectedLeagueId).toBeNull();

  // No fantasy league any more: nothing is read, and the next visit starts from the inventory again.
  await answer([]);
  await waitFor(() => expect(second.current.loading).toBe(false));
  expect(second.current.readLeagueId).toBeNull();
  expect(window.localStorage.getItem('endzone_lineup_league:41')).toBeNull();
  leaveSecond();

  deferredInventory();
  expect(renderHook(() => useLineupLeagues(), at('/team')).result.current.readLeagueId).toBeNull();
});

test("another account on this browser does not read the first account's remembered league", () => {
  window.localStorage.setItem('endzone_lineup_league:41', '4');
  deferredInventory();
  const { result } = renderHook(() => useLineupLeagues(), at('/team', 42));
  expect(result.current.readLeagueId).toBeNull();
});

test.each(['-5', 'Infinity', 'abc', '1.5'])('?leagueId=%s is not a league to read while the inventory loads', (id) => {
  deferredInventory();
  const { result } = renderHook(() => useLineupLeagues(), at(`/team?leagueId=${id}`));
  expect(result.current.readLeagueId).toBeNull();
});

test('storage that throws leaves the hook working: nothing is remembered and the league still resolves', async () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const answer = deferredInventory();
  const { result } = renderHook(() => useLineupLeagues(), at('/team'));
  expect(result.current.readLeagueId).toBeNull();

  await answer([{ id: 4, name: 'Four' }]);
  await waitFor(() => expect(result.current.selectedLeagueId).toBe(4));
  expect(result.current.error).toBeNull();
});
