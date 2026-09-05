import React from 'react';
import { render, renderHook, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToggleMatchupView, useMatchupView, matchupViewStorageKey } from '../index';

beforeEach(() => {
  window.localStorage.clear();
});

// --- the control -------------------------------------------------------------

test('renders a Matchup view radio group with Standard and Scoreboard, the value checked', () => {
  render(<ToggleMatchupView value="scoreboard" onChange={() => {}} />);
  expect(screen.getByRole('radiogroup', { name: 'Matchup view' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Standard' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'Scoreboard' })).toBeChecked();
});

test('clicking a view reports it through onChange', async () => {
  const onChange = jest.fn();
  render(<ToggleMatchupView value="standard" onChange={onChange} />);
  await userEvent.click(screen.getByRole('radio', { name: 'Scoreboard' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('scoreboard');
});

// --- the memory ----------------------------------------------------------------

test('a pick is remembered under the viewer key and read back for that viewer alone', () => {
  {
    const { result, unmount } = renderHook(() => useMatchupView('team:1'));
    expect(result.current[0]).toBe('standard');
    act(() => { result.current[1]('scoreboard'); });
    expect(result.current[0]).toBe('scoreboard');
    expect(window.localStorage.getItem(matchupViewStorageKey('team:1'))).toBe('scoreboard');
    unmount();
  }
  {
    // Another manager on the same browser starts on the default.
    const { result, unmount } = renderHook(() => useMatchupView('team:2'));
    expect(result.current[0]).toBe('standard');
    unmount();
  }
  {
    // The first manager's choice survives a remount.
    const { result } = renderHook(() => useMatchupView('team:1'));
    expect(result.current[0]).toBe('scoreboard');
  }
});

test('the remembered view is read once the viewer becomes known', () => {
  window.localStorage.setItem(matchupViewStorageKey('user:7'), 'scoreboard');
  const { result, rerender } = renderHook(({ key }) => useMatchupView(key), { initialProps: { key: null } });
  expect(result.current[0]).toBe('standard');
  rerender({ key: 'user:7' });
  expect(result.current[0]).toBe('scoreboard');
});

test('a value that is not a view is ignored, in storage and from setView', () => {
  window.localStorage.setItem(matchupViewStorageKey('team:1'), 'sideways');
  const { result } = renderHook(() => useMatchupView('team:1'));
  expect(result.current[0]).toBe('standard');
  act(() => { result.current[1]('upside-down'); });
  expect(result.current[0]).toBe('standard');
});

test('a storage that throws leaves the page on the default and still lets the view change', () => {
  const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  try {
    const { result } = renderHook(() => useMatchupView('team:1'));
    expect(result.current[0]).toBe('standard');
    act(() => { result.current[1]('scoreboard'); });
    expect(result.current[0]).toBe('scoreboard');
  } finally {
    getItem.mockRestore();
    setItem.mockRestore();
  }
});
