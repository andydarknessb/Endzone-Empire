import { put } from 'redux-saga/effects';
import MockAdapter from 'axios-mock-adapter';
import loginSaga, { loginUser, logoutUser } from './login.saga';
import apiClient, { getToken, clearToken } from '../../api/apiClient';

// The saga worker yields the raw apiClient.post(...)/get(...) promise
// (not a redux-saga `call()` effect), so stepping the generator with
// `.next()` genuinely invokes it. Mount a MockAdapter so that call never
// reaches the network — otherwise jsdom fires a real XHR that fails
// asynchronously as an unhandled rejection and crashes the test process.
let mock;
beforeEach(() => {
  mock = new MockAdapter(apiClient);
  mock.onPost('/api/auth/login').reply(200, { token: 'unused-by-manual-stepping', user: {} });
});
afterEach(() => {
  mock.restore();
  clearToken();
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
    localStorage.setItem('endzone_token', 'stale-token');

    const gen = logoutUser();
    const step = gen.next();

    expect(getToken()).toBeNull();
    expect(step.value).toEqual(put({ type: 'UNSET_USER' }));
    expect(gen.next().done).toBe(true);
  });
});

test('apiClient is the real module (sanity check for the tests above)', () => {
  expect(typeof apiClient.post).toBe('function');
});
