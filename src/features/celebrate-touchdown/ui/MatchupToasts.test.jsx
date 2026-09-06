import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MatchupToasts, TOAST_MS } from '../index';

const opponentToast = {
  id: 1, playerId: 9, name: 'D. Adams', type: 'receiving', isTouchdown: true, pointsDelta: 6.4, side: 'opponent', tone: 'negative',
};
const summaryToast = {
  id: 2, kind: 'summary', tone: 'positive', side: 'own', count: 2, pointsDelta: 12, message: '2 more TDs: +12',
};

test('renders nothing without toasts', () => {
  const { container } = render(<MatchupToasts toasts={[]} onDismiss={jest.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

test('each toast is a status with the play line or its own message, toned by side', () => {
  render(<MatchupToasts toasts={[opponentToast, summaryToast]} onDismiss={jest.fn()} />);
  const statuses = screen.getAllByRole('status');
  expect(statuses).toHaveLength(2);
  expect(statuses[0]).toHaveTextContent('D. Adams · receiving TD (+6.4)');
  expect(statuses[0]).toHaveAttribute('data-tone', 'negative');
  expect(statuses[1]).toHaveTextContent('2 more TDs: +12');
  expect(statuses[1]).toHaveAttribute('data-tone', 'positive');
});

// Points print to one decimal always (#903 review): a whole-number delta reads
// "+6.0", never "+6". Red-tell: rounding to a tenth without fixing the decimal
// (`Math.round(n * 10) / 10`) prints "+6" and turns this red.
test('a whole-number points delta still prints one decimal', () => {
  render(<MatchupToasts toasts={[{ ...opponentToast, pointsDelta: 6 }]} onDismiss={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('D. Adams · receiving TD (+6.0)');
});

test('a toast dismisses on tap and on its own after TOAST_MS', () => {
  jest.useFakeTimers();
  try {
    const onDismiss = jest.fn();
    render(<MatchupToasts toasts={[opponentToast, summaryToast]} onDismiss={onDismiss} />);

    fireEvent.click(screen.getAllByRole('status')[0]);
    expect(onDismiss).toHaveBeenCalledWith(1);

    act(() => { jest.advanceTimersByTime(TOAST_MS); });
    expect(onDismiss).toHaveBeenCalledWith(2);
  } finally {
    jest.useRealTimers();
  }
});
