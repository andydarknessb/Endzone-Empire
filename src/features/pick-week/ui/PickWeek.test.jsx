import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickWeek } from '../index';

const WEEKS = [1, 2, 3];

test('renders one Wk N option per week and checks the selected week', () => {
  render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} />);
  expect(screen.getByRole('radiogroup', { name: 'Week' })).toBeInTheDocument();
  expect(screen.getAllByRole('radio')).toHaveLength(3);
  expect(screen.getByRole('radio', { name: 'Wk 2' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Wk 1' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'Wk 3' })).not.toBeChecked();
});

test('clicking an option calls onChange with that week', async () => {
  const onChange = jest.fn();
  render(<PickWeek weeks={WEEKS} value={2} onChange={onChange} />);
  await userEvent.click(screen.getByRole('radio', { name: 'Wk 3' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(3);
});

// Red-tell: wiring next to the previous week turns this case red and no other.
test('previous and next step to the neighbouring week', async () => {
  const onChange = jest.fn();
  render(<PickWeek weeks={WEEKS} value={2} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
  expect(onChange).toHaveBeenLastCalledWith(3);
  await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
  expect(onChange).toHaveBeenLastCalledWith(1);
  expect(onChange).toHaveBeenCalledTimes(2);
});

test('previous is disabled on the first week and next on the last', () => {
  const { rerender } = render(<PickWeek weeks={WEEKS} value={1} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled();

  rerender(<PickWeek weeks={WEEKS} value={3} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
});

test('All weeks calls onChange with "All"', async () => {
  const onChange = jest.fn();
  render(<PickWeek weeks={WEEKS} value={2} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'All weeks' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('All');
});

test('with All selected no week is checked, both steppers are disabled and All weeks reads pressed', () => {
  render(<PickWeek weeks={WEEKS} value="All" onChange={() => {}} />);
  screen.getAllByRole('radio').forEach((radio) => expect(radio).not.toBeChecked());
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'All weeks', pressed: true })).toBeInTheDocument();
});

test('a selected week reads as not pressed on All weeks', () => {
  render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'All weeks', pressed: false })).toBeInTheDocument();
});

test('a week the list does not carry disables both steppers', () => {
  render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
});

test('an empty week list renders no options and disables both steppers', () => {
  render(<PickWeek weeks={[]} value="All" onChange={() => {}} />);
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'All weeks' })).toBeEnabled();
});

test('the chevrons are decorative so each stepper is named by its label alone', () => {
  render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} />);
  expect(screen.getByTestId('pick-week-chevron-left')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByTestId('pick-week-chevron-right')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByRole('button', { name: 'Previous week' })).toHaveAccessibleName('Previous week');
  expect(screen.getByRole('button', { name: 'Next week' })).toHaveAccessibleName('Next week');
});

test('fill keeps every control and its name in place', () => {
  render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} fill />);
  expect(screen.getByRole('group', { name: 'Week picker' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Wk 2' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'All weeks' })).toBeInTheDocument();
});
