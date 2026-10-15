import React from 'react';
import { render, screen } from '@testing-library/react';
import DecisionStrip from './DecisionStrip';

test('renders nothing when every field is null or absent', () => {
  const { container } = render(<DecisionStrip decision={null} usage={null} />);
  expect(container).toBeEmptyDOMElement();
});

test('a null Upgrade renders no Upgrade tile and no empty label', () => {
  render(
    <DecisionStrip
      decision={{ projWeek: { week: 4, points: 18.2 }, ros: { points: 140, throughWeek: 17 }, upgrade: null }}
      usage={null}
    />
  );
  expect(screen.getByTestId('decision-strip-proj-week')).toHaveTextContent('18.2');
  expect(screen.getByTestId('decision-strip-ros')).toHaveTextContent('140.0');
  expect(screen.queryByTestId('decision-strip-upgrade')).not.toBeInTheDocument();
  expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
});

test('an Unavailable week shows its reason in the Week N tile, not a number (#1765)', () => {
  render(
    <DecisionStrip
      decision={{ projWeek: { week: 4, points: 0, reason: 'out' }, ros: { points: 140 }, upgrade: null }}
      usage={null}
    />
  );
  const tile = screen.getByTestId('decision-strip-proj-week');
  expect(tile).toHaveTextContent('out');
  expect(tile).not.toHaveTextContent('0.0');
});

test('the Week N tile labels the reason code through the shared map (#1765)', () => {
  render(
    <DecisionStrip
      decision={{ projWeek: { week: 4, points: 0, reason: 'no_team' }, ros: null, upgrade: null }}
      usage={null}
    />
  );
  expect(screen.getByTestId('decision-strip-proj-week')).toHaveTextContent('no team');
});

test('a positive Upgrade renders as a pill naming its slot', () => {
  render(
    <DecisionStrip
      decision={{ projWeek: { week: 4, points: 18.2 }, ros: { points: 140 }, upgrade: { points: 4.1, slot: 'FLEX' } }}
      usage={null}
    />
  );
  const pill = screen.getByTestId('decision-strip-upgrade-pill');
  expect(pill).toHaveTextContent('+4.1');
  expect(screen.getByTestId('decision-strip-upgrade')).toHaveTextContent('at FLEX');
});

test('an Upgrade read in a later week names it in the pill; an equal or absent week names none (#2166)', () => {
  const strip = (upgrade) => (
    <DecisionStrip decision={{ projWeek: { week: 4, points: 18.2 }, ros: { points: 140 }, upgrade }} usage={null} />
  );
  const { rerender } = render(strip({ points: 4.1, slot: 'FLEX', week: 5 }));
  expect(screen.getByTestId('decision-strip-upgrade-pill')).toHaveTextContent('+4.1 Wk 5');

  rerender(strip({ points: 4.1, slot: 'FLEX', week: 4 }));
  expect(screen.getByTestId('decision-strip-upgrade-pill')).not.toHaveTextContent('Wk');

  rerender(strip({ points: 4.1, slot: 'FLEX' }));
  expect(screen.getByTestId('decision-strip-upgrade-pill')).not.toHaveTextContent('Wk');
});

