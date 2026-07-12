import axios from 'axios';

const TOKEN_KEY = 'endzone_token';
const REFRESH_KEY = 'endzone_refresh';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token) {
  localStorage.setItem(REFRESH_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// Shared axios instance: attaches the JWT to every request.
const apiClient = axios.create();

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Single-flight refresh: concurrent 401s share one /refresh round-trip so a
// rotated token is never presented twice (that would trip reuse detection).
let refreshPromise = null;

function storeRotatedTokens(response) {
  setToken(response.data.token);
  setRefreshToken(response.data.refreshToken);
  return response.data.token;
}

export async function refreshTokens() {
  if (!refreshPromise) {
    const sent = getRefreshToken();
    refreshPromise = axios
      .post('/api/auth/refresh', { refreshToken: sent })
      .then(storeRotatedTokens)
      .catch((error) => {
        // The single-flight guard is per-tab; another tab may have won the
        // refresh race and already rotated the shared token in localStorage.
        // If so, retry once with the winner's token instead of logging out.
        const current = getRefreshToken();
        if (current && current !== sent) {
          return axios
            .post('/api/auth/refresh', { refreshToken: current })
            .then(storeRotatedTokens);
        }
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// On 401: refresh once and retry the original request. A failed refresh means
// the session is truly dead — clear tokens and let the app fall to login.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const shouldRefresh =
      response &&
      response.status === 401 &&
      config &&
      !config._retried &&
      getRefreshToken() &&
      !String(config.url).includes('/api/auth/');
    if (!shouldRefresh) {
      return Promise.reject(error);
    }
    try {
      const token = await refreshTokens();
      config._retried = true;
      config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
      return apiClient(config);
    } catch (refreshError) {
      clearToken();
      window.dispatchEvent(new Event('auth:session-expired'));
      return Promise.reject(error);
    }
  }
);

export default apiClient;
