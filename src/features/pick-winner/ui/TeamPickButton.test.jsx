/* eslint-disable testing-library/no-node-access, testing-library/no-container -- the cursor frame, the pixel marks and the sticky strip are classes, svgs and styles with no role */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamPickButton from './TeamPickButton';

const base = { team: 'KC', opponent: 'LV', kickoff: 'Sun 3:25 PM' };

test('the name starts with the visible abbreviation and reads "{Team} over {Opponent}, {day time}"', () => {
  render(<TeamPickButton {...base} />);
  expect(
    screen.getByRole('button', { name: 'KC, Kansas City Chiefs over Las Vegas Raiders, Sun 3:25 PM' })
  ).toBeInTheDocument();
});

test('the name adds the lock words, live facts and the save state, in that order', () => {
  render(<TeamPickButton {...base} locksIn="locks in 45 min" score={17} possession won picked state="saved" />);
  expect(
    screen.getByRole('button', {
      name: 'KC, Kansas City Chiefs over Las Vegas Raiders, Sun 3:25 PM, locks in 45 min, 17 points, has the ball, winner, saved',
    })
  ).toBeInTheDocument();
});

test('a pick in flight says saving, a failed one says not saved, retry; neither is pressed', () => {
  const { rerender } = render(<TeamPickButton {...base} attempt state="saving" />);
  let button = screen.getByRole('button', { name: /, saving$/ });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  rerender(<TeamPickButton {...base} attempt state="failed" />);
  button = screen.getByRole('button', { name: /, not saved, retry$/ });
  expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('falls back to the bare Team code for an unrecognized one', () => {
  render(<TeamPickButton team="ZZZ" />);
  expect(screen.getByRole('button', { name: 'ZZZ, ZZZ' })).toBeInTheDocument();
});

test('clicking reports the team code', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn();
  render(<TeamPickButton {...base} onSelect={onSelect} />);
  await user.click(screen.getByRole('button'));
  expect(onSelect).toHaveBeenCalledWith('KC');
});

test('disabled (locked) refuses the click and keeps full contrast: no opacity', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn();
  render(<TeamPickButton {...base} disabled onSelect={onSelect} />);
  const button = screen.getByRole('button');
  await user.click(button);
  expect(onSelect).not.toHaveBeenCalled();
  expect(button).toBeDisabled();
  expect(button).not.toHaveStyle({ opacity: '0.5' });
  expect(getComputedStyle(button).opacity).not.toBe('0.7');
});

test('a saved pick is pressed and shows the check and the word Pick', () => {
  render(<TeamPickButton {...base} picked state="saved" />);
  const button = screen.getByRole('button');
  expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('team-mark')).toHaveTextContent('Pick');
  expect(button.querySelector('svg')).not.toBeNull();
});

test('an unsaved pick is outlined: the word Pick with an empty square and no check', () => {
  render(<TeamPickButton {...base} attempt state="saving" />);
  const button = screen.getByRole('button');
  expect(button).toHaveAttribute('data-attempt', 'true');
  expect(button).not.toHaveAttribute('data-picked');
  expect(screen.getByTestId('team-mark')).toHaveTextContent('Pick');
  expect(button.querySelector('svg')).toBeNull();
});

test('a favorite shows the FAV tag, a non-favorite does not', () => {
  const { rerender } = render(<TeamPickButton {...base} favorite />);
  expect(screen.getByTestId('fav-tag')).toHaveTextContent('FAV');
  rerender(<TeamPickButton {...base} />);
  expect(screen.queryByTestId('fav-tag')).not.toBeInTheDocument();
});

test('a live or final score shows beside the team', () => {
  render(<TeamPickButton {...base} score={17} disabled />);
  expect(screen.getByTestId('team-score')).toHaveTextContent('17');
});

test('the record, when given, is shown', () => {
  render(<TeamPickButton {...base} record="6-1 · home 4-0" />);
  expect(screen.getByText('6-1 · home 4-0')).toBeInTheDocument();
});

test('possession shows a decorative dot, absent otherwise', () => {
  const { rerender } = render(<TeamPickButton {...base} possession />);
  expect(screen.getByTestId('possession-dot')).toBeInTheDocument();
  rerender(<TeamPickButton {...base} />);
  expect(screen.queryByTestId('possession-dot')).not.toBeInTheDocument();
});

test('a winner is bordered in Ink even when it is not the pick', () => {
  render(<TeamPickButton {...base} won disabled />);
  expect(screen.getByRole('button')).toHaveAttribute('data-won', 'true');
  expect(screen.getByRole('button')).toHaveStyle({ borderColor: 'var(--ps-ink)' });
});
