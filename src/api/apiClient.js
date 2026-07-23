import axios from 'axios';
import { apiUrl, getApiOrigin } from './origins';

let accessToken = null;

if (typeof window !== 'undefined') {
  window.localStorage.removeItem('endzone_token');
  window.localStorage.removeItem('endzone_refresh');
}

export function getToken() {
  return accessToken;
}

export function setToken(token) {
  accessToken = token || null;
}

export function clearToken() {
  accessToken = null;
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

function storeRotatedAccessToken(response) {
  setToken(response.data.token);
  return response.data.token;
}

function requestRefresh() {
  return axios.post(apiUrl('/api/auth/refresh'), null, { withCredentials: true });
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
      clearToken();
      window.dispatchEvent(new Event('auth:session-expired'));
      return Promise.reject(error);
    }
  }
);

export default apiClient;
