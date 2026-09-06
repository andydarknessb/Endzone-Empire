import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { TecmoCutscene } from '../index';
import { getNameColors } from '../../../lib/nflTeamColors';

const play = {
  playerId: 5,
  name: 'P. Mahomes',
  nflTeam: 'KC',
  opponent: 'BUF',
  type: 'passing',
  pointsDelta: 6,
};

function setReducedMotion(reduced) {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

test('beat 1 shows the runner, then cuts to the referee BOOM frame with name and points', () => {
  setReducedMotion(false);
  render(<TecmoCutscene play={play} onDone={jest.fn()} />);

  // Beat 1: runner on the field, no BOOM frame yet. The sprites are decorative
  // (aria-hidden), so they are reached by test id rather than by role.
  expect(screen.getByTestId('tecmo-runner')).toBeInTheDocument();
  expect(screen.queryByText('BOOM!')).not.toBeInTheDocument();
  expect(screen.queryByText('P. Mahomes')).not.toBeInTheDocument();

  // Hard cut at 2.2s.
  act(() => { jest.advanceTimersByTime(2200); });
  expect(screen.getByText('BOOM!')).toBeInTheDocument();
  expect(screen.getByText('P. Mahomes')).toBeInTheDocument();
  expect(screen.getByText('+6')).toBeInTheDocument();
  expect(screen.getByTestId('tecmo-referee')).toBeInTheDocument();
  expect(screen.getByTestId('tecmo-goalpost')).toBeInTheDocument();
  expect(screen.queryByTestId('tecmo-runner')).not.toBeInTheDocument();

  // The test ids are a test-only seam. The sprites stay decoration: hidden
  // from the accessibility tree, and named by nothing a screen reader reads.
  expect(screen.getByTestId('tecmo-referee')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByTestId('tecmo-goalpost')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByLabelText(/runner|referee|goal ?post/i)).not.toBeInTheDocument();
});

test("the scorer's name renders in their team colors", () => {
  setReducedMotion(false);
  render(<TecmoCutscene play={play} onDone={jest.fn()} />);
  act(() => { jest.advanceTimersByTime(2200); });

  const name = screen.getByText('P. Mahomes');
  const { text, shadow } = getNameColors('KC');
  expect(name).toHaveStyle({ color: text });
  expect(name.style.textShadow).toContain(shadow);
});

test('reduced motion shows the static BOOM frame and auto-dismisses at 1.8s', () => {
  setReducedMotion(true);
  const onDone = jest.fn();
  render(<TecmoCutscene play={play} onDone={onDone} />);

  // Static path: the referee frame is up immediately, no animated runner.
  expect(screen.getByRole('alertdialog')).toHaveClass('tecmo-overlay--static');
  expect(screen.getByTestId('tecmo-boom-frame')).toHaveClass('tecmo-refscene--static');
  expect(screen.getByTestId('tecmo-referee')).toBeInTheDocument();
  expect(screen.queryByTestId('tecmo-runner')).not.toBeInTheDocument();
  expect(screen.getByText('BOOM!')).toBeInTheDocument();
  expect(screen.getByText('P. Mahomes')).toBeInTheDocument();

  expect(onDone).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(1800); });
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('full cutscene auto-dismisses at ~6s', () => {
  setReducedMotion(false);
  const onDone = jest.fn();
  render(<TecmoCutscene play={play} onDone={onDone} />);
  act(() => { jest.advanceTimersByTime(5999); });
  expect(onDone).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(2); });
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('tapping the overlay dismisses early during either beat', () => {
  setReducedMotion(false);
  const onDone = jest.fn();
  render(<TecmoCutscene play={play} onDone={onDone} />);
  fireEvent.click(screen.getByRole('alertdialog'));
  expect(onDone).toHaveBeenCalledTimes(1);

  const second = jest.fn();
  render(<TecmoCutscene play={play} onDone={second} />);
  act(() => { jest.advanceTimersByTime(2200); });
  fireEvent.click(screen.getAllByRole('alertdialog').pop());
  expect(second).toHaveBeenCalledTimes(1);
});

test('unmounting before the cut cleans up timers without firing onDone', () => {
  setReducedMotion(false);
  const onDone = jest.fn();
  const { unmount } = render(<TecmoCutscene play={play} onDone={onDone} />);
  unmount();
  act(() => { jest.runOnlyPendingTimers(); });
  expect(onDone).not.toHaveBeenCalled();
});

// --- keyboard: the cutscene behaves like the alertdialog it says it is (#911)

/** A focusable control outside the cutscene, standing in for the page behind it. */
function outsideButton(label) {
  const el = document.createElement('button');
  el.textContent = label;
  document.body.appendChild(el);
  return el;
}

// The cutscene covers the whole viewport, so focus has to come with it and go
// back where it was afterwards; otherwise a keyboard lands on a page it cannot
// see, and on close resumes from the top of the document. Red-tell: dropping
// the mount `focus()` turns the second assertion red; dropping the restore in
// that effect's cleanup turns the last one red.
test('the cutscene takes focus when it appears and hands it back when it closes', () => {
  setReducedMotion(false);
  const trigger = outsideButton('Set lineup');
  trigger.focus();
  expect(trigger).toHaveFocus();

  const { unmount } = render(<TecmoCutscene play={play} onDone={jest.fn()} />);
  const overlay = screen.getByRole('alertdialog');
  expect(overlay).toHaveAttribute('tabindex', '-1');
  expect(overlay).toHaveFocus();

  unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});

// Escape is the keyboard's version of the tap. Red-tell: removing the Escape
// branch from the overlay's key handler turns THIS case red and no other case
// in this file - the tap, the two auto-dismiss cases and the reduced-motion
// case never send a key, and the trap case below asserts a refused Tab, which
// the Escape branch never reads.
test('Escape dismisses the cutscene', () => {
  setReducedMotion(false);
  const onDone = jest.fn();
  render(<TecmoCutscene play={play} onDone={onDone} />);
  fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
  expect(onDone).toHaveBeenCalledTimes(1);
});

// Nothing behind the overlay can take focus while the cutscene is up. Red-tell:
// removing the `focusin` pull-back leaves focus on the outside button; removing
// the Tab branch lets the keydown's default stand, so `fireEvent` returns true.
test('focus does not leave the cutscene while it is shown', () => {
  setReducedMotion(false);
  const behind = outsideButton('Bench');
  const { unmount } = render(<TecmoCutscene play={play} onDone={jest.fn()} />);
  const overlay = screen.getByRole('alertdialog');

  behind.focus();
  expect(overlay).toHaveFocus();

  // The scene holds no focusable content, so a Tab is refused outright rather
  // than handing focus to the page behind or to the browser's own chrome.
  expect(fireEvent.keyDown(overlay, { key: 'Tab' })).toBe(false);
  expect(overlay).toHaveFocus();
  expect(fireEvent.keyDown(overlay, { key: 'Tab', shiftKey: true })).toBe(false);
  expect(overlay).toHaveFocus();

  unmount();
  behind.remove();
});

// The reduced-motion card is the same dialog and gets the same keyboard: the
// static path must not be the one surface a keyboard cannot leave. It is a
// second JSX element, so it can lose the wiring on its own. Red-tell: giving
// only the animated branch the ref, `tabIndex` and `onKeyDown` turns this red
// and leaves every case above green. It asserts no Escape of its own, so the
// Escape case above stays the only one the Escape branch binds. The frames and
// the 1.8s timer this path chooses are asserted by the reduced-motion case
// higher up, and nothing here touches them.
test('the reduced-motion card takes focus, holds it, and hands it back', () => {
  setReducedMotion(true);
  const trigger = outsideButton('Set lineup');
  trigger.focus();

  const { unmount } = render(<TecmoCutscene play={play} onDone={jest.fn()} />);
  const overlay = screen.getByRole('alertdialog');
  expect(overlay).toHaveClass('tecmo-overlay--static');
  expect(overlay).toHaveAttribute('tabindex', '-1');
  expect(overlay).toHaveFocus();

  trigger.focus();
  expect(overlay).toHaveFocus();
  expect(fireEvent.keyDown(overlay, { key: 'Tab' })).toBe(false);

  unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});
