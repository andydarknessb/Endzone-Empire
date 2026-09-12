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

// `data-testid="row"` names the OUTER wrapper (the element
// tests/e2e/auth-offline.spec.ts asserts CONTAINS the row's text); the
// covering swap-select button carries the derived `row-select` id, since it
// holds the interactive semantics (aria-pressed/aria-label/disabled) but no
// text of its own by design.

test('an empty slot renders a placeholder and no player content', () => {
  render(<LedgerRow slotLabel="QB" entry={null} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByText('Empty')).toBeInTheDocument();
  expect(screen.getByTestId('row-select')).toHaveAttribute('aria-label', 'Empty QB slot');
  expect(screen.queryByTestId('ledger-projection')).toBeNull();
});

test('an occupied row shows name, position/team code, and calls onClick', async () => {
  const onClick = jest.fn();
  render(<LedgerRow slotLabel="QB" entry={entry()} onClick={onClick} data-testid="row" />);
  expect(screen.getByText('Josh Allen')).toBeInTheDocument();
  expect(screen.getByText('QB · BUF')).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('row-select'));
  expect(onClick).toHaveBeenCalledTimes(1);
});

// The row's own testid element contains the player's name (e2e contract:
// tests/e2e/auth-offline.spec.ts reads it via toContainText).
test('the element carrying the row testid contains the player\'s name', () => {
  render(<LedgerRow slotLabel="QB" entry={entry()} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByTestId('row')).toHaveTextContent('Josh Allen');
});

// Formal review finding legacy-controls-dropped-without-a-criterion: the
// player name is a real link (opens the Decision card, #1240) again, restored as a
// sibling of the swap-select button so it is independently clickable
// without becoming a nested-interactive descendant of it.
test('the player name opens the Decision card without triggering the row click, and is not nested inside the select button', async () => {
  const onClick = jest.fn();
  const onOpenDecisionCard = jest.fn();
  render(
    <LedgerRow slotLabel="QB" entry={entry()} onClick={onClick} onOpenDecisionCard={onOpenDecisionCard} data-testid="row" />
  );
  const nameLink = screen.getByRole('button', { name: 'Josh Allen' });
  const selectButton = screen.getByTestId('row-select');
  expect(selectButton).not.toContainElement(nameLink);
  await userEvent.click(nameLink);
  expect(onOpenDecisionCard).toHaveBeenCalledWith(1);
  expect(onClick).not.toHaveBeenCalled();
});

test('a locked row shows the lock icon and not the legacy chip text', () => {
  render(<LedgerRow slotLabel="QB" entry={entry({ locked: true })} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByTestId('ledger-lock-icon')).toBeInTheDocument();
  expect(screen.queryByText('LOCKED')).toBeNull();
});

// #1317: the avatar's ink is monogramInk(kit.jersey), not the themed
// var(--text-inverse) - a fixed white or black chosen against the specific
// jersey, since the jersey itself is a fixed external brand color that never
// changes with the theme. CHI's jersey (#0b162a) clears 4.5:1 against white;
// CIN's (#fb4f14) does not.
test('the avatar ink is white for a jersey that clears 4.5:1 against white (CHI)', () => {
  render(<LedgerRow slotLabel="QB" entry={entry({ nflTeam: 'CHI' })} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByText('JA')).toHaveStyle({ color: '#ffffff' });
});

