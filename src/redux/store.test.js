describe('redux store', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  test('creates a store whose initial state matches the combined reducers', () => {
    const store = require('./store').default;
    expect(store.getState()).toEqual({
      errors: { loginMessage: '', registrationMessage: '' },
      user: {},
    });
  });

  test('dispatching a plain action updates state via the real reducer wiring', () => {
    const store = require('./store').default;
    store.dispatch({ type: 'SET_USER', payload: { id: 1, username: 'alice' } });
    expect(store.getState().user).toEqual({ id: 1, username: 'alice' });
  });

  test('exposes redux store methods (getState/dispatch/subscribe)', () => {
    const store = require('./store').default;
    expect(typeof store.getState).toBe('function');
    expect(typeof store.dispatch).toBe('function');
    expect(typeof store.subscribe).toBe('function');
  });

  test('builds successfully under NODE_ENV=development (redux-logger middleware branch)', () => {
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    expect(() => require('./store').default).not.toThrow();
  });

  test('builds successfully under NODE_ENV=production (no redux-logger)', () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    expect(() => require('./store').default).not.toThrow();
  });
});
