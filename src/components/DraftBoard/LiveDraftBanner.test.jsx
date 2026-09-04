import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import LiveDraftBanner from './LiveDraftBanner';
import { OVERDUE_AFTER_MS } from '../../lib/onTheClock';

const activeLeague = { draft_status: 'active' };
const bulldogs = { teamId: 2, teamName: 'Bulldogs' };
const running = (deadlineAt) => ({ team: bulldogs, state: 'running', deadlineAt });

afterEach(() => {
  jest.useRealTimers();
});

describe('LiveDraftBanner - on-the-clock announcement (#445 AC3)', () => {
  it('renders nothing outside an active draft', () => {
    const { container } = render(
      <LiveDraftBanner league={{ draft_status: 'pending' }} onTheClock={{ team: { teamName: 'Anvils' }, state: 'idle', deadlineAt: null }} isMyTurn={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('announces who is on the clock through a polite status region', () => {
    render(<LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() + 30000)} isMyTurn={false} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Bulldogs is on the clock');
  });

  it('announces the viewer\'s own turn', () => {
    render(<LiveDraftBanner league={activeLeague} onTheClock={{ team: { teamId: 11, teamName: 'Anvils' }, state: 'running', deadlineAt: Date.now() + 30000 }} isMyTurn />);
    expect(screen.getByRole('status')).toHaveTextContent('Your pick!');
  });

  it('keeps the per-second countdown OUT of the live region, so ticks are not announced', () => {
    // The whole point of AC3: the Team-on-the-clock text changes once per pick
    // and is announced; the seconds change every second and must not be. The
    // clock is a sibling of the status region, never inside it.
    jest.useFakeTimers();
    render(<LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() + 9000)} isMyTurn={false} />);
    const region = screen.getByRole('status');
    const clock = screen.getByTestId('draft-clock');
    expect(clock).toHaveTextContent('0:09');
    // The clock is not a descendant of the polite region, so a second ticking by
    // does not mutate the region's text.
    expect(region).not.toContainElement(clock);
    expect(region).not.toHaveTextContent('0:09');
  });
});

describe('LiveDraftBanner - timer slot per On-the-clock state (#754)', () => {
  it('running: the m:ss pick clock', () => {
    jest.useFakeTimers();
    render(<LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() + 90000)} isMyTurn={false} />);
    expect(screen.getByTestId('draft-clock')).toHaveTextContent('1:30');
  });

  it('running past the deadline: 0:00, never negative, no new copy', () => {
    render(<LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() - 4000)} isMyTurn={false} />);
    expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:00');
  });

  it('paused: the team line stays and the timer slot reads Draft paused', () => {
    render(<LiveDraftBanner league={{ ...activeLeague, draft_paused: true }} onTheClock={{ team: bulldogs, state: 'paused', deadlineAt: null }} isMyTurn={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Bulldogs is on the clock');
    expect(screen.getByText('Draft paused')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-clock')).not.toBeInTheDocument();
  });

  it('untimed: the team line and no timer', () => {
    render(<LiveDraftBanner league={activeLeague} onTheClock={{ team: bulldogs, state: 'untimed', deadlineAt: null }} isMyTurn={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Bulldogs is on the clock');
    expect(screen.getByText('No pick clock')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-clock')).not.toBeInTheDocument();
  });

  it('idle: Waiting and no timer', () => {
    render(<LiveDraftBanner league={activeLeague} onTheClock={{ team: null, state: 'idle', deadlineAt: null }} isMyTurn={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting');
    expect(screen.queryByTestId('draft-clock')).not.toBeInTheDocument();
  });

  it('the clock ticks on its own, from the deadline, without any new props', () => {
    jest.useFakeTimers();
    render(<LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() + 30000)} isMyTurn={false} />);
    expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:30');
    act(() => { jest.advanceTimersByTime(3000); });
    expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:27');
  });
});

describe('LiveDraftBanner - Overdue announced once in the live region (#769 AC3)', () => {
  it('appends the Overdue copy to the polite region exactly once at the crossing, and not before', () => {
    jest.useFakeTimers();
    const now = Date.now();
    render(<LiveDraftBanner league={activeLeague} onTheClock={running(now + 1000)} isMyTurn={false} />);
    const region = screen.getByRole('status');

    // Expired but not yet Overdue: the region names the team, and says nothing
    // about the server. (The leaf's own copy, if any, is a sibling of the
    // region, never inside it - that separation is #445 AC3.)
    act(() => { jest.advanceTimersByTime(1000); });
    expect(region).not.toHaveTextContent('Waiting on the server');

    // Cross the tolerance and keep ticking well past it: the copy lands in the
    // region, and it is there exactly once - one announcement per turn, not one
    // per second.
    act(() => { jest.advanceTimersByTime(OVERDUE_AFTER_MS + 5000); });
    const announced = within(region).getAllByText('Waiting on the server');
    expect(announced).toHaveLength(1);
    // Announcement only (#844): the region's copy is visually hidden, so the
    // one VISIBLE "Waiting on the server" in the room is the leaf's own line
    // under the digits. Red tell: render the region copy as ordinary text and
    // the position/width assertions below go red.
    expect(announced[0]).toHaveStyle({ position: 'absolute', width: '1px', height: '1px' });
    expect(screen.getByTestId('draft-clock-overdue')).toHaveTextContent('Waiting on the server');
  });

  it('announces when the clock is ALREADY overdue on arrival (connecting into a stalled draft)', () => {
    // The exact case the feature exists for: a viewer opens (or re-renders) into
    // a draft the server has actually stalled on, deadline already well past the
    // tolerance. The leaf's mount-time onExpire fires in the same commit as the
    // banner's own mount, so the announcement must survive that commit, not be
    // clobbered by a reset. A sighted user sees the leaf caption regardless; a
    // screen-reader user must still get the polite announcement.
    jest.useFakeTimers();
    render(
      <LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() - 60000)} isMyTurn={false} />
    );
    act(() => { jest.advanceTimersByTime(0); });
    expect(within(screen.getByRole('status')).getAllByText('Waiting on the server')).toHaveLength(1);
  });

  it('resets on a new deadline so the next turn does not inherit the copy', () => {
    jest.useFakeTimers();
    const now = Date.now();
    const { rerender } = render(
      <LiveDraftBanner league={activeLeague} onTheClock={running(now + 1000)} isMyTurn={false} />
    );
    act(() => { jest.advanceTimersByTime(1000 + OVERDUE_AFTER_MS + 1000); });
    expect(screen.getByRole('status')).toHaveTextContent('Waiting on the server');

    // A new pick arrives (a fresh deadline): the one-shot flag clears, so the
    // fresh clock does not start already announcing the previous turn's stall.
    rerender(
      <LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() + 90000)} isMyTurn={false} />
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('Waiting on the server');
  });
});
