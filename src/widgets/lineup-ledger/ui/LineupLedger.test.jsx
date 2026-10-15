import React from 'react';
import { render, screen } from '@testing-library/react';
import LineupLedger from './LineupLedger';

/**
 * #1425: below `sm` the Ledger asks its page to flip the phone section
 * (`onMobileTabChange`) when a selection's eligible target sits in the hidden
 * one, so a target behind the inactive section is never invisible (the bug
 * report - a manager stuck on Starters after selecting a starter whose only
 * legal targets sat on Bench). The Ledger is controlled (#1965): the page owns
 * `mobileTab` and the phone bar, so these tests read the callback, never a
 * rendered bar, and never layout measurement: jsdom does not evaluate the
 * `sx` breakpoints that hide/show the sections.
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

const starter = (over = {}) => ({ playerId: 1, name: 'Starter One', slot: 'QB', ...over });
const benchPlayer = (over = {}) => ({ playerId: 2, name: 'Bench One', slot: 'BENCH', ...over });
const lineup = () => ({ teamId: 3, season: 2026 });

// The built Ledger sections the Roster entity hands down (#2146): the widget
// renders rows, it does not group entries into them.
const row = (slotType, i, entry) => ({
  key: `${slotType}-${i}`,
  testId: `slot-row-${slotType}-${i}`,
  slotLabel: slotType,
  slotType,
  entry,
});
const sectionsOf = ({ starters, bench }) => ({
  starters: starters.map((entry, i) => row(entry.slot, i, entry)),
  ir: [],
  bench: bench.map((entry, i) => row('BENCH', i, entry)),
});
const sections = () => sectionsOf({ starters: [starter(), { playerId: 3, name: 'Starter Two', slot: 'RB' }], bench: [benchPlayer()] });

const ledgerProps = (props) => ({
  lineup: lineup(),
  sections: sections(),
  isEligibleTarget: () => false,
  selectedEntryId: null,
  onRowClick: jest.fn(),
  mobileTab: 'starters',
  onMobileTabChange: jest.fn(),
  ...props,
});

function renderLedger(props) {
  const merged = ledgerProps(props);
  return { ...render(<LineupLedger {...merged} />), props: merged };
}

// Same technique as LineupPage.test.jsx's own `rulesUnder` (a small local
// copy, deliberately): reads the compiled `sx` rule for one media condition,
// since jsdom does not apply breakpoints.
const rulesUnder = (el, media = '') => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  const norm = (value) => String(value).replace(/\s+/g, '');
  let found = '';
  const walk = (rules, condition) => {
    Array.from(rules).forEach((rule) => {
      if (rule.media) {
        walk(rule.cssRules || [], rule.media.mediaText || '');
        return;
      }
      if (rule.selectorText === `.${cls}` && norm(condition) === norm(media)) found += `${rule.style.cssText};`;
    });
  };
  Array.from(document.styleSheets).forEach((sheet) => walk(sheet.cssRules, ''));
  return found;
};
const sectionOf = (testId) => screen.getByTestId(`${testId}-section`);
// A section's wrapper is `display: block` outright when it is the active tab,
// otherwise `none` at `xs` (and `block` again from `sm`).
const shownBelowSm = (testId) => !rulesUnder(sectionOf(testId), '(min-width:0px)').includes('display: none');

// AC1: Starters active, selecting a starter with an eligible Bench/IR target
// asks the page for the Bench section.
test('selecting a starter with an eligible bench target asks for the Bench section', () => {
  const isEligibleTarget = jest.fn((entry) => Boolean(entry && entry.playerId === 2));
  const { rerender, props } = renderLedger({ isEligibleTarget });
  expect(props.onMobileTabChange).not.toHaveBeenCalled();

  rerender(<LineupLedger {...props} selectedEntryId={1} />);

  expect(props.onMobileTabChange).toHaveBeenCalledTimes(1);
  expect(props.onMobileTabChange).toHaveBeenCalledWith('bench');
});

// AC2: Bench active, selecting a bench/IR player with an eligible Starter
// target asks the page for the Starters section.
test('selecting a bench player with an eligible starter target asks for the Starters section', () => {
  const isEligibleTarget = jest.fn((entry, slotType) => slotType === 'RB');
  const { rerender, props } = renderLedger({ isEligibleTarget, mobileTab: 'bench' });

  rerender(<LineupLedger {...props} selectedEntryId={2} />);

  expect(props.onMobileTabChange).toHaveBeenCalledWith('starters');
});

// AC3: a starter selection with no eligible Bench/IR target - even though an
// eligible Starter-for-starter target exists - asks for nothing.
test('selecting a starter with no eligible bench/IR target asks for nothing', () => {
  const isEligibleTarget = jest.fn((entry, slotType) => slotType === 'RB'); // never BENCH
  const { rerender, props } = renderLedger({ isEligibleTarget });

  rerender(<LineupLedger {...props} selectedEntryId={1} />);

  expect(props.onMobileTabChange).not.toHaveBeenCalled();
});

// AC6: cancelling (selectedEntryId back to null) asks for nothing - no flip
// back.
test('cancelling a selection asks for nothing', () => {
  const isEligibleTarget = jest.fn((entry) => Boolean(entry && entry.playerId === 2));
  const { rerender, props } = renderLedger({ isEligibleTarget, selectedEntryId: 1 });
  props.onMobileTabChange.mockClear();

  rerender(<LineupLedger {...props} selectedEntryId={null} />);

  expect(props.onMobileTabChange).not.toHaveBeenCalled();
});

// AC7: at `sm` and up both sections always show, so a selection never asks.
test('at sm and above, a selection never asks for a section', () => {
  viewport = 1440;
  const isEligibleTarget = jest.fn((entry) => Boolean(entry && entry.playerId === 2));
  const { rerender, props } = renderLedger({ isEligibleTarget });

  rerender(<LineupLedger {...props} selectedEntryId={1} />);

  expect(props.onMobileTabChange).not.toHaveBeenCalled();
});

// #1965: the page owns the phone view. Below `sm` the Ledger shows only the
// section `mobileTab` names, so any other value (Outlook) hides both; from
// `sm` up both always show.
test('below sm only the section named by mobileTab shows; any other value hides both; from sm both show', () => {
  const { rerender, props } = renderLedger({ mobileTab: 'starters' });
  expect(shownBelowSm('ledger-starters')).toBe(true);
  expect(shownBelowSm('ledger-bench')).toBe(false);

  rerender(<LineupLedger {...props} mobileTab="bench" />);
  expect(shownBelowSm('ledger-starters')).toBe(false);
  expect(shownBelowSm('ledger-bench')).toBe(true);

  rerender(<LineupLedger {...props} mobileTab="outlook" />);
  expect(shownBelowSm('ledger-starters')).toBe(false);
  expect(shownBelowSm('ledger-bench')).toBe(false);
  expect(rulesUnder(sectionOf('ledger-starters'), '(min-width:600px)')).toContain('display: block');
  expect(rulesUnder(sectionOf('ledger-bench'), '(min-width:600px)')).toContain('display: block');
});

// #1965: the bar and the sticky container moved to the page.
test('the Ledger renders no phone bar and no sticky footer of its own', () => {
  renderLedger();
  expect(screen.queryByTestId('lineup-mobile-tabs')).toBeNull();
  expect(screen.queryByTestId('lineup-sticky-footer')).toBeNull();
});

// #1957: a spent row has no Drop, but keeps the Drop track so its numbers
// share the right edge of the droppable rows around it.
test('a spent row renders the Drop placeholder when other rows can drop, and none when no row can', () => {
  const spentSections = () =>
    sectionsOf({ starters: [starter({ spent: true }), { playerId: 3, name: 'Starter Two', slot: 'RB' }], bench: [benchPlayer()] });
  const { unmount } = renderLedger({ sections: spentSections(), canDropEntry: () => true });
  expect(screen.getAllByTestId('ledger-drop-spacer')).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: /^Drop / })).toHaveLength(2);
  unmount();
  renderLedger({ sections: spentSections(), canDropEntry: () => false });
  expect(screen.queryByTestId('ledger-drop-spacer')).toBeNull();
});
