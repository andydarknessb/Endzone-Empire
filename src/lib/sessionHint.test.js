import { SESSION_HINT_KEY, hasSessionHint, setSessionHint } from './sessionHint';

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.removeItem(SESSION_HINT_KEY);
});

test('round-trips the hint through localStorage', () => {
  expect(hasSessionHint()).toBe(false);
  setSessionHint(true);
  expect(window.localStorage.getItem(SESSION_HINT_KEY)).toBe('1');
  expect(hasSessionHint()).toBe(true);
});

test('clears the hint when set inactive', () => {
  setSessionHint(true);
  setSessionHint(false);
  expect(window.localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
  expect(hasSessionHint()).toBe(false);
});

test('never stores anything but the boolean marker', () => {
  setSessionHint('a-jwt-looking-string');
  expect(window.localStorage.getItem(SESSION_HINT_KEY)).toBe('1');
});

test('reads false for any value other than the marker', () => {
  window.localStorage.setItem(SESSION_HINT_KEY, 'true');
  expect(hasSessionHint()).toBe(false);
});

test('returns false instead of throwing when storage is unavailable', () => {
  jest.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
    throw new Error('SecurityError: storage is disabled');
  });
  expect(hasSessionHint()).toBe(false);
});

test('swallows write failures when storage is unavailable', () => {
  jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  jest.spyOn(window.localStorage.__proto__, 'removeItem').mockImplementation(() => {
    throw new Error('SecurityError: storage is disabled');
  });
  expect(() => setSessionHint(true)).not.toThrow();
  expect(() => setSessionHint(false)).not.toThrow();
});
