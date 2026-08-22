function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function getApiOrigin(env = process.env) {
  return normalizeOrigin(env.REACT_APP_API_ORIGIN);
}

export function getSocketOrigin(env = process.env) {
  return normalizeOrigin(env.REACT_APP_SOCKET_ORIGIN || env.REACT_APP_API_ORIGIN) || '/';
}

export function apiUrl(path, env = process.env) {
  return `${getApiOrigin(env)}${path}`;
}