test('an Upgrade of 0 renders no Upgrade tile (#1910)', () => {
  render(
    <DecisionStrip
      decision={{ projWeek: { week: 4, points: 18.2 }, ros: { points: 140 }, upgrade: { points: 0, overPlayer: null, slot: 'RB' } }}
      usage={null}
    />
  );
  expect(screen.queryByTestId('decision-strip-upgrade')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-strip-upgrade-pill')).not.toBeInTheDocument();
});

test('Usage hides when seasonAverage is absent, and shows the season average FPTS otherwise', () => {
  const { rerender } = render(<DecisionStrip decision={null} usage={{ weeks: [], seasonAverage: null }} />);
  expect(screen.queryByTestId('decision-strip-usage')).not.toBeInTheDocument();

  rerender(<DecisionStrip decision={null} usage={{ weeks: [], seasonAverage: { fantasyPoints: 12.4 } }} />);
  expect(screen.getByTestId('decision-strip-usage')).toHaveTextContent('12.4');
});

test('Ownership shows percent owned with its trend, and hides on null', () => {
  const { rerender } = render(<DecisionStrip ownership={{ percentOwned: 87.5, change: 2.3 }} />);
  const tile = screen.getByTestId('decision-strip-ownership');
  expect(tile).toHaveTextContent('87.5%');
  expect(tile).toHaveTextContent('+2.3');

  rerender(<DecisionStrip ownership={{ percentOwned: 40, change: null }} />);
  expect(screen.getByTestId('decision-strip-ownership')).toHaveTextContent('40.0%');
  expect(screen.getByTestId('decision-strip-ownership')).not.toHaveTextContent(/null|unavailable/i);

  rerender(<DecisionStrip ownership={null} />);
  expect(screen.queryByTestId('decision-strip-ownership')).not.toBeInTheDocument();
  rerender(<DecisionStrip ownership={{ percentOwned: null, change: 1 }} />);
  expect(screen.queryByTestId('decision-strip-ownership')).not.toBeInTheDocument();
});

test('Depth chart shows position group and rank, and hides on null', () => {
  const { container, rerender } = render(<DecisionStrip depth={{ teamCode: 'KC', positionGroup: 'WR', rank: 2 }} />);
  expect(screen.getByTestId('decision-strip-depth')).toHaveTextContent('WR2');

  rerender(<DecisionStrip depth={null} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<DecisionStrip depth={{ positionGroup: 'WR', rank: null }} />);
  expect(screen.queryByTestId('decision-strip-depth')).not.toBeInTheDocument();
  expect(screen.queryByText(/null|unavailable/i)).not.toBeInTheDocument();
});

test('Ownership reads percent and trend through finite(): blank and non-numeric are unknown, zero is known', () => {
  const { rerender } = render(<DecisionStrip ownership={{ percentOwned: '', change: 1 }} />);
  expect(screen.queryByTestId('decision-strip-ownership')).not.toBeInTheDocument();

  rerender(<DecisionStrip ownership={{ percentOwned: 'abc', change: 1 }} />);
  expect(screen.queryByTestId('decision-strip-ownership')).not.toBeInTheDocument();

  rerender(<DecisionStrip ownership={{ percentOwned: 40, change: '' }} />);
  expect(screen.getByTestId('decision-strip-ownership').textContent).toBe('Ownership40.0%');

  rerender(<DecisionStrip ownership={{ percentOwned: 40, change: 'abc' }} />);
  expect(screen.getByTestId('decision-strip-ownership').textContent).toBe('Ownership40.0%');

  rerender(<DecisionStrip ownership={{ percentOwned: 0, change: 0 }} />);
  expect(screen.getByTestId('decision-strip-ownership')).toHaveTextContent('0.0%');
  expect(screen.getByTestId('decision-strip-ownership')).toHaveTextContent('+0.0 7d');
});

test('NFL roster shows "Practice squad" or "Reserve" from the card, and hides for Active/null (#1766)', () => {
  const { container, rerender } = render(<DecisionStrip rosterStatus="Practice squad" />);
  expect(screen.getByTestId('decision-strip-roster-status')).toHaveTextContent('Practice squad');

  rerender(<DecisionStrip rosterStatus="Reserve" />);
  expect(screen.getByTestId('decision-strip-roster-status')).toHaveTextContent('Reserve');

  rerender(<DecisionStrip rosterStatus={null} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<DecisionStrip rosterStatus="" />);
  expect(container).toBeEmptyDOMElement();
});

// #1777: a Position-baseline projection is the position's average, not
// evidence, so the Week N tile reads "no history" like every other surface.
test('the Week N tile reads "no history", not the number, for a Position-baseline player (#1777)', () => {
  render(
    <DecisionStrip
      decision={{ projWeek: { week: 4, points: 9.4 }, ros: { points: 140 }, upgrade: null }}
      usage={null}
      noHistory
    />
  );
  const tile = screen.getByTestId('decision-strip-proj-week');
  expect(tile).toHaveTextContent('no history');
  expect(tile).not.toHaveTextContent('9.4');
  // Rest of season is not part of this change.
  expect(screen.getByTestId('decision-strip-ros')).toHaveTextContent('140.0');
});

test('an Unavailable reason still wins over "no history" in the Week N tile (#1777)', () => {
  render(
    <DecisionStrip
      decision={{ projWeek: { week: 4, points: 0, reason: 'out' }, ros: null, upgrade: null }}
      usage={null}
      noHistory
    />
  );
  const tile = screen.getByTestId('decision-strip-proj-week');
  expect(tile).toHaveTextContent('out');
  expect(tile).not.toHaveTextContent('no history');
});
