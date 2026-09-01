import React from 'react';
import { render, screen } from '@testing-library/react';
import { Skeleton } from './index';

test('is present while loading', () => {
  render(<Skeleton width={120} height={16} />);
  expect(screen.getByTestId('skeleton')).toBeInTheDocument();
});

test('accepts a custom test id so several placeholders stay distinguishable', () => {
  render(<Skeleton data-testid="myteam-skeleton" />);
  expect(screen.getByTestId('myteam-skeleton')).toBeInTheDocument();
});
