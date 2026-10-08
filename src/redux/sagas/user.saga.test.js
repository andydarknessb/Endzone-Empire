import { put } from 'redux-saga/effects';
import { runSaga } from 'redux-saga';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import userSaga, { fetchUser } from './user.saga';
import { renderHook } from '@testing-library/react';
import { useLeague } from '../../hooks/useLeague';
import { setResource } from '../../lib/resourceCache';
import apiClient, { setToken, getToken, clearToken } from '../../api/apiClient';

// Warm the shared league entry the way a visited page would.
const primeLeagueForTest = (leagueId, league) =>
  setResource(['league', leagueId], { league, teams: [] });

// See login.saga.test.js for why this is required: the worker yields a raw
// apiClient.get(...) promise, which is genuinely invoked when the
// generator's .next() resumes past it.
let mock;
beforeEach(() => {
  mock = new MockAdapter(apiClient);
  mock.onGet('/api/user').reply(200, {});
});
afterEach(() => {
  mock.restore();
});

describe('userSaga (watcher)', () => {
  test('watches FETCH_USER with fetchUser', () => {
    const gen = userSaga();
    const first = gen.next();
    expect(first.value.payload.args).toEqual(['FETCH_USER', fetchUser]);
    expect(gen.next().done).toBe(true);
  });
});

describe('fetchUser (worker)', () => {
  afterEach(() => clearToken());

  test('fetches and sets the user when a token is present', () => {
    setToken('a-real-token');
    const gen = fetchUser();

    gen.next(); // apiClient.get('/api/user')

    const fakeResponse = { data: { id: 4, username: 'carol' } };
    const setUserStep = gen.next(fakeResponse);

    expect(setUserStep.value).toEqual(put({ type: 'SET_USER', payload: fakeResponse.data }));
    expect(gen.next().done).toBe(true);
  });

  // Without a token in memory the first GET would go out bare, take a 401 and
  // be replayed after the interceptor's refresh: two /api/user requests per
  // hard load. Refreshing first leaves exactly one.
  describe('with no access token in memory (a hard load)', () => {
    let authMock;
    const run = async () => {
      const dispatched = [];
      await runSaga({ dispatch: (a) => dispatched.push(a) }, fetchUser).toPromise();
      return dispatched;
    };
    beforeEach(() => {
      clearToken();
      authMock = new MockAdapter(axios);
    });
    afterEach(() => authMock.restore());

    test('refreshes the session first, then makes the one /api/user request', async () => {
      authMock.onPost('/api/auth/refresh').reply(200, { token: 'fresh-token' });
      mock.onGet('/api/user').reply(200, { id: 4, username: 'carol' });

      const dispatched = await run();

      expect(authMock.history.post).toHaveLength(1);
      expect(mock.history.get.filter((r) => r.url === '/api/user')).toHaveLength(1);
      expect(mock.history.get[0].headers.Authorization).toBe('Bearer fresh-token');
      expect(dispatched).toEqual([{ type: 'SET_USER', payload: { id: 4, username: 'carol' } }]);
    });

    test('a refresh the server refuses unsets the user and never asks for /api/user', async () => {
      authMock.onPost('/api/auth/refresh').reply(401);

      const dispatched = await run();

      expect(mock.history.get).toHaveLength(0);
      expect(dispatched).toEqual([{ type: 'UNSET_USER' }]);
    });
  });

  test('a 401 clears the token and unsets the user', () => {
    setToken('an-expired-token');
    const gen = fetchUser();
    gen.next();

    const result = gen.throw({ response: { status: 401 } });

    expect(getToken()).toBeNull();
    expect(result.value).toEqual(put({ type: 'UNSET_USER' }));
    expect(gen.next().done).toBe(true);
  });

  test('a non-401 error keeps the token and only marks the session resolved', () => {
    setToken('a-real-token');
    const gen = fetchUser();
    gen.next();

    const result = gen.throw(new Error('network blip'));

    // The route gate waits on "resolved"; a network error must not leave it up.
    expect(result.value).toEqual(put({ type: 'SESSION_RESOLVED' }));
    expect(getToken()).toBe('a-real-token');
    expect(gen.next().done).toBe(true);
  });
});

test('a 401 on FETCH_USER (expired or invalid token) also drops the session caches', () => {
  primeLeagueForTest(1, { id: 1, name: 'Previous session row' });

  setToken('an-expired-token');
  const gen = fetchUser();
  gen.next(); // apiClient.get('/api/user')
  const step = gen.throw({ response: { status: 401 } });

  expect(step.value).toEqual(put({ type: 'UNSET_USER' }));
  const { result, unmount } = renderHook(() => useLeague(1));
  expect(result.current.league).toBeNull();
  // '/api/league/1' is unmocked here, so this hook's own request rejects
  // (axios-mock-adapter 404s unmatched routes). Unmount before that
  // rejection lands, or its setError/setLoading outlives the test.
  unmount();
});
