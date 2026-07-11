import { put, takeLatest } from 'redux-saga/effects';
import apiClient, { setToken, clearToken } from '../../api/apiClient';

// worker Saga: fired on "LOGIN" actions
export function* loginUser(action) {
  try {
    yield put({ type: 'CLEAR_LOGIN_ERROR' });

    const response = yield apiClient.post('/api/auth/login', action.payload);

    // Persist the JWT; every subsequent request sends it as a Bearer token
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

// worker Saga: fired on "LOGOUT" actions — JWT logout is client-side
export function* logoutUser() {
  clearToken();
  yield put({ type: 'UNSET_USER' });
}

function* loginSaga() {
  yield takeLatest('LOGIN', loginUser);
  yield takeLatest('LOGOUT', logoutUser);
}

export default loginSaga;
