import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from './index';

const WEEKS = [
  { value: 1, label: 'Wk 1' },
  { value: 2, label: 'Wk 2' },
  { value: 3, label: 'Wk 3' },
];

test('is a radio group whose checked option matches value', () => {
  render(<SegmentedControl aria-label="Week" options={WEEKS} value={2} onChange={() => {}} />);
  expect(screen.getByRole('radiogroup', { name: 'Week' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Wk 2' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Wk 1' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'Wk 3' })).not.toBeChecked();
});

test('clicking an option calls onChange with that option', async () => {
  const onChange = jest.fn();
  render(<SegmentedControl aria-label="Week" options={WEEKS} value={2} onChange={onChange} />);
  await userEvent.click(screen.getByRole('radio', { name: 'Wk 3' }));
  expect(onChange).toHaveBeenCalledWith(3);
});

test('arrow keys move the selection and wrap', async () => {
  const onChange = jest.fn();
  render(<SegmentedControl aria-label="Week" options={WEEKS} value={3} onChange={onChange} />);
  screen.getByRole('radio', { name: 'Wk 3' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(onChange).toHaveBeenLastCalledWith(1);
  await userEvent.keyboard('{ArrowLeft}');
  expect(onChange).toHaveBeenLastCalledWith(2);
});

test('renders an option icon as decoration beside its label', () => {
  render(
    <SegmentedControl
      aria-label="Matchup view"
      options={[{ value: 'standard', label: 'Standard', icon: <svg data-testid="icon" /> }]}
      value="standard"
      onChange={() => {}}
    />
  );
  expect(screen.getByTestId('icon')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();
});

// Red-tell (#903): dropping the forwardRef (a plain function component) leaves
// `ref.current` null and turns this red.
test('forwards a ref to the radio group element, so a composer can reach the checked option', () => {
  const ref = React.createRef();
  render(<SegmentedControl ref={ref} aria-label="Week" options={WEEKS} value={2} onChange={() => {}} />);
  expect(ref.current).toBe(screen.getByRole('radiogroup', { name: 'Week' }));
  expect(within(ref.current).getByRole('radio', { checked: true })).toBe(screen.getByRole('radio', { name: 'Wk 2' }));
});
