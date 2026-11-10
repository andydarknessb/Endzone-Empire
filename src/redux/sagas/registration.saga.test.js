import { put } from 'redux-saga/effects';
import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import registrationSaga, { registerUser } from './registration.saga';
import apiClient, { getToken, clearToken, isStaleSessionRefusal } from '../../api/apiClient';
import { hasSessionHint } from '../../lib/sessionHint';
import { renderHook } from '@testing-library/react';
import { useLeague, clearLeagueCache } from '../../hooks/useLeague';
import { setResource } from '../../lib/resourceCache';

// Warm the shared league entry the way a visited page would.
const primeLeagueForTest = (leagueId, league) =>
  setResource(['league', leagueId], { league, teams: [] });

// See login.saga.test.js for why this is required: the worker yields a raw
// apiClient.post(...) promise, which is genuinely invoked when the
// generator's .next() resumes past it.
let mock;
beforeEach(() => {
  mock = new MockAdapter(apiClient);
  mock.onPost('/api/auth/register').reply(200, { token: 'unused-by-manual-stepping', user: {} });
});
afterEach(() => {
  mock.restore();
});

describe('registrationSaga (watcher)', () => {
  test('watches REGISTER with registerUser', () => {
    const gen = registrationSaga();
    const first = gen.next();
    expect(first.value.payload.args).toEqual(['REGISTER', registerUser]);
    expect(gen.next().done).toBe(true);
  });
});

describe('registerUser (worker) — success path', () => {
  afterEach(() => clearToken());

  test('clears the error, registers, stores the token, sets the user, and switches to login mode', () => {
    const payload = { username: 'bob', email: 'bob@test.local', password: 'pw123456' };
    const gen = registerUser({ type: 'REGISTER', payload });

    expect(gen.next().value).toEqual(put({ type: 'CLEAR_REGISTRATION_ERROR' }));

    gen.next(); // apiClient.post(...)

    const fakeResponse = { data: { token: 'jwt-new', user: { id: 9, username: 'bob' } } };
    const setUserStep = gen.next(fakeResponse);
    expect(getToken()).toBe('jwt-new');
    expect(setUserStep.value).toEqual(put({ type: 'SET_USER', payload: fakeResponse.data.user }));

    const modeStep = gen.next();
    expect(modeStep.value).toEqual(put({ type: 'SET_TO_LOGIN_MODE' }));

    expect(gen.next().done).toBe(true);
  });
});

describe('registerUser (worker) — failure path', () => {
  test('any error dispatches REGISTRATION_FAILED', () => {
    const gen = registerUser({ type: 'REGISTER', payload: {} });
    gen.next();
    gen.next();

    const result = gen.throw({ response: { status: 409 } });

    expect(result.value).toEqual(put({ type: 'REGISTRATION_FAILED' }));
    expect(gen.next().done).toBe(true);
  });
});

// A hard-load refresh started before the registration (no token held) must not clear
// the session the registration just stored when it is refused after the registration.
describe('registerUser during an anonymous refresh', () => {
  let axiosMock;
  beforeEach(() => { axiosMock = new MockAdapter(axios); });
  afterEach(() => { axiosMock.restore(); clearToken(); });

  test('a 204 from that refresh after the registration leaves the new session in place', async () => {
    mock.onGet('/api/team').reply(401);
    let onWire;
    const sent = new Promise((resolve) => { onWire = resolve; });
    let answer;
    axiosMock.onPost('/api/auth/refresh?optional=1').reply(() => new Promise((release) => {
      answer = () => release([204, '']);
      onWire();
    }));
    const expired = jest.fn();
    window.addEventListener('auth:session-expired', expired);

    const request = apiClient.get('/api/team').catch((e) => e);
    await sent;
    const gen = registerUser({ type: 'REGISTER', payload: { username: 'bob', email: 'bob@test.local', password: 'pw123456' } });
    gen.next(); // CLEAR_REGISTRATION_ERROR
    gen.next(); // the register request
    gen.next({ data: { token: 'jwt-new', user: { id: 9, username: 'bob' } } }); // token stored, SET_USER
    answer(); // the anonymous refresh answers 204 after the registration

    const outcome = await request;
    expect(isStaleSessionRefusal(outcome)).toBe(true);
    expect(getToken()).toBe('jwt-new');
    expect(hasSessionHint()).toBe(true);
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener('auth:session-expired', expired);
  });
});

// A new account created on this device is a session change like a login: the
// shared useLeague cache must drop, or
// the new user can be served the previous account's rows.
describe('registerUser drops the previous session caches', () => {
  afterEach(() => { clearToken(); clearLeagueCache(); });

  test('a successful registration clears the shared league cache', () => {
    primeLeagueForTest(1, { id: 1, name: 'Previous account row', is_commissioner: true });

    const gen = registerUser({ type: 'REGISTER', payload: { username: 'bob', email: 'bob@test.local', password: 'pw123456' } });
    gen.next(); // CLEAR_REGISTRATION_ERROR
    gen.next(); // the register request
    gen.next({ data: { token: 'jwt-new', user: { id: 9, username: 'bob' } } }); // token stored, caches dropped, SET_USER

    const { result, unmount } = renderHook(() => useLeague(1));
    expect(result.current.league).toBeNull();
    // afterEach's clearLeagueCache() reloads whatever is still mounted on the
    // key (#35): take this hook instance down first so that reload doesn't
    // outlive the test.
    unmount();
  });
});
