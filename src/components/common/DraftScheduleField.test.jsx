import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftScheduleField from './DraftScheduleField';

function Harness({ initialWallTime = '', initialTimeZone = '', initialAcknowledged = false, disabled = false, minWallTime, error } = {}) {
  const [wallTime, setWallTime] = React.useState(initialWallTime);
  const [timeZone, setTimeZone] = React.useState(initialTimeZone);
  const [acknowledged, setAcknowledged] = React.useState(initialAcknowledged);
  return (
    <DraftScheduleField
      wallTime={wallTime}
      onWallTimeChange={setWallTime}
      timeZone={timeZone}
      onTimeZoneChange={setTimeZone}
      acknowledged={acknowledged}
      onAcknowledgedChange={setAcknowledged}
      disabled={disabled}
      minWallTime={minWallTime}
      error={error}
    />
  );
}

test('no time zone selector or acknowledgement checkbox until a draft date is entered', () => {
  render(<Harness />);
  expect(screen.getByLabelText('Draft date')).toBeInTheDocument();
  expect(screen.queryByLabelText('Draft time zone')).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByText('No draft scheduled')).toBeInTheDocument();
});

test('entering a draft date reveals the time zone picker and the acknowledgement checkbox, unchecked', () => {
  render(<Harness />);

  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '2026-09-04T13:00' } });

  expect(screen.getByLabelText('Draft time zone')).toBeInTheDocument();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

test('picking a time zone converts the wall time to the correct UTC instant, independent of the browser zone', async () => {
  const user = userEvent.setup();
  render(<Harness initialWallTime="2026-09-04T13:00" />);

  await user.click(screen.getByLabelText('Draft time zone'));
  await user.click(await screen.findByRole('option', { name: 'America/New_York' }));

  expect(screen.getByText('2026-09-04 17:00:00 UTC')).toBeInTheDocument();
});

test('editing the date after picking a time zone clears the acknowledgement checkbox', () => {
  render(<Harness initialWallTime="2026-09-04T13:00" initialTimeZone="America/New_York" initialAcknowledged />);

  expect(screen.getByRole('checkbox')).toBeChecked();
  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '2026-09-05T13:00' } });

  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

test('changing the time zone after acknowledging clears the acknowledgement checkbox', async () => {
  const user = userEvent.setup();
  render(<Harness initialWallTime="2026-09-04T13:00" initialTimeZone="America/New_York" initialAcknowledged />);

  expect(screen.getByRole('checkbox')).toBeChecked();
  await user.click(screen.getByLabelText('Draft time zone'));
  await user.click(await screen.findByRole('option', { name: 'Asia/Tokyo' }));

  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

test('clearing the draft date hides the time zone picker and checkbox again', () => {
  render(<Harness initialWallTime="2026-09-04T13:00" initialTimeZone="America/New_York" />);

  expect(screen.getByLabelText('Draft time zone')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '' } });

  expect(screen.queryByLabelText('Draft time zone')).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

test('disabled disables every field, including the checkbox once revealed', () => {
  render(<Harness initialWallTime="2026-09-04T13:00" initialTimeZone="America/New_York" disabled />);
  expect(screen.getByLabelText('Draft date')).toBeDisabled();
  expect(screen.getByLabelText('Draft time zone')).toBeDisabled();
  expect(screen.getByRole('checkbox')).toBeDisabled();
});

test('shows a validation error on the date field when passed', () => {
  render(<Harness initialWallTime="2020-01-01T00:00" error="Choose a draft date and time in the future." />);
  expect(screen.getByText('Choose a draft date and time in the future.')).toBeInTheDocument();
});
