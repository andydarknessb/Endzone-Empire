import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import TecmoCutscene from './TecmoCutscene';

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
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test('renders the touchdown, player name, and points', () => {
  setReducedMotion(false);
  render(<TecmoCutscene play={play} onDone={jest.fn()} />);
  expect(screen.getByText('TOUCHDOWN')).toBeInTheDocument();
  expect(screen.getByText('P. Mahomes')).toBeInTheDocument();
  expect(screen.getByText('+6')).toBeInTheDocument();
});

test('reduced motion shows the static card and auto-dismisses at 1.8s', () => {
  setReducedMotion(true);
  const onDone = jest.fn();
  const { container } = render(<TecmoCutscene play={play} onDone={onDone} />);

  // Static card path: no animated field/runner is rendered.
  expect(container.querySelector('.tecmo-overlay--static')).toBeInTheDocument();
  expect(container.querySelector('.tecmo-runner')).not.toBeInTheDocument();

  expect(onDone).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(1800); });
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('full cutscene auto-dismisses at ~4.2s', () => {
  setReducedMotion(false);
  const onDone = jest.fn();
  render(<TecmoCutscene play={play} onDone={onDone} />);
  act(() => { jest.advanceTimersByTime(4199); });
  expect(onDone).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(2); });
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('tapping the overlay dismisses early', () => {
  setReducedMotion(false);
  const onDone = jest.fn();
  render(<TecmoCutscene play={play} onDone={onDone} />);
  fireEvent.click(screen.getByRole('alertdialog'));
  expect(onDone).toHaveBeenCalledTimes(1);
});
