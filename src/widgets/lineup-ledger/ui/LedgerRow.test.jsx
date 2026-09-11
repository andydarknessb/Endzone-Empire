import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LedgerRow from './LedgerRow';

const entry = (overrides = {}) => ({
  playerId: 1,
  name: 'Josh Allen',
  position: 'QB',
  nflTeam: 'BUF',
  slot: 'QB',
  opponent: 'KC',
  kickoff: '2026-09-14T17:00:00Z',
  gameKey: 'g1',
  projection: 24.3,
  floor: 18,
  ceiling: 30,
  injuryStatus: null,
  locked: false,
  spent: false,
  irAttested: false,
  edge: null,
  availability: { available: true, reason: null },
  ...overrides,
});

test('an empty slot renders a placeholder and no player content', () => {
  render(<LedgerRow slotLabel="QB" entry={null} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveTextContent('Empty');
  expect(screen.queryByTestId('ledger-projection')).toBeNull();
});

test('an occupied row shows name, position/team code, and calls onClick', async () => {
  const onClick = jest.fn();
  render(<LedgerRow slotLabel="QB" entry={entry()} onClick={onClick} data-testid="row" />);
  expect(screen.getByText('Josh Allen')).toBeInTheDocument();
  expect(screen.getByText('QB · BUF')).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('row'));
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('a locked row shows the lock icon and not the legacy chip text', () => {
  render(<LedgerRow slotLabel="QB" entry={entry({ locked: true })} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByTestId('ledger-lock-icon')).toBeInTheDocument();
  expect(screen.queryByText('LOCKED')).toBeNull();
});

test('an injured player shows the injury tag', () => {
  render(<LedgerRow slotLabel="WR" entry={entry({ injuryStatus: 'Q' })} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByTestId('injury-tag')).toHaveTextContent('Q');
});

test('an Unavailable row shows the reason in the projection cell and a dash for points', () => {
  render(
    <LedgerRow
      slotLabel="WR"
      entry={entry({ availability: { available: false, reason: 'out' } })}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  expect(screen.getByTestId('ledger-projection')).toHaveTextContent('out');
  expect(screen.getByTestId('ledger-points')).toHaveTextContent('-');
});

test('an available row shows the projection cell as a number and a dash for points', () => {
  render(<LedgerRow slotLabel="QB" entry={entry()} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByTestId('ledger-projection')).toHaveTextContent('24.3');
  expect(screen.getByTestId('ledger-points')).toHaveTextContent('-');
});

test('the pre-kickoff Game cell shows the opponent and kickoff', () => {
  render(<LedgerRow slotLabel="QB" entry={entry()} onClick={jest.fn()} data-testid="row" />);
  const cell = screen.getByTestId('ledger-game-cell');
  expect(cell).toHaveAttribute('data-game-state', 'pre');
  expect(cell).toHaveTextContent('vs KC');
});

test('a final Game cell shows the final score', () => {
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry()}
      liveRow={{ game_status: 'final', home_team: 'KC', away_team: 'BUF', current_score_home: 20, current_score_away: 27 }}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  const cell = screen.getByTestId('ledger-game-cell');
  expect(cell).toHaveAttribute('data-game-state', 'final');
  // "Final" is a real word, not implied by colour/chip variant alone (a
  // final Game cell must be distinguishable the same way pre and live are).
  expect(cell).toHaveTextContent('Final 27-20');
});

test('a live Game cell shows the clock and score (placeholder, no situation)', () => {
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry()}
      liveRow={{
        game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
        current_score_home: 10, current_score_away: 14, quarter: 'Q2', time_remaining: '4:15',
      }}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  const cell = screen.getByTestId('ledger-game-cell');
  expect(cell).toHaveAttribute('data-game-state', 'live');
  expect(cell).toHaveTextContent('14-10');
  expect(cell).toHaveTextContent('Q2 4:15');
});

test('the Edge line renders the server-computed kind and text', () => {
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry({ edge: { kind: 'factor', text: 'Matchup +3.5' } })}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  const line = screen.getByTestId('ledger-edge-line');
  expect(line).toHaveAttribute('data-edge-kind', 'factor');
  expect(line).toHaveTextContent('Matchup +3.5');
});

