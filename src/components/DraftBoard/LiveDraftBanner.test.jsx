import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import LiveDraftBanner from './LiveDraftBanner';
import { OVERDUE_AFTER_MS } from '../../lib/onTheClock';

const activeLeague = { draft_status: 'active' };
const bulldogs = { teamId: 2, teamName: 'Bulldogs' };
const running = (deadlineAt) => ({ team: bulldogs, state: 'running', deadlineAt });

// committedPickCount is the turn identity the status region's announce effect
// keys on (#819): the region mounts empty and fills from an effect after mount,
// so the count is what makes the turn text land. This helper supplies one by
// default (a real active draft always has a pick count); tests that exercise the
// mount-empty gate override it to undefined, and the turn-change tests advance it.
const renderBanner = (props = {}) => render(<LiveDraftBanner committedPickCount={1} {...props} />);

afterEach(() => {
  jest.useRealTimers();
});

describe('LiveDraftBanner - on-the-clock announcement (#445 AC3)', () => {
  it('renders nothing outside an active draft', () => {
    const { container } = renderBanner({
      league: { draft_status: 'pending' },
      onTheClock: { team: { teamName: 'Anvils' }, state: 'idle', deadlineAt: null },
      isMyTurn: false,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('announces who is on the clock through a polite status region', () => {
    renderBanner({ league: activeLeague, onTheClock: running(Date.now() + 30000), isMyTurn: false });
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Bulldogs is on the clock');
  });

  it('announces the viewer\'s own turn', () => {
    renderBanner({
      league: activeLeague,
      onTheClock: { team: { teamId: 11, teamName: 'Anvils' }, state: 'running', deadlineAt: Date.now() + 30000 },
      isMyTurn: true,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Your pick!');
  });

  it('mounts the status region empty and fills the turn text from an effect after mount (#819 AC1)', () => {
    // A region inserted into the DOM already holding its text is generally not
    // announced (ReadinessAnnouncer.jsx docblock), so an inline turn string
    // leaves the FIRST turn unspoken. The region must mount empty and receive
    // its text from an effect keyed on the pick identity.
    //
    // Red-tell: rendering the turn text inline in the region again (the pre-#819
    // shape) makes it present on the very first commit, before any pick identity
    // keys the effect, so the empty assertion below goes red.
    //
    // The empty render is isMyTurn; the filled render names a team. The two
    // derived strings differ, so this test isolates the empty-then-filled
    // behaviour from the turn-identity keying: swapping the effect's dependency
    // to the text (the AC7 red-tell) leaves THIS test green, because the text
    // still changes between the two renders.
    const { rerender } = renderBanner({
      league: activeLeague,
      onTheClock: running(Date.now() + 30000),
      isMyTurn: true,
      committedPickCount: undefined,
    });
    // No pick identity yet: the region is present (a node assistive tech can
    // observe) but empty. textContent, not toHaveTextContent(''), because an
    // empty-string substring match passes against any content.
    expect(screen.getByRole('status').textContent).toBe('');

    // A pick identity arrives: the effect lands the turn text after mount.
    rerender(
      <LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() + 30000)} isMyTurn={false} committedPickCount={1} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Bulldogs is on the clock');
  });

  it('re-announces a snake-turnaround turn whose text is byte-identical to the previous pick (#819 AC7)', () => {
    // Snake turnaround: the same team is on the clock for two consecutive picks,
    // so the derived string is byte-identical. React bails on an Object.is-equal
    // state, so without the repeat-safe update the second turn's text node is
    // untouched and a screen reader stays silent. The pick identity
    // (committedPickCount) advances, so the effect refires and useAnnouncement's
    // zero-width space flips the node value.
    const { rerender } = render(
      <LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() + 30000)} isMyTurn={false} committedPickCount={8} />
    );
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Bulldogs is on the clock');
    const afterFirst = region.textContent;

    // The next pick: the same team is on the clock again (a snake turnaround), a
    // new committed-pick count.
    rerender(
      <LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() + 30000)} isMyTurn={false} committedPickCount={9} />
    );
    expect(region).toHaveTextContent('Bulldogs is on the clock');
    // The raw node value changed by exactly a zero-width space (invisible,
    // unspoken), so assistive tech re-announces. Red-tell: keying the effect on
    // the turn text instead of committedPickCount makes this equal afterFirst
    // (silent).
    expect(region.textContent).not.toBe(afterFirst);
    expect(region.textContent).toBe('Bulldogs is on the clock' + String.fromCharCode(0x200b));
  });

  it('advances the announcement on a live pick even though league.current_pick does not (#819)', () => {
    // The regression the risk review caught: the live reducer advances the pick
    // count and onTheClock on every draft:picked but leaves league.current_pick
    // frozen (it moves only on a draft:state snapshot). So the turn identity MUST
    // be the committed-pick count, not current_pick. Here league is byte-identical
    // across the two renders (current_pick would be unchanged), only the count and
    // the team advance - exactly the live-pick shape. Red-tell: keying the effect
    // on league.current_pick (or on a value read off `league`) leaves the region
    // stuck on "Bulldogs is on the clock" and this goes red.
    const frozenLeague = { draft_status: 'active', current_pick: 4 };
    const { rerender } = render(
      <LiveDraftBanner league={frozenLeague} onTheClock={running(Date.now() + 30000)} isMyTurn={false} committedPickCount={4} />
    );
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Bulldogs is on the clock');

    // A live pick lands: same league object, the next team on the clock, the
    // count advanced by one.
    const anvils = { team: { teamId: 3, teamName: 'Anvils' }, state: 'running', deadlineAt: Date.now() + 30000 };
    rerender(
      <LiveDraftBanner league={frozenLeague} onTheClock={anvils} isMyTurn={false} committedPickCount={5} />
    );
    expect(region).toHaveTextContent('Anvils is on the clock');
  });

  it('does not re-fire the region on a rerender that leaves the pick identity unchanged (#819)', () => {
    // Proof the effect keys on committedPickCount and nothing else: a rerender
    // that moves the deadline (a per-render prop) but keeps the count must leave
    // the region's text node untouched, so a clock tick is not an announcement.
    const { rerender } = render(
      <LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() + 30000)} isMyTurn={false} committedPickCount={8} />
    );
    const region = screen.getByRole('status');
    const after = region.textContent;
    rerender(
      <LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() + 25000)} isMyTurn={false} committedPickCount={8} />
    );
    expect(region.textContent).toBe(after);
  });

  it('keeps the per-second countdown OUT of the live region, so ticks are not announced', () => {
    // The whole point of AC3: the Team-on-the-clock text changes once per pick
    // and is announced; the seconds change every second and must not be. The
    // clock is a sibling of the status region, never inside it.
    jest.useFakeTimers();
    renderBanner({ league: activeLeague, onTheClock: running(Date.now() + 9000), isMyTurn: false });
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
    renderBanner({ league: activeLeague, onTheClock: running(Date.now() + 90000), isMyTurn: false });
    expect(screen.getByTestId('draft-clock')).toHaveTextContent('1:30');
  });

  it('running past the deadline: 0:00, never negative, no new copy', () => {
    renderBanner({ league: activeLeague, onTheClock: running(Date.now() - 4000), isMyTurn: false });
    expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:00');
  });

  it('paused: the team line stays and the timer slot reads Draft paused', () => {
    renderBanner({
      league: { ...activeLeague, draft_paused: true },
      onTheClock: { team: bulldogs, state: 'paused', deadlineAt: null },
      isMyTurn: false,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Bulldogs is on the clock');
    expect(screen.getByText('Draft paused')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-clock')).not.toBeInTheDocument();
  });

  it('untimed: the team line and no timer', () => {
    renderBanner({
      league: activeLeague,
      onTheClock: { team: bulldogs, state: 'untimed', deadlineAt: null },
      isMyTurn: false,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Bulldogs is on the clock');
    expect(screen.getByText('No pick clock')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-clock')).not.toBeInTheDocument();
  });

  it('idle: Waiting and no timer', () => {
    renderBanner({
      league: activeLeague,
      onTheClock: { team: null, state: 'idle', deadlineAt: null },
      isMyTurn: false,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Waiting');
    expect(screen.queryByTestId('draft-clock')).not.toBeInTheDocument();
  });

  it('the clock ticks on its own, from the deadline, without any new props', () => {
    jest.useFakeTimers();
    renderBanner({ league: activeLeague, onTheClock: running(Date.now() + 30000), isMyTurn: false });
    expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:30');
    act(() => { jest.advanceTimersByTime(3000); });
    expect(screen.getByTestId('draft-clock')).toHaveTextContent('0:27');
  });
});

describe('LiveDraftBanner - Overdue announced once in the live region (#769 AC3)', () => {
  it('appends the Overdue copy to the polite region exactly once at the crossing, and not before', () => {
    jest.useFakeTimers();
    const now = Date.now();
    renderBanner({ league: activeLeague, onTheClock: running(now + 1000), isMyTurn: false });
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
    renderBanner({ league: activeLeague, onTheClock: running(Date.now() - 60000), isMyTurn: false });
    act(() => { jest.advanceTimersByTime(0); });
    expect(within(screen.getByRole('status')).getAllByText('Waiting on the server')).toHaveLength(1);
  });

  it('resets on a new deadline so the next turn does not inherit the copy', () => {
    jest.useFakeTimers();
    const now = Date.now();
    const { rerender } = render(
      <LiveDraftBanner league={activeLeague} onTheClock={running(now + 1000)} isMyTurn={false} committedPickCount={1} />
    );
    act(() => { jest.advanceTimersByTime(1000 + OVERDUE_AFTER_MS + 1000); });
    expect(screen.getByRole('status')).toHaveTextContent('Waiting on the server');

    // A new pick arrives (a fresh deadline and the next committed pick): the
    // one-shot flag clears, so the fresh clock does not start already announcing
    // the previous turn's stall.
    rerender(
      <LiveDraftBanner league={activeLeague} onTheClock={running(Date.now() + 90000)} isMyTurn={false} committedPickCount={2} />
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('Waiting on the server');
  });
});
