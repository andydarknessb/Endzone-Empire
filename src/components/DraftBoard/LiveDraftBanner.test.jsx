import React from 'react';
import { render, screen } from '@testing-library/react';
import LiveDraftBanner from './LiveDraftBanner';

const activeLeague = { draft_status: 'active' };

describe('LiveDraftBanner - on-the-clock announcement (#445 AC3)', () => {
  it('renders nothing outside an active draft', () => {
    const { container } = render(
      <LiveDraftBanner league={{ draft_status: 'pending' }} onTheClock={{ teamName: 'Anvils' }} secondsLeft={30} isMyTurn={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('announces who is on the clock through a polite status region', () => {
    render(<LiveDraftBanner league={activeLeague} onTheClock={{ teamId: 2, teamName: 'Bulldogs' }} secondsLeft={30} isMyTurn={false} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Bulldogs is on the clock');
  });

  it('announces the viewer\'s own turn', () => {
    render(<LiveDraftBanner league={activeLeague} onTheClock={{ teamId: 11, teamName: 'Anvils' }} secondsLeft={30} isMyTurn />);
    expect(screen.getByRole('status')).toHaveTextContent('Your pick!');
  });

  it('keeps the per-second countdown OUT of the live region, so ticks are not announced', () => {
    // The whole point of AC3: the Team-on-the-clock text changes once per pick
    // and is announced; the seconds change every second and must not be. The
    // clock is a sibling of the status region, never inside it.
    render(<LiveDraftBanner league={activeLeague} onTheClock={{ teamId: 2, teamName: 'Bulldogs' }} secondsLeft={9} isMyTurn={false} />);
    const region = screen.getByRole('status');
    const clock = screen.getByTestId('draft-clock');
    expect(clock).toHaveTextContent('9s');
    // The clock is not a descendant of the polite region, so a second ticking by
    // does not mutate the region's text.
    expect(region).not.toContainElement(clock);
    expect(region).not.toHaveTextContent('9s');
  });
});
