import React from 'react';
import { render, screen } from '@testing-library/react';
import { Badge } from './index';

test('renders its label text', () => {
  render(<Badge>Draft Complete</Badge>);
  expect(screen.getByText('Draft Complete')).toBeInTheDocument();
});

test('defaults to the neutral variant', () => {
  const { container } = render(<Badge>12 Teams</Badge>);
  const badge = container.querySelector('[data-variant]');
  expect(badge).toHaveAttribute('data-variant', 'neutral');
  expect(badge).toHaveTextContent('12 Teams');
});

test('exposes the live variant', () => {
  const { container } = render(<Badge variant="live">Week 1 · Regular Season</Badge>);
  const badge = container.querySelector('[data-variant]');
  expect(badge).toHaveAttribute('data-variant', 'live');
  expect(badge).toHaveTextContent('Week 1 · Regular Season');
});

test('exposes the "You" pill variant', () => {
  const { container } = render(<Badge variant="you">You</Badge>);
  const badge = container.querySelector('[data-variant]');
  expect(badge).toHaveAttribute('data-variant', 'you');
  expect(badge).toHaveTextContent('You');
});
