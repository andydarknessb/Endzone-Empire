import React from 'react';
import { render, screen } from '@testing-library/react';
import DraftStartControl from './DraftStartControl';

// The commissioner-only player-market status line on the Start control (#748).
// DraftStartControl is provider-free (plain MUI), so a bare render is enough
// (matches DraftDayControls.test.jsx / DraftStatusBar.test.jsx in this
// directory). teamCount/minimumTeams are chosen so the team-count gate never
// fires here - only the market states are under test.

const baseProps = {
  teamCount: 10,
  minimumTeams: 4,
  onStart: jest.fn().mockResolvedValue({ success: true }),
};

const ABSENT_MARKET = { adpPlayers: 40, floor: 100, lastSyncAt: null, stale: true };
// Noon UTC on both timestamps below so the asserted calendar dates hold
// regardless of the test runner's own time zone.
const STALE_MARKET = { adpPlayers: 250, floor: 100, lastSyncAt: '2026-08-20T12:00:00.000Z', stale: true };
const FRESH_MARKET = { adpPlayers: 250, floor: 100, lastSyncAt: '2026-09-01T12:00:00.000Z', stale: false };

test('an absent market disables Start and names the count against the floor', () => {
  render(<DraftStartControl {...baseProps} market={ABSENT_MARKET} />);

  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeDisabled();
  expect(screen.getByText(
    'The player market has not loaded (40 of 100 players carry an ADP). Ask your admin to run the ADP sync.'
  )).toBeInTheDocument();
});

// Criterion 1's red-tell, pinned as its own boundary case: adpPlayers < floor
// is what "absent" means (decision 2), so a market sitting AT the floor is not
// absent. Swapping the test above's adpPlayers from 40 to 100 (the floor)
// would turn IT red for exactly this reason - verified by hand while writing
// this file (the failing run is pasted in the PR body) - and this case pins
// the boundary permanently rather than leaving it a one-time check.
test('a market exactly at the floor is not absent: Start stays enabled and the absent copy is gone', () => {
  render(
    <DraftStartControl
      {...baseProps}
      market={{ ...ABSENT_MARKET, adpPlayers: ABSENT_MARKET.floor, stale: false }}
    />
  );

  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeEnabled();
  expect(screen.queryByText(/has not loaded/)).not.toBeInTheDocument();
});

test('a stale market keeps Start enabled and names when it last updated', () => {
  jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-02T12:00:00.000Z').getTime());
  try {
    render(<DraftStartControl {...baseProps} market={STALE_MARKET} />);

    expect(screen.getByRole('button', { name: 'Start Draft' })).toBeEnabled();
    expect(screen.getByText('Player market last updated Aug 20. Autopicks will use that market.')).toBeInTheDocument();
  } finally {
    jest.restoreAllMocks();
  }
});

test('a fresh market renders neither status line', () => {
  render(<DraftStartControl {...baseProps} market={FRESH_MARKET} />);

  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeEnabled();
  expect(screen.queryByText(/has not loaded/)).not.toBeInTheDocument();
  expect(screen.queryByText(/last updated/)).not.toBeInTheDocument();
});

test('no market prop renders neither status line (defensive default for a payload that predates it)', () => {
  render(<DraftStartControl {...baseProps} />);

  expect(screen.queryByText(/player market/i)).not.toBeInTheDocument();
});

// 758-f1: getMarketStatus reports stale:true both when the last sync is old
// AND when there has never been a recorded sync at all. It must not print a
// fabricated date: new Date(null) is the Unix epoch, not an Invalid Date, so
// a naive stale check would show "Player market last updated Dec 31, 1969."
// here. #758's interim fix was no line at all; #773 gives this state its own
// copy instead, but the epoch string must never appear regardless of which
// copy renders, so this guard stays even though the state is no longer silent.
test('a market with plenty of players but no recorded sync ever renders no fabricated date', () => {
  render(
    <DraftStartControl {...baseProps} market={{ adpPlayers: 250, floor: 100, lastSyncAt: null, stale: true }} />
  );

  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeEnabled();
  expect(screen.queryByText(/has not loaded/)).not.toBeInTheDocument();
  expect(screen.queryByText(/last updated/)).not.toBeInTheDocument();
  expect(screen.queryByText(/1969/)).not.toBeInTheDocument();
});

// #773: the fourth market state - present, but no sync has ever been
// recorded (lastSyncAt null). Distinct from the stale case above: that state
// has a timestamp worth naming, this one does not, so the copy never claims
// an age. Red-tell: swapping this fixture's lastSyncAt for a real ISO
// timestamp (as STALE_MARKET does) makes the never-synced string disappear
// and the stale string take its place instead - never both, never neither.
const NEVER_SYNCED_MARKET = { adpPlayers: 234, floor: 100, lastSyncAt: null, stale: true };

test('a market with no sync ever recorded shows the never-synced line, not the stale line, and no year', () => {
  render(<DraftStartControl {...baseProps} market={NEVER_SYNCED_MARKET} />);

  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeEnabled();
  expect(screen.getByText(
    'Player market loaded (234 players carry an ADP), but no sync has been recorded. Autopicks will use that market.'
  )).toBeInTheDocument();
  expect(screen.queryByText(/Player market last updated/)).not.toBeInTheDocument();
  expect(screen.queryByText(/20\d{2}/)).not.toBeInTheDocument();
});

test('the never-synced line is exclusive with the stale line: a real lastSyncAt swaps one for the other', () => {
  jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-02T12:00:00.000Z').getTime());
  try {
    render(
      <DraftStartControl
        {...baseProps}
        market={{ ...NEVER_SYNCED_MARKET, lastSyncAt: '2026-08-20T12:00:00.000Z' }}
      />
    );

    expect(screen.queryByText(/no sync has been recorded/)).not.toBeInTheDocument();
    expect(screen.getByText('Player market last updated Aug 20. Autopicks will use that market.')).toBeInTheDocument();
  } finally {
    jest.restoreAllMocks();
  }
});

// 758-f3: showHints (team-count/auction copy) and showMarketStatus (market
// copy) are separate switches - a caller suppressing one must not silently
// suppress the other's information.
test('showMarketStatus suppresses the market line independently of showHints', () => {
  render(<DraftStartControl {...baseProps} market={ABSENT_MARKET} showHints={false} showMarketStatus={false} />);

  expect(screen.queryByText(/has not loaded/)).not.toBeInTheDocument();
  // The absent state still disables Start even when its copy is suppressed -
  // suppressing the message is not the same as suppressing the gate.
  expect(screen.getByRole('button', { name: 'Start Draft' })).toBeDisabled();
});
