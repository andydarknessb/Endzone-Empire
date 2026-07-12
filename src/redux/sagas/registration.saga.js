import { put, takeLatest } from 'redux-saga/effects';
import apiClient, { setToken, setRefreshToken } from '../../api/apiClient';

// worker Saga: fired on "REGISTER" actions
export function* registerUser(action) {
  try {
    yield put({ type: 'CLEAR_REGISTRATION_ERROR' });

    // Registration returns a JWT immediately — no separate login round trip
    const response = yield apiClient.post('/api/auth/register', action.payload);
    setToken(response.data.token);
    if (response.data.refreshToken) setRefreshToken(response.data.refreshToken);

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
