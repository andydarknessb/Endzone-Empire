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

// Bumped on every logout: a refresh that was on the wire then answers for the
// session that just ended, and must not install its token.
let sessionGeneration = 0;
export function clearToken() {
  sessionGeneration += 1;
  // A request after the logout must start its own refresh, not join one from the old session.
  refreshPromise = null;
  setToken(null);
}

const apiClient = axios.create({
  baseURL: getApiOrigin() || undefined,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // The session this request was sent under: a 401 answered after a logout is not refreshed.
  config._generation = sessionGeneration;
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
// A refresh answered after a logout: its token belongs to the session that ended.
// Not a refusal of the session now in place, so no caller clears that session.
const SESSION_ENDED = 'SESSION_ENDED';

/** True when the server refused to restore a session: a 401 (invalid, expired
 * or revoked cookie) or the 204 "no cookie". A network failure or a 5xx is not
 * a refusal; the cookie may still be good. */
export function isSessionRefusal(error) {
  return error?.response?.status === 401 || error?.code === NO_SESSION;
}

/** True when a 401 answers a session that has since ended (a request sent before
 * a logout, or a refresh that outlived one). It is not a refusal of the session
 * now in place, so the caller must not clear that session. */
export function isStaleSessionRefusal(error) {
  return error?.staleSession === true;
}

function storeRotatedAccessToken(response, generation) {
  const token = response.data?.token;
  if (!token) {
    const error = new Error('no session to restore');
    error.code = NO_SESSION;
    throw error;
  }
  if (generation !== sessionGeneration) {
    const error = new Error('session ended while refreshing');
    error.code = SESSION_ENDED;
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
    const generation = sessionGeneration;
    const pending = requestRefresh()
      .catch(async (error) => {
        if (error.response?.status !== 401) throw error;
        await new Promise((resolve) => setTimeout(resolve, 75));
        return requestRefresh();
      })
      .then((response) => storeRotatedAccessToken(response, generation))
      .catch((error) => {
        // A refusal that settles after a logout answers the session that ended: it must not clear the one in place.
        if (generation === sessionGeneration || !isSessionRefusal(error)) throw error;
        const ended = new Error('session ended while refreshing');
        ended.code = SESSION_ENDED;
        throw ended;
      })
      .finally(() => {
        // A superseded refresh settling must not clear the newer one a logout started.
        if (refreshPromise === pending) refreshPromise = null;
      });
    refreshPromise = pending;
  }
  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    // Sent before a logout and answered 401 after it: not refreshed, and the 401 is flagged as stale.
    if (response?.status === 401 && config && config._generation !== sessionGeneration) {
      error.staleSession = true;
      return Promise.reject(error);
    }
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
      // A refresh that answered after a logout says nothing about the session now in place.
      if (refreshError.code === SESSION_ENDED) {
        error.staleSession = true;
        return Promise.reject(error);
      }
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
