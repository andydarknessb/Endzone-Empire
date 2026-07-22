import axios from 'axios';
import { getApiOrigin } from './origins';

/**
 * Bare axios instance for the public (no-login) layer.
 *
 * Deliberately NOT the shared apiClient: it attaches no Authorization header
 * and has no 401/refresh interceptor, so a logged-out visitor browsing public
 * pages never triggers a token refresh, a session-expired event, or a redirect
 * to login. It talks only to the unauthenticated /api/public/* endpoints.
 */
const publicApiClient = axios.create({
  baseURL: getApiOrigin() || undefined,
  timeout: 15000,
});

export default publicApiClient;
