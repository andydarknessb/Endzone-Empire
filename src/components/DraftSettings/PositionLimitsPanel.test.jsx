import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PositionLimitsPanel from './PositionLimitsPanel';

function renderPanel(onSave = jest.fn()) {
  render(
    <PositionLimitsPanel
      league={{ position_caps: {}, roster_slots: [], bench_slots: 0, ir_slots: 0 }}
      frozen={false}
      onSave={onSave}
      saving={false}
      onDirtyChange={jest.fn()}
    />
  );
  return onSave;
}

test('keeps decimal input visible and never reports a successful save that discards it', () => {
  const onSave = renderPanel();
  const quarterbackLimit = screen.getByLabelText('QB');
  fireEvent.change(quarterbackLimit, { target: { value: '1.5' } });

  expect(quarterbackLimit).toHaveValue(1.5);
  expect(screen.getByText('QB must be a whole number between 0 and 10.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save position limits' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save position limits' }));
  expect(onSave).not.toHaveBeenCalled();
});

test('blocks an out-of-range position limit', () => {
  renderPanel();
  fireEvent.change(screen.getByLabelText('QB'), { target: { value: '11' } });

  expect(screen.getByText('QB must be between 0 and 10.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save position limits' })).toBeDisabled();
});

test.each(['0', '10'])('saves position limit boundary %s without dropping it', (value) => {
  const onSave = renderPanel();
  fireEvent.change(screen.getByLabelText('QB'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save position limits' }));

  expect(onSave).toHaveBeenCalledWith({ positionCaps: { QB: Number(value) } }, 'Position limits saved');
});
