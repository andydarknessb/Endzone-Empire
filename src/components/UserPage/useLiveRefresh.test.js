import { renderHook, act } from '@testing-library/react';
import { useLiveRefresh } from './useLiveRefresh';

const setHidden = (hidden) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
};
const fireVisibility = () => act(() => { document.dispatchEvent(new Event('visibilitychange')); });

beforeEach(() => {
  jest.useFakeTimers();
  setHidden(false);
});

afterEach(() => {
  jest.useRealTimers();
  setHidden(false);
});

test('ticks every 60 s while active and the tab is visible', () => {
  const onTick = jest.fn();
  renderHook(() => useLiveRefresh({ active: true, onTick }));

  act(() => { jest.advanceTimersByTime(59 * 1000); });
  expect(onTick).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(1000); });
  expect(onTick).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(60 * 1000); });
  expect(onTick).toHaveBeenCalledTimes(2);
});

test('does nothing while inactive, and stops when it goes inactive', () => {
  const onTick = jest.fn();
  const { rerender } = renderHook(({ active }) => useLiveRefresh({ active, onTick }), { initialProps: { active: false } });
  act(() => { jest.advanceTimersByTime(180 * 1000); });
  fireVisibility();
  expect(onTick).not.toHaveBeenCalled();

  rerender({ active: true });
  act(() => { jest.advanceTimersByTime(60 * 1000); });
  expect(onTick).toHaveBeenCalledTimes(1);

  rerender({ active: false });
  act(() => { jest.advanceTimersByTime(180 * 1000); });
  expect(onTick).toHaveBeenCalledTimes(1);
});

test('skips its ticks while the tab is hidden, and refreshes once when it is shown', () => {
  const onTick = jest.fn();
  renderHook(() => useLiveRefresh({ active: true, onTick }));

  setHidden(true);
  act(() => { jest.advanceTimersByTime(180 * 1000); });
  fireVisibility();
  expect(onTick).not.toHaveBeenCalled();

  setHidden(false);
  fireVisibility();
  expect(onTick).toHaveBeenCalledTimes(1);
});

test('always calls the latest onTick', () => {
  const first = jest.fn();
  const second = jest.fn();
  const { rerender } = renderHook(({ onTick }) => useLiveRefresh({ active: true, onTick }), { initialProps: { onTick: first } });
  rerender({ onTick: second });
  act(() => { jest.advanceTimersByTime(60 * 1000); });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

test('a tab shown again within 30 s of the last refresh does not refresh again', () => {
  const onTick = jest.fn();
  renderHook(() => useLiveRefresh({ active: true, onTick }));

  act(() => { jest.advanceTimersByTime(60 * 1000); });
  expect(onTick).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(29 * 1000); });
  fireVisibility();
  expect(onTick).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(1000); });
  fireVisibility();
  expect(onTick).toHaveBeenCalledTimes(2);
});

test('a visibility refresh restarts the 60 s interval', () => {
  const onTick = jest.fn();
  renderHook(() => useLiveRefresh({ active: true, onTick }));

  act(() => { jest.advanceTimersByTime(40 * 1000); });
  fireVisibility();
  expect(onTick).toHaveBeenCalledTimes(1);
  // The old interval would fire at 60 s; the restarted one fires 60 s after the refresh.
  act(() => { jest.advanceTimersByTime(59 * 1000); });
  expect(onTick).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(1000); });
  expect(onTick).toHaveBeenCalledTimes(2);
});
