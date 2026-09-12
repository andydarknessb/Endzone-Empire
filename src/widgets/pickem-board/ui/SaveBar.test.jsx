import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SaveBar from './SaveBar';

test('shows the progress meter', () => {
  render(<SaveBar pickedCount={12} slateSize={16} />);
  expect(screen.getByTestId('save-bar-progress-label')).toHaveTextContent('12 of 16 picked');
  expect(screen.getByTestId('save-bar-progress-fill')).toHaveStyle({ width: '75%' });
});

test('save is disabled with nothing to save', () => {
  render(<SaveBar pickedCount={0} slateSize={16} isDirty={false} />);
  expect(screen.getByTestId('save-bar-save')).toBeDisabled();
});

test('save is enabled once dirty, and reports the click', async () => {
  const user = userEvent.setup();
  const onSave = jest.fn();
  render(<SaveBar pickedCount={5} slateSize={16} isDirty onSave={onSave} />);
  const button = screen.getByTestId('save-bar-save');
  expect(button).not.toBeDisabled();
  await user.click(button);
  expect(onSave).toHaveBeenCalledTimes(1);
});

test('disables again while a save is already in flight', () => {
  render(<SaveBar pickedCount={5} slateSize={16} isDirty saving />);
  expect(screen.getByTestId('save-bar-save')).toBeDisabled();
  expect(screen.getByTestId('save-bar-save')).toHaveTextContent('Saving');
});

test('a general (not per-game) save failure shows its message', () => {
  render(
    <SaveBar
      pickedCount={5}
      slateSize={16}
      isDirty
      saveError={{ code: 'PICKEM_DISABLED', message: "Pick'em is not enabled for this league", gameKeys: [] }}
    />
  );
  expect(screen.getByTestId('save-bar-error')).toHaveTextContent("Pick'em is not enabled for this league");
});

test('a per-game save failure (named gameKeys) is not repeated here', () => {
  render(
    <SaveBar
      pickedCount={5}
      slateSize={16}
      isDirty
      saveError={{ code: 'PICKEM_LOCKED', message: 'too late', gameKeys: ['NO|DET'] }}
    />
  );
  expect(screen.queryByTestId('save-bar-error')).not.toBeInTheDocument();
});

test('a successful save announces a confirmation and moves focus onto it, so a keyboard user is never stranded on <body> when the button disables', async () => {
  const user = userEvent.setup();
  const onSave = jest.fn().mockResolvedValue({ ok: true });
  render(<SaveBar pickedCount={5} slateSize={16} isDirty onSave={onSave} />);
  await user.click(screen.getByTestId('save-bar-save'));

  const status = await screen.findByTestId('save-bar-success');
  expect(status).toHaveTextContent('Picks saved');
  expect(status).toHaveAttribute('role', 'status');
  expect(status).toHaveFocus();
});

test('a failed save shows no success confirmation', async () => {
  const user = userEvent.setup();
  const onSave = jest.fn().mockResolvedValue({ ok: false });
  render(<SaveBar pickedCount={5} slateSize={16} isDirty onSave={onSave} />);
  await user.click(screen.getByTestId('save-bar-save'));
  expect(screen.queryByTestId('save-bar-success')).not.toBeInTheDocument();
});

test('the confirmation clears once a new edit makes the board dirty again', async () => {
  const user = userEvent.setup();
  const onSave = jest.fn().mockResolvedValue({ ok: true });
  const { rerender } = render(<SaveBar pickedCount={5} slateSize={16} isDirty onSave={onSave} />);
  await user.click(screen.getByTestId('save-bar-save'));
  await screen.findByTestId('save-bar-success');

  // A successful save leaves the parent not-dirty (save-picks clears its
  // overrides); a fresh pick then makes it dirty again. That second
  // transition is what should retire the stale confirmation.
  rerender(<SaveBar pickedCount={5} slateSize={16} isDirty={false} onSave={onSave} />);
  rerender(<SaveBar pickedCount={6} slateSize={16} isDirty onSave={onSave} />);
  expect(screen.queryByTestId('save-bar-success')).not.toBeInTheDocument();
});
