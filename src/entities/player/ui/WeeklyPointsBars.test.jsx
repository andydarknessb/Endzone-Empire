import React from 'react';
import { render, screen, within } from '@testing-library/react';
import WeeklyPointsBars from './WeeklyPointsBars';

function weeks(overrides = {}) {
  const base = [];
  for (let week = 1; week <= 18; week++) {
    if (week === 8) {
      base.push({ week, opponent: null, kind: 'bye' });
    } else if (week === 3) {
      base.push({ week, opponent: 'KC', kind: 'unavailable', reason: 'out' });
    } else if (week <= 4) {
      base.push({ week, opponent: 'KC', kind: 'actual', points: 18.4 });
    } else {
      base.push({ week, opponent: 'KC', kind: 'projected', points: 15.1 });
    }
  }
  return Object.assign(base, overrides);
}

test('renders nothing when weeks is null or empty', () => {
  const { container: empty } = render(<WeeklyPointsBars weeks={null} />);
  expect(empty).toBeEmptyDOMElement();
  const { container: emptyArray } = render(<WeeklyPointsBars weeks={[]} />);
  expect(emptyArray).toBeEmptyDOMElement();
});

test('renders exactly 18 cells, one per week', () => {
  render(<WeeklyPointsBars weeks={weeks()} currentWeek={5} />);
  expect(screen.getByRole('list', { name: /weekly points/i })).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(18);
});

test('the bye week cell carries a dashed, unfilled column and states "bye" in its title', () => {
  render(<WeeklyPointsBars weeks={weeks()} currentWeek={5} />);
  const bye = screen.getByTestId('weekly-bar-8');
  expect(bye).toHaveAttribute('title', expect.stringContaining('bye'));
  expect(within(bye).getByTestId('weekly-bar-8-bye')).toBeInTheDocument();
  expect(within(bye).queryByTestId('weekly-bar-8-fill')).not.toBeInTheDocument();
});

test('an unavailable week shows its reason instead of a number', () => {
  render(<WeeklyPointsBars weeks={weeks()} currentWeek={5} />);
  const unavailable = screen.getByTestId('weekly-bar-3');
  expect(within(unavailable).getByTestId('weekly-bar-3-reason')).toHaveTextContent('out');
  expect(within(unavailable).queryByTestId('weekly-bar-3-fill')).not.toBeInTheDocument();
});

test('the current week carries the accessible current marker', () => {
  render(<WeeklyPointsBars weeks={weeks()} currentWeek={5} />);
  const current = screen.getByTestId('weekly-bar-5');
  expect(current).toHaveAttribute('aria-current', 'true');
  expect(within(current).getByTestId('weekly-bar-5-current')).toHaveTextContent('Current');
  // No other week carries the marker.
  const other = screen.getByTestId('weekly-bar-4');
  expect(other).not.toHaveAttribute('aria-current');
  expect(within(other).queryByTestId('weekly-bar-4-current')).not.toBeInTheDocument();
});

test('actual and projected weeks fill by points and carry a per-bar title', () => {
  render(<WeeklyPointsBars weeks={weeks()} currentWeek={5} />);
  const actual = screen.getByTestId('weekly-bar-2');
  expect(actual).toHaveAttribute('title', expect.stringContaining('18.4'));
  expect(within(actual).getByTestId('weekly-bar-2-fill')).toBeInTheDocument();

  const projected = screen.getByTestId('weekly-bar-10');
  expect(projected).toHaveAttribute('title', expect.stringContaining('projected'));
  expect(within(projected).getByTestId('weekly-bar-10-fill')).toBeInTheDocument();
});

test('the season-end week carries a divider marker distinct from the current-week marker', () => {
  render(<WeeklyPointsBars weeks={weeks()} currentWeek={5} seasonEnd={14} />);
  expect(screen.getByTestId('weekly-bar-14')).toHaveStyle({ borderRight: '2px dashed var(--border-strong)' });
  expect(screen.getByTestId('weekly-bar-5')).toHaveStyle({ borderRight: 'none' });
});