test('the avatar ink is black for a jersey that fails 4.5:1 against white (CIN)', () => {
  render(<LedgerRow slotLabel="QB" entry={entry({ nflTeam: 'CIN' })} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByText('JA')).toHaveStyle({ color: '#000000' });
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

test('an Unavailable Game cell reads its own reason state, distinct from bye (formal review)', () => {
  const { rerender } = render(
    <LedgerRow slotLabel="WR" entry={entry({ availability: { available: false, reason: 'out' } })} onClick={jest.fn()} data-testid="row" />
  );
  expect(screen.getByTestId('ledger-game-cell')).toHaveAttribute('data-game-state', 'unavailable');

  rerender(
    <LedgerRow slotLabel="WR" entry={entry({ onBye: true, availability: { available: false, reason: 'bye' } })} onClick={jest.fn()} data-testid="row" />
  );
  expect(screen.getByTestId('ledger-game-cell')).toHaveAttribute('data-game-state', 'bye');
});

test('an available row with no points yet (pre-kickoff) shows the projection cell as a number and a dash for points', () => {
  render(<LedgerRow slotLabel="QB" entry={entry()} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByTestId('ledger-projection')).toHaveTextContent('24.3');
  expect(screen.getByTestId('ledger-points')).toHaveTextContent('-');
});

test('an available row with actual points (live or final) shows them in the points cell', () => {
  render(<LedgerRow slotLabel="QB" entry={entry({ points: 12.4 })} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByTestId('ledger-points')).toHaveTextContent('12.4');
});

test('an Unavailable row shows a dash for points even when the wire carries a points value', () => {
  render(
    <LedgerRow
      slotLabel="WR"
      entry={entry({ points: 5, availability: { available: false, reason: 'out' } })}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
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

test('a live Game cell shows the clock and score, points in the live colour, and no Situation line when the row carries none', () => {
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry({ points: 12.4 })}
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
  expect(screen.queryByTestId('ledger-situation-line')).toBeNull();
  // #1241 AC2: the points cell paints in the live colour while the game is
  // in progress.
  expect(screen.getByTestId('ledger-points')).toHaveStyle({ color: 'var(--dash-danger)' });
});

// #1241 AC1: the Situation line (possession, down/distance) renders under
// the live state chip, with a red zone marker when the flag is set.
test('a live Game cell with Situation data shows possession, down/distance and a red zone marker', () => {
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry()}
      liveRow={{
        game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
        current_score_home: 10, current_score_away: 14, quarter: 'Q2', time_remaining: '4:15',
        possession: 'BUF', down_distance: '2nd & 7', is_red_zone: true,
      }}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  const situation = screen.getByTestId('ledger-situation-line');
  expect(situation).toHaveTextContent('BUF ball');
  expect(situation).toHaveTextContent('2nd & 7');
  expect(screen.getByTestId('ledger-red-zone-marker')).toBeInTheDocument();
});

// A null Situation (the poll landed before ESPN's own situation object did)
// renders no line at all - never the literal word "null" - and no red zone
// marker.
test('a live Game cell with a null Situation renders no Situation line and no "null" text', () => {
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry()}
      liveRow={{
        game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
        current_score_home: 0, current_score_away: 0, quarter: null, time_remaining: null,
      }}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  expect(screen.queryByTestId('ledger-situation-line')).toBeNull();
  expect(screen.queryByTestId('ledger-red-zone-marker')).toBeNull();
  expect(screen.getByTestId('row')).not.toHaveTextContent('null');
});

// #1292: the last play joins the Situation line, after possession and
// down/distance, using the same middot separator - no new separator, no
// em-dash.
test('a live Game cell with a last play shows it on the Situation line after possession and down/distance', () => {
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry()}
      liveRow={{
        game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
        current_score_home: 10, current_score_away: 14, quarter: 'Q2', time_remaining: '4:15',
        possession: 'BUF', down_distance: '2nd & 7', is_red_zone: false, last_play: 'Allen pass complete to Diggs for 12 yards',
      }}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  const situation = screen.getByTestId('ledger-situation-line');
  expect(situation).toHaveTextContent('BUF ball · 2nd & 7 · Allen pass complete to Diggs for 12 yards');
});

// A null last play (the feed has none yet) is a live game state on its own
// and must still render the Situation line - not dropped by the early-return
// guard - while never rendering the literal word "null".
test('a live Game cell with only a last play (no possession or down/distance) still shows the Situation line', () => {
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry()}
      liveRow={{
        game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
        current_score_home: 10, current_score_away: 14, quarter: 'Q2', time_remaining: '4:15',
        possession: null, down_distance: null, is_red_zone: false, last_play: 'Timeout Kansas City',
      }}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  const situation = screen.getByTestId('ledger-situation-line');
  expect(situation).toHaveTextContent('Timeout Kansas City');
});

