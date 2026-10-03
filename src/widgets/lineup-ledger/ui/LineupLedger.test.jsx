import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// Accessibility risk review finding (#1425): the row the manager just
// activated is inside the Starters section, which becomes `display:none`
// once the tab flips - a hidden focused element is dropped to `<body>` per
// the HTML spec. Focus must land on the Bench tab button instead, both to
// recover from that and as the only signal (a real screen-reader
// announcement) that the section changed.
test('selecting a starter that flips the tab moves focus to the Bench tab button', () => {
  const isEligibleTarget = jest.fn((entry) => Boolean(entry && entry.playerId === 2));
  const { rerender } = renderLedger({ isEligibleTarget });

  rerender(<LineupLedger lineup={lineup()} isEligibleTarget={isEligibleTarget} selectedEntryId={1} onRowClick={jest.fn()} />);

  expect(benchPressed()).toBe('true');
  expect(tabButtons()[1]).toHaveFocus();
});

// A manager who switches tabs by hand already carries focus with their own
// click (real click semantics, `userEvent`, not `fireEvent`'s bare
// dispatch) - the auto-switch's focus move must not fight that on a later,
// unrelated render.
test('switching tabs by hand is not overridden by the focus-move effect', async () => {
  const user = userEvent.setup();
  const { rerender } = renderLedger();
  await user.click(tabButtons()[1]);
  expect(tabButtons()[1]).toHaveFocus();

  await user.click(tabButtons()[0]);
  rerender(<LineupLedger lineup={lineup()} isEligibleTarget={() => false} selectedEntryId={null} onRowClick={jest.fn()} />);
  expect(tabButtons()[0]).toHaveFocus();
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

// #1957 L6 / L1: nine starting seats with one empty FLEX, five bench players
// and one IR stash.
const fullSlots = [
  { key: 'QB', count: 1 },
  { key: 'RB', count: 2 },
  { key: 'WR', count: 2 },
  { key: 'TE', count: 1 },
  { key: 'FLEX', count: 1 },
  { key: 'K', count: 1 },
  { key: 'DEF', count: 1 },
];
const fullLineup = () => {
  const filled = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K', 'DEF'];
  return {
    rosterSlots: fullSlots,
    benchSlots: 5,
    irSlots: 1,
    entries: [
      ...filled.map((slot, i) => ({ playerId: 10 + i, name: `Starter ${i}`, slot })),
      ...Array.from({ length: 5 }, (_, i) => ({ playerId: 30 + i, name: `Bench ${i}`, slot: 'BENCH' })),
      { playerId: 40, name: 'Stashed', slot: 'IR' },
    ],
  };
};

test('the phone tabs carry counts: filled starting seats of the total, and occupied Bench plus IR rows', () => {
  renderLedger({ lineup: fullLineup() });
  expect(tabButtons()[0]).toHaveTextContent(/^Starters 8\/9$/);
  expect(tabButtons()[1]).toHaveTextContent(/^Bench 6$/);
});

test('the Bench rows do not scroll inside their card', () => {
  renderLedger({ lineup: fullLineup() });
  expect(getComputedStyle(screen.getByTestId('ledger-bench-rows')).overflowY).not.toBe('auto');
});

// #1957: the page's sticky strip rides in `footer`, in the same sticky
// container as the phone tab bar and above it, so the two cannot overlap.
test('a footer renders before the Starters/Bench buttons inside the same sticky container', () => {
  renderLedger({ footer: <div data-testid="page-footer">Moving Starter One.</div> });
  const sticky = screen.getByTestId('lineup-sticky-footer');
  const footer = within(sticky).getByTestId('page-footer');
  const tabs = within(sticky).getByTestId('lineup-mobile-tabs');
  expect(footer.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(tabs).getAllByRole('button')).toHaveLength(2);
});

test('without a footer the sticky container holds only the tab bar', () => {
  renderLedger();
  const sticky = screen.getByTestId('lineup-sticky-footer');
  expect(within(sticky).getByTestId('lineup-mobile-tabs')).toBeInTheDocument();
  expect(within(sticky).queryByTestId('page-footer')).toBeNull();
});

// #1957: a spent row has no Drop, but keeps the Drop track so its numbers
// share the right edge of the droppable rows around it.
test('a spent row renders the Drop placeholder when other rows can drop, and none when no row can', () => {
  const spentLineup = () => ({
    entries: [starter({ spent: true }), { playerId: 3, name: 'Starter Two', slot: 'RB' }, benchPlayer()],
    rosterSlots,
    benchSlots: 1,
    irSlots: 0,
  });
  const { unmount } = renderLedger({ lineup: spentLineup(), canDropEntry: () => true });
  expect(screen.getAllByTestId('ledger-drop-spacer')).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: /^Drop / })).toHaveLength(2);
  unmount();
  renderLedger({ lineup: spentLineup(), canDropEntry: () => false });
  expect(screen.queryByTestId('ledger-drop-spacer')).toBeNull();
});
