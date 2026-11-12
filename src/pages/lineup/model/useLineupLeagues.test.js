import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../../../api/apiClient';
import { useLineupLeagues } from './useLineupLeagues';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// The inventory read, answered by hand so a test can look at the hook while it is still on the wire.
function deferredInventory() {
  let resolve;
  apiClient.get.mockImplementation(() => new Promise((r) => { resolve = r; }));
  return (leagues) => act(async () => { resolve({ data: leagues }); });
}

const at = (route) => ({
  wrapper: ({ children }) => (
    <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
  ),
});

beforeEach(() => window.localStorage.clear());
afterEach(() => jest.clearAllMocks());

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

test('a bare /team reads the league it resolved to last time', async () => {
  let answer = deferredInventory();
  const { result: first, unmount: leaveFirst } = renderHook(() => useLineupLeagues(), at('/team'));
  expect(first.current.readLeagueId).toBeNull();
  await answer([{ id: 4, name: 'Four' }, { id: 5, name: 'Five' }]);
  await waitFor(() => expect(first.current.selectedLeagueId).toBe(4));
  leaveFirst();

  answer = deferredInventory();
  const { result: second, unmount: leaveSecond } = renderHook(() => useLineupLeagues(), at('/team'));
  expect(second.current.readLeagueId).toBe(4);
  expect(second.current.selectedLeagueId).toBeNull();

  // No fantasy league any more: nothing is read, and the next visit starts from the inventory again.
  await answer([]);
  await waitFor(() => expect(second.current.loading).toBe(false));
  expect(second.current.readLeagueId).toBeNull();
  leaveSecond();

  deferredInventory();
  expect(renderHook(() => useLineupLeagues(), at('/team')).result.current.readLeagueId).toBeNull();
});
