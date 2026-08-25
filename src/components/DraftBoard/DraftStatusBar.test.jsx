import React from 'react';
import { render, screen, within } from '@testing-library/react';
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
  const mute = screen.getByRole('button', { name: 'Mute pick sound' });

  expect(controls).toContainElement(mute);
  expect(status).not.toContainElement(mute);
});

test("the commissioner's draft actions sit with mute in the controls group", () => {
  render(<DraftStatusBar {...baseProps} isCommissioner />);

  const controls = screen.getByRole('group', { name: 'Draft controls' });
  expect(controls).toContainElement(screen.getByRole('button', { name: 'Randomize Draft order' }));
  expect(screen.getByRole('group', { name: 'Draft status' }))
    .not.toContainElement(screen.getByRole('button', { name: 'Randomize Draft order' }));
});
