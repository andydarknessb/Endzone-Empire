/**
 * A non-credential marker that says "someone was logged in on this device".
 *
 * The public pages render in their own BrowserRouter tree with no access to the
 * authed app's in-memory access token (and the refresh cookie is httpOnly, which
 * we must not probe — refresh tokens rotate and are single-use). This boolean
 * lets the public header offer "My Dashboard" instead of "Log In".
 *
 * It is a UX hint only, never an auth decision: nothing here grants access, and
 * a stale hint just lands the user on the login screen via ProtectedRoute —
 * exactly what "Log In" would have done. Never store a token here.
 */
const SESSION_HINT_KEY = 'endzone_session_hint';

/** Mirrors the access-token lifecycle. Storage can throw in privacy modes, so
 * every access is best-effort. */
export function setSessionHint(active) {
  try {
    if (active) window.localStorage.setItem(SESSION_HINT_KEY, '1');
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch (_error) {
    // No hint is a safe outcome — the header just shows the logged-out CTAs.
  }
}

export function hasSessionHint() {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch (_error) {
    return false;
  }
}

export { SESSION_HINT_KEY };
