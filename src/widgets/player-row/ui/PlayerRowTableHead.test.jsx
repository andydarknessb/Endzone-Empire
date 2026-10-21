import React from 'react';
import { screen } from '@testing-library/react';
import { Table, TableBody, TableHead } from '@mui/material';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import PlayerRowTableHead, { playerRowColumnCount } from './PlayerRowTableHead';

function renderHead(props) {
  return renderWithProviders(
    <Table>
      <TableHead>
        <PlayerRowTableHead {...props} />
      </TableHead>
      <TableBody />
    </Table>,
  );
}

test('renders Upgrade as plain text', () => {
  renderHead({});
  expect(screen.getByText('Upgrade')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Upgrade/ })).not.toBeInTheDocument();
});

test('hides the Upgrade column entirely for best ball', () => {
  renderHead({ bestBall: true });
  expect(screen.queryByText('Upgrade')).not.toBeInTheDocument();
});

test('Proj Wk / Weeks headers include the current week when given', () => {
  renderHead({ currentWeek: 5 });
  expect(screen.getByText('Proj Wk 5')).toBeInTheDocument();
  expect(screen.getByText('Weeks 5 to 18')).toBeInTheDocument();
});

test('playerRowColumnCount matches the rendered header cell count in both modes', () => {
  expect(playerRowColumnCount(false)).toBe(8);
  expect(playerRowColumnCount(true)).toBe(7);
});

test('hideOwnership drops the Ownership header and one column from the count', () => {
  renderHead({ hideOwnership: true });
  expect(screen.queryByText('Ownership')).not.toBeInTheDocument();
  expect(playerRowColumnCount(false, true)).toBe(playerRowColumnCount(false) - 1);
  expect(playerRowColumnCount(true, true)).toBe(playerRowColumnCount(true) - 1);
});
