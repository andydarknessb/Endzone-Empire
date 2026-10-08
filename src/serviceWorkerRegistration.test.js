/**
 * The registration wrapper registers the bare /service-worker.js, in a
 * production build only.
 */
const ORIGINAL_ENV = process.env;

function loadRegister(env) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production', ...env };
  // eslint-disable-next-line global-require
  return require('./serviceWorkerRegistration').register;
}

// register() adds a 'load' listener; each test captures and invokes ITS OWN
// listener rather than dispatching a window event, so listeners left behind
// by earlier tests can never satisfy a later assertion.
function loadListenersAddedBy(fn) {
  const added = [];
  const spy = jest.spyOn(window, 'addEventListener').mockImplementation((type, handler) => { if (type === 'load') added.push(handler); });
  fn();
  spy.mockRestore();
  return added;
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
  delete navigator.serviceWorker;
});

test('does nothing outside a production build', () => {
  const register = loadRegister({ NODE_ENV: 'test' });
  const swRegister = jest.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'serviceWorker', { value: { register: swRegister }, configurable: true });

  const listeners = loadListenersAddedBy(register);

  expect(listeners).toHaveLength(0);
  expect(swRegister).not.toHaveBeenCalled();
});

test('registers /service-worker.js in production', () => {
  const register = loadRegister({});
  const swRegister = jest.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'serviceWorker', { value: { register: swRegister }, configurable: true });

  const [onLoad] = loadListenersAddedBy(register);
  onLoad();

  expect(swRegister).toHaveBeenCalledTimes(1);
  expect(swRegister).toHaveBeenCalledWith('/service-worker.js');
});
