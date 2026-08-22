import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import TecmoCutscene from './TecmoCutscene';
import { getNameColors } from '../../lib/nflTeamColors';

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
  const { container } = render(<TecmoCutscene play={play} onDone={jest.fn()} />);

  // Beat 1: runner on the field, no BOOM frame yet.
  expect(container.querySelector('.tecmo-runner')).toBeInTheDocument();
  expect(screen.queryByText('BOOM!')).not.toBeInTheDocument();
  expect(screen.queryByText('P. Mahomes')).not.toBeInTheDocument();

  // Hard cut at 2.2s.
  act(() => { jest.advanceTimersByTime(2200); });
  expect(screen.getByText('BOOM!')).toBeInTheDocument();
  expect(screen.getByText('P. Mahomes')).toBeInTheDocument();
  expect(screen.getByText('+6')).toBeInTheDocument();
  expect(container.querySelector('.tecmo-ref')).toBeInTheDocument();
  expect(container.querySelector('.tecmo-goalpost')).toBeInTheDocument();
  expect(container.querySelector('.tecmo-runner')).not.toBeInTheDocument();
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
  const { container } = render(<TecmoCutscene play={play} onDone={onDone} />);

  // Static path: the referee frame is up immediately, no animated runner.
  expect(container.querySelector('.tecmo-overlay--static')).toBeInTheDocument();
  expect(container.querySelector('.tecmo-refscene--static')).toBeInTheDocument();
  expect(container.querySelector('.tecmo-ref')).toBeInTheDocument();
  expect(container.querySelector('.tecmo-runner')).not.toBeInTheDocument();
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
