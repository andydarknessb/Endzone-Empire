import { put, takeLatest } from 'redux-saga/effects';
import apiClient, { clearToken, getToken, refreshTokens } from '../../api/apiClient';
import { dropSessionCaches } from '../../sessionCaches';

// worker Saga: fired on "FETCH_USER" actions
export function* fetchUser() {
  try {
    // A hard load starts with no access token in memory. Restore the session
    // from the refresh cookie first: a bare GET would take a 401 and be sent
    // again after the interceptor's refresh, two /api/user requests per load.
    // A refusal (401) lands in the 401 branch below with no /api/user request
    // at all; any other failure (endpoint down, network) falls through to the
    // GET, which is what a load did before this refresh existed.
    if (!getToken()) {
      try {
        yield refreshTokens();
      } catch (refreshError) {
        if (refreshError.response?.status === 401) throw refreshError;
      }
    }
    const response = yield apiClient.get('/api/user');
    yield put({ type: 'SET_USER', payload: response.data });
  } catch (error) {
    if (error.response && error.response.status === 401) {
      // Token expired or invalid — clear it so the app returns to logged-out
      // state, and drop the session caches with it (a session change).
      clearToken();
      dropSessionCaches();
      yield put({ type: 'UNSET_USER' });
    } else {
      console.log('User get request failed', error);
      // SET_USER and UNSET_USER resolve the session; this is the third way out,
      // so the /home gate does not wait forever on a network error.
      yield put({ type: 'SESSION_RESOLVED' });
    }
  }
}

function* userSaga() {
  yield takeLatest('FETCH_USER', fetchUser);
}

export default userSaga;
