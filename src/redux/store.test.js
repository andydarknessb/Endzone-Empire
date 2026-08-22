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

  // redux-logger is a development aid; production must not even LOAD the
  // module (a static import ships it in the initial bundle unused, ~10 KiB
  // minified). The test watches the module registry rather than the console.

  test('under NODE_ENV=development the store loads redux-logger and still builds', () => {
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    jest.doMock('redux-logger', () => {
      global.__reduxLoggerLoads = (global.__reduxLoggerLoads || 0) + 1;
      return jest.requireActual('redux-logger');
    });
    const before = global.__reduxLoggerLoads || 0;
    const store = require('./store').default;
    // Dispatch runs through the logger middleware (quietly), proving it is wired.
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const group = jest.spyOn(console, 'group').mockImplementation(() => {});
    const groupEnd = jest.spyOn(console, 'groupEnd').mockImplementation(() => {});
    try {
      store.dispatch({ type: 'SET_USER', payload: { id: 3, username: 'carol' } });
    } finally {
      log.mockRestore(); group.mockRestore(); groupEnd.mockRestore();
    }
    expect(store.getState().user).toEqual({ id: 3, username: 'carol' });
    expect(global.__reduxLoggerLoads || 0).toBe(before + 1);
  });

  test('under NODE_ENV=production the store never loads redux-logger', () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    jest.doMock('redux-logger', () => {
      global.__reduxLoggerLoads = (global.__reduxLoggerLoads || 0) + 1;
      return jest.requireActual('redux-logger');
    });
    const before = global.__reduxLoggerLoads || 0;
    const store = require('./store').default;
    store.dispatch({ type: 'SET_USER', payload: { id: 2, username: 'bob' } });
    expect(store.getState().user).toEqual({ id: 2, username: 'bob' });
    expect(global.__reduxLoggerLoads || 0).toBe(before);
  });
});
