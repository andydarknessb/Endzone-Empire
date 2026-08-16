import { put, takeLatest } from 'redux-saga/effects';
import apiClient, { setToken } from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';

// worker Saga: fired on "REGISTER" actions
export function* registerUser(action) {
  try {
    yield put({ type: 'CLEAR_REGISTRATION_ERROR' });

    // Registration returns a JWT immediately — no separate login round trip
    const response = yield apiClient.post('/api/auth/register', action.payload);
    setToken(response.data.token);

    // A new account on this device is a session change like a login: drop
    // the offline api cache and the shared in-memory league cache so the new
    // user is never served the previous account's rows.
    clearLeagueCache();
    if (typeof caches !== 'undefined') {
      caches.delete('api-cache-v1').catch(() => {});
    }

    yield put({ type: 'SET_USER', payload: response.data.user });
    yield put({ type: 'SET_TO_LOGIN_MODE' });
  } catch (error) {
    console.log('Error with user registration:', error);
    yield put({ type: 'REGISTRATION_FAILED' });
  }
}

function* registrationSaga() {
  yield takeLatest('REGISTER', registerUser);
}

export default registrationSaga;
