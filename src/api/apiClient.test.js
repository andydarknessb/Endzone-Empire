import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import apiClient, {
  clearToken,
  getToken,
  isSessionRefusal,
  refreshTokens,
  setToken,
} from './apiClient';
import { hasSessionHint } from '../lib/sessionHint';

describe('in-memory access token', () => {
  afterEach(clearToken);

  test('stores the access token only in memory', () => {
    setToken('abc123');
    expect(getToken()).toBe('abc123');
    expect(localStorage.getItem('endzone_token')).toBeNull();
    expect(localStorage.getItem('endzone_refresh')).toBeNull();
  });

  test('clearToken removes the in-memory token', () => {
    setToken('abc123');
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe('public-tree session hint', () => {
  afterEach(clearToken);

  test('follows the token lifecycle without ever storing the token', () => {
    expect(hasSessionHint()).toBe(false);
    setToken('abc123');
    expect(hasSessionHint()).toBe(true);
    expect(localStorage.getItem('endzone_session_hint')).toBe('1');
    clearToken();
    expect(hasSessionHint()).toBe(false);
  });
});

describe('apiClient request interceptor', () => {
  let mock;

  beforeEach(() => {
    mock = new MockAdapter(apiClient);
  });

  afterEach(() => {
    mock.restore();
    clearToken();
  });

  test('uses credentials and attaches the in-memory bearer token', async () => {
    setToken('my-jwt-token');
    mock.onGet('/api/players').reply(200, {});
    await apiClient.get('/api/players');
    expect(apiClient.defaults.withCredentials).toBe(true);
    expect(mock.history.get[0].headers.Authorization).toBe('Bearer my-jwt-token');
  });
});

describe('cookie-backed refresh', () => {
  let apiMock;
  let axiosMock;

  beforeEach(() => {
    apiMock = new MockAdapter(apiClient);
    axiosMock = new MockAdapter(axios);
    clearToken();
  });

  afterEach(() => {
    apiMock.restore();
    axiosMock.restore();
    clearToken();
  });

  test('refreshes with credentials, stores only the access token, and retries', async () => {
    axiosMock.onPost('/api/auth/refresh?optional=1').reply(200, {
      token: 'fresh-jwt',
      user: { id: 1 },
    });
    apiMock
      .onGet('/api/team')
      .replyOnce(401)
      .onGet('/api/team')
      .replyOnce((config) => {
        expect(config.headers.Authorization).toBe('Bearer fresh-jwt');
        return [200, { ok: true }];
      });

    await expect(apiClient.get('/api/team')).resolves.toMatchObject({ data: { ok: true } });
    expect(getToken()).toBe('fresh-jwt');
    expect(hasSessionHint()).toBe(true);
    expect(axiosMock.history.post[0].withCredentials).toBe(true);
    expect(localStorage.getItem('endzone_refresh')).toBeNull();
  });

  test('retries a cookie rotation race once', async () => {
    axiosMock
      .onPost('/api/auth/refresh?optional=1')
      .replyOnce(401)
      .onPost('/api/auth/refresh?optional=1')
      .replyOnce(200, { token: 'winner-jwt', user: { id: 1 } });

    await expect(refreshTokens()).resolves.toBe('winner-jwt');
    expect(axiosMock.history.post).toHaveLength(2);
  });

  // A deploy 503 or a dropped connection says nothing about the refresh cookie,
  // so the user stays signed in and the caller sees the original 401.
  test.each([
    ['answers 503', (mock) => mock.onPost('/api/auth/refresh?optional=1').reply(503)],
    ['has a network error', (mock) => mock.onPost('/api/auth/refresh?optional=1').networkError()],
  ])('keeps the session when refresh %s', async (_name, arrange) => {
    setToken('live-jwt');
    const expired = jest.fn();
    window.addEventListener('auth:session-expired', expired);
    arrange(axiosMock);
    apiMock.onGet('/api/team').reply(401);

    await expect(apiClient.get('/api/team')).rejects.toMatchObject({ response: { status: 401 } });

    expect(getToken()).toBe('live-jwt');
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener('auth:session-expired', expired);
  });

  test('clears the access token and expires the session when refresh fails', async () => {
    setToken('stale-jwt');
    const expired = jest.fn();
    window.addEventListener('auth:session-expired', expired);
    axiosMock.onPost('/api/auth/refresh?optional=1').reply(401);
    apiMock.onGet('/api/team').reply(401);

    await expect(apiClient.get('/api/team')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(getToken()).toBeNull();
    expect(hasSessionHint()).toBe(false);
    expect(expired).toHaveBeenCalled();
    expect(axiosMock.history.post).toHaveLength(2);
    window.removeEventListener('auth:session-expired', expired);
  });

  // An anonymous visitor has no refresh cookie, and the server answers that
  // with 204 and no body (`.reply(204, '')` models the browser, where axios gives
  // data === ''; a bare `.reply(204)` gives undefined and hides the old client's
  // bug). That is "no session", not a token to store.
  describe('a refresh answered 204 (no refresh cookie, no session)', () => {
    test('refreshTokens rejects with a session refusal and stores no token', async () => {
      axiosMock.onPost('/api/auth/refresh?optional=1').reply(204, '');

      const error = await refreshTokens().catch((e) => e);

      expect(isSessionRefusal(error)).toBe(true);
      expect(axiosMock.history.post[0].url.endsWith('/api/auth/refresh?optional=1')).toBe(true);
      expect(getToken()).toBeNull();
      expect(hasSessionHint()).toBe(false);
      // Not the 401 rotation-race path: it is not retried.
      expect(axiosMock.history.post).toHaveLength(1);
    });

    test('a 401 on a normal request expires the session and is never replayed', async () => {
      const expired = jest.fn();
      window.addEventListener('auth:session-expired', expired);
      axiosMock.onPost('/api/auth/refresh?optional=1').reply(204, '');
      apiMock.onGet('/api/team').reply(401);

      await expect(apiClient.get('/api/team')).rejects.toMatchObject({
        response: { status: 401 },
      });

      expect(getToken()).toBeNull();
      expect(expired).toHaveBeenCalledTimes(1);
      expect(apiMock.history.get).toHaveLength(1);
      expect(axiosMock.history.post).toHaveLength(1);
      window.removeEventListener('auth:session-expired', expired);
    });
  });

  test('isSessionRefusal is true for a 401 and false for a network or server failure', () => {
    expect(isSessionRefusal({ response: { status: 401 } })).toBe(true);
    expect(isSessionRefusal({ response: { status: 400 } })).toBe(false);
    expect(isSessionRefusal({ response: { status: 500 } })).toBe(false);
    expect(isSessionRefusal(new Error('Network Error'))).toBe(false);
    expect(isSessionRefusal(undefined)).toBe(false);
  });

  test('does not refresh-loop on auth endpoints', async () => {
    apiMock.onPost('/api/auth/login').reply(401);
    await expect(apiClient.post('/api/auth/login', {})).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(axiosMock.history.post).toHaveLength(0);
  });

  test('concurrent 401s share one refresh request', async () => {
    axiosMock.onPost('/api/auth/refresh?optional=1').reply(200, { token: 'fresh-jwt', user: { id: 1 } });
    apiMock.onGet('/api/a').replyOnce(401).onGet('/api/a').replyOnce(200, {});
    apiMock.onGet('/api/b').replyOnce(401).onGet('/api/b').replyOnce(200, {});

    await Promise.all([apiClient.get('/api/a'), apiClient.get('/api/b')]);
    expect(axiosMock.history.post).toHaveLength(1);
  });
});
