import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

test('renders Upgrade as plain text with no upgradeSort prop', () => {
  renderHead({});
  expect(screen.getByText('Upgrade')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Upgrade/ })).not.toBeInTheDocument();
});

test('renders Upgrade as a clickable sort label when upgradeSort is given', async () => {
  const onClick = jest.fn();
  renderHead({ upgradeSort: { active: true, direction: 'desc', onClick } });

  await userEvent.click(screen.getByText('Upgrade'));
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('hides the Upgrade column entirely for best ball', () => {
  renderHead({ bestBall: true, upgradeSort: { active: false, direction: 'asc', onClick: jest.fn() } });
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
