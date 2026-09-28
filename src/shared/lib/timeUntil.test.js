import { act, renderHook } from '@testing-library/react';
import { timeUntil, useNow } from './timeUntil';

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const after = (ms) => timeUntil(NOW + ms, NOW);

// The house style (spec #1737): the top two units, rounded down, the second
// padded, no leading zero unit.
describe('timeUntil at minute precision (the default)', () => {
  test.each([
    [2 * D + 3 * H + 59 * M, '2d 03h'],
    [D, '1d 00h'],
    [D - S, '23h 59m'],
    [14 * H + 40 * M + 59 * S, '14h 40m'],
    [H, '1h 00m'],
    [59 * M + 40 * S, '59m'],
    [M, '1m'],
  ])('%d ms reads %s', (remaining, text) => {
    expect(after(remaining)).toMatchObject({ text, passed: false, imminent: false });
  });

  test('the last minute reads "Under 1m" and is imminent', () => {
    expect(after(59 * S)).toMatchObject({ text: 'Under 1m', passed: false, imminent: true });
    expect(after(1)).toMatchObject({ text: 'Under 1m', imminent: true });
  });

  test('an instant that has arrived or passed has no text', () => {
    expect(after(0)).toEqual({ text: null, passed: true, imminent: false, changesAt: null });
    expect(after(-5 * M)).toMatchObject({ text: null, passed: true });
  });
});

describe('timeUntil at second precision', () => {
  const secs = (ms) => timeUntil(NOW + ms, NOW, { precision: 'second' });

  test('seconds appear only inside the last hour', () => {
    expect(secs(2 * D + 3 * H).text).toBe('2d 03h');
    expect(secs(H).text).toBe('1h 00m');
    expect(secs(59 * M + 59 * S).text).toBe('59m 59s');
    expect(secs(5 * M + 9 * S + 900).text).toBe('5m 09s');
    expect(secs(M).text).toBe('1m 00s');
  });

  test('under a minute it reads seconds alone', () => {
    expect(secs(30 * S).text).toBe('30s');
    expect(secs(999)).toMatchObject({ text: '0s', imminent: true });
  });
});

describe('timeUntil changesAt: the first instant its text differs', () => {
  test('minute precision changes on the minute below', () => {
    const r = after(14 * H + 40 * M + 30 * S);
    expect(r.changesAt).toBe(NOW + 30 * S + 1);
    expect(timeUntil(NOW + 14 * H + 40 * M + 30 * S, r.changesAt).text).toBe('14h 39m');
    expect(timeUntil(NOW + 14 * H + 40 * M + 30 * S, r.changesAt - 1).text).toBe('14h 40m');
  });

  test('a day out it changes on the hour below', () => {
    expect(after(2 * D + 3 * H + 20 * M).changesAt).toBe(NOW + 20 * M + 1);
  });

  test('"Under 1m" changes when the instant passes', () => {
    expect(after(20 * S).changesAt).toBe(NOW + 20 * S + 1);
  });

  test('second precision changes on the second below', () => {
    expect(timeUntil(NOW + 5 * M + 9 * S + 400, NOW, { precision: 'second' }).changesAt).toBe(NOW + 400 + 1);
  });
});

test('accepts an ISO string or a Date, and an unreadable instant is null', () => {
  const iso = new Date(NOW + H).toISOString();
  expect(timeUntil(iso, NOW).text).toBe('1h 00m');
  expect(timeUntil(new Date(NOW + H), new Date(NOW)).text).toBe('1h 00m');
  expect(timeUntil(null, NOW)).toBeNull();
  expect(timeUntil('not a date', NOW)).toBeNull();
});

describe('useNow', () => {
  beforeEach(() => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  test('repaints once, at the instant given, not on an interval', () => {
    let paints = 0;
    const { result } = renderHook(() => { paints += 1; return useNow(NOW + 90 * S); });
    expect(result.current).toBe(NOW);
    const paintsBefore = paints;
    act(() => { jest.advanceTimersByTime(90 * S); });
    expect(result.current).toBe(NOW + 90 * S);
    expect(paints).toBe(paintsBefore + 1);
  });

  test('with no next change it never repaints', () => {
    let paints = 0;
    renderHook(() => { paints += 1; return useNow(null); });
    const paintsBefore = paints;
    act(() => { jest.advanceTimersByTime(D); });
    expect(paints).toBe(paintsBefore);
  });

  test('a next change weeks away does not fire early (setTimeout caps at about 24.8 days)', () => {
    const { result } = renderHook(() => useNow(NOW + 30 * D));
    act(() => { jest.advanceTimersByTime(25 * D); });
    expect(result.current).toBeLessThan(NOW + 30 * D);
    act(() => { jest.advanceTimersByTime(5 * D); });
    expect(result.current).toBe(NOW + 30 * D);
  });
});

describe('useNow with a function and a refresh key', () => {
  beforeEach(() => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  test('reads the next change from the time it paints with', () => {
    const at = NOW + 2 * M + 30 * S;
    const { result } = renderHook(() => {
      const now = useNow((n) => timeUntil(at, n).changesAt);
      return timeUntil(at, now).text;
    });
    expect(result.current).toBe('2m');
    act(() => { jest.advanceTimersByTime(30 * S + 1); });
    expect(result.current).toBe('1m');
    act(() => { jest.advanceTimersByTime(M); });
    expect(result.current).toBe('Under 1m');
  });

  test('a new refresh key re-reads the clock at once', () => {
    const { result, rerender } = renderHook(({ key }) => useNow(null, key), { initialProps: { key: 1 } });
    act(() => { jest.setSystemTime(NOW + 5 * H); });
    rerender({ key: 1 });
    expect(result.current).toBe(NOW);
    rerender({ key: 2 });
    expect(result.current).toBe(NOW + 5 * H);
  });
});
