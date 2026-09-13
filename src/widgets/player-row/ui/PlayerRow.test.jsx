import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Table, TableBody } from '@mui/material';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import PlayerRow from './PlayerRow';

const player = (overrides = {}) => ({
  id: 1,
  name: 'Patrick Mahomes',
  position: 'QB',
  nfl_team: 'Kansas City Chiefs',
  availability: { state: 'free_agent', teamId: null, teamName: null, availableAt: null },
  projWeek: { week: 3, points: 22.4 },
  ros: { points: 210.5, perGame: 17.5, posRank: 2, throughWeek: 17 },
  weeks: [{ week: 3, points: 22.4 }, { week: 4, reason: 'on bye' }],
  ownership: null,
  upgrade: null,
  ...overrides,
});

function renderRow(props) {
  return renderWithProviders(
    <Table>
      <TableBody>
        <PlayerRow {...props} />
      </TableBody>
    </Table>,
  );
}

test('a rostered row renders the owning team name and an enabled Trade action', () => {
  renderRow({
    player: player({ availability: { state: 'rostered', teamId: 9, teamName: 'Rival Squad', availableAt: null } }),
    action: { kind: 'link', label: 'Trade', to: '/league/1/trades?receivingTeamId=9&playerId=1' },
  });

  expect(screen.getByText('Rival Squad')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Trade' })).toBeEnabled();
});

test('a free-agent row renders Add', () => {
  renderRow({
    player: player(),
    action: { kind: 'button', label: 'Add free agent', onClick: jest.fn() },
  });

  expect(screen.getByRole('button', { name: 'Add free agent' })).toBeEnabled();
});

test('a waivers row renders Claim', () => {
  renderRow({
    player: player({ availability: { state: 'waivers', teamId: null, teamName: null, availableAt: '2026-09-17T07:00:00.000Z' } }),
    action: { kind: 'button', label: 'Claim', onClick: jest.fn() },
  });

  expect(screen.getByRole('button', { name: 'Claim' })).toBeInTheDocument();
});

test('a my-team row renders Lineup and no Upgrade chip', () => {
  renderRow({
    player: player({ availability: { state: 'my_team', teamId: 1, teamName: null, availableAt: null }, upgrade: null }),
    action: { kind: 'link', label: 'Lineup', to: '/league/1/lineup' },
  });

  expect(screen.getByRole('link', { name: 'Lineup' })).toBeInTheDocument();
  expect(screen.queryByTestId('player-row-upgrade')).not.toBeInTheDocument();
});

test('Ownership renders nothing when null, never a dash or an "unavailable" label', () => {
  renderRow({ player: player({ ownership: null }), action: { kind: 'button', label: 'Add', onClick: jest.fn() } });

  expect(screen.queryByText('-', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
});

test('an unavailable Proj Wk shows the reason, never a fabricated number', () => {
  renderRow({
    player: player({ projWeek: { week: 3, reason: 'on IR' } }),
    action: { kind: 'button', label: 'Add', onClick: jest.fn() },
  });

  expect(screen.getByText('on IR')).toBeInTheDocument();
});

test('bestBall hides the Upgrade column entirely, not just a null value', () => {
  renderRow({
    player: player({ upgrade: { points: 4.1, overPlayer: { id: 9, name: 'Bench' }, slot: 'RB' } }),
    action: { kind: 'button', label: 'Add', onClick: jest.fn() },
    bestBall: true,
  });

  expect(screen.queryByTestId('player-row-upgrade')).not.toBeInTheDocument();
});

test('a positive Upgrade renders as a pill outside best ball', () => {
  renderRow({
    player: player({ upgrade: { points: 4.1, overPlayer: { id: 9, name: 'Bench' }, slot: 'RB' } }),
    action: { kind: 'button', label: 'Add', onClick: jest.fn() },
  });

  expect(screen.getByTestId('player-row-upgrade')).toHaveTextContent('+4.1');
});

// Risk-review finding (accessibility): the mobile card's only route into the
// Decision card used to be the ~24px-tall name link - under the 44px minimum
// every other action on this card carries, and easy to miss entirely. The
// whole identity/status block is a CardActionArea now, so ANY tap there
// opens it, not just the name glyphs.
test('card variant: tapping anywhere in the identity block opens the Decision card, not just the name', async () => {
  const onOpenPlayer = jest.fn();
  renderWithProviders(
    <PlayerRow player={player()} action={{ kind: 'button', label: 'Add', onClick: jest.fn() }} variant="card" onOpenPlayer={onOpenPlayer} />,
  );

  await userEvent.click(within(screen.getByTestId('player-row-card')).getByText('Kansas City Chiefs'));

  expect(onOpenPlayer).toHaveBeenCalledWith(1);
  // The name is plain text here, not a second nested interactive element
  // (a <button> inside the card's own action-area <button> is invalid HTML).
  expect(screen.queryByRole('button', { name: 'Patrick Mahomes' })).not.toBeInTheDocument();
});

test("a waivers row's Clears tooltip keeps the visible relative time as its accessible name, not the absolute timestamp", () => {
  renderRow({
    player: player({ availability: { state: 'waivers', teamId: null, teamName: null, availableAt: '2026-09-17T07:00:00.000Z' } }),
    action: { kind: 'button', label: 'Claim', onClick: jest.fn() },
  });

  const detail = screen.getByTestId('player-row-status-detail');
  expect(detail).not.toHaveAttribute('aria-label');
  expect(detail).toHaveTextContent(/Clears/);
});

test("an action's helper tooltip keeps the button's own label as its accessible name", () => {
  renderRow({
    player: player(),
    action: { kind: 'button', label: 'Add free agent', onClick: jest.fn(), helper: 'Add this available player immediately.' },
  });

  expect(screen.getByRole('button', { name: 'Add free agent' })).toBeInTheDocument();
});

// #1312, ADR 0040 follow-up (grill ruling Q6): the Watch toggle - a plain
// data object the caller builds, the same shape `action` already uses,
// hidden entirely when the caller omits it.
test('watchAction omitted: no Watch control renders', () => {
  renderRow({ player: player(), action: { kind: 'button', label: 'Add', onClick: jest.fn() } });

  expect(screen.queryByTestId('player-row-watch')).not.toBeInTheDocument();
});

test('watchAction: the button label flips from "Watch" to "Watching" from the row payload, no fetch', async () => {
  const onClick = jest.fn();
  renderRow({
    player: player(),
    action: { kind: 'button', label: 'Add', onClick: jest.fn() },
    watchAction: { watching: false, onClick },
  });

  const toggle = screen.getByRole('button', { name: 'Watch' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(toggle);
  expect(onClick).toHaveBeenCalled();
});

test('watchAction: watching renders "Watching" and a disabled toggle while pending', () => {
  renderRow({
    player: player(),
    action: { kind: 'button', label: 'Add', onClick: jest.fn() },
    watchAction: { watching: true, onClick: jest.fn(), pending: true },
  });

  const toggle = screen.getByRole('button', { name: 'Watching' });
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(toggle).toBeDisabled();
});

test('card variant renders the same row content in a stacked layout', () => {
  renderWithProviders(
    <PlayerRow
      player={player()}
      action={{ kind: 'button', label: 'Add free agent', onClick: jest.fn() }}
      variant="card"
    />,
  );

  expect(screen.getByTestId('player-row-card')).toBeInTheDocument();
  expect(within(screen.getByTestId('player-row-card')).getByRole('button', { name: 'Add free agent' })).toBeInTheDocument();
});
