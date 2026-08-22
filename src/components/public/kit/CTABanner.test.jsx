import React from 'react';
import { render, screen } from '@testing-library/react';
import CTABanner from './CTABanner';

test('renders section-specific conversion copy from the shared context map', () => {
  const { rerender } = render(<CTABanner context="rankings" />);
  expect(screen.getByRole('heading', { name: 'Turn rankings into a championship roster' })).toBeInTheDocument();

  rerender(<CTABanner context="recaps" />);
  expect(screen.getByRole('heading', { name: 'Make every final score matter' })).toBeInTheDocument();
});
