import { put, takeLatest } from 'redux-saga/effects';
import apiClient, {
  setToken,
  setRefreshToken,
  getRefreshToken,
  clearToken,
} from '../../api/apiClient';

// worker Saga: fired on "LOGIN" actions
export function* loginUser(action) {
  try {
    yield put({ type: 'CLEAR_LOGIN_ERROR' });

    const response = yield apiClient.post('/api/auth/login', action.payload);

    // Persist both tokens; the access JWT rides every request, the refresh
    // token silently renews it when it expires (~15 min)
    setToken(response.data.token);
    if (response.data.refreshToken) setRefreshToken(response.data.refreshToken);

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
  const refreshToken = getRefreshToken();
  clearToken();
  if (refreshToken) {
    try {
      yield apiClient.post('/api/auth/logout', { refreshToken });
    } catch (error) {
      // Best effort: local logout already happened
      console.log('Server-side logout failed:', error);
    }
  }
  yield put({ type: 'UNSET_USER' });
}

function* loginSaga() {
  yield takeLatest('LOGIN', loginUser);
  yield takeLatest('LOGOUT', logoutUser);
}

export default loginSaga;
