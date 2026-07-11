import { put } from 'redux-saga/effects';
import MockAdapter from 'axios-mock-adapter';
import registrationSaga, { registerUser } from './registration.saga';
import apiClient, { getToken, clearToken } from '../../api/apiClient';

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
