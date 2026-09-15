import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import LineupLedger from './LineupLedger';

/**
 * #1425: the mobile Starters/Bench tab bar auto-switches on selection so an
 * eligible target hidden behind the inactive tab is never invisible (the bug
 * report - a manager stuck on Starters after selecting a starter whose only
 * legal targets sat on Bench). Driven entirely by `aria-pressed` on the tab
 * buttons (AC9), never by layout measurement: jsdom does not evaluate the
 * `sx` breakpoints that hide/show the two columns.
 *
 * `window.matchMedia` is answered against `viewport` (byte-for-byte
 * `LeagueDashboardPage.test.jsx`'s own copy of this pattern) so the widget's
 * own `useMediaQuery(theme.breakpoints.down('sm'))` read resolves for real,
 * rather than mocking `@mui/material` itself.
 */
let viewport = 375; // below `sm` (MUI's default breakpoint is 600px) unless a test says otherwise

beforeEach(() => {
  viewport = 375;
  window.matchMedia = jest.fn().mockImplementation((query) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    let matches = false;
    if (max) matches = viewport <= Number(max[1]);
    else if (min) matches = viewport >= Number(min[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    };
  });
});

const rosterSlots = [
  { key: 'QB', count: 1 },
  { key: 'RB', count: 1 },
];

const starter = (over = {}) => ({ playerId: 1, name: 'Starter One', slot: 'QB', ...over });
const benchPlayer = (over = {}) => ({ playerId: 2, name: 'Bench One', slot: 'BENCH', ...over });
const lineup = () => ({ entries: [starter(), benchPlayer()], rosterSlots, benchSlots: 1, irSlots: 0 });

function renderLedger(props) {
  return render(
    <LineupLedger lineup={lineup()} isEligibleTarget={() => false} selectedEntryId={null} onRowClick={jest.fn()} {...props} />
  );
}

const tabButtons = () => within(screen.getByTestId('lineup-mobile-tabs')).getAllByRole('button');
const startersPressed = () => tabButtons()[0].getAttribute('aria-pressed');
const benchPressed = () => tabButtons()[1].getAttribute('aria-pressed');

// AC1: Starters active, selecting a starter with an eligible Bench/IR target
// switches to Bench.
test('selecting a starter with an eligible bench target switches to the Bench tab', () => {
  const isEligibleTarget = jest.fn((entry) => Boolean(entry && entry.playerId === 2));
  const { rerender } = renderLedger({ isEligibleTarget });
  expect(startersPressed()).toBe('true');

  rerender(<LineupLedger lineup={lineup()} isEligibleTarget={isEligibleTarget} selectedEntryId={1} onRowClick={jest.fn()} />);

  expect(benchPressed()).toBe('true');
  expect(startersPressed()).toBe('false');
});

// AC2: Bench active, selecting a bench/IR player with an eligible Starter
// target switches to Starters.
test('selecting a bench player with an eligible starter target switches to the Starters tab', () => {
  const isEligibleTarget = jest.fn((entry, slotType) => slotType === 'RB');
  const { rerender } = renderLedger({ isEligibleTarget });
  // Land on Bench first, the same way a manager would before selecting.
  fireEvent.click(tabButtons()[1]);
  expect(benchPressed()).toBe('true');

  rerender(<LineupLedger lineup={lineup()} isEligibleTarget={isEligibleTarget} selectedEntryId={2} onRowClick={jest.fn()} />);

  expect(startersPressed()).toBe('true');
});

// AC3: a starter selection with no eligible Bench/IR target - even though an
// eligible Starter-for-starter target exists - stays on Starters.
test('selecting a starter with no eligible bench/IR target stays on Starters', () => {
  const isEligibleTarget = jest.fn((entry, slotType) => slotType === 'RB'); // never BENCH
  const { rerender } = renderLedger({ isEligibleTarget });
  expect(startersPressed()).toBe('true');

  rerender(<LineupLedger lineup={lineup()} isEligibleTarget={isEligibleTarget} selectedEntryId={1} onRowClick={jest.fn()} />);

  expect(startersPressed()).toBe('true');
  expect(benchPressed()).toBe('false');
});

// AC6: cancelling (selectedEntryId back to null) leaves the tab exactly
// where the auto-switch left it - no flip back.
test('cancelling a selection does not change the active tab', () => {
  const isEligibleTarget = jest.fn((entry) => Boolean(entry && entry.playerId === 2));
  const { rerender } = renderLedger({ isEligibleTarget, selectedEntryId: 1 });
  expect(benchPressed()).toBe('true');

  rerender(<LineupLedger lineup={lineup()} isEligibleTarget={isEligibleTarget} selectedEntryId={null} onRowClick={jest.fn()} />);

  expect(benchPressed()).toBe('true');
});

// AC7: at `sm` and up, a selection never changes `mobileTab`.
test('at sm and above, a selection never changes the active tab', () => {
  viewport = 1440;
  const isEligibleTarget = jest.fn((entry) => Boolean(entry && entry.playerId === 2));
  const { rerender } = renderLedger({ isEligibleTarget });
  expect(startersPressed()).toBe('true');

  rerender(<LineupLedger lineup={lineup()} isEligibleTarget={isEligibleTarget} selectedEntryId={1} onRowClick={jest.fn()} />);

  expect(startersPressed()).toBe('true');
  expect(benchPressed()).toBe('false');
});
