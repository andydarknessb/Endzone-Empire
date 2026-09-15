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

// Third risk review (round 3 nit): the Decision card's prev/next handler
// opts a region INTO keeping its own arrow keys by this explicit mark,
// never by inferring it from computed CSS (which the surrounding Drawer's
// own Paper can satisfy too, incidentally - see PlayerDecisionCard.jsx's
// isTypingTarget).
test('carries the explicit arrow-scroll-region mark the Decision card looks for', () => {
  render(<WeeklyPointsBars weeks={weeks()} currentWeek={5} />);
  expect(screen.getByTestId('weekly-points-bars')).toHaveAttribute('data-arrow-scroll-region', 'true');
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
  expect(screen.getByTestId('weekly-bar-14')).toHaveAttribute('data-season-end', 'true');
  expect(screen.getByTestId('weekly-bar-5')).not.toHaveAttribute('data-season-end');
});

test('the strip never shrinks inside a column flexbox (it is a scroll container, so its minimum is otherwise 0)', () => {
  // The Decision card's sheet is a column flexbox capped at 88vh; without
  // `flex-shrink: 0` the strip collapsed to its padding and only the week
  // numbers showed. jsdom lays nothing out, so the rule is read off the
  // emotion stylesheet; the layout itself is measured in
  // tests/e2e/player-decision-card.spec.ts. Red-tell: drop `flexShrink: 0`.
  render(<WeeklyPointsBars weeks={weeks()} currentWeek={5} />);
  const strip = screen.getByTestId('weekly-points-bars');
  const cls = Array.from(strip.classList).find((c) => c.startsWith('css-'));
  let text = '';
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (rule.selectorText === `.${cls}`) text += `${rule.style.cssText};`;
    });
  });
  expect(text).toMatch(/overflow-x:\s*auto/);
  expect(text).toMatch(/flex-shrink:\s*0/);
});

// Desktop Players table (2026-09-15 report): the strip's 14px columns, 6px
// gaps, 32px padding and a week number under every bar made the Weeks column
// 440px wide, which pushed the table past its container and cut the Action
// column off the right edge with only a scrollbar at the foot of the table to
// reach it. `dense` is the table row's answer: no week labels (the title and
// accessible name still state the week in full), tighter columns, and the
// current-week marker as a dot rather than the "Current" pill.
test('dense drops the visible week numbers and pill but keeps every title, the accessible name and aria-current', () => {
  render(<WeeklyPointsBars weeks={weeks()} currentWeek={5} dense />);
  expect(screen.getAllByRole('listitem')).toHaveLength(18);
  expect(screen.queryByText('Current')).not.toBeInTheDocument();
  expect(screen.queryByText('12')).not.toBeInTheDocument();
  const current = screen.getByTestId('weekly-bar-5');
  expect(current).toHaveAttribute('aria-current', 'true');
  expect(within(current).getByTestId('weekly-bar-5-current')).toBeInTheDocument();
  expect(screen.getByTestId('weekly-bar-12')).toHaveAttribute('title', 'Week 12 vs KC: 15.1 projected');
  expect(screen.getByTestId('weekly-points-bars')).toHaveAttribute('data-dense', 'true');
});
