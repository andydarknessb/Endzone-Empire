import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { MAX_CUTSCENES } from '../../../lib/scoringEvents';
import { useCelebrateTouchdown } from '../index';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const td = (playerId, overrides = {}) => ({
  playerId,
  name: `Player ${playerId}`,
  nflTeam: 'KC',
  opponent: 'BUF',
  type: 'rushing',
  isTouchdown: true,
  pointsDelta: 6,
  ...overrides,
});

const sides = { myStarterIds: new Set([1, 2, 3, 4, 5]), oppStarterIds: new Set([9]) };

beforeEach(() => {
  apiClient.get.mockResolvedValue({ data: { touchdownCelebrations: true } });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('reads the celebration preference once from the notifications prefs endpoint', async () => {
  renderHook(() => useCelebrateTouchdown());
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/notifications/prefs'));
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test("a touchdown by the viewer's starter queues a cutscene; an opponent's is a toast", async () => {
  const { result } = renderHook(() => useCelebrateTouchdown());
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  act(() => { result.current.handlePlays([td(1), td(9, { name: 'Rival WR', type: 'receiving' })], sides); });

  expect(result.current.cutscene).toMatchObject({ playerId: 1, name: 'Player 1' });
  expect(result.current.cutscene._cid).toBeDefined();
  expect(result.current.toasts).toHaveLength(1);
  expect(result.current.toasts[0]).toMatchObject({ playerId: 9, side: 'opponent', tone: 'negative' });
  expect(result.current.toasts[0].id).toBeDefined();
});

test('a player in neither lineup and a non-touchdown moment play fire nothing', async () => {
  const { result } = renderHook(() => useCelebrateTouchdown());
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  act(() => {
    result.current.handlePlays([
      td(777),
      td(1, { type: 'sack', isTouchdown: false, pointsDelta: 1 }),
    ], sides);
  });

  expect(result.current.cutscene).toBeNull();
  expect(result.current.toasts).toEqual([]);
});

test('dismissing advances the queue, and the overflow beyond the cap is one summary toast', async () => {
  const { result } = renderHook(() => useCelebrateTouchdown());
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  act(() => { result.current.handlePlays([td(1), td(2), td(3), td(4), td(5)], sides); });

  expect(result.current.cutscene.playerId).toBe(1);
  // MAX_CUTSCENES play back to back; the rest collapse into one summary toast.
  const overflow = 5 - MAX_CUTSCENES;
  expect(result.current.toasts).toHaveLength(1);
  expect(result.current.toasts[0]).toMatchObject({ kind: 'summary', tone: 'positive', count: overflow });

  act(() => { result.current.dismissCutscene(); });
  expect(result.current.cutscene.playerId).toBe(2);
  act(() => { result.current.dismissCutscene(); });
  act(() => { result.current.dismissCutscene(); });
  expect(result.current.cutscene).toBeNull();

  act(() => { result.current.dismissToast(result.current.toasts[0].id); });
  expect(result.current.toasts).toEqual([]);
});

// The preference is opt-out: off means no cutscene and no summary for the
// viewer's own scores, while an opponent's toast is informational and still
// shows. Red-tell: ignoring the preference turns this case red and no other.
test('with celebrations off, an own touchdown fires nothing while an opponent toast still shows', async () => {
  apiClient.get.mockResolvedValue({ data: { touchdownCelebrations: false } });
  const { result } = renderHook(() => useCelebrateTouchdown());
  // The preference lands on the microtask the mocked read resolves on, before
  // this wait returns, so the plays below arrive after it.
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  act(() => { result.current.handlePlays([td(1), td(9)], sides); });

  expect(result.current.cutscene).toBeNull();
  expect(result.current.toasts).toHaveLength(1);
  expect(result.current.toasts[0].playerId).toBe(9);
});

test('a failed preference read leaves celebrations on', async () => {
  apiClient.get.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useCelebrateTouchdown());
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  act(() => { result.current.handlePlays([td(1)], sides); });
  expect(result.current.cutscene).not.toBeNull();
  expect(result.current.celebrationsEnabled).toBe(true);
});

// The preference as STATE (#903 review), so a surface can show it: on until
// the read says otherwise, then whatever the read said. Red-tell: keeping the
// preference in the ref alone (never calling the state setter) leaves
// `celebrationsEnabled` true after an "off" read and turns this red.
test('exposes the preference as state: on by default, off once the read says off', async () => {
  apiClient.get.mockResolvedValue({ data: { touchdownCelebrations: false } });
  const { result } = renderHook(() => useCelebrateTouchdown());
  expect(result.current.celebrationsEnabled).toBe(true);
  await waitFor(() => expect(result.current.celebrationsEnabled).toBe(false));
});

test('handlePlays keeps one identity across renders, so a feed callback never re-subscribes', async () => {
  const { result, rerender } = renderHook(() => useCelebrateTouchdown());
  const first = result.current.handlePlays;
  rerender();
  expect(result.current.handlePlays).toBe(first);
});
