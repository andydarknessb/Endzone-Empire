import { apiUrl, getApiOrigin, getSocketOrigin } from './origins';

test('uses same-origin client requests when no production origin is configured', () => {
  expect(getApiOrigin({})).toBe('');
  expect(getSocketOrigin({})).toBe('/');
  expect(apiUrl('/api/health', {})).toBe('/api/health');
});

test('normalizes configured API and Socket.IO origins', () => {
  const env = {
    REACT_APP_API_ORIGIN: ' https://api.endzoneempire.gg/ ',
  };

  expect(getApiOrigin(env)).toBe('https://api.endzoneempire.gg');
  expect(getSocketOrigin(env)).toBe('https://api.endzoneempire.gg');
  expect(apiUrl('/api/health', env)).toBe('https://api.endzoneempire.gg/api/health');
});

test('allows Socket.IO to use a separately configured origin', () => {
  const env = {
    REACT_APP_API_ORIGIN: 'https://api.endzoneempire.gg',
    REACT_APP_SOCKET_ORIGIN: 'https://socket.endzoneempire.gg/',
  };

  expect(getSocketOrigin(env)).toBe('https://socket.endzoneempire.gg');
});