test('an edge of kind "none" renders no Edge line', () => {
  render(<LedgerRow slotLabel="QB" entry={entry({ edge: { kind: 'none', text: null } })} onClick={jest.fn()} data-testid="row" />);
  expect(screen.queryByTestId('ledger-edge-line')).toBeNull();
});

test('an IR row with an attested stash shows the ATTESTED indicator', () => {
  render(
    <LedgerRow
      slotLabel="IR"
      entry={entry({ slot: 'IR', irAttested: true, availability: { available: false, reason: 'out' } })}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  expect(screen.getByTestId('ledger-attested-chip')).toBeInTheDocument();
});

test('a spent row is marked disabled and shows a SPENT indicator', async () => {
  const onClick = jest.fn();
  render(<LedgerRow slotLabel="WR" entry={entry({ spent: true })} onClick={onClick} disabled data-testid="row" />);
  expect(screen.getByTestId('ledger-spent-chip')).toBeInTheDocument();
  expect(screen.getByTestId('row')).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(screen.getByTestId('row'));
  expect(onClick).not.toHaveBeenCalled();
});

test('canDrop renders a drop control that calls onRequestDrop without triggering the row click', async () => {
  const onClick = jest.fn();
  const onRequestDrop = jest.fn();
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry()}
      onClick={onClick}
      canDrop
      onRequestDrop={onRequestDrop}
      data-testid="row"
    />
  );
  await userEvent.click(screen.getByRole('button', { name: /drop josh allen/i }));
  expect(onRequestDrop).toHaveBeenCalledWith(entry());
  expect(onClick).not.toHaveBeenCalled();
});

test('canDrop=false renders no drop control', () => {
  render(<LedgerRow slotLabel="QB" entry={entry()} onClick={jest.fn()} data-testid="row" />);
  expect(screen.queryByRole('button', { name: /drop/i })).toBeNull();
});

// Regression for a review finding: the drop control used to be nested
// inside the row's own role="button", so its Enter/Space keydown bubbled up
// into the row's handler, silently starting a swap instead of dropping the
// player - a keyboard-only user could never reach Drop. Drop is now a
// sibling control, so this must never happen again.
test('activating the drop control by keyboard drops the player, not the row', async () => {
  const onClick = jest.fn();
  const onRequestDrop = jest.fn();
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry()}
      onClick={onClick}
      canDrop
      onRequestDrop={onRequestDrop}
      data-testid="row"
    />
  );
  act(() => screen.getByRole('button', { name: /drop josh allen/i }).focus());
  await userEvent.keyboard('{Enter}');
  expect(onRequestDrop).toHaveBeenCalledWith(entry());
  expect(onClick).not.toHaveBeenCalled();
});

test('the row has one concise accessible name rather than its concatenated content', () => {
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry({ locked: true, edge: { kind: 'factor', text: 'Matchup +3.5' } })}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  expect(screen.getByTestId('row')).toHaveAttribute('aria-label', 'Josh Allen, QB, locked');
});

test('an empty slot has an accessible name naming the slot', () => {
  render(<LedgerRow slotLabel="WR 2" entry={null} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveAttribute('aria-label', 'Empty WR 2 slot');
});

test('the drop control is a sibling of the row, not nested inside it (no nested-interactive)', () => {
  render(
    <LedgerRow slotLabel="QB" entry={entry()} onClick={jest.fn()} canDrop onRequestDrop={jest.fn()} data-testid="row" />
  );
  const dropButton = screen.getByRole('button', { name: /drop josh allen/i });
  const row = screen.getByTestId('row');
  expect(row).not.toContainElement(dropButton);
});
