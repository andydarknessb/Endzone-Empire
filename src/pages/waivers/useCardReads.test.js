import { renderHook, act, waitFor } from '@testing-library/react';
import apiClient from '../../api/apiClient';
import { playerCardFromResponse, playerCardUrl } from '../../entities/player';
import { useCardReads } from './useCardReads';

jest.mock('../../api/apiClient');
jest.mock('../../entities/player', () => ({
  ...jest.requireActual('../../entities/player'),
  playerCardFromResponse: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  playerCardFromResponse.mockImplementation((d) => ({ ...d, viaModel: true }));
});

test('reads the card through the entity url builder and model', async () => {
  apiClient.get.mockResolvedValue({ data: { news: [] } });
  const { result } = renderHook(() => useCardReads(1));
  act(() => result.current.start(7));
  await waitFor(() => expect(result.current.read(7).status).toBe('ready'));
  expect(result.current.read(7).card.viaModel).toBe(true);
  expect(apiClient.get).toHaveBeenCalledWith(playerCardUrl({ leagueId: 1, playerId: 7 }));
});

test('a failed read keeps card null and is not retried', async () => {
  apiClient.get.mockRejectedValue(new Error('boom'));
  const { result } = renderHook(() => useCardReads(1));
  act(() => result.current.start(7));
  await waitFor(() => expect(result.current.read(7).status).toBe('error'));
  expect(result.current.read(7).card).toBeNull();
  act(() => result.current.start(7));
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});
