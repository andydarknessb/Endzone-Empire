import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ToggleGradeDetails from '../index';

/**
 * toggle-grade-details feature tests (#1104). The widget test
 * (DraftGrades.test.jsx / LeagueDashboardPage.test.jsx) covers what the
 * toggle actually does to the table; this file covers what the control
 * itself renders for a given `expanded`/`onClick`/`controls` it is handed.
 */

test('collapsed: reads "Show steals and reaches" and aria-expanded is false', () => {
  render(<ToggleGradeDetails expanded={false} onClick={() => {}} controls="draft-grades-table-1" />);
  const button = screen.getByRole('button', { name: 'Show steals and reaches' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).toHaveAttribute('aria-controls', 'draft-grades-table-1');
});

test('expanded: reads "Hide steals and reaches" and aria-expanded is true, aria-controls still names the table', () => {
  render(<ToggleGradeDetails expanded onClick={() => {}} controls="draft-grades-table-1" />);
  const button = screen.getByRole('button', { name: 'Hide steals and reaches' });
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(button).toHaveAttribute('aria-controls', 'draft-grades-table-1');
});

test('a click reports through onClick', async () => {
  const user = userEvent.setup();
  const onClick = jest.fn();
  render(<ToggleGradeDetails expanded={false} onClick={onClick} controls="draft-grades-table-1" />);
  await user.click(screen.getByRole('button', { name: 'Show steals and reaches' }));
  expect(onClick).toHaveBeenCalledTimes(1);
});
