import { put, takeLatest } from 'redux-saga/effects';
import apiClient, {
  setToken,
  clearToken,
} from '../../api/apiClient';
import { dropSessionCaches } from '../../sessionCaches';

// worker Saga: fired on "LOGIN" actions
export function* loginUser(action) {
  try {
    yield put({ type: 'CLEAR_LOGIN_ERROR' });

    // A fresh login may be a different account on this device: drop every
    // cache the previous session left (offline API store, in-memory league
    // and pick'em standings caches) before anything from this one lands.
    dropSessionCaches();

    const response = yield apiClient.post('/api/auth/login', action.payload);

    // Persist both tokens; the access JWT rides every request, the refresh
    // token silently renews it when it expires (~15 min)
    setToken(response.data.token);

    yield put({ type: 'SET_USER', payload: response.data.user });
  } catch (error) {
    console.log('Error with user login:', error);
    if (error.response && error.response.status === 401) {
      yield put({ type: 'LOGIN_FAILED' });
    } else {
      yield put({ type: 'LOGIN_FAILED_NO_CODE' });
    }
  }
}

// worker Saga: fired on "LOGOUT" actions — also revokes the refresh session
// server-side so the token family can't be replayed later
export function* logoutUser() {
  clearToken();
  // Drop every session cache so a different user on this device can't see
  // the previous account's cached responses.
  dropSessionCaches();
  try {
    yield apiClient.post('/api/auth/logout');
  } catch (error) {
    // Best effort: the in-memory access token is already gone.
  }
  yield put({ type: 'UNSET_USER' });
}

function* loginSaga() {
  yield takeLatest('LOGIN', loginUser);
  yield takeLatest('LOGOUT', logoutUser);
}

export default loginSaga;