test('a live Game cell with a null last play omits it from the Situation line, never as the literal "null"', () => {
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry()}
      liveRow={{
        game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
        current_score_home: 10, current_score_away: 14, quarter: 'Q2', time_remaining: '4:15',
        possession: 'BUF', down_distance: '2nd & 7', is_red_zone: false, last_play: null,
      }}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  const situation = screen.getByTestId('ledger-situation-line');
  expect(situation).toHaveTextContent('BUF ball · 2nd & 7');
  expect(situation).not.toHaveTextContent('null');
});

// A pre-kickoff or final Game cell never paints the points cell in the live
// colour, even when the wire happens to carry a points value.
test('a pre-kickoff Game cell keeps the points cell in the faint colour, never the live colour', () => {
  render(<LedgerRow slotLabel="QB" entry={entry({ points: 12.4 })} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByTestId('ledger-points')).toHaveStyle({ color: 'var(--dash-faint)' });
});

test('a final Game cell keeps the points cell in the faint colour, not the live colour', () => {
  render(
    <LedgerRow
      slotLabel="QB"
      entry={entry({ points: 27 })}
      liveRow={{ game_status: 'final', home_team: 'KC', away_team: 'BUF', current_score_home: 20, current_score_away: 27 }}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  expect(screen.getByTestId('ledger-points')).toHaveStyle({ color: 'var(--dash-faint)' });
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

// #1241 AC3: a server-computed "pace" kind transitions to "result" the
// instant the Realtime live game row reads final, even though the server's
// own edge text (still "pace"-flavoured here) has not been refetched yet -
// the cell must never show a stale kind.
test('a "pace" Edge line displays as "result" once the Game cell reads final, without waiting for a refetch', () => {
  render(
    <LedgerRow
      slotLabel="RB"
      entry={entry({ edge: { kind: 'pace', text: '62% of projection so far' } })}
      liveRow={{ game_status: 'final', home_team: 'KC', away_team: 'BUF', current_score_home: 20, current_score_away: 27 }}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  expect(screen.getByTestId('ledger-edge-line')).toHaveAttribute('data-edge-kind', 'result');
});

// A higher-priority kind (injury, bench-above-starter, factor) is a fact
// about the player, not the game clock, and is never overridden by the live
// game state.
test('an "injury" Edge line is never overridden by the live game state', () => {
  render(
    <LedgerRow
      slotLabel="RB"
      entry={entry({ edge: { kind: 'injury', text: 'Questionable: ankle' } })}
      liveRow={{ game_status: 'final', home_team: 'KC', away_team: 'BUF', current_score_home: 20, current_score_away: 27 }}
      onClick={jest.fn()}
      data-testid="row"
    />
  );
  expect(screen.getByTestId('ledger-edge-line')).toHaveAttribute('data-edge-kind', 'injury');
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
  expect(screen.getByTestId('row-select')).toBeDisabled();
  await userEvent.click(screen.getByTestId('row-select'));
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
  expect(screen.getByTestId('row-select')).toHaveAttribute('aria-label', 'Josh Allen, QB, locked');
});

test('an empty slot has an accessible name naming the slot', () => {
  render(<LedgerRow slotLabel="WR 2" entry={null} onClick={jest.fn()} data-testid="row" />);
  expect(screen.getByTestId('row-select')).toHaveAttribute('aria-label', 'Empty WR 2 slot');
});

test('the drop control is a sibling of the select button, not nested inside it (no nested-interactive)', () => {
  render(
    <LedgerRow slotLabel="QB" entry={entry()} onClick={jest.fn()} canDrop onRequestDrop={jest.fn()} data-testid="row" />
  );
  const dropButton = screen.getByRole('button', { name: /drop josh allen/i });
  const selectButton = screen.getByTestId('row-select');
  expect(selectButton).not.toContainElement(dropButton);
});
