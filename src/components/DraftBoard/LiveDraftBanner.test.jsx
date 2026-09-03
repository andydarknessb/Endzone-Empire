import React from 'react';
import { act, render, screen } from '@testing-library/react';
import LiveDraftBanner from './LiveDraftBanner';

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
