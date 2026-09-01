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

test('normalises a lowercase grade to the same accessible name', () => {
  render(<GradeChip grade="a" />);
  expect(screen.getByLabelText('Grade A')).toHaveTextContent('A');
});

test('degrades gracefully for an unrecognised grade instead of throwing', () => {
  render(<GradeChip grade="?" />);
  expect(screen.getByLabelText('Grade ?')).toBeInTheDocument();
});
