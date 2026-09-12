import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useDropPlayer } from './useDropPlayer';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn(), delete: jest.fn() },
}));

const mockNotify = jest.fn();
jest.mock('../../../components/Snackbar/SnackbarProvider', () => ({
  useSnackbar: () => mockNotify,
}));

afterEach(() => {
  jest.clearAllMocks();
});

const entry = { playerId: 5, name: 'D. Adams' };

test('requestDrop sets the candidate; closeDropConfirmation clears it without dropping', () => {
  const { result } = renderHook(() => useDropPlayer({ leagueId: 7, refresh: jest.fn() }));
  act(() => result.current.requestDrop(entry));
  expect(result.current.dropCandidate).toBe(entry);
  act(() => result.current.closeDropConfirmation());
  expect(result.current.dropCandidate).toBeNull();
  expect(apiClient.delete).not.toHaveBeenCalled();
});

test('confirmDrop deletes the roster row, refreshes, and offers an Undo toast', async () => {
  apiClient.delete.mockResolvedValue({});
  const refresh = jest.fn().mockResolvedValue();
  const { result } = renderHook(() => useDropPlayer({ leagueId: 7, refresh }));
  act(() => result.current.requestDrop(entry));
  await act(async () => result.current.confirmDrop());

  expect(apiClient.delete).toHaveBeenCalledWith('/api/team/roster/5?leagueId=7');
  expect(refresh).toHaveBeenCalled();
  expect(mockNotify).toHaveBeenCalledWith(
    'Dropped D. Adams',
    expect.objectContaining({ severity: 'info', actionLabel: 'Undo' })
  );
  expect(result.current.dropCandidate).toBeNull();
});

test('the Undo action posts undo-drop and refreshes again', async () => {
  apiClient.delete.mockResolvedValue({});
  apiClient.post.mockResolvedValue({});
  const refresh = jest.fn().mockResolvedValue();
  const { result } = renderHook(() => useDropPlayer({ leagueId: 7, refresh }));
  act(() => result.current.requestDrop(entry));
  await act(async () => result.current.confirmDrop());

  const [, options] = mockNotify.mock.calls[0];
  await act(async () => options.onAction());

  expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/5/undo-drop', { leagueId: 7 });
  expect(refresh).toHaveBeenCalledTimes(2);
});

test('a failed drop notifies the error and never calls refresh', async () => {
  apiClient.delete.mockRejectedValue({ response: { status: 500, data: { error: 'nope' } } });
  const refresh = jest.fn();
  const { result } = renderHook(() => useDropPlayer({ leagueId: 7, refresh }));
  act(() => result.current.requestDrop(entry));
  await act(async () => result.current.confirmDrop());

  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith(expect.any(String), { severity: 'error' }));
  expect(refresh).not.toHaveBeenCalled();
});

test('confirmDrop with no candidate is a no-op', async () => {
  const { result } = renderHook(() => useDropPlayer({ leagueId: 7, refresh: jest.fn() }));
  await act(async () => result.current.confirmDrop());
  expect(apiClient.delete).not.toHaveBeenCalled();
});
