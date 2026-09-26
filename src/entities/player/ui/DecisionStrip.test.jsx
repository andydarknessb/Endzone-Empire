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
