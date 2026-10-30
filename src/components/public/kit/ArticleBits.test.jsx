import React from 'react';
import { render, screen } from '@testing-library/react';
import { Note, Pill, Chip, Tag } from './ArticleBits';

// The floor is 13px, and jsdom reports a computed fontSize in the unit the
// stylesheet declared, so a rem size is converted at the browser default 16px
// (0.8125rem = 13px; the old 0.72rem title, 11.5px, lands under it).
const px = (value) => {
  const n = parseFloat(value);
  return /rem$/.test(value) ? n * 16 : n;
};

test('Note is a four-sided callout with a toned uppercase title, never a wide left bar', () => {
  render(<Note title="Lines as of">Body</Note>);

  const note = screen.getByRole('note');
  expect(note).toHaveStyle({
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
  });
  expect(screen.getByText('Lines as of')).toHaveStyle({ textTransform: 'uppercase' });
});

test('every kit label computes at least 13px', () => {
  render(
    <>
      <Pill color="var(--success)">Start</Pill>
      <Chip tone="var(--accent)">Rostered</Chip>
      <Tag kind="BP" />
      <Note title="Lines as of">Body</Note>
    </>
  );

  const labels = [
    screen.getByText('Start'),
    screen.getByText('Rostered'),
    screen.getByText('Big play'),
    screen.getByText('Lines as of'),
  ];
  for (const label of labels) {
    expect(px(getComputedStyle(label).fontSize)).toBeGreaterThanOrEqual(13);
  }
});
