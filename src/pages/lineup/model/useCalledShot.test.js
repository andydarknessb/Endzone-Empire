import { act, renderHook } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useCalledShot } from './useCalledShot';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn(), delete: jest.fn() },
}));

const view = { sit: { playerId: 1, name: 'Kept' }, start: { playerId: 2, name: 'Passed' } };

afterEach(() => {
  jest.clearAllMocks();
});

test('callShot posts the pair for the viewed week, then asks for a re-read (#1856)', async () => {
  apiClient.post.mockResolvedValue({ data: {} });
  const onChanged = jest.fn();
  const { result } = renderHook(() => useCalledShot({ leagueId: '3', week: 6, onChanged }));
  await act(async () => { await result.current.callShot(view); });
  expect(apiClient.post).toHaveBeenCalledWith('/api/team/lineup/called-shot', {
    leagueId: 3, week: 6, starterId: 1, benchedId: 2,
  });
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(result.current.busy).toBe(false);
});

test('withdrawShot deletes the shot for the viewed week, then asks for a re-read', async () => {
  apiClient.delete.mockResolvedValue({ data: {} });
  const onChanged = jest.fn();
  const { result } = renderHook(() => useCalledShot({ leagueId: 3, week: 6, onChanged }));
  await act(async () => { await result.current.withdrawShot(); });
  expect(apiClient.delete).toHaveBeenCalledWith('/api/team/lineup/called-shot?leagueId=3&week=6');
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('a refusal is swallowed into a notice and changes nothing (#1856)', async () => {
  apiClient.post.mockRejectedValue({ response: { status: 409, data: { error: 'that pair is too close to call' } } });
  const onChanged = jest.fn();
  const { result } = renderHook(() => useCalledShot({ leagueId: 3, week: 6, onChanged }));
  await act(async () => { await result.current.callShot(view); });
  expect(onChanged).not.toHaveBeenCalled();
  expect(result.current.busy).toBe(false);
});
