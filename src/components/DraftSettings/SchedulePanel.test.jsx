import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SchedulePanel from './SchedulePanel';

function localInputValue(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function renderPanel({ draftDate = null, draftTimezone = null, draftType = 'snake', teamCount = 2, minTeams = 2, onSave = jest.fn(), onStart = jest.fn().mockResolvedValue({ success: true }) } = {}) {
  render(
    <SchedulePanel
      league={{ draft_date: draftDate, draft_timezone: draftTimezone, draft_type: draftType, min_teams: minTeams }}
      teamCount={teamCount}
      frozen={false}
      onSave={onSave}
      onStart={onStart}
      saving={false}
      onDirtyChange={jest.fn()}
    />
  );
  return { onSave, onStart };
}

// Selects a time zone from the Autocomplete and ticks the acknowledgement
// checkbox that #116 AC3 requires before a scheduled draft can be saved.
async function scheduleAndAcknowledge(user, zoneName) {
  await user.click(screen.getByLabelText('Draft time zone'));
  await user.click(await screen.findByRole('option', { name: zoneName }));
  await user.click(screen.getByRole('checkbox'));
}

test('shows an inline error and blocks saving a past draft date', () => {
  const { onSave } = renderPanel();
  const input = screen.getByLabelText('Draft date');

  expect(input).toHaveAttribute('min');
  fireEvent.change(input, { target: { value: localInputValue(new Date(Date.now() - 60000)) } });

  expect(screen.getByText('Choose a draft date and time in the future.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});

test('the Save button stays disabled until the time zone is acknowledged (#116 AC3)', () => {
  const { onSave } = renderPanel();
  const inputValue = localInputValue(new Date(Date.now() + 5 * 60000));
  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: inputValue } });

  expect(screen.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  expect(onSave).not.toHaveBeenCalled();
});

test('a UTC draft date converts to the correct instant once the zone is picked and acknowledged (#116 AC4)', async () => {
  const user = userEvent.setup();
  const { onSave } = renderPanel();

  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '2026-09-04T13:00' } });
  await scheduleAndAcknowledge(user, 'America/New_York');
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

  expect(onSave).toHaveBeenCalledWith(
    { draftDate: '2026-09-04T17:00:00.000Z', draftTimezone: 'America/New_York' },
    'Draft schedule saved'
  );
});

test('clearing an existing schedule sends both draftDate and draftTimezone as null, unconditionally (#116 AC5)', () => {
  const { onSave } = renderPanel({
    draftDate: '2026-09-04T17:00:00.000Z',
    draftTimezone: 'America/New_York',
  });

  // Displayed back in its stored zone, not the test runner's own.
  expect(screen.getByLabelText('Draft date')).toHaveValue('2026-09-04T13:00');
  // Clearing needs no acknowledgement: nothing is left to confirm.
  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

  expect(onSave).toHaveBeenCalledWith({ draftDate: null, draftTimezone: null }, 'Draft schedule saved');
});

test('re-editing an already-scheduled draft still requires a fresh acknowledgement', () => {
  const { onSave } = renderPanel({
    draftDate: '2026-09-04T17:00:00.000Z',
    draftTimezone: 'America/New_York',
  });

  // Loading an existing schedule starts unacknowledged (#116 AC3): saving it
  // back unchanged still requires ticking the box.
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  expect(onSave).not.toHaveBeenCalled();
});

test('successful immediate start closes the confirmation dialog', async () => {
  const { onStart } = renderPanel({ draftDate: new Date(Date.now() - 60000).toISOString(), draftTimezone: 'UTC' });

  expect(screen.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Start Draft Now' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start now' }));

  await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Start draft now?' })).not.toBeInTheDocument());
});

test('failed immediate start keeps the dialog open and shows an inline error', async () => {
  const onStart = jest.fn().mockResolvedValue({ success: false, error: 'Every team must be ready.' });
  renderPanel({ onStart });

  fireEvent.click(screen.getByRole('button', { name: 'Start Draft Now' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start now' }));

  expect(await screen.findByText('Every team must be ready.')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Start draft now?' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start now' })).toBeEnabled();
  expect(onStart).toHaveBeenCalledTimes(1);
});

test('rapid start clicks trigger only one request', async () => {
  let resolveStart;
  const onStart = jest.fn(() => new Promise((resolve) => { resolveStart = resolve; }));
  renderPanel({ onStart });

  fireEvent.click(screen.getByRole('button', { name: 'Start Draft Now' }));
  const confirm = screen.getByRole('button', { name: 'Start now' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);

  expect(onStart).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();

  await act(async () => resolveStart({ success: true }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Start draft now?' })).not.toBeInTheDocument());
});

test('disables scheduling and immediate start for auction drafts', () => {
  renderPanel({ draftType: 'auction' });

  expect(screen.getByText(/Live salary-cap auctions are coming soon/)).toBeInTheDocument();
  expect(screen.getByLabelText('Draft date')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Start Draft Now' })).toBeDisabled();
});

test.each(['snake', 'autopick', 'offline'])('keeps scheduling and immediate start available for %s drafts', (draftType) => {
  renderPanel({ draftType });

  expect(screen.getByLabelText('Draft date')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save schedule' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Start Draft Now' })).toBeEnabled();
});

test.each([0, 1])('disables immediate start with %s teams when two are required', (teamCount) => {
  const { onStart } = renderPanel({ teamCount, minTeams: 2 });

  expect(screen.getByText(`${teamCount} of 2 required teams have joined.`)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start Draft Now' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Start Draft Now' }));
  expect(onStart).not.toHaveBeenCalled();
});
