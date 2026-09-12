import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfidenceMenu from './ConfidenceMenu';

test('the trigger reads "Confidence --" before a number is picked', () => {
  render(<ConfidenceMenu value={null} max={4} />);
  expect(screen.getByRole('combobox')).toHaveTextContent('Confidence --');
});

test('the trigger reads "Confidence N" once a number is picked', () => {
  render(<ConfidenceMenu value={3} max={4} />);
  expect(screen.getByRole('combobox')).toHaveTextContent('Confidence 3');
});

test('opens a menu of 1..max and reports a pick', async () => {
  const user = userEvent.setup();
  const onChange = jest.fn();
  render(<ConfidenceMenu value={null} max={4} onChange={onChange} />);
  await user.click(screen.getByRole('combobox'));
  const listbox = screen.getByRole('listbox');
  expect(within(listbox).getByText('1')).toBeInTheDocument();
  expect(within(listbox).getByText('4')).toBeInTheDocument();
  expect(within(listbox).queryByText('5')).not.toBeInTheDocument();
  await user.click(within(listbox).getByText('2'));
  expect(onChange).toHaveBeenCalledWith(2);
});

test('a number already used by another game is disabled, except this menu\'s own value', async () => {
  const user = userEvent.setup();
  render(<ConfidenceMenu value={2} max={4} disabledValues={[2, 3]} />);
  await user.click(screen.getByRole('combobox'));
  const listbox = screen.getByRole('listbox');
  expect(within(listbox).getByRole('option', { name: '3' })).toHaveAttribute('aria-disabled', 'true');
  expect(within(listbox).getByRole('option', { name: '2' })).not.toHaveAttribute('aria-disabled', 'true');
});

test('never says "rank"', () => {
  render(<ConfidenceMenu value={3} max={4} />);
  expect(screen.getByRole('combobox')).not.toHaveTextContent(/rank/i);
});

test('locked disables the whole control', () => {
  render(<ConfidenceMenu value={3} max={4} disabled />);
  expect(screen.getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
});

test('a flagged conflict paints the bad state without disabling the control', () => {
  render(<ConfidenceMenu value={3} max={4} bad />);
  expect(screen.getByTestId('confidence-menu')).toHaveAttribute('data-bad', 'true');
  expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-disabled');
});
