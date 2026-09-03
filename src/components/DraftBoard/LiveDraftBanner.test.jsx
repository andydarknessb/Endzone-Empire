import React from 'react';
import { render, screen } from '@testing-library/react';
import LiveDraftBanner from './LiveDraftBanner';

const activeLeague = { draft_status: 'active' };

// The one On-the-clock value (#754): { team, state, deadlineAt }. A running
// value carries a live deadline the PickClock leaf ticks; the store holds no
// per-second field. The leaf schedules a timeout, so the running cases run
// under fake timers to keep the scheduled tick out of the next test.
const running = (team, secondsOut = 30) => ({
  team,
  state: 'running',
  deadlineAt: Date.now() + secondsOut * 1000,
});

describe('LiveDraftBanner - on-the-clock announcement (#445 AC3)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing outside an active draft', () => {
    const { container } = render(
      <LiveDraftBanner
        league={{ draft_status: 'pending' }}
        onTheClock={{ team: { teamName: 'Anvils' }, state: 'running', deadlineAt: null }}
        isMyTurn={false}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('announces who is on the clock through a polite status region', () => {
    jest.useFakeTimers();
    render(<LiveDraftBanner league={activeLeague} onTheClock={running({ teamId: 2, teamName: 'Bulldogs' })} isMyTurn={false} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Bulldogs is on the clock');
  });

  it('announces the viewer\'s own turn', () => {
    jest.useFakeTimers();
    render(<LiveDraftBanner league={activeLeague} onTheClock={running({ teamId: 11, teamName: 'Anvils' })} isMyTurn />);
    expect(screen.getByRole('status')).toHaveTextContent('Your pick!');
  });

  it('keeps the per-second countdown OUT of the live region, so ticks are not announced', () => {
    // The whole point of AC3: the Team-on-the-clock text changes once per pick
    // and is announced; the seconds change every second and must not be. The
    // clock is a sibling of the status region, never inside it.
    jest.useFakeTimers();
    render(<LiveDraftBanner league={activeLeague} onTheClock={running({ teamId: 2, teamName: 'Bulldogs' }, 9)} isMyTurn={false} />);
    const region = screen.getByRole('status');
    const clock = screen.getByTestId('draft-clock');
    // One m:ss format now (#754): the pick clock reads 0:09, not "9s".
    expect(clock).toHaveTextContent('0:09');
    // The clock is not a descendant of the polite region, so a second ticking by
    // does not mutate the region's text.
    expect(region).not.toContainElement(clock);
    expect(region).not.toHaveTextContent('0:09');
  });

  it('shows "Draft paused" in the timer slot for a paused value, with no ticking clock', () => {
    render(
      <LiveDraftBanner
        league={activeLeague}
        onTheClock={{ team: { teamId: 2, teamName: 'Bulldogs' }, state: 'paused', deadlineAt: null }}
        isMyTurn={false}
      />
    );
    expect(screen.getByText('Draft paused')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-clock')).not.toBeInTheDocument();
  });
});
