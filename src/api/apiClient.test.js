import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import apiClient, {
  clearToken,
  getToken,
  isSessionRefusal,
  isStaleSessionRefusal,
  onTokenRefreshed,
  refreshTokens,
  setToken,
  startSession,
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
  // so the user stays signed in and the caller sees the refresh failure itself.
  test.each([
    ['answers 503', (mock) => mock.onPost('/api/auth/refresh?optional=1').reply(503), { response: { status: 503 } }],
    ['has a network error', (mock) => mock.onPost('/api/auth/refresh?optional=1').networkError(), { message: 'Network Error' }],
  ])('keeps the session when refresh %s', async (_name, arrange, rejection) => {
    setToken('live-jwt');
    const expired = jest.fn();
    window.addEventListener('auth:session-expired', expired);
    arrange(axiosMock);
    apiMock.onGet('/api/team').reply(401);

    await expect(apiClient.get('/api/team')).rejects.toMatchObject(rejection);

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

  test('a refresh answered after logout does not re-install the token', async () => {
    const refreshed = jest.fn();
    const unsubscribe = onTokenRefreshed(refreshed);
    let onWire;
    const sent = new Promise((resolve) => { onWire = resolve; });
    let answer;
    axiosMock.onPost('/api/auth/refresh?optional=1').reply(() => new Promise((release) => {
      answer = () => release([200, { token: 'late-jwt', user: { id: 1 } }]);
      onWire();
    }));

    const pending = refreshTokens().catch((e) => e);
    await sent;
    clearToken(); // the Manager logs out while the refresh is on the wire
    answer();

    const outcome = await pending;
    expect(outcome).toBeInstanceOf(Error);
    expect(getToken()).toBeNull();
    expect(hasSessionHint()).toBe(false);
    expect(refreshed).not.toHaveBeenCalled();
    unsubscribe();
  });

  test('a refresh answered after a logout and a new login leaves the new session in place', async () => {
    setToken('a-jwt');
    let onWire;
    const sent = new Promise((resolve) => { onWire = resolve; });
    let answer;
    axiosMock.onPost('/api/auth/refresh?optional=1').reply(() => new Promise((release) => {
      answer = () => release([200, { token: 'a-late-jwt', user: { id: 1 } }]);
      onWire();
    }));
    apiMock.onGet('/api/team').reply(401);

    const request = apiClient.get('/api/team').catch((e) => e);
    await sent;
    clearToken(); // logout
    setToken('b-jwt'); // the same browser logs in again
    answer();

    const outcome = await request;
    expect(outcome.response.status).toBe(401);
    expect(getToken()).toBe('b-jwt');
    expect(hasSessionHint()).toBe(true);
  });

  // A refusal answers the session the refresh started under. After a logout and re-login
  // it answers the session that ended, so it must not clear the one now in place.
  test('a refresh refused on its POST and its retry after a logout and re-login leaves the new session in place', async () => {
    setToken('a-jwt');
    const expired = jest.fn();
    window.addEventListener('auth:session-expired', expired);
    let onWire;
    const sent = new Promise((resolve) => { onWire = resolve; });
    let refuse;
    axiosMock
      .onPost('/api/auth/refresh?optional=1')
      .replyOnce(() => new Promise((release) => {
        refuse = () => release([401]);
        onWire();
      }))
      .onPost('/api/auth/refresh?optional=1')
      .replyOnce(401);
    apiMock.onGet('/api/team').reply(401);

    const request = apiClient.get('/api/team').catch((e) => e);
    await sent;
    clearToken(); // logout while the refresh is on the wire
    setToken('b-jwt'); // the same browser logs in again
    refuse(); // the POST is refused, and so is the 75 ms retry

    const outcome = await request;
    expect(isStaleSessionRefusal(outcome)).toBe(true);
    expect(outcome.response.status).toBe(401);
    expect(getToken()).toBe('b-jwt');
    expect(hasSessionHint()).toBe(true);
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener('auth:session-expired', expired);
  });

  // A login starts a new session generation: an anonymous refresh (a hard load)
  // answered 200 after it must not install its account's token over the login.
  test('a refresh started anonymously and answered after startSession leaves the new session in place', async () => {
    let onWire;
    const sent = new Promise((resolve) => { onWire = resolve; });
    let answer;
    axiosMock.onPost('/api/auth/refresh?optional=1').reply(() => new Promise((release) => {
      answer = () => release([200, { token: 'a-late-jwt', user: { id: 1 } }]);
      onWire();
    }));

    const refresh = refreshTokens().catch((e) => e);
    await sent;
    startSession('b-jwt'); // the login lands while the anonymous refresh is on the wire
    answer();

    expect(await refresh).toBeInstanceOf(Error);
    expect(getToken()).toBe('b-jwt');
    expect(hasSessionHint()).toBe(true);
  });

  test('a refresh answered 204 after a logout and re-login leaves the new session in place', async () => {
    setToken('a-jwt');
    const expired = jest.fn();
    window.addEventListener('auth:session-expired', expired);
    let onWire;
    const sent = new Promise((resolve) => { onWire = resolve; });
    let answer;
    axiosMock.onPost('/api/auth/refresh?optional=1').reply(() => new Promise((release) => {
      answer = () => release([204, '']);
      onWire();
    }));
    apiMock.onGet('/api/team').reply(401);

    const request = apiClient.get('/api/team').catch((e) => e);
    await sent;
    clearToken(); // logout while the refresh is on the wire
    setToken('b-jwt'); // the same browser logs in again
    answer();

    const outcome = await request;
    expect(isStaleSessionRefusal(outcome)).toBe(true);
    expect(getToken()).toBe('b-jwt');
    expect(hasSessionHint()).toBe(true);
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener('auth:session-expired', expired);
  });

  test('a 401 on a request sent before a logout is not refreshed once the logout has happened', async () => {
    setToken('a-jwt');
    let onWire;
    const sent = new Promise((resolve) => { onWire = resolve; });
    let answer;
    apiMock.onGet('/api/team').reply(() => new Promise((release) => {
      answer = () => release([401]);
      onWire();
    }));

    const request = apiClient.get('/api/team').catch((e) => e);
    await sent;
    clearToken(); // logout while the request is on the wire
    answer();

    const outcome = await request;
    expect(outcome.response.status).toBe(401);
    expect(axiosMock.history.post).toHaveLength(0);
  });

  test('after a logout a refresh starts its own request, not the one from the old session', async () => {
    axiosMock.onPost('/api/auth/refresh?optional=1').reply(204, '');

    const oldSession = refreshTokens().catch((e) => e);
    clearToken(); // logout: the refresh in flight belongs to the old session
    const newSession = refreshTokens().catch((e) => e);
    await Promise.all([oldSession, newSession]);

    expect(axiosMock.history.post).toHaveLength(2);
  });

  // The anonymous refresh's 204 belongs to the session before the login: the login
  // must start a refresh of its own rather than join it.
  test('after startSession a refresh starts its own request, not the one from the anonymous session', async () => {
    axiosMock.onPost('/api/auth/refresh?optional=1').reply(204, '');

    const anonymous = refreshTokens().catch((e) => e);
    startSession('b-jwt'); // the login: the refresh in flight belongs to the session before it
    const loggedIn = refreshTokens().catch((e) => e);
    await Promise.all([anonymous, loggedIn]);

    expect(axiosMock.history.post).toHaveLength(2);
  });

  // A superseded refresh settling after a logout must not clear the refresh the
  // logout left in flight, or a third caller starts a duplicate POST on the same cookie.
  test('a superseded refresh settling does not clear the newer refresh in flight', async () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const held = [];
    axiosMock.onPost('/api/auth/refresh?optional=1').reply(() => {
      if (held.length >= 2) return [200, { token: 'c-jwt', user: { id: 1 } }];
      return new Promise((release) => { held.push(release); });
    });

    const superseded = refreshTokens().catch((e) => e); // refresh A on the wire
    clearToken(); // logout: A now belongs to the session that ended
    const newer = refreshTokens(); // refresh B on the wire
    await settle();
    held[0]([200, { token: 'a-jwt', user: { id: 1 } }]);
    await superseded; // A settles as SESSION_ENDED and installs nothing

    const third = refreshTokens(); // must join B, not start a new POST
    held[1]([200, { token: 'b-jwt', user: { id: 1 } }]);

    await expect(third).resolves.toBe('b-jwt');
    await expect(newer).resolves.toBe('b-jwt');
    expect(axiosMock.history.post).toHaveLength(2);
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
