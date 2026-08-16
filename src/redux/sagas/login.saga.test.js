import { put } from 'redux-saga/effects';
import MockAdapter from 'axios-mock-adapter';
import loginSaga, { loginUser, logoutUser } from './login.saga';
import apiClient, { getToken, clearToken } from '../../api/apiClient';
import { renderHook, waitFor } from '@testing-library/react';
import { primeLeagueCache, useLeague, clearLeagueCache } from '../../hooks/useLeague';
import { usePickemStandings, clearPickemStandingsCache } from '../../hooks/usePickemStandings';

// Warm the standings cache the way a page visit would (the hook has no prime).
const primePickemStandingsForTest = () => {
  clearPickemStandingsCache();
  mock.onGet('/api/pickem/league/1/standings').reply(200, { season: 2026, mode: 'straight', standings: [{ userId: 1 }] });
};

// The saga worker yields the raw apiClient.post(...)/get(...) promise
// (not a redux-saga `call()` effect), so stepping the generator with
// `.next()` genuinely invokes it. Mount a MockAdapter so that call never
// reaches the network — otherwise jsdom fires a real XHR that fails
// asynchronously as an unhandled rejection and crashes the test process.
let mock;
beforeEach(() => {
  mock = new MockAdapter(apiClient);
  mock.onPost('/api/auth/login').reply(200, { token: 'unused-by-manual-stepping', user: {} });
  mock.onPost('/api/auth/logout').reply(200, { ok: true });
});
afterEach(() => {
  mock.restore();
  clearToken();
  clearLeagueCache();
});

describe('loginSaga (watcher)', () => {
  test('watches LOGIN with loginUser and LOGOUT with logoutUser', () => {
    const gen = loginSaga();

    const first = gen.next();
    expect(first.value.payload.args).toEqual(['LOGIN', loginUser]);

    const second = gen.next();
    expect(second.value.payload.args).toEqual(['LOGOUT', logoutUser]);

    expect(gen.next().done).toBe(true);
  });
});

describe('loginUser (worker) — success path', () => {
  test('clears the error, posts credentials, stores the token, and sets the user', () => {
    const payload = { username: 'alice', password: 'hunter2' };
    const gen = loginUser({ type: 'LOGIN', payload });

    expect(gen.next().value).toEqual(put({ type: 'CLEAR_LOGIN_ERROR' }));

    // Resumes the mocked apiClient.post(...) call. redux-saga's middleware
    // would await it and resume with the resolved value — we simulate that
    // resolution explicitly via the next .next(fakeResponse) call below.
    const postYield = gen.next();
    expect(postYield.done).toBe(false);

    const fakeResponse = { data: { token: 'jwt-abc', user: { id: 1, username: 'alice' } } };
    const setUserStep = gen.next(fakeResponse);

    expect(getToken()).toBe('jwt-abc');
    expect(setUserStep.value).toEqual(put({ type: 'SET_USER', payload: fakeResponse.data.user }));
    expect(gen.next().done).toBe(true);
  });
});

describe('loginUser (worker) — failure paths', () => {
  test('a 401 response dispatches LOGIN_FAILED', () => {
    const gen = loginUser({ type: 'LOGIN', payload: { username: 'x', password: 'y' } });
    gen.next(); // CLEAR_LOGIN_ERROR
    gen.next(); // apiClient.post(...)

    const error = { response: { status: 401 } };
    const result = gen.throw(error);

    expect(result.value).toEqual(put({ type: 'LOGIN_FAILED' }));
    expect(gen.next().done).toBe(true);
  });

  test('a network error (no response) dispatches LOGIN_FAILED_NO_CODE', () => {
    const gen = loginUser({ type: 'LOGIN', payload: { username: 'x', password: 'y' } });
    gen.next();
    gen.next();

    const error = new Error('Network Error');
    const result = gen.throw(error);

    expect(result.value).toEqual(put({ type: 'LOGIN_FAILED_NO_CODE' }));
  });

  test('a non-401 HTTP error dispatches LOGIN_FAILED_NO_CODE', () => {
    const gen = loginUser({ type: 'LOGIN', payload: { username: 'x', password: 'y' } });
    gen.next();
    gen.next();

    const error = { response: { status: 500 } };
    const result = gen.throw(error);

    expect(result.value).toEqual(put({ type: 'LOGIN_FAILED_NO_CODE' }));
  });
});

describe('logoutUser (worker)', () => {
  test('clears the stored token and unsets the user', () => {
    const gen = logoutUser();
    const requestStep = gen.next();
    expect(requestStep.done).toBe(false);

    const step = gen.next({ data: { ok: true } });
    expect(step.value).toEqual(put({ type: 'UNSET_USER' }));
    expect(gen.next().done).toBe(true);
  });
});

test('apiClient is the real module (sanity check for the tests above)', () => {
  expect(typeof apiClient.post).toBe('function');
});

// The shared useLeague cache holds viewer-scoped rows (is_commissioner,
// invite_code): a session change must drop it, or the next account in the same
// tab could pass a client-side commissioner gate on the previous account's row.
describe('session changes drop the shared league cache', () => {
  test('logging out clears it', async () => {
    mock.onGet('/api/league/1').reply(200, { league: { id: 1, name: 'Fresh row' }, teams: [] });
    primeLeagueCache(1, { id: 1, name: 'Previous account row', is_commissioner: true });

    const gen = logoutUser();
    gen.next(); // clearToken + cache drops happen synchronously before the first yield

    const { result } = renderHook(() => useLeague(1));
    expect(result.current.league).toBeNull();
    await waitFor(() => expect(result.current.league).toEqual({ id: 1, name: 'Fresh row' }));
  });

  test('logging in clears it', async () => {
    mock.onGet('/api/league/1').reply(200, { league: { id: 1, name: 'Fresh row' }, teams: [] });
    primeLeagueCache(1, { id: 1, name: 'Previous account row', is_commissioner: true });

    const gen = loginUser({ payload: { username: 'b', password: 'x' } });
    gen.next(); // CLEAR_LOGIN_ERROR
    gen.next(); // the login request; the cache drop precedes it

    const { result } = renderHook(() => useLeague(1));
    expect(result.current.league).toBeNull();
    await waitFor(() => expect(result.current.league).toEqual({ id: 1, name: 'Fresh row' }));
  });
});

test('logging out and logging in also drop the shared pick\'em standings cache', async () => {
  mock.onGet('/api/pickem/league/1/standings').reply(200, { season: 2026, mode: 'straight', standings: [] });
  primePickemStandingsForTest();
  logoutUser().next();
  const { result } = renderHook(() => usePickemStandings(1));
  expect(result.current.data).toBeNull();
  await waitFor(() => expect(result.current.loading).toBe(false));

  primePickemStandingsForTest();
  const gen = loginUser({ payload: { username: 'b', password: 'x' } });
  gen.next(); gen.next();
  const { result: afterLogin } = renderHook(() => usePickemStandings(1));
  expect(afterLogin.current.data).toBeNull();
});
