import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import apiClient, {
  getToken,
  setToken,
  getRefreshToken,
  setRefreshToken,
  clearToken,
} from './apiClient';

describe('token storage helpers', () => {
  afterEach(() => {
    clearToken();
  });

  test('getToken returns null when nothing is stored', () => {
    expect(getToken()).toBeNull();
  });

  test('setToken persists a token that getToken then returns', () => {
    setToken('abc123');
    expect(getToken()).toBe('abc123');
  });

  test('refresh token round-trips through its own storage key', () => {
    setRefreshToken('refresh-abc');
    expect(getRefreshToken()).toBe('refresh-abc');
  });

  test('clearToken removes both the access and refresh tokens', () => {
    setToken('abc123');
    setRefreshToken('refresh-abc');
    clearToken();
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
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

  test('attaches a Bearer Authorization header when a token is stored', async () => {
    setToken('my-jwt-token');
    mock.onGet('/api/players').reply(200, { players: [] });

    await apiClient.get('/api/players');

    expect(mock.history.get[0].headers.Authorization).toBe('Bearer my-jwt-token');
  });

  test('omits the Authorization header when no token is stored', async () => {
    clearToken();
    mock.onGet('/api/players').reply(200, { players: [] });

    await apiClient.get('/api/players');

    expect(mock.history.get[0].headers.Authorization).toBeUndefined();
  });
});

describe('auto-refresh on 401', () => {
  // apiClient carries the interceptors under test; the refresh call itself
  // goes out on the bare axios instance, so each gets its own adapter.
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

  test('refreshes once, stores rotated tokens, and retries the original request', async () => {
    setToken('stale-jwt');
    setRefreshToken('refresh-1');

    axiosMock.onPost('/api/auth/refresh').reply(200, {
      token: 'fresh-jwt',
      refreshToken: 'refresh-2',
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

    const response = await apiClient.get('/api/team');

    expect(response.data).toEqual({ ok: true });
    expect(getToken()).toBe('fresh-jwt');
    expect(getRefreshToken()).toBe('refresh-2');
    expect(axiosMock.history.post).toHaveLength(1);
    expect(JSON.parse(axiosMock.history.post[0].data)).toEqual({ refreshToken: 'refresh-1' });
  });

  test('clears tokens and fires auth:session-expired when the refresh itself fails', async () => {
    setToken('stale-jwt');
    setRefreshToken('dead-refresh');
    const expired = jest.fn();
    window.addEventListener('auth:session-expired', expired);

    axiosMock.onPost('/api/auth/refresh').reply(401);
    apiMock.onGet('/api/team').reply(401);

    await expect(apiClient.get('/api/team')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(expired).toHaveBeenCalled();
    window.removeEventListener('auth:session-expired', expired);
  });

  test('does not attempt a refresh without a refresh token', async () => {
    setToken('stale-jwt');
    apiMock.onGet('/api/team').reply(401);

    await expect(apiClient.get('/api/team')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(axiosMock.history.post).toHaveLength(0);
  });

  test('does not refresh-loop on auth endpoints themselves', async () => {
    setRefreshToken('refresh-1');
    apiMock.onPost('/api/auth/login').reply(401);

    await expect(apiClient.post('/api/auth/login', {})).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(axiosMock.history.post).toHaveLength(0);
  });

  test('retries with the newer token when another tab already rotated it', async () => {
    setToken('stale-jwt');
    setRefreshToken('refresh-1');

    // First refresh 401s (our token was just rotated by another tab); by the
    // time we handle the failure, localStorage holds the winner's token.
    axiosMock.onPost('/api/auth/refresh').replyOnce(() => {
      setRefreshToken('refresh-from-other-tab');
      return [401];
    });
    axiosMock.onPost('/api/auth/refresh').replyOnce((config) => {
      expect(JSON.parse(config.data)).toEqual({ refreshToken: 'refresh-from-other-tab' });
      return [200, { token: 'fresh-jwt', refreshToken: 'refresh-3', user: { id: 1 } }];
    });
    apiMock.onGet('/api/team').replyOnce(401).onGet('/api/team').replyOnce(200, { ok: true });

    const response = await apiClient.get('/api/team');

    expect(response.data).toEqual({ ok: true });
    expect(getToken()).toBe('fresh-jwt');
    expect(getRefreshToken()).toBe('refresh-3');
    expect(axiosMock.history.post).toHaveLength(2);
  });

  test('concurrent 401s share a single refresh round-trip', async () => {
    setToken('stale-jwt');
    setRefreshToken('refresh-1');

    axiosMock.onPost('/api/auth/refresh').reply(200, {
      token: 'fresh-jwt',
      refreshToken: 'refresh-2',
      user: { id: 1 },
    });
    apiMock.onGet('/api/a').replyOnce(401).onGet('/api/a').replyOnce(200, {});
    apiMock.onGet('/api/b').replyOnce(401).onGet('/api/b').replyOnce(200, {});

    await Promise.all([apiClient.get('/api/a'), apiClient.get('/api/b')]);

    expect(axiosMock.history.post).toHaveLength(1);
  });
});
