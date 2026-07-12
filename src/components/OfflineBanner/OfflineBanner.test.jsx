import React from 'react';
import { render, screen, act } from '@testing-library/react';
import OfflineBanner from './OfflineBanner';

test('renders nothing when the browser is online', () => {
  render(<OfflineBanner />);
  expect(screen.queryByText(/you're offline/i)).not.toBeInTheDocument();
});

test('shows the offline alert when the browser fires an "offline" event', () => {
  render(<OfflineBanner />);

  act(() => {
    window.dispatchEvent(new Event('offline'));
  });

  expect(screen.getByText(/you're offline — showing cached data/i)).toBeInTheDocument();
});

test('hides the alert again when the browser fires an "online" event', () => {
  render(<OfflineBanner />);

  act(() => {
    window.dispatchEvent(new Event('offline'));
  });
  expect(screen.getByText(/you're offline/i)).toBeInTheDocument();

  act(() => {
    window.dispatchEvent(new Event('online'));
  });

  expect(screen.queryByText(/you're offline/i)).not.toBeInTheDocument();
});
