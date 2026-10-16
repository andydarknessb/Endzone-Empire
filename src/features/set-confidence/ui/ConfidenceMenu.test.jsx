import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfidenceMenu from './ConfidenceMenu';

const option = (name) => screen.getByRole('option', { name });

test('the empty value reads "Confidence: none", a pick reads "Confidence N"', () => {
  const { rerender } = render(<ConfidenceMenu value={null} max={4} />);
  expect(screen.getByRole('combobox')).toHaveDisplayValue('Confidence: none');
  rerender(<ConfidenceMenu value={3} max={4} />);
  expect(screen.getByRole('combobox')).toHaveDisplayValue('Confidence 3');
});

test('offers 1..max and reports a pick as a number, and none as null', async () => {
  const user = userEvent.setup();
  const onChange = jest.fn();
  render(<ConfidenceMenu value={null} max={4} onChange={onChange} />);
  expect(screen.getAllByRole('option')).toHaveLength(5);
  await user.selectOptions(screen.getByRole('combobox'), 'Confidence 2');
  expect(onChange).toHaveBeenCalledWith(2);
  await user.selectOptions(screen.getByRole('combobox'), 'Confidence: none');
  expect(onChange).toHaveBeenLastCalledWith(null);
});

test('a rank held by an open game stays choosable and names the game it swaps with', () => {
  render(<ConfidenceMenu value={2} max={4} usedBy={{ 3: { label: 'DAL @ DEN', locked: false } }} />);
  expect(option('Confidence 3 · used by DAL @ DEN')).not.toBeDisabled();
});

test('a rank held by a kicked-off game is aria-disabled and says locked', () => {
  render(<ConfidenceMenu value={2} max={4} usedBy={{ 3: { label: 'PHI @ MIN', locked: true } }} />);
  const locked = option('Confidence 3 · locked, PHI @ MIN');
  expect(locked).toBeDisabled();
  expect(locked).toHaveAttribute('aria-disabled', 'true');
});

test('a game with no rank of its own cannot take a rank another game holds', () => {
  render(<ConfidenceMenu value={null} max={4} swappable={false} usedBy={{ 3: { label: 'DAL @ DEN', locked: false } }} />);
  expect(option('Confidence 3 · used by DAL @ DEN')).toBeDisabled();
});

test('its own value is never marked used or locked', () => {
  render(<ConfidenceMenu value={3} max={4} usedBy={{ 3: { label: 'X @ Y', locked: true } }} />);
  expect(option('Confidence 3')).not.toBeDisabled();
});

test('never reads "rank" in the control itself', () => {
  render(<ConfidenceMenu value={3} max={4} />);
  expect(screen.getByRole('combobox')).not.toHaveTextContent(/rank/i);
});

test('disabled is a solid Rule edge, no opacity, and carries its hint', () => {
  render(<ConfidenceMenu value={null} max={4} disabled aria-describedby="hint" />);
  const select = screen.getByRole('combobox');
  expect(select).toBeDisabled();
  expect(select).toHaveAttribute('aria-describedby', 'hint');
  expect(select).toHaveStyle({ opacity: '1' });
  expect(getComputedStyle(select).borderStyle).toBe('solid');
});

test('a refused save paints the bad state without disabling the control', () => {
  render(<ConfidenceMenu value={3} max={4} bad />);
  expect(screen.getByTestId('confidence-menu')).toHaveAttribute('data-bad', 'true');
  expect(screen.getByRole('combobox')).not.toBeDisabled();
});
