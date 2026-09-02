import React from 'react';
import { render, screen } from '@testing-library/react';
import { Badge } from './index';

test('renders its label text', () => {
  render(<Badge>Draft Complete</Badge>);
  expect(screen.getByText('Draft Complete')).toBeInTheDocument();
});

test('defaults to the neutral variant', () => {
  render(<Badge>12 Teams</Badge>);
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'neutral');
  expect(badge).toHaveTextContent('12 Teams');
});

test('exposes the live variant', () => {
  render(<Badge variant="live">Week 1 · Regular Season</Badge>);
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'live');
  expect(badge).toHaveTextContent('Week 1 · Regular Season');
});

test('exposes the "You" pill variant with its distinct type', () => {
  render(<Badge variant="you">You</Badge>);
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'you');
  expect(badge).toHaveTextContent('You');
  // The "You" pill's distinguishing type (mockup `.you`): if it silently
  // returned to the `live` look this fails.
  expect(badge.style.fontSize).toBe('10.5px');
  expect(badge.style.fontWeight).toBe('700');
  expect(badge.style.letterSpacing).toBe('0.08em');
});

test('the live variant does not carry the "You" pill type', () => {
  render(<Badge variant="live">Live</Badge>);
  expect(screen.getByTestId('badge').style.fontSize).toBe('');
});
