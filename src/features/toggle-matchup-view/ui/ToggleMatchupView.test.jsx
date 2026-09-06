import React from 'react';
import { render, renderHook, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ToggleMatchupView, useMatchupView, matchupViewStorageKey, viewerKeyFor, ANON_VIEWER,
} from '../index';

beforeEach(() => {
  window.localStorage.clear();
});

// The segment sizing is an sx rule, which jsdom neither lays out nor computes
// (a `min-height` from a descendant rule never reaches getComputedStyle here),
// but emotion inserts every rule into `document.styleSheets` under the group's
// generated class name. This gathers the declarations of every rule whose
// selector starts with that class (the group's own and its `[role="radio"]`
// descendant rule), keyed by the selector's tail.
const rulesUnder = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  const found = {};
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (!rule.selectorText || !rule.selectorText.startsWith(`.${cls}`)) return;
      const tail = rule.selectorText.slice(`.${cls}`.length).trim();
      found[tail] = `${found[tail] || ''}${rule.style.cssText};`;
    });
  });
  return found;
};

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

// Red-tell (#903 review): dropping the `fill` rule (or lowering it to the
// kit's 30px / the week picker's 38px) turns the first half red; applying it
// regardless of `fill` turns the second half red.
test('below sm (fill) every segment grows to the 44px touch target; the desktop control keeps the kit size', () => {
  const { rerender } = render(<ToggleMatchupView value="standard" onChange={() => {}} fill />);
  const filled = rulesUnder(screen.getByRole('radiogroup', { name: 'Matchup view' }));
  expect(filled['[role="radio"]']).toMatch(/min-height:\s*44px/);

  rerender(<ToggleMatchupView value="standard" onChange={() => {}} />);
  const desktop = rulesUnder(screen.getByRole('radiogroup', { name: 'Matchup view' }));
  expect(desktop['[role="radio"]'] || '').not.toMatch(/min-height/);
});

test('forwards a ref to the group element, so the page can focus the checked option', () => {
  const ref = React.createRef();
  render(<ToggleMatchupView ref={ref} value="standard" onChange={() => {}} />);
  expect(ref.current).toBe(screen.getByRole('radiogroup', { name: 'Matchup view' }));
});

// --- the memory ----------------------------------------------------------------

// Red-tell (#903 review): keying the entry by anything but the user id (a
// Team id, a null-while-unknown key) turns the key assertions red: the user
// key names the user alone, and an unknown user reads `anon`, never null.
test('the key is the signed-in user, else the per-browser anon key', () => {
  expect(viewerKeyFor(7)).toBe('user:7');
  expect(viewerKeyFor('7')).toBe('user:7');
  expect(viewerKeyFor(null)).toBe(ANON_VIEWER);
  expect(viewerKeyFor(undefined)).toBe(ANON_VIEWER);
  expect(viewerKeyFor('')).toBe(ANON_VIEWER);
  expect(matchupViewStorageKey(7)).toBe('endzone.matchupView.user:7');
  expect(matchupViewStorageKey(null)).toBe('endzone.matchupView.anon');
  expect(matchupViewStorageKey(7)).not.toMatch(/team/);
});

test('a pick is remembered under the user key and read back for that user alone', () => {
  {
    const { result, unmount } = renderHook(() => useMatchupView(1));
    expect(result.current[0]).toBe('standard');
    act(() => { result.current[1]('scoreboard'); });
    expect(result.current[0]).toBe('scoreboard');
    expect(window.localStorage.getItem(matchupViewStorageKey(1))).toBe('scoreboard');
    unmount();
  }
  {
    // Another signed-in manager on the same browser starts on the default.
    const { result, unmount } = renderHook(() => useMatchupView(2));
    expect(result.current[0]).toBe('standard');
    unmount();
  }
  {
    // The first manager's choice survives a remount.
    const { result } = renderHook(() => useMatchupView(1));
    expect(result.current[0]).toBe('scoreboard');
  }
});

// The cold-load case (#903 review): the key is known at first paint and is
// read on the first render, so the remembered view never flips afterwards.
// Red-tell: a hook that waits for a later-arriving key (or reads under a key
// the page derives from its own data, such as the Team id) renders the
// default on the first render and turns this red.
test('a remembered view is read on the first render under the user key and holds across rerenders', () => {
  window.localStorage.setItem(matchupViewStorageKey(7), 'scoreboard');
  const { result, rerender } = renderHook(({ userId }) => useMatchupView(userId), { initialProps: { userId: 7 } });
  expect(result.current[0]).toBe('scoreboard');
  rerender({ userId: 7 });
  expect(result.current[0]).toBe('scoreboard');
});

test('with no signed-in user the pick is remembered under the anon key', () => {
  const { result } = renderHook(() => useMatchupView(null));
  expect(result.current[0]).toBe('standard');
  act(() => { result.current[1]('scoreboard'); });
  expect(result.current[0]).toBe('scoreboard');
  expect(window.localStorage.getItem(matchupViewStorageKey(null))).toBe('scoreboard');
  expect(window.localStorage.getItem('endzone.matchupView.anon')).toBe('scoreboard');
});

test('a value that is not a view is ignored, in storage and from setView', () => {
  window.localStorage.setItem(matchupViewStorageKey(1), 'sideways');
  const { result } = renderHook(() => useMatchupView(1));
  expect(result.current[0]).toBe('standard');
  act(() => { result.current[1]('upside-down'); });
  expect(result.current[0]).toBe('standard');
});

test('a storage that throws leaves the page on the default and still lets the view change', () => {
  const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  try {
    const { result } = renderHook(() => useMatchupView(1));
    expect(result.current[0]).toBe('standard');
    act(() => { result.current[1]('scoreboard'); });
    expect(result.current[0]).toBe('scoreboard');
  } finally {
    getItem.mockRestore();
    setItem.mockRestore();
  }
});
