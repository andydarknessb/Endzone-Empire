import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftStatusBar from './DraftStatusBar';

// Issue #123 acceptance criterion 6, the copy criterion. DraftStatusBar is
// provider-free (plain MUI), so a bare render is enough.
const baseProps = {
  league: { draft_status: 'pending' },
  onTheClock: null,
  secondsLeft: null,
  reconnecting: false,
  soundOn: false,
  toggleSound: jest.fn(),
  isCommissioner: false,
  onRandomizeOrder: jest.fn(),
  onTogglePause: jest.fn(),
  onClockAlertOpen: false,
  onCloseOnClockAlert: jest.fn(),
};

test('a pending draft reads Draft not started, and the raw enum is nowhere on screen', () => {
  render(<DraftStatusBar {...baseProps} />);

  expect(within(screen.getByRole('group', { name: 'Draft status' })).getByText('Draft not started'))
    .toBeInTheDocument();
  expect(screen.queryByText('pending')).not.toBeInTheDocument();
});

test('an active draft with nobody on the clock still speaks product language', () => {
  render(<DraftStatusBar {...baseProps} league={{ draft_status: 'active' }} />);

  expect(screen.getByText('Draft in progress')).toBeInTheDocument();
  expect(screen.queryByText('active')).not.toBeInTheDocument();
});

test('a completed draft reads Draft complete', () => {
  render(<DraftStatusBar {...baseProps} league={{ draft_status: 'complete' }} />);

  expect(screen.getByText('Draft complete')).toBeInTheDocument();
  expect(screen.queryByText('complete')).not.toBeInTheDocument();
});

test('On the clock still replaces the status chip while a Team is on it', () => {
  render(<DraftStatusBar
    {...baseProps}
    league={{ draft_status: 'active' }}
    onTheClock={{ teamId: 1, teamName: 'Ridge Runners' }}
  />);

  expect(screen.getByText('On the clock: Ridge Runners')).toBeInTheDocument();
  expect(screen.queryByText('Draft in progress')).not.toBeInTheDocument();
});

test('mute is a control, not part of the status readout', () => {
  render(<DraftStatusBar {...baseProps} league={{ draft_status: 'active' }} soundOn />);

  const status = screen.getByRole('group', { name: 'Draft status' });
  const controls = screen.getByRole('group', { name: 'Draft controls' });
  const mute = screen.getByRole('button', { name: 'On-the-clock sound' });

  expect(controls).toContainElement(mute);
  expect(status).not.toContainElement(mute);
});

// Issue #512: a stable name with aria-pressed alone carrying the state,
// matching every other toggle in this codebase (Board, Players, Standard
// format, Superflex format, Full PPR, Adds, All, team-code chips). The
// Tooltip and accessible name must be byte-identical in both states, and
// aria-pressed must be the only thing that changes (WCAG 2.5.3, Label in
// Name). #508/#510 gave this control a name that flipped between "Mute" and
// "Unmute"; that combination read as contradictory to assistive tech,
// because a changing name plus aria-pressed exposes the same state twice by
// two mechanisms that disagreed.
test('the sound toggle keeps a stable Tooltip and accessible name in both states', async () => {
  // getByRole({ name }) and queryByLabelText both resolve off aria-label
  // alone - MUI's Tooltip spreads the child's own props (including our
  // aria-label) after the props it would otherwise derive from `title`, so
  // an aria-label-only assertion can never see the Tooltip text. Hovering
  // to open the tooltip and reading its rendered content is the only way to
  // actually pin the visible half of the WCAG 2.5.3 pair.
  const user = userEvent.setup();
  const { rerender } = render(<DraftStatusBar {...baseProps} soundOn={false} />);

  const offButton = screen.getByRole('button', { name: 'On-the-clock sound' });
  await user.hover(offButton);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('On-the-clock sound');
  await user.unhover(offButton);

  rerender(<DraftStatusBar {...baseProps} soundOn />);
  const onButton = screen.getByRole('button', { name: 'On-the-clock sound' });
  await user.hover(onButton);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('On-the-clock sound');
});

test('activating the toggle changes aria-pressed without changing its accessible name', async () => {
  const user = userEvent.setup();
  function Wrapper() {
    const [soundOn, setSoundOn] = React.useState(false);
    return (
      <DraftStatusBar
        {...baseProps}
        soundOn={soundOn}
        toggleSound={() => setSoundOn((prev) => !prev)}
      />
    );
  }
  render(<Wrapper />);

  // Same query, same name, both before and after - if a regression ever
  // reintroduces a flipping name, this getByRole call itself starts failing
  // to find the button by its (now-stale) name.
  const toggle = () => screen.getByRole('button', { name: 'On-the-clock sound' });

  expect(toggle()).toHaveAttribute('aria-pressed', 'false');

  await user.click(toggle());
  expect(toggle()).toHaveAttribute('aria-pressed', 'true');
  expect(toggle()).toHaveAccessibleName('On-the-clock sound');

  await user.click(toggle());
  expect(toggle()).toHaveAttribute('aria-pressed', 'false');
  expect(toggle()).toHaveAccessibleName('On-the-clock sound');
});

test("the commissioner's draft actions sit with mute in the controls group", () => {
  render(<DraftStatusBar {...baseProps} isCommissioner />);

  const controls = screen.getByRole('group', { name: 'Draft controls' });
  expect(controls).toContainElement(screen.getByRole('button', { name: 'Randomize Draft order' }));
  expect(screen.getByRole('group', { name: 'Draft status' }))
    .not.toContainElement(screen.getByRole('button', { name: 'Randomize Draft order' }));
});
