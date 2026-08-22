import errorsReducer from './errors.reducer';

const initialState = { loginMessage: '', registrationMessage: '' };

test('returns the default state for an unknown action', () => {
  expect(errorsReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
});

describe('loginMessage slice', () => {
  test('CLEAR_LOGIN_ERROR resets loginMessage to an empty string', () => {
    const state = errorsReducer({ ...initialState, loginMessage: 'stale' }, { type: 'CLEAR_LOGIN_ERROR' });
    expect(state.loginMessage).toBe('');
  });

  test('LOGIN_INPUT_ERROR sets the missing-fields message', () => {
    const state = errorsReducer(initialState, { type: 'LOGIN_INPUT_ERROR' });
    expect(state.loginMessage).toBe('Enter your username and password!');
  });

  test('LOGIN_FAILED sets the credentials-mismatch message', () => {
    const state = errorsReducer(initialState, { type: 'LOGIN_FAILED' });
    expect(state.loginMessage).toBe("Oops! The username and password didn't match. Try again!");
  });

  test('LOGIN_FAILED_NO_CODE sets the server-down message', () => {
    const state = errorsReducer(initialState, { type: 'LOGIN_FAILED_NO_CODE' });
    expect(state.loginMessage).toBe('Oops! Something went wrong! Is the server running?');
  });
});

describe('registrationMessage slice', () => {
  test('CLEAR_REGISTRATION_ERROR resets registrationMessage to an empty string', () => {
    const state = errorsReducer(
      { ...initialState, registrationMessage: 'stale' },
      { type: 'CLEAR_REGISTRATION_ERROR' }
    );
    expect(state.registrationMessage).toBe('');
  });

  test('REGISTRATION_INPUT_ERROR sets the missing-fields message', () => {
    const state = errorsReducer(initialState, { type: 'REGISTRATION_INPUT_ERROR' });
    expect(state.registrationMessage).toBe('Choose a username and password!');
  });

  test('REGISTRATION_FAILED sets the username-taken message', () => {
    const state = errorsReducer(initialState, { type: 'REGISTRATION_FAILED' });
    expect(state.registrationMessage).toBe(
      "Oops! That didn't work. The username might already be taken. Try again!"
    );
  });
});

test('an action affecting one slice leaves the other slice untouched', () => {
  const state = errorsReducer(
    { loginMessage: 'existing login error', registrationMessage: '' },
    { type: 'REGISTRATION_INPUT_ERROR' }
  );
  expect(state.loginMessage).toBe('existing login error');
  expect(state.registrationMessage).toBe('Choose a username and password!');
});
