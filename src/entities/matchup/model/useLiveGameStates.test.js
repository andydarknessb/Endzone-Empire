import { renderHook, act, waitFor } from '@testing-library/react';
import supabase from '../../../api/supabaseClient';
import { useLiveGameStates } from './useLiveGameStates';

jest.mock('../../../api/supabaseClient', () => ({
  __esModule: true,
  default: {
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

// `readRows` is called at read time so a test can change the table between
// the channel opening and the select running.
function install(readRows, onSubscribe) {
  const inFn = jest.fn().mockImplementation(() => Promise.resolve({ data: readRows(), error: null }));
  supabase.from.mockReturnValue({ select: jest.fn().mockReturnValue({ in: inFn }) });
  let handler = null;
  const channelObj = {
    on: jest.fn((_event, _filter, cb) => { handler = cb; return channelObj; }),
    subscribe: jest.fn((cb) => { onSubscribe?.(); cb?.('SUBSCRIBED'); return channelObj; }),
  };
  supabase.channel.mockReturnValue(channelObj);
  return { channelObj, inFn, push: (payload) => act(() => { handler?.(payload); }) };
}

describe('useLiveGameStates', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads after the channel is joined, so a change in the gap is not lost', async () => {
    const dbRow = { tank01_game_id: 'g1', game_status: 'in_progress' };
    install(() => [{ ...dbRow }], () => { dbRow.game_status = 'final'; });

    const { result } = renderHook(() => useLiveGameStates('s1', ['g1']));

    await waitFor(() => expect(result.current[0]?.game_status).toBe('final'));
  });

  it('filters on every listed id, listens to INSERT, and shows a game with no row at read time', async () => {
    const { channelObj, push } = install(() => [{ tank01_game_id: 'g1', game_status: 'in_progress' }]);

    const { result } = renderHook(() => useLiveGameStates('s1', ['g1', 'g2']));
    await waitFor(() => expect(result.current).toHaveLength(1));

    const config = channelObj.on.mock.calls[0][1];
    expect(config.event).toBe('*');
    expect(config.filter).toContain('g2');

    await push({ eventType: 'INSERT', new: { tank01_game_id: 'g2', game_status: 'in_progress' } });
    expect(result.current.map((r) => r.tank01_game_id)).toEqual(['g1', 'g2']);
  });

  it('ignores a DELETE payload without re-rendering or storing a row', async () => {
    const { push } = install(() => [{ tank01_game_id: 'g1', game_status: 'in_progress' }]);
    let passes = 0;
    const { result } = renderHook(() => { passes += 1; return useLiveGameStates('s1', ['g1']); });
    await waitFor(() => expect(result.current).toHaveLength(1));
    const before = result.current;
    const passesBefore = passes;

    await push({ eventType: 'DELETE', new: {}, old: { tank01_game_id: 'g1' } });
    await push({ eventType: 'UPDATE', new: {} });

    expect(passes).toBe(passesBefore);
    expect(result.current).toBe(before);
  });

  it('keeps a channel-delivered entry over an older read', async () => {
    let resolveRead;
    const inFn = jest.fn(() => new Promise((r) => { resolveRead = r; }));
    supabase.from.mockReturnValue({ select: jest.fn().mockReturnValue({ in: inFn }) });
    let handler;
    const channelObj = {
      on: jest.fn((_e, _f, cb) => { handler = cb; return channelObj; }),
      subscribe: jest.fn((cb) => { cb?.('SUBSCRIBED'); return channelObj; }),
    };
    supabase.channel.mockReturnValue(channelObj);

    const { result } = renderHook(() => useLiveGameStates('s1', ['g1']));
    await waitFor(() => expect(inFn).toHaveBeenCalled());
    act(() => { handler({ new: { tank01_game_id: 'g1', game_status: 'final' } }); });
    await act(async () => { resolveRead({ data: [{ tank01_game_id: 'g1', game_status: 'in_progress' }], error: null }); });

    expect(result.current[0].game_status).toBe('final');
  });

  it('still reads once when the channel fails', async () => {
    const { inFn, channelObj } = install(() => [{ tank01_game_id: 'g1', game_status: 'in_progress' }]);
    channelObj.subscribe.mockImplementation((cb) => { cb?.('CHANNEL_ERROR'); return channelObj; });

    const { result } = renderHook(() => useLiveGameStates('s1', ['g1']));

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(inFn).toHaveBeenCalledTimes(1);
  });
});
