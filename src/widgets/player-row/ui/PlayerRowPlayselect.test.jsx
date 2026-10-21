/* eslint-disable testing-library/no-node-access -- the Play-select look is asserted by its class and markup (.cursor, MUI roots), which have no role */
import React from 'react';
import { screen, within } from '@testing-library/react';
import { Table, TableBody } from '@mui/material';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import PlayerRow from './PlayerRow';

// ADR 0067 wave 3: `look` defaults to the dash row; the Waivers page passes "playselect".
const player = (overrides = {}) => ({
  id: 1,
  name: 'Patrick Mahomes',
  position: 'QB',
  nfl_team: 'Kansas City Chiefs',
  availability: { state: 'waivers', teamId: null, teamName: null, availableAt: new Date(Date.now() + 30 * 3600 * 1000).toISOString() },
  projWeek: { week: 3, points: 22.4 },
  ros: { points: 210.5, perGame: 17.5, posRank: 2, throughWeek: 17 },
  weeks: [{ week: 3, points: 22.4 }, { week: 4, reason: 'bye' }],
  ownership: null,
  upgrade: { points: 2.4, week: 5 },
  injury_status: 'Q',
  ...overrides,
});

const renderRow = (props) => renderWithProviders(
  <Table>
    <TableBody>
      <PlayerRow {...props} />
    </TableBody>
  </Table>,
);
const claim = (extra = {}) => ({
  kind: 'button', label: 'Claim', ariaLabel: 'Claim Patrick Mahomes', onClick: () => {}, ...extra,
});

test('with no look the row is the dash MUI row, its Claim a MUI button, and it carries no cursor', () => {
  renderRow({ player: player(), action: claim(), cursor: 'cursor' });
  expect(screen.getByTestId('player-row').className).toMatch(/MuiTableRow-root/);
  expect(screen.getByRole('button', { name: 'Claim Patrick Mahomes' }).className).toMatch(/MuiButton-contained/);
  expect(document.querySelector('.cursor')).toBeNull();
  expect(document.querySelector('[data-variant]')).toBeNull();
});

test('look="playselect": a ghost Claim by default, the filled one only with action.fill', () => {
  const { unmount } = renderRow({ player: player(), action: claim() });
  expect(screen.getByRole('button', { name: 'Claim Patrick Mahomes' })).toHaveAttribute('data-variant', 'ghost');
  unmount();
  renderRow({ player: player(), action: claim({ fill: true }) });
  expect(screen.getByRole('button', { name: 'Claim Patrick Mahomes' })).toHaveAttribute('data-variant', 'fill');
});

test('look="playselect": a pending row names its helper as the button description, not its name', () => {
  renderRow({ player: player(), action: claim({ label: 'Claim #2', ariaLabel: 'Claim #2 Patrick Mahomes', helper: 'You already have a pending claim on this player.' }) });
  const button = screen.getByRole('button', { name: 'Claim #2 Patrick Mahomes' });
  expect(button).toHaveAccessibleDescription('You already have a pending claim on this player.');
});

test('look="playselect": the cursor is one .cursor row, Danger when urgent, and a row without it has none', () => {
  const { unmount } = renderRow({ player: player(), cursor: 'cursor' });
  expect(document.querySelectorAll('.cursor')).toHaveLength(1);
  expect(screen.getByTestId('player-row')).toHaveStyle({ borderColor: 'var(--ps-cursor)' });
  unmount();
  const view = renderRow({ player: player(), cursor: 'urgent' });
  expect(screen.getByTestId('player-row')).toHaveStyle({ borderColor: 'var(--ps-danger)' });
  view.unmount();
  renderRow({ player: player() });
  expect(document.querySelector('.cursor')).toBeNull();
});

test('look="playselect": an outlined Ink Upgrade badge with its week, an injury code, and Danger only under an hour', () => {
  const { unmount } = renderRow({ player: player() });
  expect(screen.getByTestId('player-row-upgrade')).toHaveTextContent('+2.4 Wk 5');
  expect(screen.getByTestId('player-row-upgrade')).toHaveStyle({ border: '2px solid var(--ps-ink)' });
  expect(document.querySelector('[data-status="Q"]')).not.toBeNull();
  expect(screen.getByTestId('player-row-status-detail')).toHaveStyle({ color: 'var(--ps-dim)' });
  unmount();
  renderRow({ player: player({ availability: { state: 'waivers', availableAt: new Date(Date.now() + 45 * 60000).toISOString() } }) });
  expect(screen.getByTestId('player-row-status-detail')).toHaveStyle({ color: 'var(--ps-danger)' });
});

test('look="playselect": the weeks are one labelled image', () => {
  renderRow({ player: player() });
  expect(screen.getByRole('img', { name: /Projected points by week, weeks 3 to 4: week 3 22.4, week 4 bye/ })).toBeInTheDocument();
});

test('look="playselect" card variant: the card is the cursor frame and its one action is the filled button', () => {
  renderWithProviders(
    <PlayerRow variant="card" cursor="cursor" player={player()} action={claim({ fill: true })} />,
  );
  const card = screen.getByTestId('player-row-card');
  expect(card).toHaveClass('cursor');
  expect(card).toHaveStyle({ border: '4px solid var(--ps-cursor)' });
  expect(within(card).getByRole('button', { name: 'Claim Patrick Mahomes' })).toHaveAttribute('data-variant', 'fill');
});
