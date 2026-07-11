import MockAdapter from 'axios-mock-adapter';
import apiClient, { getToken, setToken, clearToken } from './apiClient';

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

  test('clearToken removes a previously stored token', () => {
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
