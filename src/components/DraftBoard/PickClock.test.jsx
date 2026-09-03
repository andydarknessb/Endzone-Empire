import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import PickClock from './PickClock';
import { OVERDUE_AFTER_MS } from '../../lib/onTheClock';

// A concrete theme so the urgent/overdue colours resolve to stable values we
// can assert against, rather than depending on MUI's ambient default.
const theme = createTheme();
const ERROR = theme.palette.error.main;
const PRIMARY = theme.palette.text.primary;

function renderClock(props) {
  return render(
    <ThemeProvider theme={theme}>
      <PickClock {...props} />
    </ThemeProvider>
  );
}

afterEach(() => {
  jest.useRealTimers();
});

describe('PickClock - Expired vs Overdue (#769 AC1)', () => {
  it('at the deadline: 0:00 in the urgent colour, no Overdue copy; past the tolerance: copy appears, urgency gone', () => {
    jest.useFakeTimers();
    const now = Date.now();
    renderClock({ deadlineAt: now + 1000 });

    // Expired: the deadline has just passed. Digits pin at 0:00, still urgent
    // (the server may advance the clock at any moment), and the room is not yet
    // told to stop waiting on itself.
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    const clock = screen.getByTestId('draft-clock');
    expect(clock).toHaveTextContent('0:00');
    expect(clock).toHaveStyle({ color: ERROR });
    expect(screen.queryByTestId('draft-clock-overdue')).not.toBeInTheDocument();

    // Overdue: expired for longer than the tolerance. The pulse meant "act now"
    // and nobody in the room can, so urgency ends and the leaf says so.
    act(() => {
      jest.advanceTimersByTime(OVERDUE_AFTER_MS);
    });
    expect(clock).toHaveTextContent('0:00');
    expect(screen.getByTestId('draft-clock-overdue')).toHaveTextContent('Waiting on the server');
    expect(clock).toHaveStyle({ color: PRIMARY });
    expect(clock).not.toHaveStyle({ color: ERROR });
    expect(clock).toHaveStyle({ animation: 'none' });
  });

  it('one second short of the tolerance is still Expired, not Overdue (the boundary is real)', () => {
    // AC1 negative control: advancing to 29s past the deadline instead of 30s
    // must NOT show the copy. If OVERDUE_AFTER_MS were ignored (copy shown at
    // expiry) this assertion goes red.
    jest.useFakeTimers();
    const now = Date.now();
    renderClock({ deadlineAt: now + 1000 });

    act(() => {
      jest.advanceTimersByTime(1000 + (OVERDUE_AFTER_MS - 1000));
    });
    expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:00');
    expect(screen.queryByTestId('draft-clock-overdue')).not.toBeInTheDocument();
    expect(screen.getByTestId('draft-clock')).toHaveStyle({ color: ERROR });
  });

  it('fires onOverdue exactly once, at the crossing', () => {
    jest.useFakeTimers();
    const now = Date.now();
    const onOverdue = jest.fn();
    renderClock({ deadlineAt: now + 1000, onOverdue });

    // Before the boundary: not yet.
    act(() => {
      jest.advanceTimersByTime(1000 + (OVERDUE_AFTER_MS - 1000));
    });
    expect(onOverdue).not.toHaveBeenCalled();

    // Crossing and well beyond: exactly one call, never once per second.
    act(() => {
      jest.advanceTimersByTime(1000 + 5000);
    });
    expect(onOverdue).toHaveBeenCalledTimes(1);
  });

  it('well before the deadline it is neither urgent nor overdue', () => {
    jest.useFakeTimers();
    const now = Date.now();
    renderClock({ deadlineAt: now + 90000 });
    const clock = screen.getByTestId('draft-clock');
    expect(clock).toHaveTextContent('1:30');
    expect(clock).toHaveStyle({ color: PRIMARY });
    expect(screen.queryByTestId('draft-clock-overdue')).not.toBeInTheDocument();
  });
});

describe('PickClock - urgent edge (#787 ruling item 2)', () => {
  it('fires onUrgent once at the crossing into the urgent window, never per second', () => {
    jest.useFakeTimers();
    const now = Date.now();
    const onUrgent = jest.fn();
    // 12s out: outside the 10s urgent window, so nothing yet.
    renderClock({ deadlineAt: now + 12000, onUrgent });
    expect(onUrgent).not.toHaveBeenCalled();

    // Cross into the urgent window (~9s left): exactly one call.
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(onUrgent).toHaveBeenCalledTimes(1);

    // Several more ticks INSIDE the window: still one - the edge fired, not the
    // per-second count (its effect keys on the urgent flag, not the seconds).
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onUrgent).toHaveBeenCalledTimes(1);
  });

  it('re-arms on a new deadline so the next turn can fire again', () => {
    jest.useFakeTimers();
    const onUrgent = jest.fn();
    const view = renderClock({ deadlineAt: Date.now() + 12000, onUrgent });
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(onUrgent).toHaveBeenCalledTimes(1);

    // A fresh, further-out deadline (a new turn). The fired flag re-arms on the
    // deadline change, so a clock still 12s out has not fired again...
    view.rerender(
      <ThemeProvider theme={theme}>
        <PickClock deadlineAt={Date.now() + 12000} onUrgent={onUrgent} />
      </ThemeProvider>
    );
    expect(onUrgent).toHaveBeenCalledTimes(1);

    // ...until this turn's clock crosses too.
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(onUrgent).toHaveBeenCalledTimes(2);
  });
});
