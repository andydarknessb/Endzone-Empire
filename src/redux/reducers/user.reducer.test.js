import userReducer from './user.reducer';

test('returns an empty object as the default state', () => {
  expect(userReducer(undefined, { type: '@@INIT' })).toEqual({});
});

test('SET_USER replaces state with the action payload', () => {
  const payload = { id: 7, username: 'gridiron_guru' };
  expect(userReducer({}, { type: 'SET_USER', payload })).toEqual(payload);
});

test('SET_USER overwrites any previously stored user', () => {
  const previous = { id: 1, username: 'old' };
  const payload = { id: 2, username: 'new' };
  expect(userReducer(previous, { type: 'SET_USER', payload })).toEqual(payload);
});

test('UNSET_USER resets state to an empty object', () => {
  const loggedIn = { id: 7, username: 'gridiron_guru' };
  expect(userReducer(loggedIn, { type: 'UNSET_USER' })).toEqual({});
});

test('an unrecognized action returns the state unchanged', () => {
  const state = { id: 1, username: 'unchanged' };
  expect(userReducer(state, { type: 'SOME_OTHER_ACTION' })).toBe(state);
});
