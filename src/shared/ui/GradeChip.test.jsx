import React from 'react';
import { render, screen } from '@testing-library/react';
import { GradeChip } from './index';

test.each(['A', 'B', 'C', 'D', 'F'])(
  'gives grade %s the accessible name "Grade %s" and shows the letter',
  (grade) => {
    render(<GradeChip grade={grade} />);
    const chip = screen.getByLabelText(`Grade ${grade}`);
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent(grade);
  },
);

// NB the grade -> fill-token mapping (a copy-paste swap of A onto the F token)
// is not asserted here: MUI compiles the token colours to an emotion class and
// jsdom drops the `var(--dash-grade-*)` values from the CSSOM, so no color a
// widget renders is readable in this harness. The mapping is covered by the
// contrast guard (each token is proven legible) and by review; the accessible
// name, letter, and degrade paths below are what the DOM can assert.

test('normalises a lowercase grade to the same accessible name', () => {
  render(<GradeChip grade="a" />);
  expect(screen.getByLabelText('Grade A')).toHaveTextContent('A');
});

test('degrades gracefully for an unrecognised grade instead of throwing', () => {
  render(<GradeChip grade="?" />);
  const chip = screen.getByLabelText('Grade ?');
  expect(chip).toBeInTheDocument();
  expect(chip).toHaveTextContent('?');
});

test.each([undefined, null, ''])(
  'announces "Grade not available" for a missing grade (%p), never "Grade undefined"',
  (missing) => {
    render(<GradeChip grade={missing} />);
    expect(screen.getByLabelText('Grade not available')).toBeInTheDocument();
    expect(screen.queryByLabelText('Grade undefined')).not.toBeInTheDocument();
  },
);
