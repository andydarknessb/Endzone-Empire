import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftDayControls from './DraftDayControls';

// The active-draft commissioner toolbar (#439). It carries Pause/Resume beside
// the safe, reasoned Correct latest Pick, and keeps the destructive Reset
// separate. DraftDayControls is provider-free (plain MUI), so a bare render is
// enough.

const LEAGUE = { name: 'Sunday Ballers', current_pick: 3, draft_paused: false };
const PICKS = [
  { pick_number: 1, teamId: 5, teamName: "Bob's Team", player_id: 1, name: 'Josh Allen', is_keeper: false },
  { pick_number: 2, teamId: 6, teamName: 'Gridiron Ghosts', player_id: 2, name: 'Bijan Robinson', is_keeper: false },
  { pick_number: 3, teamId: 6, teamName: 'Gridiron Ghosts', player_id: 3, name: 'CeeDee Lamb', is_keeper: false },
];

function renderControls(overrides = {}) {
  const handlers = {
    onTogglePause: jest.fn(),
    onCorrect: jest.fn().mockResolvedValue(true),
    onReset: jest.fn().mockResolvedValue(true),
    onGetShareLink: jest.fn().mockResolvedValue('http://x'),
  };
  render(<DraftDayControls league={LEAGUE} picks={PICKS} {...handlers} {...overrides} />);
  return handlers;
}

test('the toolbar carries Pause/Resume beside Correct latest Pick, and keeps Reset separate', () => {
  renderControls();
  const toolbar = screen.getByRole('region', { name: 'Commissioner draft controls' });
  expect(within(toolbar).getByRole('button', { name: 'Pause Draft' })).toBeInTheDocument();
  expect(within(toolbar).getByRole('button', { name: 'Correct latest Pick' })).toBeInTheDocument();
  expect(within(toolbar).getByRole('button', { name: 'Reset draft' })).toBeInTheDocument();
});

test('the pause control reads Resume Draft when the draft is paused', () => {
  renderControls({ league: { ...LEAGUE, draft_paused: true } });
  expect(screen.getByRole('button', { name: 'Resume Draft' })).toBeInTheDocument();
});

test('pausing calls onTogglePause', async () => {
  const { onTogglePause } = renderControls();
  await userEvent.click(screen.getByRole('button', { name: 'Pause Draft' }));
  expect(onTogglePause).toHaveBeenCalled();
});

test('the correction dialog names the Pick, Team and player and requires a 10-200 character reason', async () => {
  const { onCorrect } = renderControls();
  await userEvent.click(screen.getByRole('button', { name: 'Correct latest Pick' }));

  const dialog = screen.getByRole('dialog');
  // Names the Pick, the Team and the player being reversed (#439 AC4).
  expect(within(dialog).getByText(/Pick 3/)).toBeInTheDocument();
  expect(within(dialog).getByText(/Gridiron Ghosts/)).toBeInTheDocument();
  expect(within(dialog).getByText(/CeeDee Lamb/)).toBeInTheDocument();

  const confirm = within(dialog).getByRole('button', { name: 'Correct pick' });
  // Empty reason: cannot submit.
  expect(confirm).toBeDisabled();

  // Too short (< 10): still cannot submit.
  const reason = within(dialog).getByRole('textbox', { name: /reason/i });
  await userEvent.type(reason, 'too short');
  expect(confirm).toBeDisabled();
  expect(onCorrect).not.toHaveBeenCalled();

  // A valid reason enables it, and submit posts the confirmed pick number + reason.
  await userEvent.clear(reason);
  await userEvent.type(reason, 'entered against the wrong team, correcting now');
  expect(confirm).toBeEnabled();
  await userEvent.click(confirm);
  expect(onCorrect).toHaveBeenCalledWith({
    pickNumber: 3,
    reason: 'entered against the wrong team, correcting now',
  });
});

test('a reason beyond 200 characters cannot be submitted', async () => {
  const { onCorrect } = renderControls();
  await userEvent.click(screen.getByRole('button', { name: 'Correct latest Pick' }));
  const dialog = screen.getByRole('dialog');
  const reason = within(dialog).getByRole('textbox', { name: /reason/i });
  await userEvent.type(reason, 'x'.repeat(201));
  expect(within(dialog).getByRole('button', { name: 'Correct pick' })).toBeDisabled();
  expect(onCorrect).not.toHaveBeenCalled();
});

test('Correct latest Pick is disabled and explained when the latest reached pick is a keeper', () => {
  renderControls({
    league: { ...LEAGUE, current_pick: 1 },
    picks: [{ pick_number: 1, teamId: 5, teamName: "Bob's Team", player_id: 1, name: 'Josh Allen', is_keeper: true }],
  });
  expect(screen.getByRole('button', { name: 'Correct latest Pick' })).toBeDisabled();
  expect(screen.getByText(/[Kk]eeper/)).toBeInTheDocument();
});

test('Reset draft still requires typing the exact league name (kept separate and destructive)', async () => {
  const { onReset } = renderControls();
  await userEvent.click(screen.getByRole('button', { name: 'Reset draft' }));
  const dialog = screen.getByRole('dialog');
  const reset = within(dialog).getByRole('button', { name: 'Reset draft' });
  expect(reset).toBeDisabled();
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'League name' }), 'Sunday Ballers');
  expect(reset).toBeEnabled();
  await userEvent.click(reset);
  expect(onReset).toHaveBeenCalled();
});
