import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import apiClient, { clearToken, getToken, refreshTokens, setToken } from './apiClient';

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
    axiosMock.onPost('/api/auth/refresh').reply(200, {
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
    expect(axiosMock.history.post[0].withCredentials).toBe(true);
    expect(localStorage.getItem('endzone_refresh')).toBeNull();
  });

  test('retries a cookie rotation race once', async () => {
    axiosMock
      .onPost('/api/auth/refresh')
      .replyOnce(401)
      .onPost('/api/auth/refresh')
      .replyOnce(200, { token: 'winner-jwt', user: { id: 1 } });

    await expect(refreshTokens()).resolves.toBe('winner-jwt');
    expect(axiosMock.history.post).toHaveLength(2);
  });

  test('clears the access token and expires the session when refresh fails', async () => {
    setToken('stale-jwt');
    const expired = jest.fn();
    window.addEventListener('auth:session-expired', expired);
    axiosMock.onPost('/api/auth/refresh').reply(401);
    apiMock.onGet('/api/team').reply(401);

    await expect(apiClient.get('/api/team')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(getToken()).toBeNull();
    expect(expired).toHaveBeenCalled();
    expect(axiosMock.history.post).toHaveLength(2);
    window.removeEventListener('auth:session-expired', expired);
  });

  test('does not refresh-loop on auth endpoints', async () => {
    apiMock.onPost('/api/auth/login').reply(401);
    await expect(apiClient.post('/api/auth/login', {})).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(axiosMock.history.post).toHaveLength(0);
  });

  test('concurrent 401s share one refresh request', async () => {
    axiosMock.onPost('/api/auth/refresh').reply(200, { token: 'fresh-jwt', user: { id: 1 } });
    apiMock.onGet('/api/a').replyOnce(401).onGet('/api/a').replyOnce(200, {});
    apiMock.onGet('/api/b').replyOnce(401).onGet('/api/b').replyOnce(200, {});

    await Promise.all([apiClient.get('/api/a'), apiClient.get('/api/b')]);
    expect(axiosMock.history.post).toHaveLength(1);
  });
});
