import rootReducer from './_root.reducer';

test('combines errors and user slices with the correct default shape', () => {
  const state = rootReducer(undefined, { type: '@@INIT' });
  expect(state).toEqual({
    errors: { loginMessage: '', registrationMessage: '' },
    user: {},
  });
});

test('routes SET_USER through to the user slice only', () => {
  const state = rootReducer(undefined, {
    type: 'SET_USER',
    payload: { id: 3, username: 'routed' },
  });
  expect(state.user).toEqual({ id: 3, username: 'routed' });
  expect(state.errors).toEqual({ loginMessage: '', registrationMessage: '' });
});

test('routes LOGIN_FAILED through to the errors slice only', () => {
  const state = rootReducer(undefined, { type: 'LOGIN_FAILED' });
  expect(state.errors.loginMessage).toBe("Oops! The username and password didn't match. Try again!");
  expect(state.user).toEqual({});
});
