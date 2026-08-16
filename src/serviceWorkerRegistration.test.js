/**
 * The registration wrapper hands the worker the API origin through its
 * script URL, since a service worker cannot read REACT_APP_* itself.
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
  const register = loadRegister({ NODE_ENV: 'test', REACT_APP_API_ORIGIN: 'https://api.endzoneempire.gg' });
  const swRegister = jest.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'serviceWorker', { value: { register: swRegister }, configurable: true });

  const listeners = loadListenersAddedBy(register);

  expect(listeners).toHaveLength(0);
  expect(swRegister).not.toHaveBeenCalled();
});

test('registers /service-worker.js?api=<origin> when the API lives on another origin (production)', () => {
  const register = loadRegister({ REACT_APP_API_ORIGIN: 'https://api.endzoneempire.gg' });
  const swRegister = jest.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'serviceWorker', { value: { register: swRegister }, configurable: true });

  const [onLoad] = loadListenersAddedBy(register);
  onLoad();

  expect(swRegister).toHaveBeenCalledTimes(1);
  expect(swRegister).toHaveBeenCalledWith('/service-worker.js?api=https%3A%2F%2Fapi.endzoneempire.gg');
});

test('registers the bare /service-worker.js when the API is same-origin (dev proxy, previews)', () => {
  const register = loadRegister({ REACT_APP_API_ORIGIN: '' });
  const swRegister = jest.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'serviceWorker', { value: { register: swRegister }, configurable: true });

  const [onLoad] = loadListenersAddedBy(register);
  onLoad();

  expect(swRegister).toHaveBeenCalledTimes(1);
  expect(swRegister).toHaveBeenCalledWith('/service-worker.js');
});

