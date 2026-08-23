import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TimerPanel from './TimerPanel';

function renderPanel(onSave = jest.fn()) {
  render(
    <TimerPanel
      league={{ draft_status: 'pending', pick_time_seconds: 60, autodraft_delay_seconds: 10 }}
      frozen={false}
      onSave={onSave}
      onSetClock={jest.fn()}
      saving={false}
      onDirtyChange={jest.fn()}
    />
  );
  return { onSave };
}

test.each([
  ['0', 'Autodraft delay must be between 1 and 60.'],
  ['1.5', 'Autodraft delay must be a whole number between 1 and 60.'],
  ['61', 'Autodraft delay must be between 1 and 60.'],
])('blocks invalid autodraft delay %s', (value, message) => {
  const { onSave } = renderPanel();
  fireEvent.change(screen.getByLabelText('Autodraft delay (seconds)'), { target: { value } });

  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save timer' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save timer' }));
  expect(onSave).not.toHaveBeenCalled();
});

test.each(['1', '60'])('accepts autodraft delay boundary %s', (value) => {
  const { onSave } = renderPanel();
  fireEvent.change(screen.getByLabelText('Autodraft delay (seconds)'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save timer' }));

  expect(onSave).toHaveBeenCalledWith(
    { pickTimeSeconds: 60, autodraftDelaySeconds: Number(value) },
    'Timer saved'
  );
});
