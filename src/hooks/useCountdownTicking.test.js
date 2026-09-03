import { act, renderHook } from '@testing-library/react';
import useCountdownTicking, { alignedToSecond } from './useCountdownTicking';

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);

beforeEach(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('alignedToSecond', () => {
  test('waits out the partial second so the next tick lands on the boundary', () => {
    expect(alignedToSecond(29400)).toBe(400);
    expect(alignedToSecond(28995)).toBe(995);
  });

  test('never returns 0: a tick dead on the boundary waits a whole second', () => {
    expect(alignedToSecond(29000)).toBe(1000);
  });
});

describe('useCountdownTicking', () => {
  test('defaults to a flat one-second cadence', () => {
    const { result } = renderHook(() => useCountdownTicking(NOW + 30000));
    expect(result.current).toBe(30000);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(result.current).toBe(29000);
  });

  test('nextDelay chooses each tick from the remaining time', () => {
    const nextDelay = jest.fn(() => 5000);
    const { result } = renderHook(() => useCountdownTicking(NOW + 30000, { nextDelay }));
    expect(nextDelay).toHaveBeenLastCalledWith(30000);
    act(() => { jest.advanceTimersByTime(4999); });
    expect(result.current).toBe(30000);
    act(() => { jest.advanceTimersByTime(1); });
    expect(result.current).toBe(25000);
    expect(nextDelay).toHaveBeenLastCalledWith(25000);
  });

  test('aligned ticks land on the deadline\'s own second boundaries', () => {
    const { result } = renderHook(() => useCountdownTicking(NOW + 30400, { nextDelay: alignedToSecond }));
    expect(result.current).toBe(30400);
    act(() => { jest.advanceTimersByTime(400); });
    expect(result.current).toBe(30000);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(result.current).toBe(29000);
  });

  test('stops ticking at zero and fires onExpire once', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() => useCountdownTicking(NOW + 1500, { onExpire }));
    act(() => { jest.advanceTimersByTime(1000); });
    expect(result.current).toBe(500);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(result.current).toBe(-500);
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(5000); });
    expect(result.current).toBe(-500);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test('a new target re-arms from the new deadline', () => {
    const { result, rerender } = renderHook(({ t }) => useCountdownTicking(t), { initialProps: { t: NOW + 5000 } });
    rerender({ t: NOW + 90000 });
    expect(result.current).toBe(90000);
  });
});
