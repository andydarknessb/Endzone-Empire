import apiClient from '../api/apiClient';
import {
  enqueuePendingLineupMutation,
  enqueueScoreCorrection,
  LINEUP_MUTATION_REJECTED_EVENT,
  LINEUP_MUTATION_REPLAYED_EVENT,
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

test('a replayed save announces its intent, status and response body (spec #2042)', async () => {
  const intent = enqueuePendingLineupMutation(mutation(11, 'WR'));
  apiClient.request.mockResolvedValue({ status: 200, data: { undoable: false, irreversible: ['called_shot'] } });
  const heard = [];
  const listen = (event) => heard.push(event.detail);
  window.addEventListener(LINEUP_MUTATION_REPLAYED_EVENT, listen);

  await replayPendingLineupMutations();
  window.removeEventListener(LINEUP_MUTATION_REPLAYED_EVENT, listen);

  expect(heard).toEqual([{ intent, status: 200, data: { undoable: false, irreversible: ['called_shot'] } }]);
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

describe('a replay the server refuses', () => {
  const refusal = (status, data = { error: 'locked' }) => Object.assign(new Error('refused'), { response: { status, data } });

  test('a permanent 4xx is dropped and announced, and the queue moves on', async () => {
    const a = enqueuePendingLineupMutation(mutation(11, 'WR'));
    const b = enqueuePendingLineupMutation(mutation(12, 'FLEX'));
    apiClient.request.mockRejectedValueOnce(refusal(409)).mockResolvedValueOnce({ status: 200, data: {} });
    const rejected = [];
    const replayed = [];
    const onRejected = (event) => rejected.push(event.detail);
    const onReplayed = (event) => replayed.push(event.detail);
    window.addEventListener(LINEUP_MUTATION_REJECTED_EVENT, onRejected);
    window.addEventListener(LINEUP_MUTATION_REPLAYED_EVENT, onReplayed);

    await expect(replayPendingLineupMutations()).resolves.toEqual({ replayed: 1, remaining: 0 });
    window.removeEventListener(LINEUP_MUTATION_REJECTED_EVENT, onRejected);
    window.removeEventListener(LINEUP_MUTATION_REPLAYED_EVENT, onReplayed);

    expect(rejected).toEqual([{ intent: a, status: 409, data: { error: 'locked' } }]);
    expect(replayed).toEqual([{ intent: b, status: 200, data: {} }]);
    expect(readPendingLineupMutations()).toEqual([]);
  });

  test('a 503 keeps the head intent and never reaches the next one', async () => {
    const a = enqueuePendingLineupMutation(mutation(11, 'WR'));
    enqueuePendingLineupMutation(mutation(12, 'FLEX'));
    apiClient.request.mockRejectedValueOnce(refusal(503));

    await expect(replayPendingLineupMutations()).resolves.toMatchObject({ replayed: 0, remaining: 2 });

    expect(apiClient.request).toHaveBeenCalledTimes(1);
    expect(readPendingLineupMutations()[0].id).toBe(a.id);
  });

  test.each([401, 408, 429])('a %i keeps the intent queued', async (status) => {
    enqueuePendingLineupMutation(mutation(11, 'WR'));
    apiClient.request.mockRejectedValueOnce(refusal(status));

    await expect(replayPendingLineupMutations()).resolves.toMatchObject({ replayed: 0, remaining: 1 });
  });

  test('a network error (no response) keeps the intent queued', async () => {
    const a = enqueuePendingLineupMutation(mutation(11, 'WR'));
    apiClient.request.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));

    await expect(replayPendingLineupMutations()).resolves.toMatchObject({ replayed: 0, remaining: 1 });
    expect(readPendingLineupMutations()[0].id).toBe(a.id);
  });
});

// #2298: only the tab holding the replay lock sees the refusal, so it is announced on a BroadcastChannel.
describe('a refused replay announced across tabs (#2298)', () => {
  const channels = [];
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      channels.push(this);
    }
    // Like the real thing, never delivers to the posting instance.
    postMessage(data) {
      channels.filter((c) => c !== this && c.name === this.name).forEach((c) => c.onmessage?.({ data }));
    }
    close() {}
  }
  const refusal = Object.assign(new Error('refused'), { response: { status: 409, data: { error: 'locked' } } });
  const original = global.BroadcastChannel;

  const loadTab = () => {
    let tab;
    jest.isolateModules(() => {
      tab = require('./pendingLineupMutations');
      tab.api = require('../api/apiClient').default;
    });
    return tab;
  };
  const collectRejected = () => {
    const seen = [];
    const listener = (event) => seen.push(event.detail);
    window.addEventListener(LINEUP_MUTATION_REJECTED_EVENT, listener);
    return { seen, stop: () => window.removeEventListener(LINEUP_MUTATION_REJECTED_EVENT, listener) };
  };

  afterEach(() => {
    channels.length = 0;
    global.BroadcastChannel = original;
  });

  test('the replaying tab broadcasts the refusal and toasts from its own event only once', async () => {
    global.BroadcastChannel = FakeBroadcastChannel;
    const tab = loadTab();
    const intent = tab.enqueuePendingLineupMutation(mutation(11, 'WR'));
    tab.api.request.mockRejectedValueOnce(refusal);
    const heard = [];
    const otherTab = new FakeBroadcastChannel(tab.LINEUP_REJECTED_CHANNEL);
    otherTab.onmessage = (event) => heard.push(event.data);
    const local = collectRejected();

    await tab.replayPendingLineupMutations();
    local.stop();

    const detail = { intent, status: 409, data: { error: 'locked' } };
    expect(heard).toEqual([detail]);
    expect(local.seen).toEqual([detail]);
  });

  test('a tab that did not replay re-dispatches a received refusal as the window event, once', () => {
    global.BroadcastChannel = FakeBroadcastChannel;
    const tab = loadTab();
    const replayingTab = new FakeBroadcastChannel(tab.LINEUP_REJECTED_CHANNEL);
    const local = collectRejected();
    const detail = { intent: { id: 'x' }, status: 409, data: { error: 'locked' } };

    replayingTab.postMessage(detail);
    local.stop();

    expect(local.seen).toEqual([detail]);
  });

  test('without BroadcastChannel a refusal still fires the window event once and nothing throws', async () => {
    delete global.BroadcastChannel;
    const tab = loadTab();
    const intent = tab.enqueuePendingLineupMutation(mutation(11, 'WR'));
    tab.api.request.mockRejectedValueOnce(refusal);
    const local = collectRejected();

    await expect(tab.replayPendingLineupMutations()).resolves.toEqual({ replayed: 0, remaining: 0 });
    local.stop();

    expect(local.seen).toEqual([{ intent, status: 409, data: { error: 'locked' } }]);
  });
});
