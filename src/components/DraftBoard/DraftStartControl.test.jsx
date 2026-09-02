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
