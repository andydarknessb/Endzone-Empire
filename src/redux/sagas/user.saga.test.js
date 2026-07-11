import { put } from 'redux-saga/effects';
import MockAdapter from 'axios-mock-adapter';
import userSaga, { fetchUser } from './user.saga';
import apiClient, { setToken, getToken, clearToken } from '../../api/apiClient';

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

  test('does nothing when no token is stored (never calls the API)', () => {
    clearToken();
    const gen = fetchUser();
    expect(gen.next().done).toBe(true);
  });

  test('fetches and sets the user when a token is present', () => {
    setToken('a-real-token');
    const gen = fetchUser();

    gen.next(); // apiClient.get('/api/user')

    const fakeResponse = { data: { id: 4, username: 'carol' } };
    const setUserStep = gen.next(fakeResponse);

    expect(setUserStep.value).toEqual(put({ type: 'SET_USER', payload: fakeResponse.data }));
    expect(gen.next().done).toBe(true);
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

  test('a non-401 error is swallowed without dispatching or clearing the token', () => {
    setToken('a-real-token');
    const gen = fetchUser();
    gen.next();

    const result = gen.throw(new Error('network blip'));

    expect(getToken()).toBe('a-real-token');
    expect(result.done).toBe(true);
  });
});
