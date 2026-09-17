import React from 'react';
import { render, screen } from '@testing-library/react';
import LastPlays from './LastPlays';

const play = (over = {}) => ({
  playerId: 1,
  name: 'P. Mahomes',
  type: 'passing',
  isTouchdown: true,
  pointsDelta: 6,
  side: 'home',
  ...over,
});

test('renders nothing with no items', () => {
  const { container } = render(<LastPlays items={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test('a play row names the scorer, the play label and the signed points', () => {
  render(<LastPlays items={[play()]} />);
  expect(screen.getByTestId('last-play')).toHaveTextContent('P. Mahomes passing TD +6.0');
});

// Regression (#1241 follow-up): a play with a negative delta (a non-touchdown
// event absorbing the server's residual) must print its own hyphen sign, not
// "+-6.0" (the old hardcoded "+" prefix ahead of an already-signed number).
test('a negative points delta prints its own sign, never "+-"', () => {
  render(<LastPlays items={[play({ pointsDelta: -6, isTouchdown: false, type: 'fumble' })]} />);
  const row = screen.getByTestId('last-play');
  expect(row).toHaveTextContent('-6.0');
  expect(row.textContent).not.toContain('+-');
});
