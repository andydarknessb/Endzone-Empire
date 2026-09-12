import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamPickButton from './TeamPickButton';

test('is a real button whose accessible name is the team\'s full name', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" />);
  expect(screen.getByRole('button', { name: 'Detroit Lions' })).toBeInTheDocument();
});

test('derives the full name from the Team code when none is given', () => {
  render(<TeamPickButton team="DET" />);
  expect(screen.getByRole('button', { name: 'Detroit Lions' })).toBeInTheDocument();
});

test('falls back to the bare Team code for an unrecognized one', () => {
  render(<TeamPickButton team="ZZZ" />);
  expect(screen.getByRole('button', { name: 'ZZZ' })).toBeInTheDocument();
});

test('clicking reports the team code', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn();
  render(<TeamPickButton team="DET" fullName="Detroit Lions" onSelect={onSelect} />);
  await user.click(screen.getByRole('button', { name: 'Detroit Lions' }));
  expect(onSelect).toHaveBeenCalledWith('DET');
});

test('disabled (locked) refuses the click', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn();
  render(<TeamPickButton team="DET" fullName="Detroit Lions" disabled onSelect={onSelect} />);
  await user.click(screen.getByRole('button', { name: 'Detroit Lions' }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Detroit Lions' })).toBeDisabled();
});

test('picked carries aria-pressed and shows a filled radio, no score', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" picked />);
  const button = screen.getByRole('button', { name: 'Detroit Lions' });
  expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('team-radio')).toBeInTheDocument();
  expect(screen.queryByTestId('team-score')).not.toBeInTheDocument();
});

test('a favorite shows the FAV tag', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" favorite />);
  expect(screen.getByTestId('fav-tag')).toHaveTextContent('FAV');
});

test('a non-favorite shows no FAV tag', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" />);
  expect(screen.queryByTestId('fav-tag')).not.toBeInTheDocument();
});

test('a live or final score replaces the radio', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" score={17} />);
  expect(screen.getByTestId('team-score')).toHaveTextContent('17');
  expect(screen.queryByTestId('team-radio')).not.toBeInTheDocument();
});

test('the record, when given, is shown', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" record="6-1 · home 4-0" />);
  expect(screen.getByText('6-1 · home 4-0')).toBeInTheDocument();
});

test('carries the 44px minimum touch target at every width', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" />);
  const button = screen.getByRole('button', { name: 'Detroit Lions' });
  expect(button).toHaveStyle({ minHeight: '64px' });
});

test('a winning team is bordered even when it is not the pick', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" won />);
  expect(screen.getByRole('button', { name: 'Detroit Lions' })).toHaveStyle({
    borderColor: 'var(--dash-away)',
  });
});

test('a losing team dims regardless of whether it was picked', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" picked dim score={7} />);
  expect(screen.getByRole('button', { name: 'Detroit Lions, 7 points' })).toHaveStyle({ opacity: 0.7 });
});

test('the accessible name folds in the score once one exists, since it appears nowhere else on a live or final card', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" score={17} />);
  expect(screen.getByRole('button', { name: 'Detroit Lions, 17 points' })).toBeInTheDocument();
});

test('the accessible name folds in the record when given', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" record="6-1 · home 4-0" />);
  expect(screen.getByRole('button', { name: 'Detroit Lions, 6-1 · home 4-0' })).toBeInTheDocument();
});

test('the accessible name still leads with the team when both record and score are given', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" record="6-1 · home 4-0" score={20} />);
  expect(screen.getByRole('button', { name: 'Detroit Lions, 6-1 · home 4-0, 20 points' })).toBeInTheDocument();
});

test('possession shows a decorative dot, absent otherwise', () => {
  const { rerender } = render(<TeamPickButton team="DET" fullName="Detroit Lions" possession />);
  expect(screen.getByTestId('possession-dot')).toBeInTheDocument();
  rerender(<TeamPickButton team="DET" fullName="Detroit Lions" />);
  expect(screen.queryByTestId('possession-dot')).not.toBeInTheDocument();
});

test('the monogram ink is white for a jersey that clears 4.5:1 against white (#1301)', () => {
  render(<TeamPickButton team="DET" fullName="Detroit Lions" />);
  expect(screen.getByText('DET', { selector: '[aria-hidden="true"]' })).toHaveStyle({
    color: '#ffffff',
  });
});

test('the monogram ink is black for a jersey that falls below 4.5:1 against white (#1301)', () => {
  render(<TeamPickButton team="CIN" fullName="Cincinnati Bengals" />);
  expect(screen.getByText('CIN', { selector: '[aria-hidden="true"]' })).toHaveStyle({
    color: '#000000',
  });
});

test('the monogram ink is black for an unrecognized team code, which resolves to the fallback jersey (#1301)', () => {
  render(<TeamPickButton team="ZZZ" />);
  expect(screen.getByText('ZZZ', { selector: '[aria-hidden="true"]' })).toHaveStyle({
    color: '#000000',
  });
});
