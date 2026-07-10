import { put, takeLatest } from 'redux-saga/effects';
import apiClient, { getToken, clearToken } from '../../api/apiClient';

// worker Saga: fired on "FETCH_USER" actions
function* fetchUser() {
  // No stored token → nobody is logged in; skip the request entirely
  if (!getToken()) return;
  try {
    const response = yield apiClient.get('/api/user');
    yield put({ type: 'SET_USER', payload: response.data });
  } catch (error) {
    if (error.response && error.response.status === 401) {
      // Token expired or invalid — clear it so the app returns to logged-out state
      clearToken();
      yield put({ type: 'UNSET_USER' });
    } else {
      console.log('User get request failed', error);
    }
  }
}

function* userSaga() {
  yield takeLatest('FETCH_USER', fetchUser);
}

export default userSaga;
