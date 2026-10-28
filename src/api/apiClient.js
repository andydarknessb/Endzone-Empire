import axios from 'axios';
import { apiUrl, getApiOrigin } from './origins';
import { setSessionHint } from '../lib/sessionHint';

let accessToken = null;

if (typeof window !== 'undefined') {
  window.localStorage.removeItem('endzone_token');
  window.localStorage.removeItem('endzone_refresh');
}

export function getToken() {
  return accessToken;
}

// Every login, registration, silent refresh and logout funnels through these
// two, so they're the one place the public-tree session hint has to be kept in
// step with the token. The hint is a UX marker only — see lib/sessionHint.
export function setToken(token) {
  accessToken = token || null;
  setSessionHint(accessToken);
}

export function clearToken() {
  setToken(null);
}

const apiClient = axios.create({
  baseURL: getApiOrigin() || undefined,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise = null;

// Who wants the new access token after every successful refresh (a live draft
// socket tells its server). Returns the unsubscribe.
const refreshListeners = new Set();
export function onTokenRefreshed(listener) {
  refreshListeners.add(listener);
  return () => refreshListeners.delete(listener);
}

// The refresh endpoint answers 204 with no body when the browser sent no refresh
// cookie: an anonymous visitor has no session to restore. That is a refusal
// every caller must treat like a 401 (the cookie is httpOnly, so only the
// server can say "none"), but it is not an HTTP error, so it carries a code of
// its own instead of a fabricated response.
const NO_SESSION = 'NO_SESSION';

/** True when the server refused to restore a session: a 401 (invalid, expired
 * or revoked cookie) or the 204 "no cookie". A network failure or a 5xx is not
 * a refusal; the cookie may still be good. */
export function isSessionRefusal(error) {
  return error?.response?.status === 401 || error?.code === NO_SESSION;
}

function storeRotatedAccessToken(response) {
  const token = response.data?.token;
  if (!token) {
    const error = new Error('no session to restore');
    error.code = NO_SESSION;
    throw error;
  }
  setToken(token);
  refreshListeners.forEach((listener) => listener(token));
  return token;
}

// `optional=1` opts in to the 204 "no cookie" answer; the server still answers
// 400 without it, for bundles built before the 204 existed. A query param, not
// a header, so it adds no CORS preflight.
function requestRefresh() {
  return axios.post(apiUrl('/api/auth/refresh?optional=1'), null, { withCredentials: true });
}

export async function refreshTokens() {
  if (!refreshPromise) {
    refreshPromise = requestRefresh()
      .catch(async (error) => {
        if (error.response?.status !== 401) throw error;
        await new Promise((resolve) => setTimeout(resolve, 75));
        return requestRefresh();
      })
      .then(storeRotatedAccessToken)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const shouldRefresh =
      response &&
      response.status === 401 &&
      config &&
      !config._retried &&
      !String(config.url).includes('/api/auth/');
    if (!shouldRefresh) return Promise.reject(error);
    try {
      const token = await refreshTokens();
      config._retried = true;
      config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
      return apiClient(config);
    } catch (refreshError) {
      // Only a refusal ends the session; a 503 mid-deploy or a dropped link leaves the cookie good,
      // and the caller sees that transient failure, not a 401 it would read as a refusal.
      // Any other answer (an older server's 400 for no cookie) keeps the original 401.
      if (isSessionRefusal(refreshError)) {
        clearToken();
        window.dispatchEvent(new Event('auth:session-expired'));
      }
      const transient = !isSessionRefusal(refreshError) && (!refreshError.response || refreshError.response.status >= 500);
      return Promise.reject(transient ? refreshError : error);
    }
  }
);

export default apiClient;
