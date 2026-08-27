import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmojiPicker from './EmojiPicker';

// #443: an accessible Unicode emoji picker that participates in the text
// composer. These tests pin the picker's public behaviour in isolation:
// keyboard operability, an accessible name, predictable focus return, and that
// choosing an emoji only reports the chosen Unicode (the composer, not the
// picker, decides what to do with it) and never sends anything itself.
//
// #488 (follow-up from the #483 review) hardens four of those claims that were
// only nominally true: typeahead, arrow-key reachability that matches the
// announced layout, aria-expanded on the trigger, and focus return when the
// consumer supplies no onChoiceClosed callback.

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

// #488 (1): typeahead. MUI MenuList matches a typed key against each item's
// text (innerText / textContent), never against aria-label. So the human name
// must be REAL text inside the item, which is also what makes it the item's
// accessible name. Typing "f" must jump to the first item named with an "f".
// Removing the visually hidden name text turns this red twice over: typeahead
// would no longer move focus, and the focused item would have no name.
test('typeahead: typing a letter moves focus to an item whose name starts with it', async () => {
  render(<EmojiPicker onSelect={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /emoji/i }));
  // The menu opens with focus on the first item; typeahead moves it.
  await userEvent.keyboard('f');

  // Focus jumps to the first item named with an "f" ("face with tears of joy"
  // in palette order), whose accessible name is exactly that visually hidden
  // text. Without the real name text, typeahead would not move focus at all.
  const target = screen.getByRole('menuitem', { name: 'face with tears of joy' });
  expect(target).toHaveFocus();
  expect(target).toHaveAccessibleName(/^f/i);
});

// #488 (2): the palette is a plain vertical menu, so the arrow keys a screen
// reader is told to use actually reach every item. ArrowDown N-1 times from the
// first item lands on the last, with no 2-D grid surprises (the old wrapped grid
// announced "vertical menu" but moved focus sideways).
test('vertical arrow keys reach the last item in N-1 presses', async () => {
  render(<EmojiPicker onSelect={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /emoji/i }));

  const itemCount = screen.getAllByRole('menuitem').length;

  // Focus starts on the first item; one ArrowDown per remaining item.
  for (let i = 0; i < itemCount - 1; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await userEvent.keyboard('{ArrowDown}');
  }
  // The last menuitem ("american football") now holds focus: the vertical axis
  // reaches it in exactly N-1 presses, as a vertical menu is announced to.
  expect(screen.getByRole('menuitem', { name: 'american football' })).toHaveFocus();
  // The menu is not misannounced as a horizontal list.
  expect(screen.getByRole('menu')).not.toHaveAttribute('aria-orientation', 'horizontal');
});

// #488 (3): the trigger announces whether the menu is open, and points at it.
test('the trigger carries aria-expanded and aria-controls that track the menu', async () => {
  render(<EmojiPicker onSelect={() => {}} />);
  const trigger = screen.getByRole('button', { name: /emoji/i });

  // Closed: expanded is explicitly false, and it controls nothing yet.
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).not.toHaveAttribute('aria-controls');

  await userEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const controls = trigger.getAttribute('aria-controls');
  expect(controls).toBeTruthy();
  // aria-controls names an element that exists while open: the menu list itself.
  expect(screen.getByRole('menu')).toHaveAttribute('id', controls);
});

// #488 (5): with no onChoiceClosed supplied, choosing an emoji must not strand
// focus on document.body (disableRestoreFocus is unconditional); it returns to
// the trigger the user opened the picker from.
test('choosing an emoji with no onChoiceClosed returns focus to the trigger', async () => {
  render(<EmojiPicker onSelect={jest.fn()} />);
  const trigger = screen.getByRole('button', { name: /emoji/i });
  await userEvent.click(trigger);

  await userEvent.click(screen.getByRole('menuitem', { name: 'thumbs up' }));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  // Focus lands once the menu has fully exited, on the trigger by default.
  await waitFor(() => expect(trigger).toHaveFocus());
});
