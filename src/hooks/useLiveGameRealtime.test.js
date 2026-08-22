import { renderHook, waitFor, act } from '@testing-library/react';
import supabase from '../api/supabaseClient';
import useLiveGameRealtime from './useLiveGameRealtime';

jest.mock('../api/supabaseClient', () => ({
  __esModule: true,
  default: {
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

function mockFetchResult({ data = null, error = null } = {}) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error });
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });
  supabase.from.mockReturnValue({ select });
  return { eq };
}

function mockChannel() {
  let handler;
  const channelObj = {
    on: jest.fn((_event, _filter, cb) => {
      handler = cb;
      return channelObj;
    }),
    subscribe: jest.fn(() => channelObj),
  };
  supabase.channel.mockReturnValue(channelObj);
  return { channelObj, push: (payload) => act(() => handler(payload)) };
}

afterEach(() => {
  jest.clearAllMocks();
});

test('fetches initial state on mount and does not subscribe when scheduled', async () => {
  const scheduled = { tank01_game_id: '20260914_DEN@KC', game_status: 'scheduled' };
  mockFetchResult({ data: scheduled });
  mockChannel();

  const { result } = renderHook(() => useLiveGameRealtime('20260914_DEN@KC'));
  expect(result.current.loading).toBe(true);

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.state).toEqual(scheduled);
  expect(supabase.channel).not.toHaveBeenCalled();
});

test('filters the initial fetch by tank01_game_id, not the internal serial id', async () => {
  const { eq } = mockFetchResult({ data: { tank01_game_id: 'abc', game_status: 'final' } });
  mockChannel();

  const { result } = renderHook(() => useLiveGameRealtime('abc'));
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(supabase.from).toHaveBeenCalledWith('live_game_states');
  expect(eq).toHaveBeenCalledWith('tank01_game_id', 'abc');
});

test('subscribes when the initial status is in_progress, filtering by tank01_game_id', async () => {
  mockFetchResult({ data: { tank01_game_id: 'live1', game_status: 'in_progress' } });
  const { channelObj } = mockChannel();

  const { result } = renderHook(() => useLiveGameRealtime('live1'));
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(supabase.channel).toHaveBeenCalledWith('live-game-live1');
  expect(channelObj.on).toHaveBeenCalledWith(
    'postgres_changes',
    expect.objectContaining({ filter: 'tank01_game_id=eq.live1' }),
    expect.any(Function)
  );
});

test('does not subscribe when the initial status is final', async () => {
  mockFetchResult({ data: { tank01_game_id: 'done1', game_status: 'final' } });
  mockChannel();

  const { result } = renderHook(() => useLiveGameRealtime('done1'));
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(supabase.channel).not.toHaveBeenCalled();
});

test('updates state on a pushed update and unsubscribes once status flips to final', async () => {
  mockFetchResult({ data: { tank01_game_id: 'live2', game_status: 'in_progress' } });
  const { push } = mockChannel();

  const { result } = renderHook(() => useLiveGameRealtime('live2'));
  await waitFor(() => expect(result.current.loading).toBe(false));

  push({ new: { tank01_game_id: 'live2', game_status: 'in_progress', current_score_home: 7 } });
  expect(result.current.state.current_score_home).toBe(7);
  expect(supabase.removeChannel).not.toHaveBeenCalled();

  push({ new: { tank01_game_id: 'live2', game_status: 'final', current_score_home: 21 } });
  expect(result.current.state.game_status).toBe('final');
  expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
});

test('unsubscribes on unmount', async () => {
  mockFetchResult({ data: { tank01_game_id: 'live3', game_status: 'in_progress' } });
  mockChannel();

  const { result, unmount } = renderHook(() => useLiveGameRealtime('live3'));
  await waitFor(() => expect(result.current.loading).toBe(false));

  unmount();
  expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
});

test('surfaces a fetch error and clears loading', async () => {
  mockFetchResult({ error: { message: 'boom' } });
  mockChannel();

  const { result } = renderHook(() => useLiveGameRealtime('erroring'));
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.error).toBe('boom');
  expect(supabase.channel).not.toHaveBeenCalled();
});
