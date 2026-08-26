import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmojiPicker from './EmojiPicker';

// #443: an accessible Unicode emoji picker that participates in the text
// composer. These tests pin the picker's public behaviour in isolation:
// keyboard operability, an accessible name, predictable focus return, and that
// choosing an emoji only reports the chosen Unicode (the composer, not the
// picker, decides what to do with it) and never sends anything itself.

test('the trigger is a button with an accessible name', () => {
  render(<EmojiPicker onSelect={() => {}} />);
  expect(screen.getByRole('button', { name: /emoji/i })).toBeInTheDocument();
});

test('opening the picker reveals a menu of emoji, each with an accessible name', async () => {
  render(<EmojiPicker onSelect={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /emoji/i }));

  // A real menu, not a bare list of glyphs a screen reader cannot name.
  expect(screen.getByRole('menu')).toBeInTheDocument();
  const items = screen.getAllByRole('menuitem');
  expect(items.length).toBeGreaterThan(0);
  // Every choice is nameable (no menuitem whose accessible name is empty).
  items.forEach((item) => expect(item).toHaveAccessibleName());
});

test('choosing an emoji reports its Unicode and closes the menu, without sending', async () => {
  const onSelect = jest.fn();
  render(<EmojiPicker onSelect={onSelect} />);
  await userEvent.click(screen.getByRole('button', { name: /emoji/i }));

  const thumbsUp = screen.getByRole('menuitem', { name: 'thumbs up' });
  await userEvent.click(thumbsUp);

  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith('\u{1F44D}'); // 👍, the Unicode itself
  // The menu closes on choice; the picker never triggers a send of its own.
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('is fully operable by keyboard: open, arrow to an emoji, Enter selects', async () => {
  const onSelect = jest.fn();
  render(<EmojiPicker onSelect={onSelect} />);

  const trigger = screen.getByRole('button', { name: /emoji/i });
  trigger.focus();
  // Enter/Space opens the menu and focus lands inside it (MUI focuses the first
  // item), so a keyboard user is never stranded on a closed control.
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('menu')).toBeInTheDocument();

  // Move within the menu and commit with Enter, no pointer involved.
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(typeof onSelect.mock.calls[0][0]).toBe('string');
});

test('dismissing with Escape returns focus to the trigger', async () => {
  render(<EmojiPicker onSelect={() => {}} />);
  const trigger = screen.getByRole('button', { name: /emoji/i });
  await userEvent.click(trigger);
  expect(screen.getByRole('menu')).toBeInTheDocument();

  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  // Predictable focus return: a dismissed picker leaves the user back on the
  // control they opened it from. Focus lands once the menu finishes closing.
  await waitFor(() => expect(trigger).toHaveFocus());
});
