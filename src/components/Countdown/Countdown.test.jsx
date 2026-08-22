import React from 'react';
import { render, screen } from '@testing-library/react';
import Countdown from './Countdown';

describe('Countdown', () => {
  beforeEach(() => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(new Date('2026-07-17T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders countdown text for a future date ~2 days out', () => {
    const future = new Date('2026-07-19T15:00:00Z').toISOString();
    render(<Countdown date={future} />);
    // ~2 days out with hh/mm/ss all present and zero-padded after the day unit.
    expect(screen.getByText(/\d+d \d{2}h \d{2}m \d{2}s/)).toBeInTheDocument();
  });

  test('renders nothing for a null date', () => {
    const { container } = render(<Countdown date={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing for a past date', () => {
    const past = new Date('2020-01-01T00:00:00Z').toISOString();
    const { container } = render(<Countdown date={past} />);
    expect(container).toBeEmptyDOMElement();
  });
});
