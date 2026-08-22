import apiClient from '../api/apiClient';
import {
  enqueuePendingLineupMutation,
  enqueueScoreCorrection,
  PENDING_LINEUP_MUTATIONS_KEY,
  readPendingLineupMutations,
  replayPendingLineupMutations,
} from './pendingLineupMutations';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { request: jest.fn() },
}));

function setOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

const mutation = (playerId, slot) => ({
  endpoint: '/api/team/lineup',
  method: 'PUT',
  payload: {
    leagueId: 7,
    week: 3,
    moves: [{ playerId, slot }],
  },
});

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
  apiClient.request.mockReset();
});

afterAll(() => setOnline(true));

test('stores multiple offline intents in insertion order', () => {
  enqueuePendingLineupMutation(mutation(11, 'WR'));
  enqueuePendingLineupMutation(mutation(12, 'FLEX'));

  expect(readPendingLineupMutations().map((intent) => intent.payload.moves[0].playerId)).toEqual([
    11,
    12,
  ]);
  expect(JSON.parse(localStorage.getItem(PENDING_LINEUP_MUTATIONS_KEY))).toHaveLength(2);
});

test('builds an allow-listed correction endpoint without accepting arbitrary URLs', () => {
  enqueueScoreCorrection({ leagueId: 7, payload: { week: 4 } });

  expect(readPendingLineupMutations()[0]).toMatchObject({
    endpoint: '/api/scoring/league/7/correct-week',
    method: 'POST',
    payload: { week: 4 },
  });
  expect(() =>
    enqueuePendingLineupMutation({ endpoint: 'https://example.test', method: 'POST', payload: {} })
  ).toThrow('invalid pending lineup mutation');
});

test('replays sequentially and removes only 200/201 responses', async () => {
  const first = enqueuePendingLineupMutation(mutation(11, 'WR'));
  const second = enqueuePendingLineupMutation(mutation(12, 'FLEX'));
  const requestOrder = [];
  let activeRequests = 0;

  apiClient.request.mockImplementation(async (config) => {
    activeRequests += 1;
    expect(activeRequests).toBe(1);
    requestOrder.push(config.data.moves[0].playerId);
    await Promise.resolve();
    activeRequests -= 1;
    return { status: requestOrder.length === 1 ? 200 : 201 };
  });

  await expect(replayPendingLineupMutations()).resolves.toEqual({ replayed: 2, remaining: 0 });
  expect(requestOrder).toEqual([11, 12]);
  expect(apiClient.request.mock.calls[0][0].headers).toEqual({ 'Idempotency-Key': first.id });
  expect(apiClient.request.mock.calls[1][0].headers).toEqual({ 'Idempotency-Key': second.id });
  expect(localStorage.getItem(PENDING_LINEUP_MUTATIONS_KEY)).toBeNull();
});

test('retains the failed intent and every later intent for the next reconnect', async () => {
  const first = enqueuePendingLineupMutation(mutation(11, 'WR'));
  enqueuePendingLineupMutation(mutation(12, 'FLEX'));
  apiClient.request.mockRejectedValueOnce(new Error('network unavailable'));

  const result = await replayPendingLineupMutations();

  expect(result).toMatchObject({ replayed: 0, remaining: 2 });
  expect(result.error).toEqual(expect.any(Error));
  expect(readPendingLineupMutations().map((intent) => intent.id)).toEqual([
    first.id,
    expect.any(String),
  ]);
  expect(apiClient.request).toHaveBeenCalledTimes(1);
});

test('does not replay while the browser reports offline', async () => {
  enqueuePendingLineupMutation(mutation(11, 'WR'));
  setOnline(false);

  await expect(replayPendingLineupMutations()).resolves.toEqual({ replayed: 0, remaining: 1 });
  expect(apiClient.request).not.toHaveBeenCalled();
});
