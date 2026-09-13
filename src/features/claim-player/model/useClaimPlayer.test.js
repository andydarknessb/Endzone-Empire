import React from 'react';
import { renderHook, act } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { SnackbarProvider } from '../../../components/Snackbar/SnackbarProvider';
import { useClaimPlayer } from './useClaimPlayer';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const wrapper = ({ children }) => <SnackbarProvider>{children}</SnackbarProvider>;

afterEach(() => jest.clearAllMocks());

test('submits a claim with no drop and no bid, then calls onDone', async () => {
  apiClient.post.mockResolvedValue({});
  const onDone = jest.fn();
  const { result } = renderHook(() => useClaimPlayer({ leagueId: 1, onDone }), { wrapper });

  let ok;
  await act(async () => {
    ok = await result.current.submitClaim({ playerId: 7 });
  });

  expect(ok).toBe(true);
  expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
    leagueId: 1,
    playerId: 7,
    dropPlayerId: null,
    bid: 0,
  });
  expect(onDone).toHaveBeenCalled();
});

test('submits a claim with a drop pick and a FAAB bid', async () => {
  apiClient.post.mockResolvedValue({});
  const { result } = renderHook(() => useClaimPlayer({ leagueId: 1 }), { wrapper });

  await act(async () => {
    await result.current.submitClaim({ playerId: 7, dropPlayerId: 20, bid: 40 });
  });

  expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
    leagueId: 1,
    playerId: 7,
    dropPlayerId: 20,
    bid: 40,
  });
});

test('a failed claim reports the failure and returns false', async () => {
  apiClient.post.mockRejectedValue({ response: { data: { message: 'Waivers have already cleared' } } });
  const onDone = jest.fn();
  const { result } = renderHook(() => useClaimPlayer({ leagueId: 1, onDone }), { wrapper });

  let ok;
  await act(async () => {
    ok = await result.current.submitClaim({ playerId: 7 });
  });

  expect(ok).toBe(false);
  expect(onDone).not.toHaveBeenCalled();
});
