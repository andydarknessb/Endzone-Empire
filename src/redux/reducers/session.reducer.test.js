import sessionReducer from './session.reducer';

test('starts unresolved', () => {
  expect(sessionReducer(undefined, { type: '@@INIT' })).toEqual({ resolved: false });
});

test.each(['SET_USER', 'UNSET_USER', 'SESSION_RESOLVED'])('%s resolves the session', (type) => {
  expect(sessionReducer({ resolved: false }, { type })).toEqual({ resolved: true });
});

test('FETCH_USER reopens a resolved session', () => {
  expect(sessionReducer({ resolved: true }, { type: 'FETCH_USER' })).toEqual({ resolved: false });
});

test('ignores unrelated actions', () => {
  const state = { resolved: true };
  expect(sessionReducer(state, { type: 'SOMETHING_ELSE' })).toBe(state);
});
