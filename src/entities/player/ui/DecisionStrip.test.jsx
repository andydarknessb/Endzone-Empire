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
