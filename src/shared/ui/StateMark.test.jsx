import React from 'react';
import { render, screen } from '@testing-library/react';
import StateMark from './StateMark';

test.each([
  ['live', 'In progress'],
  ['final', 'Final'],
  ['scheduled', 'Yet to play'],
])('a %s view is a labelled image named "%s"', (kind, label) => {
  render(<StateMark view={{ kind, label }} />);
  expect(screen.getByRole('img', { name: label })).toHaveAttribute('data-testid', `state-${kind}`);
});

test('the live state paints the danger dot, the others an icon', () => {
  const { rerender } = render(<StateMark view={{ kind: 'live', label: 'In progress' }} />);
  expect(screen.getByTestId('live-dot')).toHaveAttribute('data-tone', 'danger');
  rerender(<StateMark view={{ kind: 'final', label: 'Final' }} />);
  expect(screen.queryByTestId('live-dot')).toBeNull();
  expect(screen.getByTestId('state-final')).not.toBeEmptyDOMElement();
});

test('an unknown state renders nothing', () => {
  const { container } = render(<StateMark view={null} />);
  expect(container).toBeEmptyDOMElement();
});
